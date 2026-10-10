# Cybersecurity Log API (Flask)

A starter REST API for uploading, parsing, filtering, and analyzing the included sample `.log` format.

## Run locally

Requires Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\\Scripts\\activate     # Windows
pip install -r requirements.txt
python app.py
```

The API runs at `http://127.0.0.1:5000`.

## Upload the sample log

```bash
curl -X POST http://127.0.0.1:5000/api/logs/upload \
  -F "file=@sample_logs/cybersecurity_test.log"
```

## Endpoints

```text
GET  /api/health
POST /api/logs/upload
GET  /api/logs?limit=20
GET  /api/logs?severity=WARN
GET  /api/logs?event=login_failed
GET  /api/logs?source_ip=198.51.100.23
GET  /api/logs/stats
GET  /api/alerts
```

`GET /api/logs` accepts `severity`, `event`, `source_ip`, `source`, `limit` (1-500), and `offset` query parameters.

## Limitations and next steps

- Events are stored in memory and disappear after restart.
- Uploaded copies are saved in `uploads/`; add retention and cleanup.
- The parser supports the included custom format, not native Windows EVTX, all syslog variants, or Apache combined logs.
- Alert rules are basic heuristics and may produce false positives or miss threats.
- Authentication, authorization, rate limiting, persistent storage, and production deployment are not included.

Before handling real logs, add access controls, retention rules, input validation, and secret/PII protection. Turn off Flask debug mode and use a production WSGI server for deployment. Only analyze logs you own or are authorized to access.
