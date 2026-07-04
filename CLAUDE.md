# CLAUDE.md — instructions for AI agents working on GPX Rider

GPX Rider is a **no-build, static web app**: plain HTML/CSS/JS ES modules,
no bundler, no framework, no `node_modules`. Keep it that way — do not
introduce a build step, TypeScript, npm dependencies, or a framework unless
the user explicitly asks for one.

## Commands

```sh
make           # default: gallery-data + gallery + test (the deploy Action runs the same generation)
make run       # serve the repo at http://127.0.0.1:5173/app/ (python3 http.server)
make test      # node --test tests/*.test.mjs (no dependencies needed)
make gallery   # regenerate the README gallery section from gallery/*/desc.md
make gallery-data  # regenerate app/gallery.json (parses each GPX for distance/ascent/descent, difficulty classification, and ready-to-draw mini-profile bars) for the in-app ride gallery
make rider-dot-model  # regenerate app/assets/rider-dot.glb (the 3D rider marker mesh) — only needed after editing scripts/generate_rider_dot_model.py, not part of the default `make`
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
| `app/difficulty.mjs` | Route classification from distance + total elevation gain alone: distance/terrain classes and overall difficulty (tested) |
| `app/climbs.mjs` | Detects sustained climbing segments in a route for the setup-page climbs overview (tested) |
| `app/profile.mjs` | Elevation profile canvas drawing + hover/seek hit-testing |
| `app/trainer.mjs` | FTMS trainer over Web Bluetooth: pairing, reconnect, control-point writes, Indoor Bike Data parsing (speed, power, calories, HR) |
| `app/heartrate.mjs` | BLE heart-rate strap (standard Heart Rate service 0x180D) |
| `app/recorder.mjs` | Ride "bucket": accumulates samples while moving, persists via `storage.mjs` |
| `app/fit.mjs` | Minimal FIT activity encoder — tags rides as sport=cycling, sub_sport=virtual_activity (tested) |
| `app/units.mjs` | km/mi + kcal/kJ display formatting; internal state is always metric (tested) |
| `app/screenshot.mjs` | One-click JPG of the map viewport via tab capture (`getDisplayMedia`) — the 3D map canvas sits in a closed shadow root and cannot be read directly |
| `app/gallery.mjs` | Fullscreen ride-gallery overlay (`<dialog#galleryDialog>`): route cards from `app/gallery.json` — all card content (mini-profile bars, difficulty classification, length/ascent/descent) is precomputed by `generate_gallery_json.py`; this module only lays it out and formats the totals for the km/mi setting, plus a live "loaded" marker. Attribution text is a constant here |
| `app/storage.mjs` | Persistence: IndexedDB behind a sync in-memory cache (localStorage fallback + one-time migration; tested) |
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
  the rider is actually moving, and it survives reloads via `storage.mjs`
  (IndexedDB — a long ride no longer risks localStorage's ~5 MB quota).
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
- **UI layout & reusable components.** The app is a dark, single-viewport
  shell (`index.html`): a fixed top bar (brand, GPX chip, Open/Browse/Settings),
  a 3D map filling the left, and a fixed-width right control panel. CSS
  components in `styles.css` are meant to be reused, not re-invented per
  screen: `.btn` (+ `-ghost`/`-blue`/`-accent`/`-outline-*`/`-sm`),
  `.panel-card` (+ `-head`/`-title`/`-hint`), `.stat-grid` + `.stat-tile`,
  `.switch` (the amber toggle used everywhere a checkbox appears in the
  settings dialog), `.setting-row` / `.setting-slider`, `.icon-btn`, and
  `.status-dot`. A global `[hidden] { display: none !important }` rule lets
  the `hidden` attribute win over a component's own `display`. Fonts: Space
  Grotesk (UI), JetBrains Mono / IBM Plex Mono (numbers), Spectral (serif
  titles). The grade palette (green→gray→amber→orange→red) is duplicated in
  three places by design — `profile.mjs#gradeColor`, the gallery generator's
  `generate_gallery_json.py#mini_bar_color` (which bakes the mini-profile bar
  colors into `gallery.json`), and the `.profile-legend` swatches — keep them
  in sync.
- **Settings dialog.** A single `<dialog#settingsDialog>` with a left
  category rail (`[data-settings-tab]`) and a right panel per category
  (`[data-settings-panel]`); `selectSettingsTab` in `app.js` toggles the
  `active` tab, shows the matching panel, and copies the tab's
  `data-panel-title`/`data-panel-subtitle` into the header. `openSettings(tab)`
  opens on a given category (first-run key prompt opens on `"data"`). All the
  underlying inputs kept their IDs, so the settings-restore/sync code is
  unchanged — only their grouping moved.
- **HUD & display settings.** Fullscreen HUD tiles are matched to settings
  toggles by `data-hud="…"` / `data-hud-toggle="…"` keys, which must
  also exist in `DEFAULT_HUD_ELEMENTS` (`tuning.mjs`) — add all three when
  adding a tile (the toggle markup is a `.field-toggle` with a `.switch`).
  The minimap toggle uses `visibility` (class `minimap-hidden`), not
  `display:none`, so the Google map never needs a resize kick when re-shown.
  Map labels toggle the `Map3DElement.mode` between `SATELLITE` and `HYBRID`.
- **Route overview (name + classification + climbs)**: `updateRouteOverview`
  in `app.js` runs once per route load (GPX import or restoring a saved
  ride), not on every ride-progress tick — it only depends on the route's
  fixed distance/ascent totals and populates `state.routeName`/`state.climbs`
  for later use. It fills the top-bar GPX chip (`#gpxChip`), the Difficulty
  stat tile (`#difficultyStat` + `#difficultyDetail`), and the climbs list
  inside the elevation card. `state.routeName` prefers a gallery ride's curated title,
  then the GPX's own `<name>` (`parseGpx` in `route.mjs` returns
  `{ points, name }`), then the uploaded filename, and is persisted/restored
  with the saved ride. `difficulty.mjs#classifyRoute` buckets distance,
  meters-of-climb-per-km, and "equivalent km" (distance + ascent ÷
  `EQUIVALENT_KM_CLIMB_METERS`) into named classes purely from distance and
  elevation gain — no power/speed/weight/weather data. `climbs.mjs#detectClimbs`
  walks the route once, extending a candidate climb through small dips
  (same noise-anchor idea as `enrichRoute`'s ascent counter, but with its own
  dedicated thresholds, deliberately decoupled from
  `CLIMB_NOISE_THRESHOLD_METERS`) and only closing it once elevation has
  dropped `CLIMB_DESCENT_TOLERANCE_METERS` below the peak *and* the route has
  moved `CLIMB_MERGE_GAP_METERS` past that peak — so a short flat stretch or
  a few meters of downhill doesn't end a climb; candidates under
  `CLIMB_MIN_GAIN_METERS` or `CLIMB_MIN_AVERAGE_GRADE_PERCENT` are dropped as
  noise. All thresholds live in `tuning.mjs`. `updateClimbStatus` (`app.js`,
  called from `updateRideUi` on the same slow-UI cadence as the other live
  stats) looks up `state.progressMeters` against `state.climbs` each tick: if
  progress falls inside a climb's `[startDistanceMeters, endDistanceMeters]`
  it reports that climb's remaining distance/ascent/grade and highlights it
  in the climbs list; otherwise it reports the next upcoming climb and the
  distance to it. It never re-detects climbs itself — the tolerance already
  baked into `detectClimbs`'s boundaries is what keeps this from flickering
  on GPX noise.
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
  strokes smear down steep slopes into wide blobs. The route line floats at
  `ROUTE_LINE_ALTITUDE_METERS` (2.5m) with its path densified (`densifyRoute`)
  so elevated segments follow the terrain.
  The rider dot is a `Model3DElement` loading `app/assets/rider-dot.glb` (see
  `renderRiderDot`/`updateRiderDot` in `app.js`), **not** a `Polygon3DElement`
  and **not** a `Marker3DElement`/`PinElement` billboard — both were tried
  first, in that order, and both were confirmed by real-browser testing (not
  just reasoned about) to fail:
  - `Polygon3DElement`: meant for static terrain-draped areas, not a point
    that moves every frame. Re-tessellating one every frame produced a
    solid-black fill at ordinary follow-camera distances — independent of
    polygon winding, altitude/z-fighting with terrain (tried 1–20m up), and
    `extruded: true` (a short cylinder instead of a flat disc) — plus a
    faceted/streaky look from the constant re-triangulation.
  - `Marker3DElement` + `PinElement`: fixed the black-fill and faceting, but
    a `PinElement` reads as a map-pin/teardrop, not a location dot, and its
    `scale` is a screen-space billboard size that doesn't grow/shrink with
    camera distance the way a real ground object should.

  A real mesh avoids all of that. `app/assets/rider-dot.glb` is hand-rolled
  by `scripts/generate_rider_dot_model.py` (no 3D modeling tool available in
  this environment — the same "encode the binary format by hand" approach
  `app/fit.mjs` takes for FIT files): a two-material puck, baked to a true 1
  meter diameter so `RIDER_DOT_SCALE` in `tuning.mjs` is a plain real-world
  size multiplier. Both materials use the `KHR_materials_unlit` glTF
  extension — an ordinary lit PBR material rendered solid black here
  regardless of normals/winding/doubleSided/texturing (confirmed by testing
  many variants), and unlit is also the semantically correct choice for a
  location marker anyway: it must stay clearly visible at any time of day or
  camera angle, not dim to black in shadow like a real physical object would.
  The model is placed with `orientation: {heading:0, tilt:90, roll:0})` —
  without that correction the disc renders standing on its edge instead of
  lying flat on the ground (confirmed by testing; the model's local up axis
  does not map to world-up by default, and this doesn't appear to be
  documented anywhere). Floated at `RIDER_DOT_ALTITUDE_METERS`, kept equal to
  `ROUTE_LINE_ALTITUDE_METERS` since there's no reason for the dot to sit at
  a different height than the line it's walking along. A `Polyline3DElement`
  ring (via `riderCircleCoordinates`, whose winding must trace
  counter-clockwise as seen from above — see its comment) is the fallback for
  browsers without `Model3DElement`. The dot (and the minimap marker) mirrors
  the brand "GPX Rider" logo dot — a solid amber center with a paler amber
  ring — via the model's two materials and, for the minimap and fallback
  ring, the `RIDER_DOT_COLOR` constant in `app.js`. The rider beacon is a
  real-world-sized extruded `Polygon3DElement` cylinder with
  `drawsOccludedSegments` so trees never hide the rider's position; it is
  **off by default** (`DEFAULT_BEACON_ENABLED`), opt-in from the Rendering
  settings — unlike the dot, it hasn't shown the same black-fill issue, but
  it's also large enough that a small-on-screen-footprint problem wouldn't
  reproduce the same way, and if it ever does, the fix here is the same:
  switch it to a `Model3DElement` too, not more polygon tweaking.
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

## Persistence

`app/storage.mjs` keeps everything in IndexedDB (database `gpx-rider`,
object store `kv`), fronted by an in-memory cache that `initStorage()`
loads once — `startApp()` awaits it before anything reads — so
`readJson`/`writeJson`/`removeStored` stay synchronous for callers.
Records saved by older versions in localStorage are migrated into
IndexedDB on first load; browsers without working IndexedDB fall back to
localStorage transparently. Keys: `gpx-rider:settings`,
`gpx-rider:last-ride` (route + progress), `gpx-rider:ride-log` (recorded
samples), `gpx-rider:last-trainer`, `gpx-rider:last-heart-rate`. The one
deliberate exception is `gpx-rider:maps-api-key`, which stays in
localStorage (handled directly in `app.js`): saving it reloads the page
immediately, and only a synchronous write is guaranteed to survive that.
Never send any of these anywhere; the app's privacy story is "everything
stays in the browser".

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
