#!/usr/bin/env python3
"""Local server for Resume Builder.

Serves the app at http://127.0.0.1:8765/ and persists every edit to
resume-data.json in this folder (the app POSTs to /save as you type).
Run directly or double-click start.command.
"""
import json
import os
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, "resume-data.json")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path.rstrip("/") == "/save":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                json.loads(body.decode("utf-8"))  # validate before touching the file
                tmp = DATA_FILE + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, DATA_FILE)  # atomic: never leaves a half-written file
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"ok")
            except Exception as exc:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(exc).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


def main():
    url = f"http://127.0.0.1:{PORT}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # Port already taken — assume a previous instance is running.
        print(f"Resume Builder already running — opening {url}")
        webbrowser.open(url)
        return
    threading.Timer(0.4, webbrowser.open, [url]).start()
    print(f"Resume Builder running at {url}")
    print(f"Edits are saved to {DATA_FILE}")
    print("Press Ctrl+C (or close this window) to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
