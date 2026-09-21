"""Load APIX_* variables from apix/.env if present.

Keeps the API key out of the shell history and out of the conversation.
The .env file is gitignored and never committed.
"""
import pathlib, os

def load():
    f = pathlib.Path(__file__).parent / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))
