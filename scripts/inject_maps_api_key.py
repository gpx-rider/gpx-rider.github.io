#!/usr/bin/env python3
# Run only by .github/workflows/deploy-pages.yml, after checkout and before
# the Pages artifact is uploaded. Bakes the MAPS_API_KEY repository secret
# (expected to be an HTTP referrer-restricted key scoped to the Pages origin)
# into app/config.mjs so the live demo works without visitors pasting their
# own key. It also injects the optional HEAD repository variable immediately
# after <head> in app/index.html, which is intended for deployment-only tags
# such as analytics snippets. If either value is unset this leaves the matching
# source default unchanged, so local checkouts and forks are unaffected.
#
# The key is base64-encoded in the file, not encrypted — see config.mjs for
# why (it's cosmetic, not a security boundary).
import base64
import os
import pathlib
import re

CONFIG_PATH = pathlib.Path("app/config.mjs")
INDEX_PATH = pathlib.Path("app/index.html")
PATTERN = re.compile(r'const DEPLOYED_MAPS_API_KEY_B64 = ".*";')
HEAD_PATTERN = re.compile(r"(?m)^([ \t]*<head>[ \t]*)$")


def inject_maps_api_key():
    key = os.environ.get("MAPS_API_KEY", "")
    encoded = base64.b64encode(key.encode()).decode() if key else ""
    text = CONFIG_PATH.read_text()
    replacement = f'const DEPLOYED_MAPS_API_KEY_B64 = "{encoded}";'
    updated, count = PATTERN.subn(replacement, text)
    if count != 1:
        raise SystemExit(f"expected exactly one DEPLOYED_MAPS_API_KEY_B64 line in {CONFIG_PATH}, found {count}")
    CONFIG_PATH.write_text(updated)


def inject_head_html():
    head_html = os.environ.get("HEAD", "").strip()
    if not head_html:
        return

    text = INDEX_PATH.read_text()
    indented_head = "\n".join(f"    {line}" if line else "" for line in head_html.splitlines())
    updated, count = HEAD_PATTERN.subn(lambda match: f"{match.group(1)}\n{indented_head}", text, count=1)
    if count != 1:
        raise SystemExit(f"expected exactly one <head> line in {INDEX_PATH}, found {count}")
    INDEX_PATH.write_text(updated)


def main():
    inject_maps_api_key()
    inject_head_html()


if __name__ == "__main__":
    main()
