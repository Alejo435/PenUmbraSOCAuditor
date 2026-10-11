# PenUmbra SOC Auditor™️- Backendd

This is the part of our project that does the thinking. It reads security logs, draws a map of what happened, and uses AI to explain it in plain English.

WHAT IT DOES

1. Reads log lines (records of what happened on a computer system).
2. Builds a graph, which is a map showing how users, computers, IP addresses, programs and files connect.
3. Flags suspicious activity, like many failed logins.
4. Uses AI to write short explanations and a report that a beginner can follow.

THE MAIN FILES

soc_app.py - starts everything. Run this one.
log_parser.py - turns each log line into something the program can read.
graph_engine.py - builds the map and spots suspicious activity.
ai_analyst.py and local_llm.py - ask the AI to explain what is happening.
cybersecurity_test.log - a sample log to practice with.
requirements.txt - the list of tools the project needs.

HOW TO RUN IT

You need Python installed. Open this folder in VS Code, open a terminal, and run these one at a time.

Install all the necessary requirements from requirements.txt

Step 1. Make a private workspace for the project:
python -m venv .venv

Step 2. Turn it on:
.venv\Scripts\Activate.ps1

Step 3. Install the tools:
pip install -r requirements.txt

Step 4. Start the app:
python soc_app.py

Step 5. Open your web browser and type this into the address bar:
127.0.0.1:5000/dashboard/

You will see the sample log play out and the map fill in.

THE AI SETUP

The AI runs on a separate computer in our group. To use it, create a file named .env in this folder and add the address and password you were given:

GEMMA_URL=http://ADDRESS-YOU-WERE-GIVEN:8000
GEMMA_TOKEN=THE-PASSWORD-YOU-WERE-GIVEN

Keep the password private and never upload the .env file to GitHub. If the AI is not available, the app still works with simple built-in explanations.

NEED HELP?

If you get an error, copy the message and ask the team.
