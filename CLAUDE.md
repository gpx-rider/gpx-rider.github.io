# CLAUDE.md — instructions for AI agents working on GPX Rider

GPX Rider is a **no-build, static web app**: plain HTML/CSS/JS ES modules,
no bundler, no framework, no `node_modules`. Keep it that way — do not
introduce a build step, TypeScript, npm dependencies, or a framework unless
the user explicitly asks for one.

## Commands

```sh
make run       # serve the repo at http://127.0.0.1:5173/app/ (python3 http.server)
make test      # node --test tests/*.test.mjs (no dependencies needed)
make gallery   # regenerate the README gallery section from gallery/*/desc.md
make gallery-data  # regenerate app/gallery.json for the in-app ride gallery
```

Always run `make test` after changing anything in `app/`. Browser-only
modules can at least be syntax-checked with `node --check app/<file>.mjs`.

## Architecture

Everything the browser loads lives in `app/`. `app/app.js` is the only
entry point (loaded as a module from `index.html`); it owns the mutable
`state` object, the DOM element map (`els`), event wiring, the Google 3D
map + follow camera, and the movement loop. Everything else is a focused
module:

| File | Responsibility |
|---|---|
| `app/app.js` | Orchestrator: state, DOM, map rendering, camera capture, movement loop, settings & saved-ride persistence |
| `app/tuning.mjs` | **All tunable behavior parameters**, one documented constant each (defaults, thresholds, model factors). New knobs go here, not inline |
| `app/camera.mjs` | Pure follow-camera math (tested) |
| `app/geo.mjs` | Pure geodesy helpers: haversine, bearing, destinationPoint, clamp, lerp |
| `app/route.mjs` | GPX parsing, route enrichment (cumulative distance + noise-filtered ascent/descent), point interpolation, grade computation (tested) |
| `app/eta.mjs` | Smart ETA: flat-equivalent pace model estimating remaining ride time (tested) |
| `app/profile.mjs` | Elevation profile canvas drawing + hover/seek hit-testing |
| `app/trainer.mjs` | FTMS trainer over Web Bluetooth: pairing, reconnect, control-point writes, Indoor Bike Data parsing (speed, power, calories, HR) |
| `app/heartrate.mjs` | BLE heart-rate strap (standard Heart Rate service 0x180D) |
| `app/recorder.mjs` | Ride "bucket": accumulates samples while moving, persists to localStorage |
| `app/fit.mjs` | Minimal FIT activity encoder — tags rides as sport=cycling, sub_sport=virtual_activity (tested) |
| `app/units.mjs` | km/mi + kcal/kJ display formatting; internal state is always metric (tested) |
| `app/screenshot.mjs` | One-click JPG of the map viewport via tab capture (`getDisplayMedia`) — the 3D map canvas sits in a closed shadow root and cannot be read directly |
| `app/gallery.mjs` | Ride gallery cards from `app/gallery.json` |
| `app/storage.mjs` | localStorage JSON helpers |
| `app/config.mjs` | `deployedMapsApiKey()` — empty in source, rewritten at deploy time (see below) |

Module conventions: browser modules use the `.mjs` extension (except the
`app.js` entry point), pure logic goes in its own module with tests, and
hardware/IO modules (`trainer.mjs`, `heartrate.mjs`) hold their own internal
state and talk back to `app.js` only through `init*()` callbacks.

Tunable parameters (defaults, thresholds, physics/model factors) live in
`app/tuning.mjs` with a doc comment each — never as inline magic numbers —
so users can adjust behavior in one place. Deliberate exceptions:
`app/config.mjs` (rewritten at deploy time, see below) and the BLE
write-queue timing internals in `trainer.mjs` (hardware-safety, documented
in place).

## Key domain concepts

- **Two movement sources.** The rider advances along the route from either
  *pedaling* (trainer-reported speed, always wins) or the *simulation*
  (slider speed, toggled by the "Start simulation" button). Starting to
  pedal auto-stops a running simulation; the button must never control the
  trainer-driven movement. Pedaling detection uses hysteresis
  (`PEDALING_START_KPH` / `PEDALING_STOP_KPH` in `tuning.mjs`).
- **The movement loop** (`tick` in `app.js`) runs on requestAnimationFrame
  while the tab is visible and falls back to `setTimeout` when hidden, so
  rides keep advancing and recording in background tabs. Per-tick elapsed
  time is clamped (`MAX_TICK_SECONDS`) to avoid teleporting.
- **Ride recording** is independent of route progress: resetting or seeking
  the route does not touch the recorded bucket. The bucket only grows while
  the rider is actually moving, and it survives reloads via localStorage.
- **FIT export** must stay a *virtual ride* (sport 2 / sub_sport 58) or
  Strava/Garmin will misclassify uploads. `fit.mjs` is a hand-rolled
  little-endian encoder — if you touch it, keep the CRC and header tests
  green and verify a real download parses (e.g. with an online FIT viewer).
- **Ascent/descent & the smart ETA.** `enrichRoute` adds cumulative
  `ascent`/`descent` to every point, noise-filtered by
  `CLIMB_NOISE_THRESHOLD_METERS` so GPX elevation jitter doesn't inflate
  totals; `ascentAt`/`descentAt` interpolate them at any progress distance
  (they feed the ascent progress bar and "ascent left" stats). The ETA
  (`eta.mjs`) measures the rider's pace in *flat-equivalent meters* —
  climbing charged, descending credited (factors in `tuning.mjs`) — and
  projects it onto the remaining route. The estimator is fed **only from
  real pedaling ticks** (simulation speed is artificial and would poison
  it); a pure simulation ETA is plain remaining-distance ÷ slider-speed.
  The estimator resets when a new GPX loads, not on ride reset.
