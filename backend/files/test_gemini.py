import os, sys
from pathlib import Path
from dotenv import load_dotenv

env = Path(__file__).parent / ".env"
print(".env exists:", env.exists())
load_dotenv(env, override=True)

key = (os.getenv("GEMINI_API_KEY") or "").strip().strip('"').strip("'")
if not key:
    sys.exit("No GEMINI_API_KEY found. Save .env (Ctrl+S) in this folder.")
print("Key loaded, starts with:", key[:3], "length:", len(key))

from google import genai
client = genai.Client(api_key=key)

for name in [os.getenv("GEMINI_MODEL", "gemini-flash-latest"), "gemini-2.5-flash", "gemini-2.0-flash"]:
    try:
        r = client.models.generate_content(model=name, contents="Reply with the single word: ok")
        print(f"SUCCESS with model '{name}': {r.text.strip()}")
        print(f"If needed, add to .env:  GEMINI_MODEL={name}")
        break
    except Exception as e:
        print(f"FAILED with '{name}': {type(e).__name__}: {str(e)[:300]}")  