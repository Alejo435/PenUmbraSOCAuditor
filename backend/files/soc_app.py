"""
app.py - PenUmbra SOC Auditor

One process, one command:  python app.py
  - Flask API   : http://127.0.0.1:5000/            (your original routes still work)
  - Dashboard   : http://127.0.0.1:5000/dashboard/  (graph + AI assessment + report)
  - Replay      : a background thread feeds cybersecurity_test.log in "real time"
  - AI worker   : re-analyses the graph as evidence arrives (Gemini, or rules if no key)
"""
import os
import threading
import time
from datetime import datetime
from pathlib import Path

import dash_cytoscape as cyto
from dash import Dash, Input, Output, State, callback, ctx, dcc, html, no_update
from flask import Flask, jsonify, request

from local_llm import LocalAnalyst as Analyst
from graph_engine import ThreatGraph
from log_parser import normalize_event, parse_line, parse_timestamp

BASE_DIR = Path(__file__).parent
LOG_FILE = Path(os.getenv("LOG_FILE", "cybersecurity_test.log"))
if not LOG_FILE.is_absolute():
    LOG_FILE = BASE_DIR / LOG_FILE
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "15"))        # 15 = log time runs 15x faster
AI_MIN_INTERVAL = float(os.getenv("AI_MIN_INTERVAL", "8"))  # seconds between Gemini calls (free-tier friendly)
AI_BATCH_SIZE = int(os.getenv("AI_BATCH_SIZE", "6"))      # analyze after this many new logs...
AI_IDLE_FLUSH = float(os.getenv("AI_IDLE_FLUSH", "20")) 

# =========================================================================
# Pipeline: ingest -> graph -> AI analysis -> history / report
# =========================================================================
class Pipeline:
    def __init__(self):
        self.graph = ThreatGraph()
        self.analyst = Analyst()
        self.lock = threading.RLock()
        self.raw_logs = []
        self.assessment = None
        self.history = []
        self.dirty = False
        self.last_analysis = 0.0
        self.backoff_until = 0.0
        self.analyzed_events = 0
        self.analyzed_alerts = 0
        self.last_ingest = time.time()
        self.replay = {"running": False, "sent": 0, "total": 0, "error": None}
        self._replay_token = 0
        self._started = False

    # ---- start / restart ---------------------------------------------------
    def start(self):
        if not self._started:
            self._started = True
            threading.Thread(target=self._analysis_loop, daemon=True).start()
        self.start_replay()

    def restart(self):
        self._replay_token += 1  # tells the old replay thread to stop
        with self.lock:
            self.graph.reset()
            self.raw_logs, self.assessment, self.history = [], None, []
            self.dirty = False
            self.analyzed_events = self.analyzed_alerts = 0
        self.start_replay()

    # ---- ingest (used by the replay AND by POST /logs) -----------------------
    def ingest(self, event, payload=None):
        self.graph.ingest(event)
        with self.lock:
            self.raw_logs.append(payload if payload is not None else event["raw"])
            self.dirty = True
            self.last_ingest = time.time()

    # ---- replay simulator ----------------------------------------------------
    def start_replay(self):
        self._replay_token += 1
        threading.Thread(target=self._replay, args=(self._replay_token,), daemon=True).start()

    def _replay(self, token):
        self.replay = {"running": True, "sent": 0, "total": 0, "error": None}
        try:
            events = [e for e in (parse_line(l) for l in LOG_FILE.read_text(encoding="utf-8").splitlines()) if e]
        except OSError as exc:
            self.replay = {"running": False, "sent": 0, "total": 0, "error": f"Cannot read {LOG_FILE.name}: {exc}"}
            return
        self.replay["total"] = len(events)
        previous = None
        for ev in events:
            ts = parse_timestamp(ev["timestamp"])
            if previous is not None:
                gap = (ts - previous).total_seconds() / REPLAY_SPEED
                time.sleep(min(max(gap, 0.25), 2.5))   # keep it watchable
            previous = ts
            if token != self._replay_token:
                return
            self.ingest(ev)
            self.replay["sent"] += 1
        self.replay["running"] = False

    # ---- AI analysis ---------------------------------------------------------
    def _analysis_loop(self):
        while True:
            time.sleep(0.5)
            now = time.time()
            if not self.dirty or now < self.backoff_until:
                continue
            if self.analyst.mode != "gemini":          # rules engine is free, run it freely
                if now - self.last_analysis >= 1.0:
                    self.run_analysis()
                continue
            new_events = len(self.graph.events) - self.analyzed_events
            new_alerts = len(self.graph.alerts) - self.analyzed_alerts
            idle = now - self.last_ingest
            ready = new_events >= AI_BATCH_SIZE or new_alerts > 0 or idle >= AI_IDLE_FLUSH
            if ready and now - self.last_analysis >= AI_MIN_INTERVAL:
                self.run_analysis()

    def run_analysis(self):
        with self.lock:
            self.dirty = False
        generation = self.graph.generation
        snap = self.graph.snapshot()
        if not snap["event_count"]:
            return
        self.analyzed_events = snap["event_count"]
        self.analyzed_alerts = len(snap["alerts"])
        result, source, error = self.analyst.analyze(snap, self.graph.recent_events(5), self.assessment)
        if generation != self.graph.generation:
            return  # a replay restart happened while the AI was thinking
        self.graph.set_descriptions(result["entity_notes"])
        entry = {k: v for k, v in result.items() if k != "entity_notes"}
        entry.update(source=source, error=error, events=snap["event_count"],
                     log_time=self.graph.recent_events(1)[0]["timestamp"])
        with self.lock:
            self.assessment = entry
            self.history.append(entry)
        self.last_analysis = time.time()
        if error and self.analyst.client:
            self.backoff_until = time.time() + 20   # AI failed (e.g. rate limit): rest a bit

    def generate_report(self):
        snap = self.graph.snapshot()
        if not snap["event_count"]:
            return "_No events yet. Wait for the replay to start, then try again._"
        if self.assessment is None:
            self.run_analysis()
        md, source, error = self.analyst.write_report(snap, self.graph.recent_events(5),
                                                      self.assessment, self.history)
        if source == "gemini":
            md += f"\n\n---\n_Report written by Gemini ({self.analyst.model}) from the live graph._"
        elif error:
            md += f"\n\n_AI unavailable, so the rule-based report was used. ({error})_"
        reports = BASE_DIR / "reports"
        reports.mkdir(exist_ok=True)
        (reports / f"report_{datetime.now():%Y%m%d_%H%M%S}.md").write_text(md, encoding="utf-8")
        return md

    def status(self):
        r = self.replay
        return {"ai_mode": self.analyst.mode, "model": self.analyst.model if self.analyst.client else None,
                "ai_error": self.analyst.last_error, "replay": dict(r),
                "events": self.graph.snapshot()["event_count"]}


