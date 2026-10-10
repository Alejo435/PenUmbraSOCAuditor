from flask import Flask, jsonify, request

app = Flask(__name__)

logs = []

@app.route("/")
def home():
    return jsonify({"message": "Cybersecurity API is running!"})

@app.route("/logs", methods=["GET"])
def get_logs():
    return jsonify(logs)

@app.route("/logs", methods=["POST"])
def add_log():
    log = request.json
    logs.append(log)
    return jsonify({"message": "Log added!", "log": log}), 201

if __name__ == "__main__":
    app.run(debug=True)
