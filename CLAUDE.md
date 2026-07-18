# CLAUDE.md — instructions for AI agents working on GPX Rider

GPX Rider is a **no-build, static web app**: plain HTML/CSS/JS ES modules,
no bundler, no framework, no `node_modules`. Keep it that way — do not
introduce a build step, TypeScript, npm dependencies, or a framework unless
the user explicitly asks for one. Leaflet (the map library) is **vendored**
as pre-built static files in `app/vendor/leaflet/` (loaded via a plain
`<script>`/`<link>` tag, exactly like the Google/JetBrains fonts) — this is
not an npm dependency and needs no build step; see "Map & rider marker"
below for why it's vendored rather than pointed at a CDN.

Use **American English** throughout the repository, including UI copy,
documentation, code comments, test names, and generated metadata. Preserve
official product names, quoted third-party text, and source data when their
original spelling must remain exact.

## Commands

```sh
make           # default: gallery-data + test (the deploy Action runs the same generation)
make run       # serve the repo (scripts/dev_server.py — a no-cache static server so edits never load stale). Landing page at http://127.0.0.1:5173/app/, the app itself at http://127.0.0.1:5173/app/app.html
make test      # node --test tests/*.test.mjs (no dependencies needed)
make gallery-data  # regenerate app/gallery.json from gallery/*/metadata.json + export.gpx (texts, distance/ascent/descent, difficulty, and mini-profile bars)
```

Always run `make test` after changing anything in `app/`. Browser-only
modules can at least be syntax-checked with `node --check app/<file>.mjs`.

## Architecture

Everything the browser loads lives in `app/`, which is what GitHub Pages
deploys as the site root. `app/index.html` is the **public landing page**
(hero replay + marketing sections, driven by `app/landing/landing.mjs`); its "Launch
GPX Rider" links point to `app.html`, the actual application. `app/app.js` is
the application's only entry point (loaded as a module from `app/app.html`),
and it is deliberately **thin**: it boots the app (`startApp`) and wires DOM
events to the feature modules (`bindEvents`) — nothing else.

Modules are organized into **feature folders** under `app/`. Only `app.js`,
the HTML pages, `styles.css`, `gallery.json`, `assets/`, and `vendor/` stay at
the app root. `app/gallery/` holds served route *data* (GPX/metadata per
route); the gallery *code* lives in `app/gallery-ui/` — keep them apart.