pipeline = Pipeline()


# =========================================================================
# Flask API (your original routes are kept)
# =========================================================================
app = Flask(__name__)


@app.route("/")
def home():
    return jsonify({"message": "Cybersecurity API is running!", "dashboard": "/dashboard/"})


@app.route("/logs", methods=["GET"])
def get_logs():
    return jsonify(pipeline.raw_logs)


@app.route("/logs", methods=["POST"])
def add_log():
    # accepts JSON ({"raw": "<log line>"} or structured) or a plain-text log line
    payload = request.get_json(silent=True)
    if payload is None:
        payload = request.get_data(as_text=True)
    event = normalize_event(payload)
    if event is None:
        return jsonify({"error": "Could not parse log. Send a raw log line or JSON with a 'raw' field."}), 400
    pipeline.ingest(event, payload)
    return jsonify({"message": "Log added!", "log": payload}), 201


@app.route("/api/graph")
def api_graph():
    snap = pipeline.graph.snapshot()
    return jsonify({"snapshot": snap, "elements": pipeline.graph.to_cytoscape()})


@app.route("/api/assessment")
def api_assessment():
    return jsonify({"assessment": pipeline.assessment, "history": pipeline.history, "status": pipeline.status()})


@app.route("/api/report", methods=["POST"])
def api_report():
    return jsonify({"report": pipeline.generate_report()})


@app.route("/api/replay", methods=["POST"])
def api_replay():
    pipeline.restart()
    return jsonify({"message": "Replay restarted"})


