import shlex
from datetime import datetime, timezone


def convert_log_to_json(log_text):
    """Convert raw log text into structured event dicts for the graph engine."""
    logs = []

    for line_number, line in enumerate(log_text.splitlines(), start=1):
        line = line.strip()

        if not line or line.startswith("#"):
            continue

        # Expected basic format: timestamp severity source message
        parts = line.split(" ", 3)

        if len(parts) < 4:
            continue

        timestamp, severity, source, message = parts

        # Parse key=value fields from the message.
        fields = {}

        try:
            tokens = shlex.split(message)
        except ValueError:
            # Keep processing even if a line has malformed quotes.
            tokens = message.split()

        for token in tokens:
            if "=" not in token:
                continue

            key, value = token.split("=", 1)
            fields[key] = value

        event_type = fields.pop("event", "unknown")

        logs.append({
            "timestamp": timestamp,
            "severity": severity.upper(),
            "source": source,
            "event": event_type,
            "fields": fields,
            "message": message,
            "line_number": line_number
        })

    return logs


# =========================================================================
# Additions (everything above this line is the original, untouched)
# =========================================================================


def parse_timestamp(timestamp):
    """Parse a log timestamp into a naive UTC datetime. Raises ValueError if unsupported."""
    timestamp = str(timestamp).strip()

    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%H:%M:%S"):
            try:
                parsed = datetime.strptime(timestamp, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            raise ValueError(f"Unsupported log timestamp format: {timestamp}")

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def has_valid_timestamp(event):
    try:
        parse_timestamp(event["timestamp"])
        return True
    except (KeyError, ValueError):
        return False


def convert_log_file_text(log_text):
    """convert_log_to_json, minus any events whose timestamp can't be parsed
    (those would crash the replay clock)."""
    return [e for e in convert_log_to_json(log_text) if has_valid_timestamp(e)]


def convert_line_to_event(line):
    """One raw log line -> one event dict (same shape as convert_log_to_json), or None."""
    events = convert_log_file_text(line)
    return events[0] if events else None


def normalize_event(payload):
    """
    What POST /logs receives -> a normalized event dict, or None.
      - a raw log line (string)
      - {"raw": "<log line>"}
      - an already-structured dict with timestamp + event (and optionally
        severity, source, fields, message)
    """
    if isinstance(payload, str):
        return convert_line_to_event(payload)

    if isinstance(payload, dict):
        if "raw" in payload:
            return convert_line_to_event(str(payload["raw"]))

        if "timestamp" in payload and "event" in payload:
            event = {
                "timestamp": str(payload["timestamp"]),
                "severity": str(payload.get("severity", "INFO")).upper(),
                "source": str(payload.get("source", "unknown")),
                "event": str(payload["event"]),
                "fields": {k: str(v) for k, v in (payload.get("fields") or {}).items()},
                "message": str(payload.get("message", "")),
                "line_number": 0,
            }
            return event if has_valid_timestamp(event) else None

    return None