# PenUmbra SOC Auditor™️- Backend

This is the backend for our project. It reads security logs, makes a graph of what's going on, and uses AI to explain it in plain English so you don't have to be a security expert to follow along.

WHAT IT DOES

1. Reads log lines (basically a record of what happened on a system)
2. Builds a graph showing how users, computers, IP addresses, programs, and files are connected
3. Flags suspicious stuff, like someone failing to log in a bunch of times
4. Uses AI to write short explanations and a report for beginners

THE FILES

soc_app.py - starts the dashboard. This is the one you run on your laptop.
log_parser.py - turns each log line into something the code can read
graph_engine.py - builds the graph and catches the suspicious stuff
ai_analyst.py and local_llm.py - talk to the AI and get the explanations
gemma_server.py - the AI server. Only the one computer with the GPU runs this.
cybersecurity_test.log - a sample log to test with
requirements.txt - everything you need to install

HOW IT ALL WORKS

There are two parts. One computer with a GPU runs the AI server. Everyone else runs the dashboard on their own laptop. The laptops send text to the AI server over a VPN and get explanations back, so nobody else needs the AI model on their laptop.

PART 1 - RUN THE DASHBOARD (everyone does this)

You need Python installed. Open this folder in VS Code, open a terminal, and run these one at a time.

1. Make a virtual environment:
python -m venv .venv

2. Turn it on:
.venv\Scripts\Activate.ps1

3. Install everything:
pip install -r requirements.txt

4. Start it:
python soc_app.py

5. Open your browser and type this in the address bar:
127.0.0.1:5000/dashboard/

You should see the sample log play out and the graph fill in. If the AI isn't connected yet, it still works, it just uses simple built-in explanations.

PART 2 - SET UP THE AI SERVER (only the host computer)

Only one person needs to do this, on the computer with the GPU. Everyone else can skip this part.

What you need: Python 3.10 to 3.12, an NVIDIA GPU, and the Gemma model files in a folder called gemma-2-2b-it, right next to gemma_server.py.

1. Open the folder with gemma_server.py in VS Code and open a terminal.

2. Make a virtual environment and turn it on:
python -m venv .venv
.venv\Scripts\Activate.ps1

3. Install the stuff it needs. For torch, use the install command from the PyTorch website so you get the GPU version, otherwise it'll be really slow:
pip install flask torch transformers accelerate

4. Pick a long password. This keeps random people from using our AI.

5. Start the server (swap in your real password):
$env:GEMMA_HOST="0.0.0.0"
$env:GEMMA_TOKEN="your-password"
python gemma_server.py

6. Wait until you see these two lines:
Model loaded on: cuda:0
Running on all addresses (0.0.0.0)

7. Leave the terminal open! If you close it, the AI stops for everyone. Also don't let the computer go to sleep. The settings in step 5 go away when the terminal closes, so you have to retype them every time.

8. Do this one time only. Open PowerShell as Administrator and run:
New-NetFirewallRule -DisplayName "Gemma server" -Direction Inbound -Protocol TCP -LocalPort 8000 -RemoteAddress 100.64.0.0/10 -Action Allow
This lets the VPN connect to the server and nothing else.

To check that it works on the same computer:
python -c "import requests; print(requests.get('http://127.0.0.1:8000/health', headers={'Authorization':'Bearer your-password'}).json())"
You should see status: ok.

PART 3 - CONNECT THROUGH THE VPN

We use a free VPN called Tailscale. It gives every computer a private address that starts with 100, so people in different buildings can reach the AI server without putting it on the public internet.

On the host computer (the one with the AI):
1. Download Tailscale (search for the Tailscale download page), install it, and sign in
2. Open a new terminal and run:
tailscale ip -4
3. Write down the address it gives you. It's four numbers with dots, starting with 100
4. To add a teammate, go to the Tailscale admin page in your browser, click Machines, click the three dots next to the host computer, and pick Share. Send them the invite link. They can only see the AI computer, not your other stuff.

On your laptop:
1. Download Tailscale, install it, and sign in with your own account
2. Accept the invite you got. The host computer should show up in your Tailscale app
3. Check that you're connected:
tailscale status
4. Test it with the real address and password you were given:
python -c "import requests; print(requests.get('http://100.x.y.z:8000/health', headers={'Authorization':'Bearer your-password'}).json())"
You should see status: ok.

Then make a file called .env in the same folder as soc_app.py and put this in it:

GEMMA_URL=http://100.x.y.z:8000
GEMMA_TOKEN=your-password
GEMMA_TIMEOUT=240
AI_MIN_INTERVAL=30

Replace 100.x.y.z and your-password with the real ones. No spaces around the equals sign and no quotes.

Last thing, make sure soc_app.py has this line near the top, then run it like in Part 1:
from local_llm import LocalAnalyst as Analyst

The top of the dashboard should say AI: Gemini (local gemma-2-2b-it). It says Gemini but it's really our local Gemma. That's just the label.

IF SOMETHING BREAKS

Timed out - Is the host computer awake? Is the server terminal still running? Is Tailscale connected on both computers?
Unauthorized - The password doesn't match. Check for typos.
getaddrinfo failed - You left the placeholder in. Use the real numbers.
tailscale is not recognized - Close your terminal and open a new one after installing Tailscale.
No module named requests - Turn on your virtual environment and run pip install -r requirements.txt again.

DON'T DO THESE

Don't upload the .env file, the password, or your Tailscale invite to GitHub or post them in public chats.
Only send fake test logs to the AI server, not real company data.
If the password gets leaked, change it: stop the server, set a new password, restart the server, and update everyone's .env file.
