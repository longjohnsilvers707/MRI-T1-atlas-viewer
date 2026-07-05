#!/usr/bin/env python3
"""
Brain Atlas Viewer - Local Server
Run: python server.py
Then open: http://localhost:8765
"""
import os
import sys
import hashlib
import threading
import webbrowser
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, unquote

APP_DIR    = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR  = os.path.join(APP_DIR, "cache")
LABELS_DIR = os.path.join(APP_DIR, "labels")
VENDOR_DIR = os.path.join(APP_DIR, "vendor")
PORT       = 8765

# Atlas NIfTI files cached on disk (downloaded from GitHub on first run)
_CDN = "https://raw.githubusercontent.com/niivue/niivue/main/packages/niivue/demos/images"
# name -> (url, expected SHA-256). Digests captured from the niivue `main`
# branch demo images. A download (or an existing cached copy) whose hash differs
# is rejected and re-fetched rather than trusted, so a corrupted, truncated, or
# swapped response can't silently poison the on-disk cache forever (issues.md D2).
CACHE_FILES = {
    "mni152.nii.gz": (f"{_CDN}/mni152.nii.gz",
                      "e33dcfd37ceec56efa5e419249fd2a778313371e56b65c8d217af80cefdd6821"),
    "aal.nii.gz":    (f"{_CDN}/aal.nii.gz",
                      "af9fcba49420955020e61c72cf28ab89e12662e2ce64659456c10592ad88f834"),
}


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def download_with_progress(url, dest, expected_sha):
    """Stream url -> dest via a `.part` temp file, verify SHA-256, then rename.

    Writing to `dest.part` and only `os.replace`-ing it into place after the
    hash matches means a partial or tampered download never appears at the real
    path (issues.md D2/D3).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "BrainAtlasViewer/1.0"})
    tmp = dest + ".part"
    h = hashlib.sha256()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length", 0))
            got = 0
            chunk = 1 << 16  # 64 KB
            while True:
                blk = resp.read(chunk)
                if not blk:
                    break
                out.write(blk)
                h.update(blk)
                got += len(blk)
                if total:
                    pct = got * 100 // total
                    print(f"\r  {os.path.basename(dest)}  {pct:3d}%  ({got//1024} KB)", end="", flush=True)
        print()  # newline after progress
        digest = h.hexdigest()
        if digest != expected_sha:
            raise ValueError(f"SHA-256 mismatch (expected {expected_sha}, got {digest})")
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def prefetch_atlas_files():
    """Ensure required NIfTI files are present and integrity-checked (once)."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    announced = False
    for name, (url, expected) in CACHE_FILES.items():
        dest = os.path.join(CACHE_DIR, name)
        # Re-validate an existing cached file; only re-download on hash mismatch.
        if os.path.isfile(dest):
            if _sha256_file(dest) == expected:
                continue
            print(f"  {name}: cached copy failed integrity check, re-downloading…")
        if not announced:
            print("Downloading required atlas files…")
            announced = True
        try:
            print(f"  {name} from GitHub…")
            download_with_progress(url, dest, expected)
            mb = os.path.getsize(dest) / 1_048_576
            print(f"  Saved: {dest} ({mb:.1f} MB)")
        except Exception as e:
            print(f"  WARNING: could not download {name}: {e}")
            # App will show an error; user can manually place the file in cache/
    if announced:
        print()


class _RangeFileWrapper:
    """Read-only file wrapper that exposes at most `remaining` bytes.

    SimpleHTTPRequestHandler.copyfile() streams the object returned by
    send_head() to the client; wrapping the file lets us emit just the
    requested byte range for a 206 response. The wrapper is also closed by
    copyfile()'s shutil.copyfileobj / the handler, releasing the file.
    """

    def __init__(self, fileobj, remaining):
        self._f = fileobj
        self._remaining = remaining

    def read(self, amt=-1):
        if self._remaining <= 0:
            return b""
        if amt is None or amt < 0 or amt > self._remaining:
            amt = self._remaining
        data = self._f.read(amt)
        self._remaining -= len(data)
        return data

    def close(self):
        self._f.close()


