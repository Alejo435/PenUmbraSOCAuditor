
import argparse
import copy
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template
from convert import convert_log_to_json
from graph_engine import ThreatGraph

app = Flask(__name__)

graph = ThreatGraph()
state_lock = threading.RLock()

parsed_logs = []
replay_status = {
    "running": False,
    "finished": False,
    "error": None,
    "processed": 0,
    "total": 0,
    "clock": "20:00:00",
    "file": None
}

# One simulated second between events.
EVENT_INTERVAL = 1.0
START_CLOCK = datetime.strptime("20:00:00", "%H:%M:%S")


def load_log_file(filename):
    """Read and parse the test log file."""
    path = Path(filename).expanduser().resolve()

    if not path.is_file():
        raise FileNotFoundError(f"Log file not found: {path}")

    text = path.read_text(encoding="utf-8", errors="replace")
    events = convert_log_to_json(text)

    if not events:
        raise ValueError(f"No valid log events found in {path}")

    return path, events



def get_timestamp(timestamp):
    """Parse supported log timestamp formats."""
    timestamp = timestamp.strip()

    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%H:%M:%S"):
        try:
            return datetime.strptime(timestamp, fmt)
        except ValueError:
            continue

    raise ValueError(f"Unsupported log timestamp format: {timestamp}")





def replay_events():
    try:
        previous_timestamp = None
        simulation_start = time.monotonic()
        log_start_timestamp = None

        for index, original_event in enumerate(parsed_logs):
            with state_lock:
                if not replay_status["running"]:
                    return

            event = copy.deepcopy(original_event)
            current_timestamp = get_timestamp(event["timestamp"])

            # Make timestamps timezone-aware or naive consistently.
            if current_timestamp.tzinfo is not None:
                current_timestamp = current_timestamp.astimezone(timezone.utc).replace(tzinfo=None)

            if log_start_timestamp is None:
                log_start_timestamp = current_timestamp

            if previous_timestamp is not None:
                delay = (current_timestamp - previous_timestamp).total_seconds()
                target_elapsed = (current_timestamp - log_start_timestamp).total_seconds()

                # Keep the simulation clock moving during the wait.
                while True:
                    with state_lock:
                        if not replay_status["running"]:
                            return

                        elapsed = time.monotonic() - simulation_start
                        remaining = target_elapsed - elapsed

                        if remaining <= 0:
                            break

                        simulated_time = log_start_timestamp.timestamp() + elapsed
                        clock_time = datetime.fromtimestamp(simulated_time)

                        replay_status["clock"] = clock_time.strftime("%H:%M:%S")

                    time.sleep(min(remaining, 0.1))

            with state_lock:
                if not replay_status["running"]:
                    return

                graph.ingest(event)
                replay_status["processed"] = index + 1
                replay_status["clock"] = current_timestamp.strftime("%H:%M:%S")

            previous_timestamp = current_timestamp

        with state_lock:
            replay_status["running"] = False
            replay_status["finished"] = True

    except Exception as exc:
        app.logger.exception("Log replay failed")
        with state_lock:
            replay_status["running"] = False
            replay_status["error"] = str(exc)



@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/info")
def api_info():
    with state_lock:
        return jsonify({
            "file": replay_status["file"],
            "total": replay_status["total"],
            "clock": replay_status["clock"]
        })


@app.route("/api/logs")
def api_logs():
    """Return all parsed events without changing the graph."""
    return jsonify(parsed_logs)


@app.route("/api/start", methods=["POST"])
def api_start():
    with state_lock:
        if replay_status["running"]:
            return jsonify({"message": "Replay is already running."})

        if replay_status["finished"]:
            return jsonify({
                "error": "Replay has finished. Reset it before starting again."
            }), 400

        if replay_status["error"]:
            return jsonify({"error": replay_status["error"]}), 500

        replay_status["running"] = True

    thread = threading.Thread(target=replay_events, daemon=True)
    thread.start()

    return jsonify({"message": "Replay started."})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    with state_lock:
        # Stop any active replay before clearing the graph.
        replay_status["running"] = False

    # Allow a running worker to observe the stop flag.
    time.sleep(0.05)

    with state_lock:
        graph.reset()
        replay_status.update({
            "running": False,
            "finished": False,
            "error": None,
            "processed": 0,
            "total": len(parsed_logs),
            "clock": "20:00:00"
        })

    return jsonify({"message": "Replay reset."})


@app.route("/api/state")
def api_state():
    with state_lock:
        snapshot = graph.snapshot()
        elements = graph.to_cytoscape()

        return jsonify({
            "snapshot": snapshot,
            "elements": elements,
            "replay": dict(replay_status)
        })
    

@app.route("/api/recent")
def api_recent():
    return jsonify(graph.recent_events(15))



def main():
    global parsed_logs

    parser = argparse.ArgumentParser(
        description="Replay a log file into the cybersecurity threat graph."
    )
    parser.add_argument(
        "log_file",
        help="Path to the test log file, e.g. sample_logs/cybersecurity_test.log"
    )
    args = parser.parse_args()

    try:
        path, events = load_log_file(args.log_file)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    parsed_logs = events

    replay_status.update({
        "file": str(path),
        "total": len(parsed_logs)
    })

    print(f"Loaded {len(parsed_logs)} events from {path}")
    print("Open http://127.0.0.1:5000 in your browser.")

    # Disable the reloader to avoid launching duplicate replay workers.
    app.run(debug=True, use_reloader=False, threaded=True, port=5001)


if __name__ == "__main__":
    main()
