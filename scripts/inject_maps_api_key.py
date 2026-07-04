#!/usr/bin/env python3
# Run only by .github/workflows/deploy-pages.yml, after checkout and before
# the Pages artifact is uploaded. Bakes the MAPS_API_KEY repository secret
# (expected to be an HTTP referrer-restricted key scoped to the Pages origin)
# into app/config.mjs so the live demo works without visitors pasting their
# own key. If the secret is unset this writes back the same empty default,
# so local checkouts and forks without the secret are unaffected.
#
# The key is base64-encoded in the file, not encrypted — see config.mjs for
# why (it's cosmetic, not a security boundary).
import base64
import os
import pathlib
import re

CONFIG_PATH = pathlib.Path("app/config.mjs")
PATTERN = re.compile(r'const DEPLOYED_MAPS_API_KEY_B64 = ".*";')


def main():
    key = os.environ.get("MAPS_API_KEY", "")
    encoded = base64.b64encode(key.encode()).decode() if key else ""
    text = CONFIG_PATH.read_text()
    replacement = f'const DEPLOYED_MAPS_API_KEY_B64 = "{encoded}";'
    updated, count = PATTERN.subn(replacement, text)
    if count != 1:
        raise SystemExit(f"expected exactly one DEPLOYED_MAPS_API_KEY_B64 line in {CONFIG_PATH}, found {count}")
    CONFIG_PATH.write_text(updated)


if __name__ == "__main__":
    main()
