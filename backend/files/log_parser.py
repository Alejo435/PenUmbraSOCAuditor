"""
log_parser.py - turns a raw log line into a clean Python dict.

Line format (from cybersecurity_test.log):
    2026-10-09T20:01:03Z WARN auth-service event=login_failed user=admin source_ip=198.51.100.23 reason=invalid_password
"""
import re
from datetime import datetime

# key=value  OR  key="value with spaces"
KV_PATTERN = re.compile(r'(\w+)=("[^"]*"|\S+)')
# timestamp  SEVERITY  source  rest-of-line
LINE_PATTERN = re.compile(r"^(\S+)\s+(INFO|WARN|WARNING|ERROR|CRITICAL|DEBUG)\s+(\S+)\s*(.*)$")


def parse_timestamp(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def parse_line(line: str):
    """Return an event dict, or None for blank lines / comments / unparseable lines."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None

    match = LINE_PATTERN.match(line)
    if not match:
        return None

    ts, severity, source, rest = match.groups()
    fields = {k: v.strip('"') for k, v in KV_PATTERN.findall(rest)}

    try:
        parse_timestamp(ts)
    except ValueError:
        return None

    return {
        "timestamp": ts,
        "severity": "WARN" if severity == "WARNING" else severity,
        "source": source,
        "event": fields.pop("event", "unknown"),
        "fields": fields,
        "raw": line,
    }


def normalize_event(payload):
    """
    Accepts what POST /logs receives and returns a normalized event (or None):
      - a raw log line as a string
      - {"raw": "<log line>"}
      - an already-structured dict with timestamp/severity/source/event/fields
    """
    if isinstance(payload, str):
        return parse_line(payload)
    if isinstance(payload, dict):
        if "raw" in payload:
            return parse_line(payload["raw"])
        if "timestamp" in payload and "event" in payload:
            return {
                "timestamp": payload["timestamp"],
                "severity": str(payload.get("severity", "INFO")).upper(),
                "source": payload.get("source", "unknown"),
                "event": payload["event"],
                "fields": {k: str(v) for k, v in payload.get("fields", {}).items()},
                "raw": str(payload),
            }
    return None
