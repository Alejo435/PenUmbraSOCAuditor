"""
full_report.py - one report covering every node currently in the graph.

Built from the live graph + the per-node reports (reports.entries). Nodes whose
Gemma report isn't finished yet use their rules-based draft and are marked as such.
Only the executive summary needs a Gemma call, and it falls back to rules if
Gemma is unavailable.
"""
from datetime import datetime
from pathlib import Path

from ai_analyst import (FLAG_EXPLAIN, NEXT_STEP, TYPE_DESC, offline_summary,
                        overall_severity)

REPORTS_DIR = Path(__file__).parent / "reports"


def _wrap(text):
    """Keep line breaks when the markdown is rendered."""
    return "  \n".join(text.splitlines())


def _node_tag(entry):
    if entry["source"] == "gemma":
        return "AI report" + (" (update pending)" if entry["status"] in ("updating", "queued", "generating") else "")
    return "Preliminary rules-based draft"


def generate_full_report(graph, reports, analyst, lock, clock="", use_ai=True):
    """Return a dict with the markdown report, or None if the graph is empty."""
    with lock:                                   # one consistent view of graph + reports
        snap = graph.snapshot()
        entries = reports.all()
    if not snap["nodes"]:
        return None

    now = datetime.now()
    labels = {n["id"]: n["label"] for n in snap["nodes"]}
    nodes = {n["id"]: n for n in snap["nodes"]}
    severity = overall_severity(snap["alerts"])

    # Gemma call happens OUTSIDE the lock so the replay keeps running.
    if use_ai and analyst.enabled:
        summary, source, error = analyst.write_summary(snap, severity)
    else:
        summary, source, error = offline_summary(snap), "rules", None

    ai_count = sum(e["source"] == "gemma" for e in entries)
    out = [
        "# Security Assessment Report", "",
        f"**Generated:** {now:%Y-%m-%d %H:%M:%S} | **Log clock:** {clock or 'n/a'}  ",
        f"**Overall severity:** {severity.upper()} | **Events processed:** {snap['event_count']} "
        f"| **Nodes:** {len(snap['nodes'])} | **Alerts:** {len(snap['alerts'])}  ",
        f"**Node reports:** {ai_count} AI-written, {len(entries) - ai_count} preliminary drafts", "",
        "## Executive summary", summary, "",
        "## Detection timeline",
    ]

    if snap["alerts"]:
        out += [f"- `{a['timestamp']}` **{a['rule'].replace('_', ' ')}** ({a['severity']}): {a['message']}"
                for a in snap["alerts"]]
    else:
        out.append("- No detections yet.")

    out += ["", "## Attack path (suspicious connections in order)"]
    path = sorted((e for e in snap["edges"] if e["order"]), key=lambda e: e["order"])
    if path:
        for e in path:
            line = f"{e['order']}. {labels[e['source']]} --{e['relation']}--> {labels[e['target']]}"
            if e["count"] > 1:
                line += f" (x{e['count']})"
            if e["reason"]:
                line += f" - {e['reason']}"
            out.append(line)
    else:
        out.append("- No suspicious connections yet.")

    risky = sorted((n for n in snap["nodes"] if n["risk"] > 0), key=lambda n: (-n["risk"], n["index"]))
    out += ["", "## Entities of concern"]
    if risky:
        out += ["| Node # | Entity | Type | Risk | Detections |", "|---|---|---|---|---|"]
        for n in risky:
            why = "; ".join(FLAG_EXPLAIN.get(f, f) for f in n["flags"])
            out.append(f"| {n['index']} | {n['label']} | {n['type']} | {n['risk']}/100 | {why} |")
    else:
        out.append("- None.")

    out += ["", "## Recommended actions"]
    steps, seen = [], set()
    for n in risky:
        for flag in n["flags"]:
            if flag not in seen and flag in NEXT_STEP:
                seen.add(flag)
                steps.append(NEXT_STEP[flag].format(t=n["label"]))
    out += [f"{i}. {s}" for i, s in enumerate(steps, 1)] or ["- Keep monitoring; nothing to act on yet."]

    out += ["", "## All nodes (in the order they appeared)"]
    for e in entries:
        n = nodes.get(e["node_id"])
        if not n:
            continue
        out += ["", f"### #{e['index']} {n['label']} ({TYPE_DESC.get(n['type'], n['type'])})",
                f"_{_node_tag(e)} - risk {n['risk']}/100_", "",
                _wrap(e["report"] or "No report yet.")]

    if error:
        out += ["", f"_AI summary unavailable, so a rules-based summary was used. ({error})_"]

    markdown = "\n".join(out) + "\n"

    REPORTS_DIR.mkdir(exist_ok=True)
    path_out = REPORTS_DIR / f"full_report_{now:%Y%m%d_%H%M%S}.md"
    path_out.write_text(markdown, encoding="utf-8")

    return {"report": markdown, "source": source, "error": error, "severity": severity,
            "generated_at": f"{now:%H:%M:%S}", "file": path_out.name,
            "nodes": len(snap["nodes"]), "alerts": len(snap["alerts"]), "ai_reports": ai_count}