# =========================================================================
# Dashboard (Dash + Cytoscape.js, all Python)
# =========================================================================
SEV_COLOR = {"low": "#22c55e", "medium": "#f59e0b", "high": "#f97316", "critical": "#ef4444"}
ALERT_COLOR = {"medium": "#f59e0b", "high": "#f97316"}
CARD = {"background": "#121a2f", "border": "1px solid #1f2a44", "borderRadius": "10px", "padding": "14px"}
BTN = {"background": "#1d4ed8", "color": "white", "border": "none", "borderRadius": "8px",
       "padding": "8px 14px", "marginLeft": "8px", "cursor": "pointer", "fontWeight": 600}
MUTED = {"color": "#8b9ac0", "fontSize": "12px"}


def build_stylesheet(tick, path_len):
    """Shapes per entity type, colour by risk, and a flowing dashed 'attack path'."""
    offset = 14 - (tick * 2) % 14       # decreasing offset = dashes flow source -> target
    active = (tick // 12) % path_len + 1 if path_len else 0   # sweep through steps in order
    sheet = [
        {"selector": "node", "style": {
            "label": "data(label)", "color": "#e6eaf5", "font-size": 11, "text-valign": "bottom",
            "text-margin-y": 6, "text-outline-color": "#0b1020", "text-outline-width": 2,
            "background-color": "#334155", "border-width": 2, "border-color": "#64748b",
            "width": 40, "height": 40, "shape": "ellipse"}},
        {"selector": 'node[type = "user"]', "style": {"shape": "ellipse"}},
        {"selector": 'node[type = "host"]', "style": {"shape": "round-rectangle"}},
        {"selector": 'node[type = "ip"]', "style": {"shape": "diamond", "width": 46, "height": 46}},
        {"selector": 'node[type = "process"]', "style": {"shape": "hexagon"}},
        {"selector": 'node[type = "file"]', "style": {"shape": "triangle"}},
        {"selector": "node[risk >= 1]", "style": {"background-color": "#a16207", "border-color": "#f59e0b"}},
        {"selector": "node[risk >= 40]", "style": {"background-color": "#c2410c", "border-color": "#f97316"}},
        {"selector": "node[risk >= 60]", "style": {"background-color": "#b91c1c", "border-color": "#ef4444"}},
        {"selector": "edge", "style": {
            "curve-style": "bezier", "target-arrow-shape": "triangle", "width": 1.5,
            "line-color": "#475569", "target-arrow-color": "#475569", "label": "data(label)",
            "font-size": 9, "color": "#94a3b8", "text-rotation": "autorotate",
            "text-background-color": "#0b1020", "text-background-opacity": 0.85,
            "text-background-padding": 2}},
        {"selector": ".attack", "style": {
            "line-color": "#ef4444", "target-arrow-color": "#ef4444", "width": 2.5,
            "line-style": "dashed", "line-dash-pattern": [8, 6], "line-dash-offset": offset,
            "color": "#fca5a5"}},
    ]
    if active:
        sheet.append({"selector": f"edge[order = {int(active)}]", "style": {
            "line-color": "#fde047", "target-arrow-color": "#fde047", "width": 4.5, "z-index": 999}})
    return sheet


def pill(text, color):
    return html.Span(text, style={"background": color, "color": "#0b1020", "borderRadius": "999px",
                                  "padding": "2px 10px", "fontSize": "12px", "fontWeight": 700})


def render_assessment(a):
    if not a:
        return html.Div("Waiting for the first events...", style=MUTED)
    sev = a["severity"]
    return html.Div([
        html.Div([pill(sev.upper(), SEV_COLOR.get(sev, "#999")),
                  html.Span(f"  confidence {a['confidence']}%", style=MUTED),
                  html.Span(f"  | {'Gemini' if a['source'] == 'gemini' else 'rules engine'}", style=MUTED)]),
        html.H3(a["headline"], style={"margin": "10px 0 6px"}),
        html.P(a["summary"], style={"lineHeight": 1.5, "fontSize": "14px"}),
        html.P([html.B("What changed: "), a["what_changed"]], style={"fontSize": "13px", "color": "#b8c4e6"}),
        html.H4("Recommended next steps", style={"marginBottom": "4px"}),
        html.Ul([html.Li(s) for s in a["next_steps"]], style={"fontSize": "13px", "marginTop": 0}),
        html.H4("Open questions", style={"marginBottom": "4px"}),
        html.Ul([html.Li(q) for q in a["open_questions"]], style={"fontSize": "13px", "marginTop": 0}),
    ])


def render_history(history):
    if not history:
        return html.Div("No assessments yet.", style=MUTED)
    items = []
    for h in reversed(history):
        color = SEV_COLOR.get(h["severity"], "#999")
        items.append(html.Div([
            html.Div(style={"width": "10px", "height": "10px", "borderRadius": "50%", "background": color,
                            "marginTop": "5px", "flex": "none"}),
            html.Div([
                html.Div([html.B(f"{h['events']} events in"), html.Span(f"  {h['log_time']}", style=MUTED)]),
                html.Div([pill(h["severity"], color), html.Span(f"  {h['confidence']}%", style=MUTED)],
                         style={"margin": "4px 0"}),
                html.Div(h["headline"], style={"fontSize": "13px"}),
                html.Div(h["what_changed"], style={**MUTED, "marginTop": "2px"}),
            ])], style={"display": "flex", "gap": "10px", "padding": "8px 0", "borderBottom": "1px solid #1f2a44"}))
    return html.Div(items)


def render_alerts(alerts):
    if not alerts:
        return html.Div("No detections yet.", style=MUTED)
    return html.Div([html.Div([
        html.Div([pill(a["severity"], ALERT_COLOR.get(a["severity"], "#999")),
                  html.Span(f"  {a['rule']}  {a['timestamp']}", style=MUTED)]),
        html.Div(a["message"], style={"fontSize": "13px", "marginTop": "4px"})],
        style={"padding": "8px 0", "borderBottom": "1px solid #1f2a44"}) for a in reversed(alerts)])


def render_node(node_id):
    if not node_id:
        return html.Div("Click a node in the graph to see what it is and why it matters.", style=MUTED)
    node = next((n for n in pipeline.graph.snapshot()["nodes"] if n["id"] == node_id), None)
    if not node:
        return html.Div("That node is no longer in the graph.", style=MUTED)
    return html.Div([
        html.Div([html.B(node["label"], style={"fontSize": "15px"}),
                  html.Span(f"  {node['type']}  | risk {node['risk']}/100  | seen {node['count']}x", style=MUTED)]),
        html.Div(node["description"] or "AI description pending...", style={"margin": "6px 0", "fontSize": "13px"}),
        html.Div(f"Detections: {', '.join(node['flags']) or 'none'}", style=MUTED),
        html.Div(f"Detail: {node['detail']}", style=MUTED) if node["detail"] else None,
        html.Div(f"First seen {node['first_seen']}  |  last seen {node['last_seen']}", style=MUTED)])


def render_status():
    s = pipeline.status()
    r = s["replay"]
    ai = f"Gemini ({s['model']})" if s["ai_mode"] == "gemini" else "rules engine (no GEMINI_API_KEY found)"
    parts = [f"Events {r['sent']}/{r['total']}" + ("  (replaying)" if r["running"] else ""), f"AI: {ai}"]
    msg = " | ".join(parts)
    err = r["error"] or s["ai_error"]
    return [html.Span(msg), html.Span(f"   !! {err}", style={"color": "#f97316"}) if err else None]


dash_app = Dash(__name__, server=app, url_base_pathname="/dashboard/", title="PenUmbra SOC Auditor")
dash_app.index_string = """<!DOCTYPE html><html><head>{%metas%}<title>{%title%}</title>{%favicon%}{%css%}
<style>body{margin:0;background:#0b1020;color:#e6eaf5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif}
h3,h4{margin-top:0}</style></head><body>{%app_entry%}<footer>{%config%}{%scripts%}{%renderer%}</footer></body></html>"""

TAB = {"background": "#121a2f", "color": "#8b9ac0", "border": "none", "padding": "8px"}
TAB_ON = {**TAB, "color": "#fff", "borderBottom": "2px solid #6aa9ff"}

dash_app.layout = html.Div([
    dcc.Interval(id="tick", interval=1000),
    dcc.Interval(id="anim", interval=250),
    dcc.Store(id="sent-version"),
    html.Div([
        html.Div([html.H2("PenUmbra SOC Auditor", style={"margin": 0}),
                  html.Div(id="status", style=MUTED)]),
        html.Div([html.Button("Fit view", id="btn-fit", style={**BTN, "background": "#334155"}),
                  html.Button("Replay logs", id="btn-replay", style={**BTN, "background": "#334155"}),
                  html.Button("Generate report", id="btn-report", style=BTN)]),
    ], style={"display": "flex", "justifyContent": "space-between", "alignItems": "center", "padding": "14px 20px"}),
    html.Div([
        html.Div([
            html.Div([
                cyto.Cytoscape(id="graph", elements=[], minZoom=0.2, maxZoom=2.5,
                               layout={"name": "preset", "fit": False, "animate": True, "animationDuration": 500},
                               stylesheet=build_stylesheet(0, 0),
                               style={"width": "100%", "height": "680px"}),
                html.Div("👤 user (circle)   🖥️ host/service (rounded square)   🌐 IP (diamond)   "
                         "⚙️ process (hexagon)   📄 file (triangle)   |   red dashed = attack path, "
                         "numbers show the order it happened", style={**MUTED, "padding": "6px 4px"}),
            ], style=CARD),
            html.Div(id="node-info", style={**CARD, "marginTop": "12px"}),
        ], style={"flex": "3", "minWidth": 0}),
        html.Div(dcc.Tabs(id="tabs", value="assess", colors={"border": "#1f2a44", "primary": "#6aa9ff",
                                                              "background": "#121a2f"}, children=[
            dcc.Tab(label="Assessment", value="assess", style=TAB, selected_style=TAB_ON,
                    children=html.Div(id="assess", style={"padding": "12px"})),
            dcc.Tab(label="History", value="history", style=TAB, selected_style=TAB_ON,
                    children=html.Div(id="history", style={"padding": "12px"})),
            dcc.Tab(label="Alerts", value="alerts", style=TAB, selected_style=TAB_ON,
                    children=html.Div(id="alerts", style={"padding": "12px"})),
            dcc.Tab(label="Report", value="report", style=TAB, selected_style=TAB_ON,
                    children=html.Div(dcc.Loading(dcc.Markdown("Click **Generate report** to have the AI write one.",
                                                               id="report")), style={"padding": "12px"})),
        ]), style={**CARD, "flex": "2", "minWidth": 0, "padding": "0", "overflowY": "auto", "maxHeight": "760px"}),
    ], style={"display": "flex", "gap": "14px", "padding": "0 20px 20px"}),
])


@callback(Output("graph", "elements"), Output("sent-version", "data"), Output("assess", "children"),
          Output("history", "children"), Output("alerts", "children"), Output("status", "children"),
          Input("tick", "n_intervals"), State("sent-version", "data"))
def refresh(_, sent_version):
    graph = pipeline.graph
    version = f"{graph.generation}:{graph.version}"
    elements = no_update if version == sent_version else graph.to_cytoscape()
    snap_alerts = graph.snapshot()["alerts"]
    return (elements, version, render_assessment(pipeline.assessment), render_history(pipeline.history),
            render_alerts(snap_alerts), render_status())


_path_cache = {"key": None, "len": 0}


@callback(Output("graph", "stylesheet"), Input("anim", "n_intervals"))
def animate(tick):
    key = (pipeline.graph.generation, pipeline.graph.version)
    if _path_cache["key"] != key:
        _path_cache.update(key=key, len=len(pipeline.graph.snapshot()["attack_path"]))
    return build_stylesheet(tick or 0, _path_cache["len"])


@callback(Output("node-info", "children"), Input("graph", "tapNodeData"), Input("tick", "n_intervals"))
def show_node(node_data, _):
    return render_node(node_data["id"] if node_data else None)


@callback(Output("report", "children"), Output("tabs", "value"),
          Input("btn-replay", "n_clicks"), Input("btn-report", "n_clicks"), prevent_initial_call=True)
def on_buttons(_replay, _report):
    if ctx.triggered_id == "btn-replay":
        pipeline.restart()
        return "Replay restarted. Click **Generate report** when you are ready.", "assess"
    return pipeline.generate_report(), "report"


@callback(Output("graph", "layout"), Input("btn-fit", "n_clicks"), prevent_initial_call=True)
def fit_view(n):
    return {"name": "preset", "fit": True, "padding": 50, "animate": True, "animationDuration": 400, "nonce": n}


if __name__ == "__main__":
    pipeline.start()
    # use_reloader=False so the replay thread isn't started twice by Flask's auto-reloader
    app.run(debug=True, use_reloader=False, port=int(os.getenv("PORT", "5000")))
