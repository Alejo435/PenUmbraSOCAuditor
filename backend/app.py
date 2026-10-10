
from flask import Flask, jsonify, render_template, request
from convert import convert_log_to_json

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/convert", methods=["POST"])
def convert():
    data = request.get_json(silent=True)

    if not data or not isinstance(data.get("logs"), str):
        return jsonify({"error": "Please provide log text."}), 400

    logs = convert_log_to_json(data["logs"])
    return jsonify(logs)


if __name__ == "__main__":
    app.run(debug=True)
