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

## Set up the AI server

Only one person needs to do this, on the computer with the GPU. **Everyone else can skip this part.**

**What you need:** Python 3.10 to 3.12, an NVIDIA GPU, and the Gemma model files in a folder called `gemma-2-2b-it`, right next to `gemma_server.py`.

1. **Open a terminal.** Open the folder with `gemma_server.py` in VS Code and open a terminal.

2. **Make a virtual environment and turn it on:**

```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
```

3. **Install the requirements.** For `torch`, use the install command from the [PyTorch website](https://pytorch.org/get-started/locally/) so you get the GPU version, otherwise it will be really slow.

```powershell
   pip install flask torch transformers accelerate
```

4. **Pick a long password.** This keeps random people from using our AI. You will use it as `GEMMA_TOKEN`.

5. **Start the server** (swap in your real password):

```powershell
   $env:GEMMA_HOST="0.0.0.0"
   $env:GEMMA_TOKEN="your-password"
   python gemma_server.py
```

6. **Wait until you see these two lines:**

```
   Model loaded on: cuda:0
   Running on all addresses (0.0.0.0)
```

7. **Leave the terminal open!** If you close it, the AI stops for everyone. Also don't let the computer go to sleep. The settings in step 5 go away when the terminal closes, so you have to retype them every time.

8. **Allow the VPN through the firewall (one time only).** Open PowerShell as Administrator and run:

```powershell
   New-NetFirewallRule -DisplayName "Gemma server" -Direction Inbound -Protocol TCP -LocalPort 8000 -RemoteAddress 100.64.0.0/10 -Action Allow
```

   This lets the VPN connect to the server and nothing else.

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
