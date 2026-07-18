#!/usr/bin/env python3
# Run only by .github/workflows/deploy-pages.yml, after checkout and before
# the Pages artifact is uploaded. Injects the optional HEAD repository
# variable immediately after <head> in app/index.html — the public landing
# page, the site's entry point — which is intended for deployment-only tags
# such as analytics snippets. If HEAD is unset this leaves the source
# unchanged, so local checkouts and forks are unaffected.
#
# GPX Rider needs no API key to deploy (OpenStreetMap tiles are free and
# anonymous), so this script no longer injects one.
import os
import pathlib
import re

INDEX_PATH = pathlib.Path("app/index.html")
HEAD_PATTERN = re.compile(r"(?m)^([ \t]*<head>[ \t]*)$")


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
    inject_head_html()


if __name__ == "__main__":
    main()
