"""
graph_engine.py - builds the threat graph as log events arrive.

Each event adds/updates nodes (user, host, ip, process, file) and edges
(relationships). Simple detection rules flag suspicious activity and raise a
risk score. New nodes are placed near their neighbours while every existing
node stays pinned, so the graph never reshuffles.
"""
import math
import random
import threading

import networkx as nx

ICONS = {"user": "👤", "host": "🖥️", "ip": "🌐", "process": "⚙️", "file": "📄"}

# how many failed logins from one IP before we call it brute force, etc.
BRUTE_FORCE_THRESHOLD = 5
RATE_LIMIT_THRESHOLD = 3

SCANNER_PATHS = ("wp-login", "wp-admin", "phpmyadmin", "/.env", "/.git")

# layout tuning
K_DISTANCE = 95      # ideal distance between connected nodes (pixels)
GRAVITY = 0.12       # strength of the pull toward the center (0 = none)
MAX_RADIUS = 290     # new nodes are never placed farther than this from the center
MIN_GAP = 75         # new nodes are nudged apart until they are at least this far from others
CENTER = "__center__"

# shifts the whole graph so it sits in the middle of the dashboard canvas
CANVAS_OFFSET = (470, 335)


class ThreatGraph:
    def __init__(self):
        self.lock = threading.RLock()
        self.generation = 0
        self.reset()

    # ------------------------------------------------------------------ state
    def reset(self):
        with self.lock:
            self.generation += 1
            self.version = 0
            self.G = nx.MultiDiGraph()
            self.positions = {}
            self.events = []
            self.alerts = []
            self.noise_count = 0
            self._seq = 0
            self._failed_logins = {}   # ip -> {"count": int, "users": set}
            self._rate_limited = {}    # ip -> count
            self._alerted = set()      # (rule, key) pairs already alerted

    # --------------------------------------------------------------- building
    def _node(self, ntype, key, ts, label=None):
        nid = f"{ntype}:{key}"
        if nid not in self.G:
            self.G.add_node(nid, type=ntype, label=label or key, first_seen=ts,
                            last_seen=ts, count=0, risk=0, flags=[], description="",
                            detail="")
        n = self.G.nodes[nid]
        n["last_seen"] = ts
        n["count"] += 1
        return nid

    def _edge(self, src, dst, relation, ts, suspicious=False, reason=""):
        if not self.G.has_edge(src, dst, relation):
            self._seq += 1
            self.G.add_edge(src, dst, key=relation, count=0, first_seen=ts, last_seen=ts,
                            seq=self._seq, suspicious=False, reason="")
        e = self.G.edges[src, dst, relation]
        e["count"] += 1
        e["last_seen"] = ts
        if suspicious:
            e["suspicious"] = True
            e["reason"] = reason or e["reason"]

    def _flag(self, nid, rule, points):
        """Attach a detection to a node and bump its risk (once per rule)."""
        n = self.G.nodes[nid]
        if rule not in n["flags"]:
            n["flags"].append(rule)
            n["risk"] = min(100, n["risk"] + points)

    def _alert(self, ev, rule, severity, message, key, targets):
        """Raise an alert once per (rule, key). targets = {node_id: risk_points}."""
        for nid, pts in targets.items():
            self._flag(nid, rule, pts)
        if (rule, key) in self._alerted:
            return
        self._alerted.add((rule, key))
        self.alerts.append({"timestamp": ev["timestamp"], "rule": rule, "severity": severity,
                            "message": message, "entities": list(targets)})

    # ----------------------------------------------------------------- ingest
    def ingest(self, ev):
        """Add one parsed event to the graph."""
        with self.lock:
            self.events.append(ev)
            before = set(self.G.nodes)

            handler = getattr(self, f"_on_{ev['event']}", None)
            if handler:
                handler(ev, ev["fields"])
            else:
                self.noise_count += 1  # heartbeat, backup, logout... kept in the feed only

            new_nodes = [n for n in self.G.nodes if n not in before]
            self._place_new_nodes(new_nodes)
            self.version += 1

    # ---- event handlers: one method per event type -------------------------
    def _on_login_success(self, ev, f):
        ts = ev["timestamp"]
        ip = self._node("ip", f.get("source_ip", "unknown"), ts)
        user = self._node("user", f.get("user", "unknown"), ts)
        self._edge(ip, user, f"login_success ({f.get('method', '?')})", ts)

    def _on_login_failed(self, ev, f):
        ts = ev["timestamp"]
        src_ip = f.get("source_ip", "unknown")
        ip = self._node("ip", src_ip, ts)
        user = self._node("user", f.get("user", "unknown"), ts)
        self._edge(ip, user, "login_failed", ts)

        st = self._failed_logins.setdefault(src_ip, {"count": 0, "users": set()})
        st["count"] += 1
        st["users"].add(f.get("user", "unknown"))
        if st["count"] >= BRUTE_FORCE_THRESHOLD:
            reason = f"{st['count']} failed logins from {src_ip}"
            for _, _, key, data in self.G.out_edges(ip, keys=True, data=True):
                if key == "login_failed":
                    data["suspicious"], data["reason"] = True, reason
            self._alert(ev, "brute_force", "high",
                        f"{src_ip} failed to log in {st['count']} times against "
                        f"{len(st['users'])} account(s) ({', '.join(sorted(st['users']))}).",
                        key=src_ip, targets={ip: 40})

    def _on_http_request(self, ev, f):
        ts = ev["timestamp"]
        src_ip = f.get("source_ip", "unknown")
        path = f.get("path", "")
        status = f.get("status", "?")
        ip = self._node("ip", src_ip, ts)
        service = self._node("host", ev["source"], ts)
        self._edge(ip, service, f"{f.get('method', 'GET')} {status}", ts)

        low = path.lower()
        if ".." in low or "%2e%2e" in low:
            fnode = self._node("file", path, ts)
            self._edge(ip, fnode, "requested", ts, True, "path traversal attempt")
            self._alert(ev, "path_traversal", "high",
                        f"{src_ip} tried to read files outside the web root ({path}).",
                        key=src_ip, targets={ip: 30, fnode: 30})
        elif any(p in low for p in SCANNER_PATHS):
            fnode = self._node("file", path, ts)
            self._edge(ip, fnode, "requested", ts, True, "scanner probe")
            self._alert(ev, "recon_scan", "medium",
                        f"{src_ip} probed for a known admin/login page ({path}).",
                        key=src_ip, targets={ip: 15, fnode: 15})

        if status == "429":
            n = self._rate_limited[src_ip] = self._rate_limited.get(src_ip, 0) + 1
            if n >= RATE_LIMIT_THRESHOLD:
                for _, _, key, data in self.G.out_edges(ip, keys=True, data=True):
                    if key.endswith("429"):
                        data["suspicious"], data["reason"] = True, "rate limit triggered repeatedly"
                self._alert(ev, "rate_limit_abuse", "medium",
                            f"{src_ip} hit the login rate limit {n} times (possible credential stuffing).",
                            key=src_ip, targets={ip: 30})

    def _on_connection_allowed(self, ev, f):
        ts = ev["timestamp"]
        ip = self._node("ip", f.get("source_ip", "unknown"), ts)
        dst = self._node("host", f.get("destination_ip", "unknown"), ts)
        self._edge(ip, dst, f"tcp/{f.get('destination_port', '?')} allowed", ts)

    def _on_connection_blocked(self, ev, f):
        ts = ev["timestamp"]
        src_ip = f.get("source_ip", "unknown")
        port = f.get("destination_port", "?")
        ip = self._node("ip", src_ip, ts)
        dst = self._node("host", f.get("destination_ip", "unknown"), ts)
        self._edge(ip, dst, f"tcp/{port} blocked", ts, True, f"firewall rule {f.get('rule', '?')}")
        self._alert(ev, "blocked_connection", "medium",
                    f"Firewall blocked {src_ip} from reaching port {port} (rule {f.get('rule', '?')}).",
                    key=(src_ip, port), targets={ip: 20})

    def _process_common(self, ev, f):
        ts = ev["timestamp"]
        host_name = f.get("host", "unknown")
        host = self._node("host", host_name, ts)
        user = self._node("user", f.get("user", "unknown"), ts)
        proc = self._node("process", f"{host_name}/{f.get('process', '?')}", ts, f.get("process", "?"))
        parent_name = f.get("parent", "?")
        parent_id = f"process:{host_name}/{parent_name}"
        parent_is_new = parent_id not in self.G
        parent = self._node("process", f"{host_name}/{parent_name}", ts, parent_name)
        if parent_is_new:
            self._edge(host, parent, "runs", ts)
        self._edge(user, host, "active_on", ts)
        if f.get("command"):
            self.G.nodes[proc]["detail"] = f["command"]
        return host, user, proc, parent

    def _on_process_start(self, ev, f):
        host, user, proc, parent = self._process_common(ev, f)
        self._edge(parent, proc, "spawned", ev["timestamp"])

    def _on_unusual_process(self, ev, f):
        host, user, proc, parent = self._process_common(ev, f)
        why = f.get("detection", "anomaly")
        self._edge(parent, proc, "spawned", ev["timestamp"], True, why)
        self._alert(ev, "suspicious_process", "high",
                    f"{f.get('parent')} spawned {f.get('process')} on {f.get('host')} "
                    f"(command: {f.get('command', 'n/a')}). Office apps rarely launch shells.",
                    key=proc, targets={proc: 50, parent: 20, host: 15, user: 15})

    def _on_privilege_change(self, ev, f):
        ts = ev["timestamp"]
        user = self._node("user", f.get("user", "unknown"), ts)
        service = self._node("host", ev["source"], ts)
        denied = f.get("result") == "denied"
        self._edge(user, service, f"privilege_change -> {f.get('target_role', '?')} ({f.get('result', '?')})",
                   ts, denied, f.get("reason", ""))
        if denied:
            self._alert(ev, "privilege_escalation_attempt", "high",
                        f"{f.get('user')} tried to become {f.get('target_role')} and was denied "
                        f"({f.get('reason', 'no reason given')}).",
                        key=f.get("user"), targets={user: 25})

    def _on_database_connection_failed(self, ev, f):
        ts = ev["timestamp"]
        host = self._node("host", f.get("host", "unknown"), ts)
        db = self._node("host", f.get("database", "unknown"), ts)
        self._edge(host, db, "db_connection_failed", ts)

    def _on_database_connection_restored(self, ev, f):
        ts = ev["timestamp"]
        host = self._node("host", f.get("host", "unknown"), ts)
        db = self._node("host", f.get("database", "unknown"), ts)
        self._edge(host, db, "db_connection_restored", ts)

    # ----------------------------------------------------------------- layout
    def _place_new_nodes(self, new_nodes):
        """Drop each new node next to a neighbour, then let ONLY new nodes settle."""
        if not new_nodes:
            return
        pos = dict(self.positions)
        pinned = list(pos)  # everything that already has a spot stays put
        rng = random.Random(len(self.G) * 7919 + self.version)

        for nid in new_nodes:
            neighbours = [n for n in nx.all_neighbors(self.G, nid) if n in pos]
            angle = rng.uniform(0, 2 * math.pi)
            if neighbours:
                x, y = pos[neighbours[0]]
                pos[nid] = (x + 95 * math.cos(angle), y + 95 * math.sin(angle))
            elif pos:
                cx = sum(p[0] for p in pos.values()) / len(pos)
                cy = sum(p[1] for p in pos.values()) / len(pos)
                pos[nid] = (cx + 200 * math.cos(angle), cy + 200 * math.sin(angle))
            else:
                pos[nid] = (0.0, 0.0)

        if len(self.G) > 1:
            # Layout graph = real graph + a fixed hidden "center" node connected to
            # everything by weak springs. That gentle gravity stops separate clusters
            # from flying apart. Existing nodes (and the center) are pinned.
            layout_graph = nx.Graph(self.G)
            for n in self.G.nodes:
                layout_graph.add_edge(CENTER, n, weight=GRAVITY)
            pos[CENTER] = (0.0, 0.0)
            settled = nx.spring_layout(layout_graph, k=K_DISTANCE, pos=pos,
                                       fixed=pinned + [CENTER], iterations=60,
                                       seed=42, scale=None, center=None)
            pos = {n: (float(x), float(y)) for n, (x, y) in settled.items() if n != CENTER}
            for nid in new_nodes:                      # safety clamp: stay on the canvas
                x, y = pos[nid]
                dist = math.hypot(x, y)
                if dist > MAX_RADIUS:
                    pos[nid] = (x * MAX_RADIUS / dist, y * MAX_RADIUS / dist)
            for _ in range(30):                        # nudge NEW nodes off anything too close
                for nid in new_nodes:
                    for other, (ox, oy) in pos.items():
                        x, y = pos[nid]
                        dx, dy = x - ox, y - oy
                        dist = math.hypot(dx, dy)
                        if other != nid and dist < MIN_GAP:
                            if dist < 1e-6:
                                dx, dy, dist = rng.uniform(-1, 1), rng.uniform(-1, 1), 1.0
                            push = (MIN_GAP - dist) * 0.6 / dist
                            pos[nid] = (x + dx * push, y + dy * push)
        self.positions = pos

    # --------------------------------------------------------------- read side
    def snapshot(self):
        """Plain-dict view of everything - safe to hand to JSON, the UI, or the AI."""
        with self.lock:
            sus = [(d["first_seen"], d["seq"], u, v, k)
                   for u, v, k, d in self.G.edges(keys=True, data=True) if d["suspicious"]]
            sus.sort()
            order = {(u, v, k): i + 1 for i, (_, _, u, v, k) in enumerate(sus)}

            nodes = [{"id": nid, **{k: (list(v) if isinstance(v, list) else v) for k, v in d.items()}}
                     for nid, d in self.G.nodes(data=True)]
            edges = []
            for u, v, k, d in self.G.edges(keys=True, data=True):
                edges.append({"id": f"{u}|{k}|{v}", "source": u, "target": v, "relation": k,
                              "count": d["count"], "suspicious": d["suspicious"], "reason": d["reason"],
                              "order": order.get((u, v, k)), "first_seen": d["first_seen"],
                              "last_seen": d["last_seen"]})
            return {
                "generation": self.generation, "version": self.version,
                "event_count": len(self.events), "noise_count": self.noise_count,
                "nodes": nodes, "edges": edges, "alerts": list(self.alerts),
                "attack_path": [e["id"] for e in sorted(
                    (e for e in edges if e["order"]), key=lambda e: e["order"])],
            }

    def recent_events(self, n=15):
        with self.lock:
            return [{"timestamp": e["timestamp"], "severity": e["severity"],
                     "source": e["source"], "event": e["event"], "fields": e["fields"]}
                    for e in self.events[-n:]]

    def set_descriptions(self, notes):
        """notes = {node_id: 'AI-written description'}"""
        with self.lock:
            for nid, text in notes.items():
                if nid in self.G:
                    self.G.nodes[nid]["description"] = text

    def to_cytoscape(self):
        """Convert the snapshot into Cytoscape.js elements (positions included)."""
        snap = self.snapshot()
        elements = []
        for n in snap["nodes"]:
            x, y = self.positions.get(n["id"], (0, 0))
            elements.append({
                "data": {"id": n["id"], "label": f"{ICONS[n['type']]} {n['label']}",
                         "type": n["type"], "risk": n["risk"]},
                "position": {"x": x + CANVAS_OFFSET[0], "y": y + CANVAS_OFFSET[1]},
            })
        for e in snap["edges"]:
            label = e["relation"] + (f" x{e['count']}" if e["count"] > 1 else "")
            if e["order"]:
                label = f"#{e['order']} {label}"
            elements.append({
                # 'order' is a number on purpose: the stylesheet selects on it, never on log text
                "data": {"id": e["id"], "source": e["source"], "target": e["target"], "label": label,
                         "order": e["order"] or 0},
                "classes": "attack" if e["suspicious"] else "",
            })
        return elements
