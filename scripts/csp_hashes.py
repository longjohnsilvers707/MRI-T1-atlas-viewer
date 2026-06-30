#!/usr/bin/env python3
"""csp_hashes.py — recompute the SHA-256 hashes for the inline <script> blocks
in index.html and check them against the Content-Security-Policy meta tag.

The CSP allows the app's own inline scripts by hash (no 'unsafe-inline'), so any
edit to an inline <script> block changes its hash and must be reflected in the
meta tag. Run this after editing index.html:

    python3 scripts/csp_hashes.py          # print hashes + report mismatches
"""
import base64
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "index.html")


def main():
    html = open(HTML, encoding="utf-8").read()
    hashes = []
    for m in re.finditer(r"<script([^>]*)>(.*?)</script>", html, re.S):
        if "src=" in m.group(1):
            continue  # external scripts are covered by origins, not hashes
        digest = hashlib.sha256(m.group(2).encode("utf-8")).digest()
        hashes.append("sha256-" + base64.b64encode(digest).decode())

    print("Computed inline-script hashes:")
    for h in hashes:
        print("   ", h)

    missing = [h for h in hashes if ("'" + h + "'") not in html]
    if missing:
        print("\nERROR: these hashes are NOT present in the CSP meta tag:")
        for h in missing:
            print("   ", h)
        sys.exit(1)
    print("\nAll inline-script hashes are present in the CSP meta tag. ✓")


if __name__ == "__main__":
    main()
