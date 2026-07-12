#!/usr/bin/env python3
"""Local dev/preview static server that disables all HTTP caching.

GPX Rider is a no-build static app: the browser loads the `.mjs`/`.css`/`.json`
files directly. Python's stock `http.server` sends `Last-Modified` and answers
conditional requests with `304 Not Modified`, so the browser happily serves a
stale module from cache — which means an edit to `tuning.mjs` (or any other
file) can silently not take effect until a hard refresh. That is exactly the
wrong behavior while tuning the app.

This server serves the same tree but forces every response to be uncacheable:
it strips the request's conditional headers (so it never returns a 304), drops
the response validators (`Last-Modified`/`ETag`), and adds `no-store`. Every
reload therefore fetches fresh bytes.

It also injects a *local* Google Maps API key into `app/config.mjs` on the fly
(never touching the file on disk) so the map works in local dev without pasting
a key in Settings every time — the same base64 substitution the deploy workflow
does, but sourced from the developer's machine, not a repository secret. The key
comes from the `MAPS_API_KEY` environment variable, or a `.maps-api-key` file at
the repo root; both are gitignored / never committed. With neither present the
committed empty default is served unchanged, so the app just falls back to
asking for a key in Settings exactly as before.

Usage: python3 scripts/dev_server.py [PORT] [HOST]   (defaults: 5173 127.0.0.1)
Run it from the repo root; the landing page is then at http://HOST:PORT/app/
and the app itself at http://HOST:PORT/app/app.html.
"""

import base64
import io
import os
import pathlib
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DEFAULT_PORT = 5173
DEFAULT_HOST = "127.0.0.1"

CONFIG_URL_SUFFIX = "/app/config.mjs"
KEY_LINE_PATTERN = re.compile(rb'const DEPLOYED_MAPS_API_KEY_B64 = ".*";')

# Content types forced by file extension, independent of the OS MIME registry.
# Python's http.server falls back to the platform registry for unknown types,
# and on some machines .mjs resolves to text/plain — which browsers reject for
# ES module scripts ("Strict MIME type checking is enforced for module
# scripts"). Pinning them here makes local dev behave the same everywhere.
FORCED_CONTENT_TYPES = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".glb": "model/gltf-binary",
    ".wasm": "application/wasm",
}


def local_maps_api_key():
    """A Maps key from the local machine only — env var wins, else the
    gitignored .maps-api-key file. Returns "" when neither is set."""
    key = os.environ.get("MAPS_API_KEY", "").strip()
    if key:
        return key
    key_file = pathlib.Path(".maps-api-key")
    if key_file.exists():
        return key_file.read_text().strip()
    return ""


class NoCacheHandler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        # Force known web extensions ahead of the platform registry so module
        # scripts always arrive with a JavaScript MIME type.
        ext = os.path.splitext(str(path))[1].lower()
        if ext in FORCED_CONTENT_TYPES:
            return FORCED_CONTENT_TYPES[ext]
        return super().guess_type(path)

    def send_head(self):
        # Never honour conditional requests, so we always return a fresh 200
        # instead of a 304 that tells the browser to reuse its cached copy.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        if urlsplit(self.path).path.endswith(CONFIG_URL_SUFFIX):
            injected = self._config_with_local_key()
            if injected is not None:
                return injected
        return super().send_head()

    def _config_with_local_key(self):
        # Serve app/config.mjs with the local key baked into the same line the
        # deploy workflow rewrites. Returns None (fall back to the file as-is)
        # when there's no local key or the file doesn't look as expected.
        key = local_maps_api_key()
        if not key:
            return None
        try:
            source = pathlib.Path(self.translate_path(self.path)).read_bytes()
        except OSError:
            return None
        encoded = base64.b64encode(key.encode()).decode()
        replacement = f'const DEPLOYED_MAPS_API_KEY_B64 = "{encoded}";'.encode()
        updated, count = KEY_LINE_PATTERN.subn(replacement, source)
        if count != 1:
            return None
        self.send_response(200)
        self.send_header("Content-Type", "text/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(updated)))
        self.end_headers()
        return io.BytesIO(updated)

    def send_header(self, keyword, value):
        # Drop the cache validators so the browser has nothing to revalidate
        # against and cannot reuse a stored response.
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main(argv):
    port = int(argv[1]) if len(argv) > 1 else DEFAULT_PORT
    host = argv[2] if len(argv) > 2 else DEFAULT_HOST
    # Threaded so the browser's many parallel module requests are served
    # concurrently instead of one-at-a-time (a serial server stalls or refuses
    # connections when a page pulls in dozens of .mjs files at once).
    server = ThreadingHTTPServer((host, port), NoCacheHandler)
    print(f"GPX Rider (no-cache dev server): landing http://{host}:{port}/app/ · app http://{host}:{port}/app/app.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main(sys.argv)
