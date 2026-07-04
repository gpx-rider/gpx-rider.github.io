---
name: verify
description: Build/launch/drive recipe for verifying GPX Rider changes end-to-end in a real browser.
---

# Verifying GPX Rider in a real browser

No build step. Serve the repo root and drive `app/` with Playwright:

```sh
python3 -m http.server 5173 --bind 127.0.0.1 &   # app at http://127.0.0.1:5173/app/
```

In remote/CI environments Playwright is installed globally — import it from
the global module root instead of `node_modules`:

```js
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
// run with: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node script.mjs
```

Gotchas that cost time:

- **No Maps API key → `startApp()` blocks or detours.** With no key the
  settings dialog auto-opens (and covers the map buttons); with a bogus key
  the Google Maps script request can hang the whole startup, because
  `startApp()` awaits `initMap()` before `bindEvents()`. Seed a fake key in
  `localStorage` (`gpx-rider:maps-api-key`) *and* abort Google requests so
  the load fails fast: `context.route("**googleapis.com**", r => r.abort())`.
  Everything except the 3D map itself works fine in that state.
- **Seed persisted state via `addInitScript`** (runs before the app's
  module). Storage keys are listed in CLAUDE.md's Persistence section; the
  durable store is IndexedDB (`gpx-rider` / `kv`), localStorage is only the
  legacy/fallback location and the maps key.
- Useful observable surfaces without a map: the recording panel
  (`#recDistanceStat` etc., fed from the restored ride log), the settings
  dialog (`#settingsBtn`, `#distanceUnitSelect`, `#energyUnitSelect`), and
  the progress label under the simulation controls.
