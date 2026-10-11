"""
app.py - Cybersecurity threat graph + per-node AI reports.

    python app.py sample_logs/cybersecurity_test.log
    (or set LOG_FILE in .env and just run: python app.py)

  Dashboard : http://127.0.0.1:5000/
  Live logs : POST /logs   (raw line, {"raw": "..."} or structured JSON)
  Reports   : GET /api/reports        (every report, list index = node arrival order)
              GET /api/reports/<n>    (report for the n-th node)
"""

import argparse
import copy
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from ai_analyst import Analyst
from graph_engine import ThreatGraph
from convert import convert_log_file_text, normalize_event, parse_timestamp
from node_reports import NodeReports
from full_report import generate_full_report


app = Flask(__name__)

graph = ThreatGraph()
reports = NodeReports(graph, Analyst())
state_lock = threading.RLock()

# 1.0 = log time runs in real time; 15 = 15x faster.
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "1"))
START_CLOCK = os.getenv("START_CLOCK", "20:00:00")   # what the simulation clock shows before/at replay start

parsed_logs = []
start_clock = START_CLOCK
replay_token = 0          # bumped on every start/reset so an old replay thread can never keep running
replay_status = {
    "running": False,
    "finished": False,
    "error": None,
    "processed": 0,
    "total": 0,
    "clock": start_clock,
    "file": None,
}


def load_log_file(filename):
    """Read the log file and convert it to JSON events."""
    path = Path(filename).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Log file not found: {path}")

    events = convert_log_file_text(path.read_text(encoding="utf-8", errors="replace"))
    if not events:
        raise ValueError(f"No valid log events found in {path}")
    return path, events


def ingest_event(event):
    """Single entry point for new events: update the graph, then update the node reports."""
    with state_lock:
        result = graph.ingest(event)
        reports.on_ingest(result["new"], result["changed"])


def _replay_is_current(token):
    return replay_status["running"] and token == replay_token


def clock_origin(first_event_time):
    """Log-time moment the clock starts at: START_CLOCK on the first event's date.
    If the first event is earlier than that, the clock starts at the first event instead."""
    h, m, s = (int(x) for x in START_CLOCK.split(":"))
    origin = first_event_time.replace(hour=h, minute=m, second=s, microsecond=0)
    return min(origin, first_event_time)


def replay_events(token):
    try:
        wall_start = time.monotonic()
        log_start = clock_origin(parse_timestamp(parsed_logs[0]["timestamp"]))

        for index, original_event in enumerate(parsed_logs):
            event = copy.deepcopy(original_event)
            current = parse_timestamp(event["timestamp"])

            target_elapsed = (current - log_start).total_seconds() / REPLAY_SPEED

            # Wait for this event's moment while keeping the simulation clock moving.
            while True:
                with state_lock:
                    if not _replay_is_current(token):
                        return
                    elapsed = time.monotonic() - wall_start
                    remaining = target_elapsed - elapsed
                    if remaining <= 0:
                        break
                    shown = log_start + timedelta(seconds=elapsed * REPLAY_SPEED)
                    replay_status["clock"] = shown.strftime("%H:%M:%S")
                time.sleep(min(remaining, 0.1))

            with state_lock:
                if not _replay_is_current(token):
                    return
                ingest_event(event)
                replay_status["processed"] = index + 1
                replay_status["clock"] = current.strftime("%H:%M:%S")

        with state_lock:
            if _replay_is_current(token):
                replay_status["running"] = False
                replay_status["finished"] = True

    except Exception as exc:
        app.logger.exception("Log replay failed")
        with state_lock:
            if token == replay_token:
                replay_status["running"] = False
                replay_status["error"] = str(exc)


# ------------------------------------------------------------------- pages
@app.route("/")
def home():
    return render_template("index.html")


# ---------------------------------------------------------------- replay API
@app.route("/api/info")
def api_info():
    with state_lock:
        return jsonify({"file": replay_status["file"], "total": replay_status["total"],
                        "clock": replay_status["clock"]})


