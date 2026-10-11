# PenUmbra SOC Auditor™️
A visual threat console for security beginners. It replays a log file in real time, builds a live graph of users, hosts, IPs, processes and files, flags suspicious activity with detection rules, and writes a plain-English AI report for every node. The AI model (Gemma) runs on a separate PC over a Tailscale VPN, so logs never go to a third-party cloud.

## Features

- Live threat graph with risk scores and a numbered attack path
- Seven detection rules (brute force, path traversal, scanning, rate-limit abuse, blocked connections, suspicious processes, denied privilege escalation)
- Click a node for its AI report, which updates as the node changes
- Full incident report on demand, downloadable as Markdown
- Timeline, event feed, alert sound, and a panel to inject live log lines
- Falls back to rules-based reports if the AI is unreachable

## Tech stack

- **Frontend:** React, TypeScript, Vite, Tailwind, Cytoscape.js, Zustand
- **Backend:** Python, Flask, NetworkX
- **AI:** Gemma-2-2b-it over Tailscale

## Run it

You need Python 3.10+ and Node.js 20.19+. Use two terminals.

**Backend**

```bash
cd backend
pip install -r requirements.txt
python app.py sample_logs/cybersecurity_test03.log
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, press the backtick key (`` ` ``) to show the operator panel, and click **Start**. Click any node to read its report, or click **Report** in the header for the full report.

The backend runs on port 5001, and the frontend proxies `/api` and `/logs` to it.

## Enable the AI reports

Put your Gemma server details in `backend/.env` instead of the empty `GEMMA_URL`:

```
GEMMA_URL=http://<tailscale-ip>:8000
GEMMA_TOKEN=<token>
```

The server must accept `POST /generate` with `{"prompt", "max_new_tokens"}` and a bearer token, and return `{"text"}`. Never commit `.env`.

## Sample logs

`backend/sample_logs/` has three synthetic scenarios: `cybersecurity_test01.log` (10 min), `cybersecurity_test02.log` (1 min) and `cybersecurity_test03.log` (5 min). Speed up a replay with `REPLAY_SPEED=10`.

## Troubleshooting

- **403 on port 5000 (macOS):** AirPlay uses that port. This project uses 5001.
- **Header says "Not connected":** start the backend first.
- **Reports say "rules-based":** the AI server is unreachable. Check the VPN, `GEMMA_URL` and `GEMMA_TOKEN`.