class AtlasHandler(SimpleHTTPRequestHandler):
    # Directories whose contents are large, immutable static assets and so
    # may be cached by the browser. index.html / other app code stays no-store.
    _CACHEABLE_PREFIXES = ("/cache/", "/labels/", "/meshes/", "/vendor/")

    # Host headers we answer to. Anything else (e.g. a DNS-rebinding hostname
    # that resolves to 127.0.0.1) is refused before any file is served, which
    # blunts DNS-rebinding reaching this localhost-bound port (issues.md A1).
    _ALLOWED_HOSTS = frozenset({
        f"localhost:{PORT}", f"127.0.0.1:{PORT}", f"[::1]:{PORT}",
        "localhost", "127.0.0.1",
    })

    def _host_ok(self):
        return (self.headers.get("Host") or "").strip().lower() in self._ALLOWED_HOSTS

    @staticmethod
    def _is_forbidden_path(path):
        """True for paths that must never be served, even though they live
        under APP_DIR. The app only needs index.html plus the cache / labels /
        meshes / vendor trees; this denies dotfiles & dirs (.git, .claude,
        .gitignore), bytecode caches, traversal segments, and project
        source/docs (issues.md A1/A2)."""
        segments = [s for s in path.split("/") if s]
        for seg in segments:
            if seg.startswith(".") or seg == "__pycache__":  # also blocks ".."
                return True
        last = segments[-1].lower() if segments else ""
        return (last.endswith((".py", ".md", ".part"))
                or last in ("license", "requirements-dev.txt"))

    def _guard(self):
        """Refuse the request (returning True) if host or path is disallowed."""
        if not self._host_ok():
            self.send_error(403, "Forbidden host")
            return True
        if self._is_forbidden_path(unquote(urlparse(self.path).path)):
            self.send_error(404, "Not found")
            return True
        return False

    # Extend the base class's mimetypes table so extensions the standard library
    # mislabels (or doesn't know) get sensible content-types. The base handler
    # uses this map for everything it serves (including our fall-through routes).
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".obj":    "text/plain; charset=utf-8",
        ".nii":    "application/octet-stream",
        ".gz":     "application/gzip",     # covers .nii.gz
        ".mz3":    "application/octet-stream",
        ".json":   "application/json",
        # Pin these so serving the locally vendored libraries never depends on
        # the host's mimetypes registry (varies on Windows/minimal installs).
        # ESM import() needs a JS type; the TF.js WASM backend needs exactly
        # application/wasm for streaming compilation — a wrong type makes the
        # local copy fail and silently fall back to a CDN.
        ".js":     "text/javascript",
        ".mjs":    "text/javascript",
        ".wasm":   "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        # Per-request cache policy, read back in end_headers(). Defaults to the
        # safe "always fresh" behaviour and is upgraded for static-asset paths.
        self._cache_control = "no-store"
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def _resolve_cache_policy(self):
        """Decide the Cache-Control value for the current request path."""
        path = unquote(urlparse(self.path).path)
        if any(path.startswith(p) for p in self._CACHEABLE_PREFIXES):
            # Large, immutable atlas assets - let the browser keep them.
            self._cache_control = "max-age=3600"
        else:
            # HTML / app code - always revalidate so updates ship immediately.
            self._cache_control = "no-store"

    @staticmethod
    def _safe_under(base, fname):
        """Resolve base/fname and return the real path only if it stays inside
        base; otherwise None. Defeats `/cache/../server.py`-style traversal,
        which the old string-prefix check let through (issues.md A2)."""
        real_base = os.path.realpath(base)
        target = os.path.realpath(os.path.join(real_base, fname))
        if os.path.commonpath([target, real_base]) != real_base:
            return None
        return target

    def do_GET(self):
        self._resolve_cache_policy()
        if self._guard():
            return
        path = unquote(urlparse(self.path).path)

        # /cache/<filename>  - locally-cached NIfTI atlas files
        # /labels/<filename> - bundled atlas label .txt files
        # Validate the resolved path stays inside the directory (real path +
        # commonpath), then keep the friendly 404 for genuine misses, then fall
        # through to the base handler (via send_head, which we extend with HTTP
        # Range support) so streaming / 206 / content-type handling all work.
        if path.startswith("/cache/"):
            target = self._safe_under(CACHE_DIR, path[len("/cache/"):])
            if target is None:
                self.send_error(403, "Forbidden")
                return
            if not os.path.isfile(target):
                self.send_error(404, "Not in cache (check server startup output)")
                return

        elif path.startswith("/labels/"):
            target = self._safe_under(LABELS_DIR, path[len("/labels/"):])
            if target is None:
                self.send_error(403, "Forbidden")
                return
            if not os.path.isfile(target):
                self.send_error(404, "Not found in labels dir")
                return

        # Default (and the validated cache/labels routes): serve from APP_DIR.
        # This also already covers /meshes/, /vendor/ and index.html.
        super().do_GET()

    def do_HEAD(self):
        self._resolve_cache_policy()
        if self._guard():
            return
        super().do_HEAD()

    def send_head(self):
        """Serve a file, honouring a single-range HTTP Range request (206).

        CPython's SimpleHTTPRequestHandler does not implement Range, so we add
        it here. Both do_GET and do_HEAD route through send_head, so this gives
        Range support to every static file served from APP_DIR (cache, labels,
        meshes, ...). Requests without a Range header fall back to the base
        class's normal 200 path unchanged.
        """
        range_header = self.headers.get("Range")
        if not range_header:
            return super().send_head()

        # Resolve the request path to a real file using the base class helper.
        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.isfile(path):
            # Directories / missing files: let the base class handle it (index
            # listing, 404, redirect, etc.) without Range semantics.
            return super().send_head()

        # Parse "bytes=start-end" (we support a single range only).
        try:
            unit, _, rng = range_header.partition("=")
            if unit.strip().lower() != "bytes" or "," in rng:
                raise ValueError
            start_s, _, end_s = rng.strip().partition("-")
            file_len = os.path.getsize(path)
            if start_s == "":
                # Suffix range: bytes=-N  -> last N bytes.
                length = int(end_s)
                start = max(0, file_len - length)
                end = file_len - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else file_len - 1
                end = min(end, file_len - 1)
            if start > end or start >= file_len:
                raise ValueError
        except ValueError:
            # Malformed / unsatisfiable range -> 416 with Content-Range '*'.
            try:
                file_len = os.path.getsize(path)
            except OSError:
                file_len = 0
            self.send_response(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{file_len}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)
        f.seek(start)
        # _RangeFileWrapper yields exactly (end - start + 1) bytes to copyfile.
        wrapper = _RangeFileWrapper(f, end - start + 1)
        self.send_response(206, "Partial Content")
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_len}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return wrapper

    def end_headers(self):
        # No Access-Control-Allow-Origin: the app is served same-origin, so the
        # blanket ACAO:* that previously let any web page read these bytes
        # cross-origin is removed (issues.md A1).
        self.send_header("Cache-Control", self._cache_control)
        # Advertise Range support for the large static assets (the 206 path in
        # send_head sends its own Accept-Ranges; this covers the 200 responses).
        if self._cache_control != "no-store":
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_OPTIONS(self):
        if not self._host_ok():
            self.send_error(403, "Forbidden host")
            return
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        # The standard log_request() path calls this as
        #   log_message('"%s" %s %s', requestline, str(code), size)
        # i.e. args == (requestline, code, size). Suppress noise for
        # successful/redirect/range responses, print everything else. Guard the
        # indexing so other (non-standard) callers never raise.
        code = ""
        if len(args) >= 2:
            code = str(args[1])
        if code not in ("200", "206", "304"):
            sys.stderr.write(f"[{self.address_string()}] {fmt % args}\n")


