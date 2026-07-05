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

Usage: python3 scripts/dev_server.py [PORT] [HOST]   (defaults: 5173 127.0.0.1)
Run it from the repo root; the app is then at http://HOST:PORT/app/.
"""

import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

DEFAULT_PORT = 5173
DEFAULT_HOST = "127.0.0.1"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Never honour conditional requests, so we always return a fresh 200
        # instead of a 304 that tells the browser to reuse its cached copy.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

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
    server = HTTPServer((host, port), NoCacheHandler)
    print(f"GPX Rider (no-cache dev server) at http://{host}:{port}/app/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main(sys.argv)