| Folder | Feature | Modules |
|---|---|---|
| `app/core/` | Shared foundation | `state.mjs` (the single mutable `state` object + `els` DOM map + `updateProgressLabel`; bottom of the feature import graph — must never import a feature module), `tuning.mjs` (loads and re-exports **all tunable behavior parameters** from `tuning.yaml` under their historical names — new knobs go in the yaml, not this file), `tuning.yaml` (the actual values + one documented comment each, shared with `scripts/tuning_config.py`), `yaml.mjs` (hand-rolled parser for the small YAML subset `tuning.yaml` uses; tested), `geo.mjs` (pure geodesy: haversine, bearing, destinationPoint, clamp, lerp; tested), `units.mjs` (km/mi + kcal/kJ display formatting; internal state is always metric; tested) |
| `app/map/` | Map rendering | `map-init.mjs` (creates the Leaflet map + OpenStreetMap tile layer — no API key needed), `map-view.mjs` (follow/overview/manual mode state machine: pan-to-rider, fit-bounds overview, manual-drag capture — see "Map & rider marker" below), `route-render.mjs` (grade-colored route polylines + the rider marker), `route-style.mjs` (pure route segment styling), `screenshot.mjs` (viewport JPG via tab capture) |
| `app/route/` | Route processing | `route.mjs` (GPX parsing, enrichment, interpolation, grade, heading; tested), `climb-signal.mjs` (pure resample/smooth/rolling-grade elevation-signal helpers behind climb detection; tested), `climbs.mjs` (sustained-climb detection — the fatigue-pressure state machine built on `climb-signal.mjs`; tested), `difficulty.mjs` (classification from distance + gain; tested), `route-load.mjs` (GPX file/URL intake, `applyGpxText` route-swap sequence, once-per-load route overview), `climbs-ui.mjs` (climb/segment focus, live climb status, the HUD climb/segment banner), `profile.mjs` (elevation profile canvas drawing + hit-testing), `profile-ui.mjs` (profile rendering + hover/seek/drag-select wiring) |
| `app/ride/` | Ride execution & telemetry | `movement.mjs` (the movement loop `tick`, simulation toggle, pedaling hysteresis, reset, seek), `eta.mjs` (flat-equivalent pace ETA model; tested), `ride-ui.mjs` (`updateRideUi`, the per-tick UI driver), `telemetry-ui.mjs` (trainer/HR callbacks, HR source resolution, calories/timer, telemetry readouts), `training-zones.mjs` (HR/power zones, fullscreen zone meters, zone summaries), `recorder.mjs` (ride sample bucket), `recording-ui.mjs` (FIT card, download, clear), `fit.mjs` (FIT encoder — must stay sport=cycling, sub_sport=virtual_activity; tested) |
| `app/trainer/` | Hardware | `trainer.mjs` (trainer pairing + reconnect + protocol detection; FTMS over Web Bluetooth: write queue, Indoor Bike Data; routes to the FE-C backend for Tacx), `trainer-fec.mjs` (Tacx FE-C over BLE backend: telemetry notifications + Track Resistance grade writes on service 6e40fec1), `fec.mjs` (pure ANT+ FE-C codec: ANT framing + page 16/25/51 encode/decode — tested), `heartrate.mjs` (BLE heart-rate strap, service 0x180D) |
| `app/settings/` | Settings | `settings-ui.mjs` (settings dialog shell + every panel except the map action-bar controls: units, rider profile, display & HUD toggles, rendering, screenshot settings) |
| `app/storage/` | Storage & persistence | `storage.mjs` (IndexedDB behind a sync cache, localStorage fallback + migration; tested), `persistence.mjs` (`restoreSettings`/`saveSettings`, `restoreSavedRide`/`saveRide` — the one deliberately cross-cutting module) |
| `app/hud/` | Shared HUD layout | `screen-manager.mjs` (**the central HUD layout manager** — see "Map HUD layout" below), `map-hud.mjs` (clock chip, HUD tile order/visibility + drag-reorder, tile layout, dock collapse, fullscreen enter/exit, map screenshot action), `theater-mode.mjs` (exact-size recording viewport) |
| `app/gallery-ui/` | Gallery | `gallery.mjs` (fullscreen ride-gallery overlay; cards from `app/gallery.json`, each with a small top-down Leaflet preview auto-framed to the route's bounds), `gallery-export.mjs` (Export to gallery card: metadata.json title/description snippet, clipboard copy) |
| `app/landing/` | Landing page | `landing.mjs` (public landing page behavior: hero replay over a live top-down Leaflet/OSM map with a faked HUD, then a whole-route overview hold, loops; knobs in `LANDING_HERO`, `core/tuning.mjs`), `landing-route.mjs` (static route data the hero replays — marketing data, not app runtime) |
| `app/demo/` | Demo mode | `demo.mjs` (pure synthetic trainer/HR ride model; tested), `demo-mode.mjs` (demo mode UI: drives the ride from the model, demo chip sync) |

## Code organization system — how to keep this codebase clean

`app.js` was once a 5000-line monolith; it is now ~230 lines of boot + event
wiring and must stay that way. The rules below are the system that keeps it
so. Follow them mechanically — they are written so that any agent, regardless
of context budget, can make a change without re-deriving the architecture.

### The layers (import direction flows downward only)

Feature folders group a feature's models, views, and coordinators together
(loose MVC: pure domain modules are the models, `*-ui` modules render and
wire UI, coordinator-like modules such as `movement` and `map-view` connect
state, domain logic, and infrastructure). Folders do NOT change the layer
rules — a pure module stays pure wherever it lives:

1. **`core/tuning.mjs`** — constants only, loaded from `core/tuning.yaml` via `core/yaml.mjs` (a pure parser with no imports of its own). Imports nothing app-level.
2. **Pure logic modules** (`core/geo`, `route/route`, `ride/eta`,
   `route/difficulty`, `route/climbs`, `core/units`, `ride/fit`, `demo/demo`,
   `map/route-style`, `route/profile`, `trainer/fec`) — no DOM, no app state,
   no imports from higher layers. Every one of these is unit-testable; most
   are tested.
3. **Hardware/IO modules** (`trainer/trainer`, `trainer/trainer-fec`,
   `trainer/heartrate`, `ride/recorder`, `storage/storage`, `map/screenshot`) —
   own their internal state, talk upward only through `init*()` callbacks or
   return values.
4. **`core/state.mjs`** — the shared mutable `state` object + the `els` DOM
   map + `updateProgressLabel`. It may import only layers 1–3 (in practice:
   `tuning.mjs` and `eta.mjs`). **Never add functions or feature logic here,
   and never make it import a feature module** — it is the bottom of the
   feature graph precisely so everything above can import it freely.
5. **Feature modules** (the `*-ui` modules, `ride/movement`, `map/map-init`,
   `route/route-load`, `map/route-render`, `map/map-view`, `hud/map-hud`,
   `storage/persistence`, …) — import `state`/`els` from `core/state.mjs`,
   pure helpers from layers 1–3, and *each other's exported functions*.
   Circular imports **between feature modules** are expected and safe because
   they only export top-level function declarations that are called at
   runtime; what is NOT safe is running another feature module's code at
   module-evaluation time (top-level calls, or computing a module-level
   `const` from another feature module). Keep module top levels to imports,
   constants, and function declarations.
6. **`app.js`** — boot (`startApp`) + event wiring (`bindEvents`). Nothing
   else, ever.

Do not create broad shared folders (`utils/`, `models/`, `views/`,
`controllers/`) — new code goes in the folder of the feature it belongs to,
or a new feature folder.

### Where does my change go?

- **New behavior** → a new focused module, or the one existing module whose
  header comment names that responsibility. Every module starts with a
  comment stating what it owns; if your change doesn't fit any header, that
  is the signal to create a new module, not to stretch an existing one.
- **New event listener** → the handler lives in a feature module; `app.js`
  gets only the import + `addEventListener` line.
- **New shared state field** → add it to the `state` object in `state.mjs`
  with a comment; new DOM element → add it to `els`. No module-level mutable
  state in feature modules (animation/poll loops keep their "am I running"
  flag on `state`, e.g. `movementLoopActive`).
- **New tunable** → `core/tuning.mjs`, same change (existing rule, see below).
- **New HUD element on the map surface** → the owning feature creates and
  updates the element, and **registers it with the screen manager**
  (`hud/screen-manager.mjs`) instead of absolutely positioning it — see
  "Map HUD layout" below. Never add `position: absolute` + inset rules for a
  HUD component in `styles.css`.
- **New persisted setting** → four places, all in the same change:
  a `DEFAULT_*` in `tuning.mjs`, the field in `state.mjs`, read+clamp in
  `restoreSettings` and the key in `saveSettings` (`persistence.mjs`), and
  the feature's own `sync*`/`apply*` functions. `persistence.mjs` is the one
  module that is *allowed* to touch everything — persistence is inherently
  cross-cutting; don't try to split it.
- **New pure computation** → its own layer-2 module (or an existing one),
  with unit tests in `tests/`.

### Module hygiene rules

- One module = one responsibility, stated in its header comment. If a module
  needs an "and" in its header that isn't cosmetic, split it.
- Keep feature modules roughly **under 400 lines**. `app.js` stays under
  ~350. A module trending past that is due for a split in the same PR.
- Export **only** what other modules or `bindEvents` actually call; keep
  helpers unexported. When you stop using an import, delete it.
- Never reach around a module's exports (no duplicating a private helper
  from another module — export it or move it).