@app.route("/api/logs")
def api_logs():
    """Return all parsed events from the test file without changing the graph."""
    return jsonify(parsed_logs)


@app.route("/api/start", methods=["POST"])
def api_start():
    global replay_token
    with state_lock:
        if replay_status["running"]:
            return jsonify({"message": "Replay is already running."})
        if replay_status["finished"]:
            return jsonify({"error": "Replay has finished. Reset it before starting again."}), 400
        if replay_status["error"]:
            return jsonify({"error": replay_status["error"]}), 500

        replay_token += 1
        token = replay_token
        replay_status["running"] = True

    threading.Thread(target=replay_events, args=(token,), daemon=True).start()
    return jsonify({"message": "Replay started."})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    global replay_token
    with state_lock:
        replay_token += 1          # any running replay thread stops at its next check
        graph.reset()
        reports.reset()
        replay_status.update({
            "running": False, "finished": False, "error": None,
            "processed": 0, "total": len(parsed_logs), "clock": start_clock,
        })
    return jsonify({"message": "Replay reset."})


@app.route("/api/state")
def api_state():
    with state_lock:
        return jsonify({
            "snapshot": graph.snapshot(),
            "elements": graph.to_cytoscape(),
            "replay": dict(replay_status),
            "recent": graph.recent_events(15),
            "reports": reports.summary(),
        })


@app.route("/api/recent")
def api_recent():
    return jsonify(graph.recent_events(15))


# ---------------------------------------------------------------- report API
@app.route("/api/reports")
def api_reports():
    """Every report. List position == node arrival order."""
    return jsonify(reports.all())


@app.route("/api/reports/<int:index>")
def api_report(index):
    entry = reports.get(index)
    if entry is None:
        return jsonify({"error": "No report for that node yet."}), 404
    return jsonify(entry)


@app.route("/api/full-report", methods=["POST"])
def api_full_report():
    """Full report of every node currently in the graph. Add ?ai=0 to skip the Gemma summary."""
    use_ai = request.args.get("ai", "1") != "0"
    with state_lock:
        clock = replay_status["clock"]
    result = generate_full_report(graph, reports, reports.analyst, state_lock, clock, use_ai)
    if result is None:
        return jsonify({"error": "No nodes in the graph yet. Start the replay first."}), 400
    return jsonify(result)


# ------------------------------------------------------------- live log API
@app.route("/logs", methods=["GET"])
def get_logs():
    """Every event the graph has ingested so far."""
    with graph.lock:
        return jsonify(list(graph.events))


@app.route("/logs", methods=["POST"])
def add_log():
    # accepts JSON ({"raw": "<log line>"} or structured) or a plain-text log line
    payload = request.get_json(silent=True)
    if payload is None:
        payload = request.get_data(as_text=True)
    event = normalize_event(payload)
    if event is None:
        return jsonify({"error": "Could not parse log. Send a raw log line or JSON with a 'raw' field."}), 400
    ingest_event(event)
    return jsonify({"message": "Log added!", "log": payload}), 201


def main():
    global parsed_logs

    parser = argparse.ArgumentParser(description="Replay a log file into the cybersecurity threat graph.")
    parser.add_argument("log_file", nargs="?", default=os.getenv("LOG_FILE", "cybersecurity_test.log"),
                        help="Path to the test log file (default: $LOG_FILE or cybersecurity_test.log)")
    args = parser.parse_args()

    try:
        path, events = load_log_file(args.log_file)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    parsed_logs = events
    replay_status.update({"file": str(path), "total": len(parsed_logs), "clock": START_CLOCK})

    port = int(os.getenv("PORT", "5001"))
    print(f"Loaded {len(parsed_logs)} events from {path}")
    print(f"AI reports: {reports.analyst.mode}")
    print(f"Open http://127.0.0.1:{port} in your browser.")

    # use_reloader=False so Flask doesn't start a second copy of the report worker.
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", use_reloader=False, threaded=True, port=port)


if __name__ == "__main__":
    main()