def check_vendor_complete():
    """Warn loudly if any pinned third-party library listed in
    vendor/SHA256SUMS is missing on disk. A missing vendored file makes the
    front-end silently fall back to a public CDN at runtime (the WASM backend
    JS did exactly this), which breaks the "everything served locally" goal.
    Print-only: never blocks startup. Run `bash scripts/fetch_vendor.sh` to
    restore anything reported here."""
    manifest = os.path.join(VENDOR_DIR, "SHA256SUMS")
    if not os.path.isfile(manifest):
        print("  Vendor libs : SHA256SUMS not found (skipping local-asset check)")
        return
    missing = []
    with open(manifest) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # "<sha>  ./relative/path" — split off the path after the digest.
            rel = line.split(None, 1)[1].lstrip("./") if len(line.split(None, 1)) == 2 else ""
            if rel and not os.path.isfile(os.path.join(VENDOR_DIR, rel)):
                missing.append(rel)
    if missing:
        print("  Vendor libs : WARNING - missing local copies (runtime will fall back to a CDN):")
        for rel in missing:
            print(f"                - vendor/{rel}")
        print("                Run: bash scripts/fetch_vendor.sh")
    else:
        print("  Vendor libs : all local (no runtime CDN needed)")


def main():
    # Download atlas files before starting
    prefetch_atlas_files()

    # ThreadingHTTPServer so concurrent NiiVue Range requests + the 6.5 MB
    # bundle + per-mesh loads don't serialize behind one slow stream (D1).
    server = ThreadingHTTPServer(("localhost", PORT), AtlasHandler)
    url    = f"http://localhost:{PORT}"

    print(f"Brain Atlas Viewer  ->  {url}")
    print(f"  Atlas labels : {LABELS_DIR}")
    print(f"  NIfTI cache  : {CACHE_DIR}")
    check_vendor_complete()
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