- `.mjs` extension for all browser modules (`app.js` is the sole exception).

### Verification checklist (run every time, in this order)

1. `node --check app/<file>.mjs` for each file you touched (syntax).
2. `make test` (pure-module regressions).
3. Boot the app in a real browser (`make run`, open
   `http://127.0.0.1:5173/app/app.html`) and check the devtools console:
   **import/export name mismatches and missing imports only surface at
   runtime in a no-build app** — a clean `node --check` does not prove the
   module graph links. Load a route, start the simulation, confirm no
   console errors. If you moved or renamed modules, open the landing page
   (`/app/`) too — it has its own import graph.
4. If you added/renamed/split a module, update the module table above and
   mirror the edit in `AGENTS.md`.

Tunable parameters (defaults, thresholds, physics/model factors) live in
`app/core/tuning.yaml` with a doc comment each — never as inline magic values —
so users can adjust behavior in one place, reload, done (no build step).
`app/core/tuning.mjs` only loads that file (via `yaml.mjs`) and re-exports each
value under its historical constant name, so the rest of the app is unchanged;
`scripts/tuning_config.py` parses the exact same `tuning.yaml` (via its own
matching hand-rolled parser, kept in sync with `yaml.mjs` — extend both plus
their shared tests if you widen the supported YAML subset) so the Python
generators (`generate_gallery_json.py`) never mirror a value by hand. This is
not limited to numbers: file paths, URLs, color strings, tile-server config —
anything a user or future contributor might reasonably want to retune belongs
in `tuning.yaml`, not inlined at its call site, even if it's only used once.
When adding a new adjustable behavior, add its constant to `tuning.yaml` (and
the `req(...)` re-export in `tuning.mjs`) in the same change; don't leave it
inline "for now." The one deliberate exception is the BLE write-queue timing
internals in `trainer.mjs` (hardware-safety, documented in place).

