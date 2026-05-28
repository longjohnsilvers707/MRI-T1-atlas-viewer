#!/usr/bin/env python3
"""
Brain Atlas Viewer - Local Server
Run: python server.py
Then open: http://localhost:8765
"""
import os
import sys
import threading
import webbrowser
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, unquote

APP_DIR    = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR  = os.path.join(APP_DIR, "cache")
LABELS_DIR = os.path.join(APP_DIR, "labels")
PORT       = 8765

# Atlas NIfTI files cached on disk (downloaded from GitHub on first run)
_CDN = "https://raw.githubusercontent.com/niivue/niivue/main/packages/niivue/demos/images"
CACHE_FILES = {
    "mni152.nii.gz": f"{_CDN}/mni152.nii.gz",
    "aal.nii.gz":    f"{_CDN}/aal.nii.gz",
}


def download_with_progress(url, dest):
    """Download url to dest, printing a simple progress indicator."""
    req = urllib.request.Request(url, headers={"User-Agent": "BrainAtlasViewer/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        data  = bytearray()
        chunk = 1 << 16  # 64 KB
        while True:
            blk = resp.read(chunk)
            if not blk:
                break
            data += blk
            if total:
                pct = len(data) * 100 // total
                print(f"\r  {os.path.basename(dest)}  {pct:3d}%  ({len(data)//1024} KB)", end="", flush=True)
    print()  # newline after progress
    with open(dest, "wb") as f:
        f.write(data)


def prefetch_atlas_files():
    """Download required NIfTI files before the server starts (once only)."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    needed = [(name, url) for name, url in CACHE_FILES.items()
              if not os.path.isfile(os.path.join(CACHE_DIR, name))]
    if not needed:
        return
    print("Downloading required atlas files…")
    for name, url in needed:
        dest = os.path.join(CACHE_DIR, name)
        try:
            print(f"  {name} from GitHub…")
            download_with_progress(url, dest)
            mb = os.path.getsize(dest) / 1_048_576
            print(f"  Saved: {dest} ({mb:.1f} MB)")
        except Exception as e:
            print(f"  WARNING: could not download {name}: {e}")
            # App will show an error; user can manually place the file in cache/
    print()


class AtlasHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)

        # /cache/<filename>  — locally-cached NIfTI atlas files
        if path.startswith("/cache/"):
            fname = path[7:]
            fpath = os.path.join(CACHE_DIR, fname)
            if os.path.isfile(fpath):
                self._serve_file(fpath)
            else:
                self.send_error(404, f"Not in cache: {fname} — check server startup output")
            return

        # /labels/<filename>  — bundled atlas label .txt files
        if path.startswith("/labels/"):
            fname = path[8:]
            fpath = os.path.join(LABELS_DIR, fname)
            if os.path.isfile(fpath):
                self._serve_file(fpath)
            else:
                self.send_error(404, f"Not found in labels dir: {fname}")
            return

        # Default: serve app directory (index.html, etc.)
        super().do_GET()

    def _serve_file(self, filepath):
        ext = os.path.splitext(filepath)[1].lower()
        ct  = {
            ".html": "text/html; charset=utf-8",
            ".js":   "application/javascript",
            ".css":  "text/css",
            ".txt":  "text/plain; charset=utf-8",
            ".json": "application/json",
            ".gz":   "application/gzip",
            ".nii":  "application/octet-stream",
            ".mz3":  "application/octet-stream",
        }.get(ext, "application/octet-stream")
        try:
            with open(filepath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(500, str(e))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else ""
        if str(code) not in ("200", "206", "304"):
            sys.stderr.write(f"[{self.address_string()}] {fmt % args}\n")


def main():
    # Download atlas files before starting
    prefetch_atlas_files()

    server = HTTPServer(("localhost", PORT), AtlasHandler)
    url    = f"http://localhost:{PORT}"

    print(f"Brain Atlas Viewer  ->  {url}")
    print(f"  Atlas labels : {LABELS_DIR}")
    print(f"  NIfTI cache  : {CACHE_DIR}")
    print("Press Ctrl+C to stop.\n")

    def open_browser():
        import time; time.sleep(0.5)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
