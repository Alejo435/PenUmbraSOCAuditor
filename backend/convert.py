import shlex


def convert_log_to_json(log_text):
    """Convert raw log text into structured events for the graph engine."""
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