## Key domain concepts

- **Two movement sources.** The rider advances along the route from either
  *pedaling* (trainer-reported speed, always wins) or the *simulation*
  (slider speed, toggled by the "Start simulation" button). Starting to
  pedal auto-stops a running simulation; the button must never control the
  trainer-driven movement. Pedaling detection uses hysteresis
  (`PEDALING_START_KPH` / `PEDALING_STOP_KPH` in `tuning.mjs`).
- **The movement loop** (`tick` in `movement.mjs`) runs on requestAnimationFrame
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
  shell (`app.html`): a fixed top bar (brand, GPX chip, Open/Browse/Settings),
  a top-down map filling the left, and a fixed-width right control panel. CSS
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
  in sync. `gradeColor` is exported and reused (not re-copied) by the
  fullscreen climb banner's mini-profile in `climbs-ui.mjs`; the climb-category chip
  colors in `CLIMB_CATEGORIES` (`tuning.mjs`) track the same palette.
- **Settings dialog.** A single `<dialog#settingsDialog>` with a left
  category rail (`[data-settings-tab]`) and a right panel per category
  (`[data-settings-panel]`); `selectSettingsTab` in `settings-ui.mjs` toggles the
  `active` tab, shows the matching panel, and copies the tab's
  `data-panel-title`/`data-panel-subtitle` into the header. `openSettings(tab)`
  opens on a given category (default `"map"`). All the underlying inputs kept
  their IDs, so the settings-restore/sync code is unchanged — only their
  grouping moved. On phones (the `max-width: 860px` block in `styles.css`)
  the dialog stacks: the rail moves to the top as a single
  horizontally-scrolling tab strip and the category panels fill the rest.
  `.settings-main` carries `min-height: 0` so it shrinks to the fixed dialog
  height and `.settings-body` (`overflow-y: auto`, `overscroll-behavior:
  contain`) is what scrolls — without that the panel content spilled past the
  dialog and the page behind scrolled instead (issue #13). Categories:
  `"map"` (follow-rider toggle, route grade colors), `"hud"`, `"units"`,
  `"trainer"`, `"screenshots"`, `"data"`.
- **Map HUD layout (screen manager).** All dynamic map/HUD overlays are laid
  out by `hud/screen-manager.mjs`, which owns four flex regions inside
  `#mapViewport`: **left column**, **center column**, **right column**, and a
  **full-width bottom stack**. Each feature creates, updates, and
  shows/hides its own element, and *registers* it
  (`registerHudComponent({ id, region, weight, element, align })`) — weights
  order a column (ties keep registration order, deterministic), the region's
  flex `gap` spaces components, hiding an element (the `hidden` attribute)
  collapses its slot, and `align: "end"` pins a component to the far end of
  its column. Current placements: left = clock (10) + training meters (20);
  center = climb banner (10) + demo chip (20); right = map actions (10);
  bottom = the data dock. The manager publishes the bottom region's measured
  height as `--fs-dock-height` on the viewport so the side columns end above
  the dock (no overlap), and the region containers carry the responsive
  insets — the phone media block adjusts `--hud-inset`/`--hud-bottom-*` once
  instead of per component. Region containers are `pointer-events: none` with
  `pointer-events: auto` children, so the map stays draggable between
  components. **Never absolutely position a HUD component from its own CSS
  or measure siblings from feature JS** (the old `top: 92px`-style stacking
  and the demo-chip offset hack are exactly what this replaces). The manager
  does layout only — no feature state or behavior. It applies to the dynamic
  map/HUD surface only; the setup panel and dialogs are rigid screens and
  stay out of it.
- **Map ride HUD (design 3a).** The ride HUD is part of `#mapViewport` in
  both setup/windowed mode and fullscreen. Entering fullscreen only adds
  `.fullscreen-mode` to `#mapViewport` (making it a fixed, full-bleed
  container); it must not change which HUD overlays are visible. The setup map
  and fullscreen map are intentionally the same map surface with the same HUD
  content, just at different sizes. Do not add CSS that hides `.fs-*` overlays
  outside `.fullscreen-mode`. Three overlays, all fed on the slow-UI cadence
  from `updateRideUi`:
  - **Bottom data dock** (`#fullscreenOverlayBottom` / `.fs-dock`): the metric
    tiles plus the *road-ahead* elevation profile and the distance/climbing
    progress bars. `initializeMapHud` mounts the shared `#profile` canvas into
    `#fsProfileMount` once; the same grade-coloured canvas draws the grade bars,
    axes, ride marker, hover tooltip, click-to-seek, and drag-to-select segment
    highlight in setup and fullscreen. The dock collapses to a compact strip via
    `#dockToggleBtn` (`toggleHudDock` → `.collapsed` class, persisted as
    `hudDockCollapsed`); collapsed hides the road-ahead profile and stacks the
    two progress bars, expanded shows the profile with the bars side-by-side.
    Because a collapsed (display:none) canvas measures 0×0, re-expanding
    re-renders the profile. The road-ahead plot only has height because the
    two rows of metric tiles set the dock's height — the profile is `flex:1`
    within that. On phones (the `max-width: 860px` block in `styles.css`) the
    dock body stacks into a column instead: the fixed-width metric grid becomes
    a four-column `1fr` grid, the separator and road-ahead note are dropped, the
    road plot gets a fixed height (it has no intrinsic height once the body is a
    column), and the collapsed metric strip wraps — otherwise the desktop row
    layout overflows a phone's width. The corner overlays (clock, banner,
    actions) pull in via the HUD region inset variables and the banner loses
    its desktop `min-width`.
  - **Top-left clock chip** (`#fullscreenClock`): elapsed time (from
    `rideLogSummary().timerSeconds`) + ridden distance, at the head of the
    left HUD column (the training-zone meters stack under it).
  - **Top-right controls**: the existing `.map-actions` cluster, plus the
    Settings shortcut (`#mapSettingsShortcutBtn`, class `.map-action-btn-settings`)
    so the same controls are available when fullscreen hides the top bar.
  - **Top-centre climb/segment banner** (`#climbBanner`, `updateFullscreenClimbBanner`):
    reuses `state.climbs`. Shows the *ahead* variant (category chip from
    `CLIMB_CATEGORIES`, countdown, a mini grade-profile built with
    `profile.mjs`'s exported `gradeColor`, length/gain/avg/max) when the next
    climb is within `CLIMB_BANNER_APPROACH_METERS`, and the *on-climb* variant
    (to-top / to-go / current / peak / grade-left, plus two unlabelled
    progress bars — blue = distance, amber = ascent, matching the dock bars)
    while on it. Both variants carry a "climb N of M" ordinal (the climb's
    `findIndex` position + `state.climbs.length`), mirroring the setup page's
    live climb status. Max grade and the mini-profile bars are cached on the climb
    object (climbs are re-detected each route load, so the cache can't
    go stale). If the user drag-selects a custom profile segment while riding,
    this same banner surface switches to the selected segment stats (start, end,
    length, ascent, descent) instead of forcing a map overview.

  HUD tiles are matched to settings toggles by `data-hud="…"` /
  `data-hud-toggle="…"` keys, which must also exist in `DEFAULT_HUD_ELEMENTS`
  (`tuning.mjs`) — add all three when adding a tile (the toggle markup is a
  `.field-toggle` with a `.switch`; the tile is a `.fs-tile` inside
  `#fullscreenHud` with the matching `data-hud`). `layoutMetricTiles` sizes
  the tiles from the visible count (they flow into two rows and narrow when
  all eight are on).
- **Route overview (name + classification + climbs)**: `updateRouteOverview`
  in `route-load.mjs` runs once per route load (GPX import or restoring a saved
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
  models a "fatigue" (pressure integrator) score meant to emulate perceived
  effort rather than reading point-to-point geometry: the route is first
  resampled to a fixed step and double-smoothed (median filter, then moving
  average, both in `climb-signal.mjs`), then at every point a short- and a
  long-distance rolling grade are read and whichever is more "climb-like"
  (grade run through a nonlinear pressure curve, since humans don't perceive
  steepness linearly) fills the bucket; flats and descents drain it. A
  candidate becomes an officially active climb once the bucket crosses
  `start_fatigue`, and closes on whichever comes first: the bucket draining
  back to `end_fatigue`, the route dropping `end_drop_meters` below the peak
  over `end_drop_distance_meters`, or `max_easy_after_peak_meters` passing
  with no climb pressure at all — so a short flat stretch or a few meters of
  downhill doesn't end a climb. Accepted candidates within `merge_gap_meters`
  of each other (and no more than `merge_max_drop_meters` apart in elevation)
  are merged into one; candidates under `min_gain_meters`, `min_distance_meters`,
  or the length-scaled `min_average_grade_for_length` floor are dropped as
  noise. All thresholds live in the `climb_detection` section of `tuning.yaml`
  (via `tuning.mjs`) — `scripts/climb_tester.py` is a standalone CLI that reads
  the exact same section for verbose step-by-step diagnostics against a GPX
  file; it does not affect the shipped app. `updateClimbStatus` (`climbs-ui.mjs`,
  called from `updateRideUi` on the same slow-UI cadence as the other live
  stats) looks up `state.progressMeters` against `state.climbs` each tick: if
  progress falls inside a climb's `[startDistanceMeters, endDistanceMeters]`
  it reports that climb's remaining distance/ascent/grade and highlights it
  in the climbs list; otherwise it reports the next upcoming climb and the
  distance to it. It never re-detects climbs itself — the tolerance already
  baked into `detectClimbs`'s boundaries is what keeps this from flickering
  on GPX noise.
- **Custom profile segments.** A click on the elevation profile still seeks the
  rider. A horizontal drag across the profile selects an arbitrary route
  segment, using `PROFILE_SEGMENT_SELECTION_*` thresholds in `tuning.mjs` to
  avoid accidental tiny selections. While a custom segment is selected, the
  normal profile hover readout is disabled and that same canvas readout style is
  reused for segment stats: start, stop, length, ascent, and descent. A normal
  click on the profile clears the custom selection and then seeks as usual.
  While stationary in overview, selecting a segment seeks to its start,
  highlights it on the profile and route line, and fits the map to that
  segment's bounds (the same climb/segment overview `focusedRouteRange()`
  drives for detected climbs). While moving, it does not change the map mode;
  it keeps following the rider and shows only the segment stats in the map
  HUD banner. A selected custom segment is not added to `state.climbs` and
  must not affect climb detection/status.
- **First-open auto-load & route deep-link**: with no saved ride and a working
  map, `initGallery` loads the first gallery route automatically
  (`shouldAutoLoadFirst` in `app.js`'s `startApp`). Opening the app with a
  `?route=<gallery-id>` query (the landing page's "Launch GPX Rider"
  button uses `app.html?route=0050_jested`) forces that specific gallery route
  on load — ahead of both a restored saved ride and the auto-load-first — via
  `getRequestedRouteId` passed to `initGallery`. An absent or unknown id just
  falls through to the normal behavior.
- **Units**: all internal values are metric (meters, km/h, kcal). Only
  format at the display edge via `units.mjs`.
- **BLE**: FTMS control-point writes must go through the write queue in
  `trainer.mjs` (one GATT operation at a time) and grade writes are
  throttled/averaged — read the comments there before changing timing.
- **Two trainer protocols.** `trainer.mjs` pairs and reconnects for both, then
  detects at connect time which control service the chosen device exposes and
  routes to a backend: **FTMS** (`0x1826`, handled inline in `trainer.mjs` —
  KICKR-class trainers) or **Tacx FE-C over BLE** (`6e40fec1`, handled by
  `trainer-fec.mjs` — the wheel-on Flow/Vortex/Bushido/Genius, which never got
  FTMS firmware). The public API (`connectTrainer`, `queueTrainerGradeSample`,
  `sendTrainerGrade`, `isTrainerConnected`, telemetry/status callbacks) is
  protocol-agnostic, so `movement.mjs`/`telemetry-ui.mjs`/`app.js` never learn
  which is active. `sendTrainerGrade` dispatches to the FE-C Track Resistance
  write when `trainer.protocol === "fec"`; FTMS-only commands
  (`sendTrainerCommand` Start/Stop/Reset/Request-Control) are simply no-ops on
  FE-C (its `controlPoint` is null and FE-C needs no control handshake). The
  wire format is a hand-rolled ANT+ FE-C codec in the pure, tested `fec.mjs`
  (ANT framing + XOR checksum; page 51 Track Resistance grade encode with its
  −200% offset; page 16/25 speed/power/cadence decode); `trainer-fec.mjs` is
  the BLE IO around it and adapts to whether a device wraps pages in ANT
  framing or sends them bare (learned from the first parseable notification).
  FE-C carries no calories field, so calories come from power for those
  trainers. `TACX_FEC_DEFAULT_CRR` (the rolling-resistance coefficient sent
  with each grade) lives in `tuning.yaml`.
- **Map & rider marker.** GPX Rider renders a plain top-down 2D slippy map —
  [Leaflet](https://leafletjs.com/) with OpenStreetMap raster tiles — instead
  of a 3D camera. There is no tilt, range, heading, or camera physics: panning
  and zooming is exactly what Leaflet gives for free, which is also why this
  is dramatically simpler than the Google Photorealistic 3D Maps system it
  replaced (no API key, no follow-camera chase math, no cinematic overview
  flight patterns, no terrain-avoidance lift). `map-init.mjs#initMap` creates
  the Leaflet map and a single OpenStreetMap tile layer (`MAP_TILE_URL`,
  `MAP_ATTRIBUTION`, `MAP_MAX_ZOOM` in `tuning.mjs` — never remove or hide the
  OpenStreetMap attribution, it's required by the tile usage policy). Leaflet
  is vendored (`app/vendor/leaflet/`, fetched once from the npm registry's
  published `dist/` build) rather than pointed at a CDN `<script>` tag: this
  keeps the map working even when a CDN is unreachable or blocked by a
  restrictive network policy (as this sandbox's own outbound proxy blocks
  unpkg.com/jsdelivr/cdnjs — a real risk this app's users could hit too), and
  since it's just static files with no build step, vendoring costs nothing.
  The route line (`route-render.mjs#renderRouteLines`) is grade-colored
  `L.polyline` segments built the same way the old 3D route was —
  `route-style.mjs`'s pure segment-styling helpers are unchanged, they just
  feed Leaflet polylines instead of `Polyline3DElement`s. The rider marker
  (`renderRiderMarker`/`updateRiderMarker`) is an `L.marker` with a `divIcon`:
  a small circular dot (`.rider-marker-ring`, amber-on-amber-ring matching the
  brand "GPX Rider" logo dot) with a directional arrow (`.rider-marker-arrow`)
  that rotates to `headingAt(route, progressMeters)` (`route.mjs`) each frame
  — CSS `transform: rotate()` on an element that spans the whole icon box, so
  it turns around the marker's own center. `map-view.mjs` owns the three map
  modes in `state.mapMode`:
  - `"follow"` — `updateMapFollow` (called from `ride-ui.mjs` on the slow-UI
    cadence, not every frame — restarting Leaflet's own `panTo` glide 60
    times a second looks worse than a few times a second) pans the map to the
    rider's current position if `state.followRider` is on (the map action bar
    / Settings "keep rider centered" toggle, `centerRiderInput`/
    `centerRiderBtn`).
  - `"overview"` — `enterOverviewMode({ route, instant })` fits the map to a
    route's bounds (`L.map#fitBounds`, padded by `MAP_OVERVIEW_PADDING_PIXELS`).
    Passing a climb/segment slice instead of the whole route (from
    `climbs-ui.mjs#focusClimb`/`focusProfileSegment`) frames just that range —
    there is no separate "climb camera mode" anymore, it's the same fit
    against a smaller route array. `instant` skips Leaflet's pan/zoom
    animation for a fresh route load (a new route can be on the other side of
    the world).
  - `"manual"` — the user dragged or zoomed the map by hand
    (`bindManualMapCapture`'s `dragstart`/`zoomstart` listeners, guarded by
    `state.programmaticMapMove` so the app's own `panTo`/`fitBounds`/`setView`
    calls don't trip them). Nothing recenters the map until the user presses
    the overview toggle or the recenter button.
  `toggleRouteOverview` drives the map action bar's overview button exactly
  like before: pressed once frames the whole route, pressed again (from a
  climb/segment-focused overview) returns to the whole-route overview, pressed
  from there returns to following the rider. Movement starting (pedal or sim)
  always calls `returnToFollow()` once via `ensureMovementLoop` — the overview
  is **never** force-disabled at any other time, matching the old camera's
  behavior; a user may still toggle it on mid-ride.

## Persistence

`app/storage/storage.mjs` keeps everything in IndexedDB (database `gpx-rider`,
object store `kv`), fronted by an in-memory cache that `initStorage()`
loads once — `startApp()` awaits it before anything reads — so
`readJson`/`writeJson`/`removeStored` stay synchronous for callers.
Records saved by older versions in localStorage are migrated into
IndexedDB on first load; browsers without working IndexedDB fall back to
localStorage transparently. Keys: `gpx-rider:settings`,
`gpx-rider:last-ride` (route + progress), `gpx-rider:ride-log` (recorded
samples), `gpx-rider:last-trainer`, `gpx-rider:last-heart-rate`. Never send
any of these anywhere; the app's privacy story is "everything stays in the
browser". There is no API key to manage anywhere: OpenStreetMap tiles are
free and anonymous, so the map works identically for every visitor, fork,
and local checkout with zero setup.

## Documentation duties

- **Keep `README.md` updated.** Any user-visible feature, limitation, or
  workflow change must be reflected in the README (Features, How to use it,
  Notes & limitations). The README is the project's landing page; stale
  docs are treated as bugs.
- **Feature interesting algorithms and architecture decisions in the
  README's "Under the hood" section.** When a change introduces or replaces
  a non-obvious algorithm (e.g. the climb-detection fatigue model) or makes
  an architecture decision worth explaining (an ADR-style "why this approach,
  not the obvious one" — e.g. vendoring Leaflet, or dropping the 3D camera
  for a top-down map) add or update a subsection there in the same change —
  short intro, a bullet list of the techniques involved, and links to the
  pure module(s), their tests, and the relevant `tuning.yaml` section. Match
  the existing subsections' style. Routine bug fixes and small feature
  additions don't need this; reserve it for things a contributor would
  otherwise have to read the code to discover.
- Keep `AGENTS.md` and `CLAUDE.md` synchronized. Any change to one
  agent-instruction file must be reflected in the other in the same change
  (preserving only filename-specific titles if needed).
- Keep these files updated when the architecture or conventions change.
- Gallery route text lives in `gallery/*/metadata.json` (`title`,
  `description`). Use the setup page's Export to gallery card to copy the
  current title/description into that file, then run `make gallery-data` —
  the card preview itself is always auto-framed to the route's bounds, so
  there is no camera pose to hand-author.

## Testing & manual verification

- **Understand before you touch code.** Before implementing a bug fix or
  feature, take a moment to actually think through the problem: what is the
  current behavior, why is it happening (trace it to the responsible module
  using the layer/folder table above, don't guess), and what should the
  correct behavior be. Skipping straight to an edit is how superficial
  patches (fixing a symptom at the call site instead of the root cause in
  the owning module) end up in this codebase.
- **Reproduce before you fix.** For a bug fix, write a failing unit test
  that captures the reported behavior *before* changing implementation code
  — for pure logic (layer 2 modules) this is a real `tests/*.test.mjs` case;
  for something only reachable through the DOM/map, reproduce it manually
  in the browser first (`make run`) and note the exact repro steps. Watch it
  fail for the reason you expect, then implement the fix and watch the same
  test/repro pass. For a new feature, write the test(s) for the pure logic
  it needs first, then implement against them. This is what caught, for
  example, that FIT's `activity.local_timestamp` needs to differ from
  `timestamp` by the local UTC offset (issue #4) rather than repeating the
  same UTC value — the failing test forced decoding the real encoded bytes
  instead of eyeballing the change.
- Unit tests cover the pure modules (`route`, `units`, `fit`, `eta`,
  `climbs`, `difficulty`, `demo`, `route-style`, `fec`, `yaml`, `storage`,
  `profile`). Add tests alongside any new pure logic.
- Web Bluetooth requires Chrome/Edge; hardware paths can't be unit-tested.
  When changing `trainer.mjs`/`heartrate.mjs`, preserve the existing
  logging (`[trainer]` console.debug lines) — it's the only field
  diagnostics available.
- The deployed site is GitHub Pages via
  `.github/workflows/deploy-pages.yml` (deploys `app/` on push to `main`).