- **HUD & display settings.** Fullscreen HUD tiles are matched to settings
  checkboxes by `data-hud="…"` / `data-hud-toggle="…"` keys, which must
  also exist in `DEFAULT_HUD_ELEMENTS` (`tuning.mjs`) — add all three when
  adding a tile. The minimap toggle uses `visibility` (class
  `minimap-hidden`), not `display:none`, so the Google map never needs a
  resize kick when re-shown. Map labels toggle the `Map3DElement.mode`
  between `SATELLITE` and `HYBRID`.
- **First-open auto-load**: with no saved ride and a working map,
  `initGallery` loads the first gallery route automatically
  (`shouldAutoLoadFirst` in `app.js`); it is skipped when the map/API key
  is missing so the first-run key prompt stays front and center.
- **Units**: all internal values are metric (meters, km/h, kcal). Only
  format at the display edge via `units.mjs`.
- **BLE**: FTMS control-point writes must go through the write queue in
  `trainer.mjs` (one GATT operation at a time) and grade writes are
  throttled/averaged — read the comments there before changing timing.
- **3D map geometry**: never render lines with `CLAMP_TO_GROUND` — draped
  strokes smear down steep slopes into wide blobs. The route line and rider
  dot use `RELATIVE_TO_GROUND` a couple of meters up, with the path
  densified (`densifyRoute`) so elevated segments follow the terrain. The
  rider dot's ground radius scales with the camera-eye distance
  (`cameraDistanceToPoint`) to keep a constant apparent size. The rider
  beacon is a real-world-sized extruded `Polygon3DElement` cylinder with
  `drawsOccludedSegments` so trees never hide the rider's position.
- **Camera modes & physical motion**: `state.cameraMode` is `"overview"`
  after a route loads (whole route framed via `computeRouteOverviewCamera`
  in `camera.mjs`: start→end reads left-to-right, the route's far side
  faces away, 45° tilt), `"manual"` once the user grabs the overview, and
  `"follow"` from the moment movement starts. The overview snaps into place
  instantly on load (`applyCameraNow` — a new route may be across the
  world); every later camera move chases the target's eye/look-at pair with
  bounded acceleration (`chaseStep` + `chaseTuning` in `camera.mjs`: the
  acceleration budget grows with remaining distance, so follow tracking is
  gentle while transition flights are fast, braking to arrive), stepped by
  the movement loop while riding and by `ensureCameraFlightLoop` otherwise.
- **Camera terrain avoidance** lifts the follow camera when its eye would
  sink below terrain + clearance and eases it back down as terrain allows
  (`currentTerrainLift` in `app.js`; pure math in `camera.mjs`'s
  `applyCameraLift`). The terrain estimate is `maxElevationNear` over the
  route's own elevation points — deliberately **not** the Google Elevation
  API, which would cost real money at follow-camera query rates. Keep it
  that way.

## Persistence (localStorage keys)

`gpx-rider:maps-api-key`, `gpx-rider:settings`, `gpx-rider:last-ride`
(route + progress), `gpx-rider:ride-log` (recorded samples),
`gpx-rider:last-trainer`, `gpx-rider:last-heart-rate`. Never send any of
these anywhere; the app's privacy story is "everything stays in the
browser".

## Deployed Maps API key

The live GitHub Pages demo works without a visitor pasting a key: the
`MAPS_API_KEY` repository secret (an HTTP referrer-restricted key, scoped to
the Pages origin) is base64-encoded and baked into `app/config.mjs` at
deploy time by `scripts/inject_maps_api_key.py`, run from `deploy-pages.yml`
before the Pages artifact is uploaded. The encoding is cosmetic — a webapp's
key is always visible in the network tab regardless — it just keeps the raw
key out of the JS source as a greppable literal. `app.js`'s
`resolveMapsApiKey()` prefers a key a visitor saved in Settings over this
default, so self-hosters and forks without the secret get the exact same
"paste your key" flow as before — `app/config.mjs` just stays empty. When a
deployed key is present, `startApp()` hides the whole API-key section in
Settings (`els.apiKeySection`) instead of showing an empty field nobody
needs. Never widen the referrer restriction beyond the exact deployed
origin, and don't add a second, unrestricted key anywhere in the client
bundle.

## Documentation duties

- **Keep `README.md` updated.** Any user-visible feature, limitation, or
  workflow change must be reflected in the README (Features, How to use it,
  Notes & limitations). The README is the project's landing page; stale
  docs are treated as bugs.
- Keep this file updated when the architecture or conventions change.
- The gallery section of the README between `<!-- gallery-start -->` and
  `<!-- gallery-end -->` is generated by `make gallery` — don't hand-edit
  it; edit `gallery/*/desc.md` and regenerate.

## Testing & manual verification

- Unit tests cover the pure modules (`camera`, `route`, `units`, `fit`,
  `eta`). Add tests alongside any new pure logic.
- Web Bluetooth requires Chrome/Edge; hardware paths can't be unit-tested.
  When changing `trainer.mjs`/`heartrate.mjs`, preserve the existing
  logging (`[trainer]` console.debug lines) — it's the only field
  diagnostics available.
- The deployed site is GitHub Pages via
  `.github/workflows/deploy-pages.yml` (deploys `app/` on push to `main`).
