
def convert_log_to_json(log_text):
    logs = []

    for line in log_text.splitlines():
        line = line.strip()

        # Skip empty lines and comments
        if not line or line.startswith("#"):
            continue

        parts = line.split(" ", 3)

        # Skip lines that do not have all four fields
        if len(parts) < 4:
            continue

        timestamp = parts[0]
        severity = parts[1]
        source = parts[2]
        message = parts[3]

        logs.append({
            "timestamp": timestamp,
            "severity": severity,
            "source": source,
            "message": message
        })

    return logs
