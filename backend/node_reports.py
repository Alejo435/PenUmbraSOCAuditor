"""
node_reports.py - one report per node, kept up to date as the graph changes.

    reports.entries[i]  ->  report for the i-th node that ever appeared in the graph

Each entry:
    index, node_id, label, type, risk,
    report      the text the UI shows
    source      "rules" (draft) or "gemma" (AI-written)
    status      queued | generating | updating | ready | error
    version     how many times Gemma has (re)written it
    error, updated_at

Flow:
  graph.ingest() -> on_ingest(new, changed)  -> instant rules draft + queue the node
  background worker -> asks Gemma for ONE node at a time (newest facts at that moment)
  The UI only reads reports when the user clicks a node.
"""
import os
import threading
import time
from datetime import datetime

RETRY_SECONDS = float(os.getenv("REPORT_RETRY_SECONDS", "15"))   # pause after a failed Gemma call


def _now():
    return datetime.now().strftime("%H:%M:%S")


class NodeReports:
    def __init__(self, graph, analyst):
        self.graph = graph
        self.analyst = analyst
        self.lock = threading.RLock()
        self.wake = threading.Condition(self.lock)
        self._generation = 0
        self.entries = []
        self._index = {}        # node_id -> position in entries
        self._pending = set()   # node ids waiting for Gemma
        threading.Thread(target=self._worker, daemon=True).start()

    # ------------------------------------------------------------------ state
    def reset(self):
        with self.wake:
            self._generation += 1          # any report Gemma is still writing gets discarded
            self.entries = []
            self._index = {}
            self._pending = set()

    # ------------------------------------------------------- called on ingest
    def on_ingest(self, new_ids, changed_ids):
        """new_ids come in arrival order; changed_ids are existing nodes affected by the event."""
        new_set = set(new_ids)
        ids = list(new_ids) + [n for n in changed_ids if n not in new_set]
        contexts = {}
        for nid in ids:                    # read the graph BEFORE taking our own lock
            ctx = self.graph.node_context(nid)
            if ctx:
                contexts[nid] = ctx

        with self.wake:
            for nid in new_ids:            # keep list order == node arrival order
                if nid in contexts and nid not in self._index:
                    self._index[nid] = len(self.entries)
                    self.entries.append({
                        "index": len(self.entries), "node_id": nid, "label": "", "type": "",
                        "risk": 0, "report": "", "source": "none", "status": "queued",
                        "version": 0, "revision": 0, "fails": 0, "error": None,
                        "updated_at": _now()})

            for nid, ctx in contexts.items():
                pos = self._index.get(nid)
                if pos is None:
                    continue
                entry, node = self.entries[pos], ctx["node"]
                entry.update(label=node["label"], type=node["type"], risk=node["risk"],
                             fails=0, error=None, updated_at=_now())
                entry["revision"] += 1
                if entry["source"] == "gemma":
                    entry["status"] = "updating"      # keep showing the last AI report meanwhile
                else:
                    entry["report"] = self.analyst.offline_report(ctx)
                    entry["source"] = "rules"
                    entry["status"] = "queued"
                if self.analyst.enabled:
                    self._pending.add(nid)
                else:
                    entry["status"] = "ready"
            self.wake.notify()

    # ---------------------------------------------------------------- worker
    def _pick(self):
        def key(nid):
            e = self.entries[self._index[nid]]
            return (e["fails"], e["source"] == "gemma", -e["risk"], e["index"])
        return min(self._pending, key=key)

    def _worker(self):
        while True:
            with self.wake:
                while not self._pending:
                    self.wake.wait()
                nid = self._pick()
                self._pending.discard(nid)
                generation = self._generation
                self.entries[self._index[nid]]["status"] = "generating"

            ctx = self.graph.node_context(nid)       # newest facts, read outside our lock
            if ctx is None:
                continue
            report, source, error = self.analyst.write_node_report(ctx)

            failed = source != "gemma" and self.analyst.enabled
            with self.wake:
                pos = self._index.get(nid)
                if generation != self._generation or pos is None:
                    continue                          # graph was reset while Gemma was thinking
                entry = self.entries[pos]
                entry["updated_at"] = _now()
                if failed:
                    entry["fails"] += 1
                    entry["error"] = error
                    entry["status"] = "error"
                    self._pending.add(nid)            # try again after a pause
                else:
                    entry.update(report=report, source=source, error=None, fails=0)
                    entry["version"] += 1
                    entry["status"] = "updating" if nid in self._pending else "ready"
            if failed:
                time.sleep(RETRY_SECONDS)

    # ------------------------------------------------------------- read side
    def get(self, index):
        with self.lock:
            if 0 <= index < len(self.entries):
                return dict(self.entries[index])
            return None

    def all(self):
        with self.lock:
            return [dict(e) for e in self.entries]

    def summary(self):
        with self.lock:
            return {
                "mode": self.analyst.mode,
                "total": len(self.entries),
                "ai_reports": sum(e["source"] == "gemma" for e in self.entries),
                "pending": sum(e["status"] in ("queued", "generating", "updating") for e in self.entries),
                "errors": sum(e["status"] == "error" for e in self.entries),
            }