# CLAUDE.md — instructions for AI agents working on GPX Rider

GPX Rider is a **no-build, static web app**: plain HTML/CSS/JS ES modules,
no bundler, no framework, no `node_modules`. Keep it that way — do not
introduce a build step, TypeScript, npm dependencies, or a framework unless
the user explicitly asks for one.

Use **American English** throughout the repository, including UI copy,
documentation, code comments, test names, and generated metadata. Preserve
official product names, quoted third-party text, and source data when their
original spelling must remain exact.

## Commands

```sh
make           # default: gallery-data + test (the deploy Action runs the same generation)
make run       # serve the repo (scripts/dev_server.py — a no-cache static server so edits never load stale). Landing page at http://127.0.0.1:5173/app/, the app itself at http://127.0.0.1:5173/app/app.html
make test      # node --test tests/*.test.mjs (no dependencies needed)
make gallery-data  # regenerate app/gallery.json from gallery/*/metadata.json + export.gpx (texts, preview camera, distance/ascent/descent, difficulty, and mini-profile bars)
make rider-dot-model  # regenerate app/assets/rider-dot.glb (the 3D rider marker mesh) — only needed after editing scripts/generate_rider_dot_model.py, not part of the default `make`
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
`config.mjs` (rewritten in place at deploy time — do not move it), the HTML
pages, `styles.css`, `gallery.json`, and `assets/` stay at the app root.
`app/gallery/` holds served route *data* (GPX/metadata per route); the gallery
*code* lives in `app/gallery-ui/` — keep them apart.

| Folder | Feature | Modules |
|---|---|---|
| `app/core/` | Shared foundation | `state.mjs` (the single mutable `state` object + `els` DOM map + `updateProgressLabel`; bottom of the feature import graph — must never import a feature module), `tuning.mjs` (loads and re-exports **all tunable behavior parameters** from `tuning.yaml` under their historical names — new knobs go in the yaml, not this file), `tuning.yaml` (the actual values + one documented comment each, shared with `scripts/tuning_config.py`), `yaml.mjs` (hand-rolled parser for the small YAML subset `tuning.yaml` uses; tested), `geo.mjs` (pure geodesy: haversine, bearing, destinationPoint, clamp, lerp; tested), `units.mjs` (km/mi + kcal/kJ display formatting; internal state is always metric; tested) |
| `app/map/` | Map rendering | `map-init.mjs` (Maps API key resolution/saving, Google Maps JS loader, 3D map + minimap creation), `route-render.mjs` (elevated 3D route lines, rider dot mesh + fallback ring, rider beacon, minimap route/marker — see the rider-dot notes below), `route-style.mjs` (pure route segment styling), `screenshot.mjs` (viewport JPG via tab capture — the 3D canvas sits in a closed shadow root and cannot be read directly), `terrain-tiles-math.mjs` (pure Web Mercator tile coords + Terrarium elevation decode; tested), `terrain-tiles.mjs` (fetches/decodes/LRU-caches online Mapzen Terrarium elevation tiles — see "Online terrain elevation" below) |
| `app/camera/` | Camera behavior | `camera.mjs` (pure follow-camera math; tested), `flyover.mjs` (pure orbit math; tested), `flyby.mjs` (pure ellipse/figure-eight flight math; tested), `follow-camera.mjs` (follow/first-person targets, chase flight, terrain avoidance, manual-drag capture), `overview-camera.mjs` (overview state machine: static/satellite framing, animated orbit/fly-by/fly-over, finish orbit, return-to-rider), `camera-ui.mjs` (map action-bar camera controls + menus, camera settings sliders, first-person preset, reset button state), `camera-debug.mjs` (debug overlay readout + red travel-path debug line), `transition-arc.mjs` (pure overview ↔ chase transition-arc math: Hermite/Bezier eye + look-at flight, duration solver against scale-aware physical limits; tested), `transition-camera.mjs` (app-side transition driver: captures pose + driver velocity, predicts the dock state, flies the arc into whichever target is in `arc_into_modes` — the follow camera (overview-off, movement-start, profile-seek teleport) or the fly-by/fly-over pattern; static/orbit/satellite overviews are never arced into) |
| `app/route/` | Route processing | `route.mjs` (GPX parsing, enrichment, interpolation, grade; tested), `climb-signal.mjs` (pure resample/smooth/rolling-grade elevation-signal helpers behind climb detection; tested), `climbs.mjs` (sustained-climb detection — the fatigue-pressure state machine built on `climb-signal.mjs`; tested), `difficulty.mjs` (classification from distance + gain; tested), `route-load.mjs` (GPX file/URL intake, `applyGpxText` route-swap sequence, once-per-load route overview), `climbs-ui.mjs` (climb/segment focus, live climb status, the HUD climb/segment banner), `profile.mjs` (elevation profile canvas drawing + hit-testing), `profile-ui.mjs` (profile rendering + hover/seek/drag-select wiring) |
| `app/ride/` | Ride execution & telemetry | `movement.mjs` (the movement loop `tick`, simulation toggle, pedaling hysteresis, reset, seek), `eta.mjs` (flat-equivalent pace ETA model; tested), `ride-ui.mjs` (`updateRideUi`, the per-tick UI driver), `telemetry-ui.mjs` (trainer/HR callbacks, HR source resolution, calories/timer, telemetry readouts), `training-zones.mjs` (HR/power zones, fullscreen zone meters, zone summaries), `recorder.mjs` (ride sample bucket), `recording-ui.mjs` (FIT card, download, clear), `fit.mjs` (FIT encoder — must stay sport=cycling, sub_sport=virtual_activity; tested) |
| `app/trainer/` | Hardware | `trainer.mjs` (FTMS over Web Bluetooth: pairing, reconnect, write queue, Indoor Bike Data), `heartrate.mjs` (BLE heart-rate strap, service 0x180D) |
| `app/settings/` | Settings | `settings-ui.mjs` (settings dialog shell + every non-camera panel: units, rider profile, display & HUD toggles, rendering, screenshot settings) |
| `app/storage/` | Storage & persistence | `storage.mjs` (IndexedDB behind a sync cache, localStorage fallback + migration; tested), `persistence.mjs` (`restoreSettings`/`saveSettings`, `restoreSavedRide`/`saveRide` — the one deliberately cross-cutting module) |
| `app/hud/` | Shared HUD layout | `screen-manager.mjs` (**the central HUD layout manager** — see "Map HUD layout" below), `map-hud.mjs` (clock chip, HUD tile order/visibility + drag-reorder, tile layout, dock collapse, fullscreen enter/exit, map screenshot action), `theater-mode.mjs` (exact-size recording viewport) |
| `app/gallery-ui/` | Gallery | `gallery.mjs` (fullscreen ride-gallery overlay; cards from `app/gallery.json`, per-card on-demand 3D preview via each route's `metadata.json#previewCamera`), `gallery-export.mjs` (Export to gallery card: metadata.json snippet with the live camera, clipboard copy) |
| `app/landing/` | Landing page | `landing.mjs` (public landing page behavior: hero replay over a live 3D map with a faked HUD, then summit orbit, loops; knobs in `LANDING_HERO`, `core/tuning.mjs`), `landing-route.mjs` (static route data the hero replays — marketing data, not app runtime) |
| `app/demo/` | Demo mode | `demo.mjs` (pure synthetic trainer/HR ride model; tested), `demo-mode.mjs` (demo mode UI: drives the ride from the model, demo chip sync) |

## Code organization system — how to keep this codebase clean

`app.js` was once a 5000-line monolith; it is now ~300 lines of boot + event
wiring and must stay that way. The rules below are the system that keeps it
so. Follow them mechanically — they are written so that any agent, regardless
of context budget, can make a change without re-deriving the architecture.

### The layers (import direction flows downward only)

Feature folders group a feature's models, views, and coordinators together
(loose MVC: pure domain modules are the models, `*-ui` modules render and
wire UI, coordinator-like modules such as `movement`, `follow-camera` and
`overview-camera` connect state, domain logic, and infrastructure). Folders
do NOT change the layer rules — a pure module stays pure wherever it lives:

1. **`core/tuning.mjs`** — constants only, loaded from `core/tuning.yaml` via `core/yaml.mjs` (a pure parser with no imports of its own). Imports nothing app-level.
2. **Pure logic modules** (`core/geo`, `camera/camera`, `route/route`,
   `ride/eta`, `route/difficulty`, `route/climbs`, `core/units`, `ride/fit`,
   `camera/flyby`, `camera/flyover`, `demo/demo`, `map/route-style`,
   `route/profile`) — no DOM, no app state, no imports from higher layers.
   Every one of these is unit-testable; most are tested.
3. **Hardware/IO modules** (`trainer/trainer`, `trainer/heartrate`,
   `ride/recorder`, `storage/storage`, `map/screenshot`) — own their internal
   state, talk upward only through `init*()` callbacks or return values.
4. **`core/state.mjs`** — the shared mutable `state` object + the `els` DOM
   map + `updateProgressLabel`. It may import only layers 1–3 (in practice:
   `tuning.mjs` and `eta.mjs`). **Never add functions or feature logic here,
   and never make it import a feature module** — it is the bottom of the
   feature graph precisely so everything above can import it freely.
5. **Feature modules** (the `*-ui` modules, `ride/movement`, `map/map-init`,
   `route/route-load`, `map/route-render`, `camera/follow-camera`,
   `camera/overview-camera`, `hud/map-hud`, `storage/persistence`, …) —
   import `state`/`els` from `core/state.mjs`, pure helpers from layers 1–3,
   and *each other's exported functions*. Circular imports **between feature
   modules** are expected and safe because they only export top-level
   function declarations that are called at runtime; what is NOT safe is
   running another feature module's code at module-evaluation time (top-level
   calls, or computing a module-level `const` from another feature module).
   Keep module top levels to imports, constants, and function declarations.
6. **`app.js`** — boot (`startApp`) + event wiring (`bindEvents`). Nothing
   else, ever. (`config.mjs` also stays at the app root: the deploy Action
   and the dev server rewrite it in place by path.)

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
not limited to numbers: file paths, URLs, color strings, orientation/config
objects — anything a user or future contributor might reasonably want to
retune belongs in `tuning.yaml`, not inlined at its call site, even if it's
only used once. When adding a new adjustable behavior, add its constant to
`tuning.yaml` (and the `req(...)` re-export in `tuning.mjs`) in the same
change; don't leave it inline "for now." Deliberate exceptions:
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
  in sync. `gradeColor` is exported and reused (not re-copied) by the
  fullscreen climb banner's mini-profile in `climbs-ui.mjs`; the climb-category chip
  colors in `CLIMB_CATEGORIES` (`tuning.mjs`) track the same palette.
- **Settings dialog.** A single `<dialog#settingsDialog>` with a left
  category rail (`[data-settings-tab]`) and a right panel per category
  (`[data-settings-panel]`); `selectSettingsTab` in `settings-ui.mjs` toggles the
  `active` tab, shows the matching panel, and copies the tab's
  `data-panel-title`/`data-panel-subtitle` into the header. `openSettings(tab)`
  opens on a given category (first-run key prompt opens on `"data"`). All the
  underlying inputs kept their IDs, so the settings-restore/sync code is
  unchanged — only their grouping moved. On phones (the `max-width: 860px`
  block in `styles.css`) the dialog stacks: the rail moves to the top as a
  single horizontally-scrolling tab strip and the category panels fill the
  rest. `.settings-main` carries `min-height: 0` so it shrinks to the fixed
  dialog height and `.settings-body` (`overflow-y: auto`, `overscroll-behavior:
  contain`) is what scrolls — without that the panel content spilled past the
  dialog and the page behind scrolled instead (issue #13). The `"debug"`
  category holds developer-facing toggles (currently the camera-debug overlay,
  below); new diagnostics go there rather than cluttering the user-facing tabs.
- **Camera debug overlay.** A `"debug"` settings toggle
  (`#cameraDebugInput` → `state.cameraDebugEnabled`, persisted, default off via
  `DEFAULT_CAMERA_DEBUG_ENABLED`) shows a translucent readout (`#cameraDebug`,
  a plain map overlay — visible windowed *and* fullscreen, unlike the
  `.fs-*` HUD overlays) of the values the 3D map **actually applies**:
  `state.map.{tilt,range,heading,roll,fov,center}` plus the derived eye altitude
  and ride progress. The readout can be collapsed via
  `#cameraDebugCollapseBtn` (`state.cameraDebugCollapsed`, persisted) while
  keeping the debug overlay active. It exists mainly to compare a requested
  camera against what Google honours after a manual drag (e.g. how far a tilt
  is respected at a given range). While active and the selected overview mode is
  `"orbit"`, `"flyby"` or `"flyover"`, `camera-debug.mjs` also draws that mode's travel path
  as a red `Polyline3DElement` configured by `OVERVIEW_DEBUG_LINE_*`; for orbit
  this is the camera eye's ground track, for fly-by the fitted travel ellipse,
  and for fly-over the fitted figure-eight. It stays visible if the user drags
  the camera into manual mode.
  `renderCameraDebug` rebuilds the rows and
  `startCameraDebugLoop` re-runs it on its own `CAMERA_DEBUG_REFRESH_MS`
  `setTimeout` chain while the overlay is on — a dedicated poll because when
  the user is dragging the camera at rest nothing else steps it. Wired through
  the same `updateDisplaySettingsFromControls`/`syncDisplayControls`/
  `applyDisplaySettings` trio as the other display toggles.
- **Map HUD layout (screen manager).** All dynamic map/HUD overlays are laid
  out by `hud/screen-manager.mjs`, which owns four flex regions inside
  `#mapViewport`: **left column**, **center column**, **right column**, and a
  **full-width bottom stack**. Each feature creates, updates, and
  shows/hides its own element, and *registers* it
  (`registerHudComponent({ id, region, weight, element, align })`) — weights
  order a column (ties keep registration order, deterministic), the region's
  flex `gap` spaces components, hiding an element (the `hidden` attribute)
  collapses its slot, and `align: "end"` pins a component to the far end of
  its column (the minimap). Current placements: left = clock (10) +
  training meters (20); center = climb banner (10) + demo chip (20); right =
  map actions (10) + camera debug (20) + minimap (30, end); bottom = the data
  dock. The manager publishes the bottom region's measured height as
  `--fs-dock-height` on the viewport so the side columns end above the dock
  (no overlap), and the region containers carry the responsive insets — the
  phone media block adjusts `--hud-inset`/`--hud-bottom-*` once instead of
  per component. Region containers are `pointer-events: none` with
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
    layout overflows a phone's width. The corner overlays (minimap, clock,
    banner, actions) pull in via the HUD region inset variables and the banner
    loses its desktop `min-width`.
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
    length, ascent, descent) instead of forcing a camera overview.

  HUD tiles are matched to settings toggles by `data-hud="…"` /
  `data-hud-toggle="…"` keys, which must also exist in `DEFAULT_HUD_ELEMENTS`
  (`tuning.mjs`) — add all three when adding a tile (the toggle markup is a
  `.field-toggle` with a `.switch`; the tile is a `.fs-tile` inside
  `#fullscreenHud` with the matching `data-hud`). `layoutMetricTiles` sizes
  the tiles from the visible count (they flow into two rows and narrow when
  all eight are on). The minimap toggle uses `visibility` (class
  `minimap-hidden`), not `display:none`, so the Google map never needs a
  resize kick when re-shown. Map labels toggle the `Map3DElement.mode`
  between `SATELLITE` and `HYBRID`.
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
  highlights it on the profile and 3D route, and enters the same focused camera
  stack used by detected climbs (`static`, `orbit`, or `satellite`, controlled
  by `climbFocusMode`). While moving, it does not change camera mode; it keeps
  the rider camera/follow behavior and shows only the segment stats in the map
  HUD banner. A selected custom segment is not added to `state.climbs` and must
  not affect climb detection/status.
- **First-open auto-load & route deep-link**: with no saved ride and a working
  map, `initGallery` loads the first gallery route automatically
  (`shouldAutoLoadFirst` in `app.js`'s `startApp`); it is skipped when the map/API key
  is missing so the first-run key prompt stays front and center. Opening the
  app with a `?route=<gallery-id>` query (the landing page's "Launch GPX Rider"
  button uses `app.html?route=0050_jested`) forces that specific gallery route
  on load — ahead of both a restored saved ride and the auto-load-first — via
  `getRequestedRouteId` passed to `initGallery`. An absent or unknown id just
  falls through to the normal behavior.
- **Units**: all internal values are metric (meters, km/h, kcal). Only
  format at the display edge via `units.mjs`.
- **BLE**: FTMS control-point writes must go through the write queue in
  `trainer.mjs` (one GATT operation at a time) and grade writes are
  throttled/averaged — read the comments there before changing timing.
- **3D map geometry**: never render lines with `CLAMP_TO_GROUND` — draped
  strokes smear down steep slopes into wide blobs. The route line floats at
  `ROUTE_LINE_ALTITUDE_METERS` (2.5m) with its path densified (`densifyRoute`)
  so elevated segments follow the terrain.
  The rider dot is a `Model3DElement` loading the model at
  `RIDER_DOT_MODEL_PATH` (`tuning.mjs`; see `renderRiderDot`/`updateRiderDot`
  in `route-render.mjs`), **not** a `Polygon3DElement` and **not** a
  `Marker3DElement`/`PinElement` billboard — both were tried first, in that
  order, and both were confirmed by real-browser testing (not just reasoned
  about) to fail:
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

  A real mesh avoids all of that. The shipped model, `app/assets/rider-dot.glb`,
  is hand-rolled by `scripts/generate_rider_dot_model.py` (no 3D modeling
  tool available in this environment — the same "encode the binary format by
  hand" approach `app/ride/fit.mjs` takes for FIT files): a two-material puck,
  baked to a true 1 meter diameter so `RIDER_DOT_SCALE` in `tuning.mjs` is a
  plain real-world size multiplier. Both materials use the
  `KHR_materials_unlit` glTF extension — an ordinary lit PBR material
  rendered solid black here regardless of normals/winding/doubleSided/
  texturing (confirmed by testing many variants), and unlit is also the
  semantically correct choice for a location marker anyway: it must stay
  clearly visible at any time of day or camera angle, not dim to black in
  shadow like a real physical object would. `RIDER_DOT_MODEL_PATH`,
  `RIDER_DOT_ORIENTATION`, `RIDER_DOT_SCALE`, and `RIDER_DOT_ALTITUDE_METERS`
  (`tuning.mjs`) are all independently tunable specifically so a different
  model can be dropped into `app/assets/` and pointed at without touching
  `route-render.mjs` — see the comments on those constants for what to expect when
  swapping models (orientation and unlit materials both being the most
  likely things a new model needs). `RIDER_DOT_ALTITUDE_METERS` puts the dot
  on the ground and is deliberately independent of `ROUTE_LINE_ALTITUDE_METERS`
  — the route line has to float clear of the terrain because a drawn line
  clamped to the ground smears down slopes, but a real mesh doesn't have that
  problem. It's not 0 though: the shipped puck's origin is at its vertical
  center, so 0 buried its bottom half in the terrain, and clipping didn't
  fully stop until well past just the model's own half-height — most likely
  because the terrain mesh itself isn't perfectly smooth/precise at close
  range (confirmed by testing on a steep switchback, where clipping is most
  visible). Needs retuning alongside `RIDER_DOT_MODEL_PATH` for a model with
  different dimensions or an off-center origin — start from that model's own
  half-height above 0 and increase from there if it still clips. A
  `Polyline3DElement` ring (via `riderCircleCoordinates`, whose winding must
  trace counter-clockwise as seen from above — see its comment) is the fallback for
  browsers without `Model3DElement`. The dot (and the minimap marker) mirrors
  the brand "GPX Rider" logo dot — a solid amber center with a paler amber
  ring — via the model's two materials and, for the minimap and fallback
  ring, the `RIDER_DOT_COLOR` constant in `route-render.mjs`. The rider beacon is a
  real-world-sized extruded `Polygon3DElement` cylinder with
  `drawsOccludedSegments` so trees never hide the rider's position; it is
  **off by default** (`DEFAULT_BEACON_ENABLED`), opt-in from the Rendering
  settings — unlike the dot, it hasn't shown the same black-fill issue, but
  it's also large enough that a small-on-screen-footprint problem wouldn't
  reproduce the same way, and if it ever does, the fix here is the same:
  switch it to a `Model3DElement` too, not more polygon tweaking.
- **Camera modes & physical motion**: `state.overviewActive` is true by
  default after a route loads, and `state.cameraMode` is `"overview"` while the
  route overview is actually driving the map (whole route framed via
  `computeRouteOverviewCamera`
  in `camera.mjs`: the framing axis is the route's *principal axis of spread*
  — a PCA over all points, not the start→end line, so loops/lollipops/
  out-and-backs still frame along their real long dimension instead of an
  arbitrary near-zero start→end axis — with that long axis horizontal, the
  route's far side facing away, and start-left/end-right for open routes). The
  overview's tilt, side and distance are tunable in `tuning.mjs`
  (`OVERVIEW_TILT_DEGREES`, `OVERVIEW_HEADING_OFFSET_DEGREES`,
  `OVERVIEW_MARGIN_FACTOR`, `OVERVIEW_RANGE_FACTOR`,
  `OVERVIEW_MIN/MAX_RANGE_METERS`, all passed through from `enterOverviewMode`).
  `headingOffsetDegrees` rotates the whole view on top of the auto-picked side
  (180 = view from the exact opposite side, long axis still horizontal; other
  values swing the azimuth freely — the fit reruns against the final heading so
  the route stays framed at any offset). The fit always frames the whole route;
  `rangeFactor` (<1) and
  `maxRangeMeters` pull the camera in closer at the cost of cropping the route
  — the lever for a lower, terrain-rich view, since Google's 3D map limits how
  far it will tilt toward the horizon at the large range a whole-route fit
  needs (use the Debug camera overlay to see the tilt it actually applies).
  Grabbing the map while an overview is showing turns the overview **off**:
  `endUserInteraction` clears `overviewActive`, drops any animated driver, and
  sets `state.cameraMode` to `"manual"` (the overview button goes inactive).
  The overview is **never force-disabled by movement**: the
  automatic transitions are "route loaded → overview on", "movement
  started (pedal or sim) → overview off" (the auto-off lives in
  `ensureMovementLoop`, which flips to `"follow"` and clears `overviewActive` /
  the animated driver once), and "ride just finished → finish-line orbit on"
  (see below). Any other time — including mid-ride — the user may
  toggle the overview on or off; showing it while riding is a deliberate choice
  and does nothing to the ride. A static/satellite overview kept up while riding
  is driven by the movement loop's own `updateMapCamera`→`stepCameraFlight`
  chase toward `state.overviewCamera`; an animated one keeps running its own
  loop (which no longer bails on `movementLoopActive`), and `updateMapCamera`
  yields whenever `state.overviewAnim` is set so the two never fight. The
  overview snaps into place instantly on load
  (`applyCameraNow` — a new route may be across the
  world); every later camera move chases the target's eye/look-at pair with
  bounded acceleration (`chaseStep` + `chaseTuning` in `camera.mjs`: the
  acceleration budget grows with remaining distance, so follow tracking is
  gentle while transition flights are fast, braking to arrive), stepped by
  the movement loop while riding and by `ensureCameraFlightLoop` otherwise.
- **Map overview control.** The map action bar has a split translucent overview
  control: the plane button toggles `state.overviewActive` and switches between
  the selected overview and rider camera; the chevron opens the same
  `"static"`/`"orbit"`/`"flyby"`/`"flyover"`/`"satellite"`/`"satellite-north"`
  choices as the Camera & view settings select. The split control is amber while
  overview is active. The toggle button is only disabled when no route is loaded
  — never during a ride (`canToggle = hasRoute` in `syncOverviewControls`).
  Picking a mode from the dropdown activates overview whether parked or riding
  (a deliberate choice); changing the settings select only reframes immediately
  if overview is already active. The map reset camera button
  (`#resetCameraViewBtn`) is fully decoupled from the overview: it only resets
  the follow-camera offsets/zoom/angle and, when the rider camera is the active
  surface, flies it back — it never activates or deactivates an overview (an
  active overview is left running). It is **disabled whenever the camera is
  already at its defaults** (`cameraAtDefaults` in `camera-ui.mjs` — all offsets at
  default and `cameraMode !== "manual"`, i.e. pressing it would change nothing)
  and enables once a drag captures new offsets or leaves the camera in
  `"manual"`. `syncResetCameraButton` (called from `syncOverviewControls` and
  the camera-slider handler) keeps that state in sync.
- **Overview motion modes** (`state.overviewMode`, a persisted user setting in
  Settings › Camera & view, default `DEFAULT_OVERVIEW_MODE` in `tuning.mjs`):
  `"static"` is the framed still (the `ensureCameraFlightLoop` path above);
  `"satellite"` and `"satellite-north"` are also static stills but looking
  nearly straight down (`SATELLITE_TILT_DEGREES`) with the route framed as large
  as it fits (`SATELLITE_MARGIN_FACTOR`) — `"satellite"` keeps the route's long
  axis horizontal (the default PCA orientation), `"satellite-north"` forces a
  due-north heading via `computeRouteOverviewCamera`'s `headingDegrees` override;
  `"orbit"`, `"flyby"` and `"flyover"` are *animated* and driven through a
  separate `ensureOverviewAnimationLoop`/`stepOverviewAnimation` loop that writes
  the map camera **directly** every frame (the motion is already smooth, so
  there is no chase). `enterOverviewMode` picks per-mode fit params
  (`overviewCameraParams`) and still computes the static `state.overviewCamera`
  (orbit spins its heading via `orbitCamera`; it's also the fly modes' fallback),
  then `startOverviewAnimation` takes over for animated modes — building a
  `createEllipseFlyby` driver for `"flyby"` or a `createFigureEightFlyover`
  driver for `"flyover"` (both return `false` and fall back to static if the
  route is too small to fly). Both animation and the static flight
  write `state.map` directly, so only one runs at a time (`enterOverviewMode`
  starts exactly one; `startOverviewAnimation` nulls `state.cameraFlight`). The
  animated loop self-exits the instant the camera leaves overview — grabbing the
  map (`endUserInteraction` → `"manual"`) or movement starting (`"follow"`) —
  and eases in from the current pose over `OVERVIEW_ANIM_INTRO_SECONDS` so
  switching modes never jumps. The ellipse fly-by (`app/camera/flyby.mjs`, configured by
  `ELLIPSE_FLYBY` in `tuning.mjs`) fits a PCA-aligned ellipse to the route
  footprint, scales it independently of the route bounds, enforces
  `min_turn_radius_meters`, and supports `direction` (`1` clockwise seen from
  above, `-1` counter-clockwise). Its camera looks along the direction of travel
  and pitches down by `mount_pitch_degrees`; `seconds_per_lap`, `max_speed_mps`,
  `fly_height_meters_min`, `fly_height_meters_above_terrain_min`, `camera_fov_degrees`,
  `inward_look_degrees`, `view_distance_meters`, `ellipse_scale`, `min_semi_major_meters`,
  `min_semi_minor_meters`, `sample_count`, and `start_angle_degrees` are all tunable.
  `inward_look_degrees` rotates the horizontal look direction toward the ellipse
  interior (clockwise = right, counter-clockwise = left), while the route travel
  direction still drives the baseline heading.
  The actual fly height is the higher of the baseline height and the height
  needed to clear the highest terrain along the whole flight path by
  `fly_height_meters_above_terrain_min`. That highest-terrain figure comes from
  an injected `terrainSampler` (`buildLoopFlight` in `flyby.mjs` stays pure and
  takes it as an option): `overview-camera.mjs` and `transition-camera.mjs` pass
  `onlineTerrainElevationAt` (`follow-camera.mjs`), which reads the online
  Mapzen tiles, so a hill the route *detours around* is still cleared — the old
  route-only "highest sample under the ellipse" missed those. With online
  terrain off (or a tile not yet loaded), it degrades to the route-based
  footprint estimate. The sampled highest terrain and sample coverage are shown
  on the camera debug overlay (`path terrain` / `path pts`). `max_bank_degrees` scales the bank angle from
  the current turn radius
  (`min_turn_radius_meters` = max bank), and `overview-camera.mjs` applies it to `state.map.roll`.
  Fly-over (`createFigureEightFlyover`) reuses the exact same footprint fit,
  `ELLIPSE_FLYBY` config, and camera-frame/pacing driver — only the path differs:
  a Gerono figure-eight (`along = a·cos u`, `cross = b·sin 2u`) that crosses the
  footprint center twice per lap. Every tunable above applies identically, with
  one behavioral twist: because the eight *changes turn direction* between its
  two lobes, `bankAt`/`inward_look_degrees` follow the **local** turn (via the
  curve's `signedCurvatureAt` and the `tracksTurnDirection` flag) instead of the
  ellipse's fixed handedness — so the camera banks and looks into whichever turn
  it is actually in (right on one lobe, left on the other) and eases smoothly
  through straight-ahead at each center crossing, where the path is momentarily
  straight. The ellipse fly-by is unchanged (constant `direction`).
  The red debug line shown while the camera debug overlay is active is shared
  by orbit, fly-by and fly-over and tuned by `OVERVIEW_DEBUG_LINE_COLOR`,
  `OVERVIEW_DEBUG_LINE_WIDTH`, `OVERVIEW_DEBUG_LINE_ALTITUDE_METERS`, and
  `OVERVIEW_DEBUG_LINE_SAMPLE_COUNT`.
- **Transition arcs into continuously-moving cameras.** Some camera handoffs
  are flown as a physically-constrained "missile POV" arc instead of the plain
  chase / eased entry. Which *targets* get the arc is a declarative policy —
  `camera_transition.arc_into_modes` in `tuning.yaml` (default `["follow",
  "flyby", "flyover"]`), read by the `arcsIntoMode(mode)` predicate. The rule
  behind that list: arc only into a target that represents continuous physical
  motion you can dock onto with matching velocity. So:
  - **follow (the rider camera)** — arced into on the overview-off toggle, the
    movement-start auto-off (overview → follow), and a teleport to the rider
    (clicking the elevation profile to seek while parked in the rider camera —
    `seekToMeters` in `movement.mjs`, guarded to skip while moving, in an
    overview, or in manual mode). The dock is where the rider *will* be.
  - **fly-by / fly-over** — arced into from any camera when the mode is
    selected (`startCameraTransitionToFlyPattern`): the entry is the joinable
    pattern point needing the least head-turn from the current line of sight
    (`entrySForView` in `flyby.mjs`) — joinable meaning no steeper than
    `fly_entry_climb_degrees` (default 45°) up from the horizon and never
    where the directed pattern flies back at the camera. A camera facing the
    pattern docks at the sight-line crossing dead ahead; one facing away
    docks at the first qualifying point that comes into view turning toward
    it. The plain *nearest* pattern point is usually almost straight overhead
    and forced a contorted joining arc. The arc docks there with that point's
    velocity, bank and FOV, then hands off to the pattern animation entering
    at exactly that arc-length (`startOverviewAnimation({ atS })`, no intro
    ease); the eased (non-arc) pattern entry enters at the same point. Falls
    back to the eased pattern entry when no arc fits (already on the pattern,
    too steep a climb, etc.).
  - **static / orbit / satellite** (whole-route, climb-focus, and finish-line
    alike) — **never** arced into. They're artificial framings (a held frame
    or a turntable), so an arc into them reads as two stitched motions; they
    snap on a fresh load or ease through their own driver.
  The **reset-camera button** also opts out of the follow arc even though it
  targets follow (`returnToRiderCamera({ transition: false })`) — a "put it
  back" reset should ease the plain chase home, not fly a dramatic arc. The
  pure math lives in
  `camera/transition-arc.mjs` (tested): the camera eye and its look-at point
  each fly a time-scaled cubic Hermite curve (executed as a cubic Bezier,
  control offsets = velocity·T/3) in a local east/north/up frame, so position
  AND velocity are continuous at both docks — no alignment phase, no angle
  LERP/SLERP anywhere. Mid-flight the view looks along the flight tangent
  (rotated as a *direction*, constant-rate, into each dock's real look
  direction across the `lookat_blend_*` windows), roll banks from the arc's
  lateral acceleration, and FOV carries between the endpoint cameras. A
  duration solver scans `camera_transition.min/max_duration_seconds` for the
  shortest arc satisfying the scale-aware limits: minimum turn radius
  max(floor, fraction·D) enforced as a lateral-acceleration cap of
  (D/T)²/radius, a maximum climb/dive angle, and the 0.5·D control-offset
  loop guardrail (violating candidates are rejected, not clamped — clamping
  would silently break the exact docking velocity). All knobs live under
  `camera_transition` in `tuning.yaml`. `camera/transition-camera.mjs` is the
  app-side driver: `captureCameraTransitionStart` reads the current pose plus
  the velocity of whichever driver owns the camera (static pose, chase-flight
  velocities, orbit tangential velocity, fly-by frame speed), the dock state is
  either a function of the candidate duration (a moving rider is intercepted
  where they *will* be via `followCameraTargetAt(progress, { terrainLift:
  false })`) or a fixed pose (the fly pattern's entry frame + velocity/bank/FOV
  via `flyPatternDockState`), and `state.cameraTransition` + its rAF loop own
  the map while flying (`updateMapCamera`/`ensureCameraFlightLoop` yield on it,
  exactly like `state.overviewAnim`). On docking at the rider, the chase flight
  is seeded with the arc's terminal velocity so follow tracking continues the
  motion; on docking onto a fly pattern, the pattern animation resumes at the
  docked arc-length. Every call site keeps its pre-existing behavior as the
  fallback: when `camera_transition.enabled` is false, the target isn't in
  `arc_into_modes`, no candidate duration satisfies the limits, or the two
  cameras are closer than `min_distance_meters`, the classic `chaseStep`
  flight / eased pattern intro runs unchanged. A manual map grab cancels the
  flight outright, and `applyCameraNow` (instant snaps) always supersedes it.
- **Finish-line orbit.** The instant a ride — pedaled, simulated, or demo —
  reaches the end of the route (the finish check inside `tick`, `movement.mjs`),
  `enterFinishOrbit` takes the camera into an orbit around the rider's exact
  final position, instead of freezing on the follow camera's last frame. It
  reuses the same animated-orbit driver as the overview modes above (same
  intro ease-in from wherever the camera was, same exit on a manual map drag
  or the overview toggle) but does not go through `computeRouteOverviewCamera`
  — the "route" at a finish point has no spread to fit a PCA axis to, so it
  builds the base camera directly (`center` at the finish point plus
  `FINISH_ORBIT_LOOKAT_HEIGHT_METERS`, `FINISH_ORBIT_TILT_DEGREES`,
  `FINISH_ORBIT_RANGE_METERS`), with an initial heading sampled the same way
  the follow camera does (`HEADING_SAMPLE_METERS` back from the finish point).
  `state.finishOrbitActive` distinguishes it from a normal whole-route orbit so
  `stepOverviewAnimation` spins it at its own `FINISH_ORBIT_SECONDS_PER_REV` /
  `FINISH_ORBIT_DIRECTION` instead of the whole-route or climb-focus orbit
  speeds; any later call into `enterOverviewMode` (a manual overview toggle, a
  climb/segment focus, resetting the ride, loading a new route) clears the flag
  and supersedes it, same as grabbing the map does. Toggle via
  `DEFAULT_FINISH_ORBIT_ENABLED`; all the geometry knobs above live in
  `tuning.mjs`.
- **Camera terrain avoidance** lifts the follow camera when its eye would
  sink below terrain + clearance and eases it back down as terrain allows
  (`currentTerrainLift` in `follow-camera.mjs`; pure math in `camera.mjs`'s
  `applyCameraLift`). The base terrain estimate is `maxElevationNear` over the
  route's own elevation points — a free, always-available offline floor
  (deliberately **not** the Google Elevation API, which would cost real money
  at follow-camera query rates). When **online terrain** is enabled it is
  augmented with real ground elevation from `map/terrain-tiles.mjs`, blended as
  the higher of the two (`terrainElevationForSample` in `follow-camera.mjs`), so
  the camera also clears hillsides the GPX track never climbs; it degrades to
  the route-only floor whenever a tile has not loaded yet or the setting is off.
- **Follow-camera rider visibility (swing around a hill).** Follow mode only.
  Lift handles a hillside the view ray *sinks into*; this handles the other
  occlusion — a hill squarely between the (already-above-ground) eye and the
  rider, where lifting further would only tip the view uselessly overhead.
  `currentVisibilityNudge` (`follow-camera.mjs`) tests the eye→rider sightline
  for terrain occlusion (same ray-sampling + tapered clearance as the lift,
  reusing `terrainElevationForSample`) and, when blocked, scans swings out to
  `rider_visibility.max_nudge_degrees` each way; the pure
  `pickVisibilityNudge` (`camera.mjs`, tested) picks the least rotation that
  clears the rider (best-effort least-occluding swing if none fully clears).
  The chosen angle is added to the camera heading, so the rider stays centered
  and only the viewing *side* changes; it eases in/out (rise/fall taus) exactly
  like the lift and is recomputed on `recompute_ms`. Skipped for predicted
  targets (`terrainLift: false`) and never applied in any other camera mode
  (overview / orbit / fly / transition). Knobs live under `rider_visibility` in
  `tuning.yaml`; runtime-only state (`cameraVisNudge*` on `state`), no persisted
  setting or UI toggle.
- **Online terrain elevation.** `map/terrain-tiles.mjs` streams public Mapzen
  Terrarium terrain-RGB tiles from the AWS Open Data bucket (no API key, no
  cost, anonymous), decodes each PNG's pixels into an elevation grid through an
  offscreen canvas (`crossOrigin = "anonymous"` so `getImageData` stays
  untainted), and LRU-caches the grids so `terrainElevationAt(lat, lng)` is a
  cheap synchronous lookup the follow camera calls every frame — a cache miss
  kicks off the async fetch and returns `null`, so callers fall back until the
  tile arrives. A configured tile spans several km, so a whole ride usually
  stays in one or two cached tiles (that *is* the "only re-fetch on crossing a
  new tile" throttle the feature asks for); `prefetchTerrainAround` warms the
  tile plus its eight neighbors on route load. All the pure arithmetic (Web
  Mercator `tileForLngLat`, `decodeTerrarium`) lives in the tested
  `map/terrain-tiles-math.mjs`; everything tunable (base URL, zoom, tile size,
  cache cap, attribution string, default-on toggle) is in the `terrain_tiles`
  section of `tuning.yaml`. Feature modules gate every call on
  `state.terrainTilesEnabled`; the module itself never reads app state. Google's
  own 3D map already streams imagery for the same area, so this exposes no
  location the map didn't already request. The open-data attribution
  (`TERRAIN_TILE_ATTRIBUTION`) is shown at the foot of the setup control pane
  (`#terrainAttribution`) while the feature is on.

## Persistence

`app/storage/storage.mjs` keeps everything in IndexedDB (database `gpx-rider`,
object store `kv`), fronted by an in-memory cache that `initStorage()`
loads once — `startApp()` awaits it before anything reads — so
`readJson`/`writeJson`/`removeStored` stay synchronous for callers.
Records saved by older versions in localStorage are migrated into
IndexedDB on first load; browsers without working IndexedDB fall back to
localStorage transparently. Keys: `gpx-rider:settings`,
`gpx-rider:last-ride` (route + progress), `gpx-rider:ride-log` (recorded
samples), `gpx-rider:last-trainer`, `gpx-rider:last-heart-rate`. The one
deliberate exception is `gpx-rider:maps-api-key`, which stays in
localStorage (handled directly in `map-init.mjs`): saving it reloads the page
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
key out of the JS source as a greppable literal. `map-init.mjs`'s
`resolveMapsApiKey()` prefers a key a visitor saved in Settings over this
default, so self-hosters and forks without the secret get the exact same
"paste your key" flow as before — `app/config.mjs` just stays empty. When a
deployed key is present, `startApp()` hides the whole API-key section in
Settings (`els.apiKeySection`) instead of showing an empty field nobody
needs. Never widen the referrer restriction beyond the exact deployed
origin, and don't add a second, unrestricted key anywhere in the client
bundle. The landing page (`landing.mjs`) resolves the key the same way —
visitor's saved key, else the baked-in `config.mjs` key — so it lights up on
the live demo and in local dev without any separate wiring.

`inject_maps_api_key.py` also injects the optional `HEAD` repository variable
(deployment-only tags such as analytics) right after `<head>` in
`app/index.html`, which is now the **landing page** — the public entry point,
so that is where such tags belong.

**Local dev key.** For local development the map needs a key too, but it must
never be committed. `scripts/dev_server.py` injects a *local* key into the
`app/config.mjs` it serves (the on-disk file stays the empty default), using
the same base64 substitution as the deploy script. The key is read from the
`MAPS_API_KEY` environment variable, or from a `.maps-api-key` file at the repo
root — both are gitignored (`.maps-api-key` is in `.gitignore`) and must stay
out of git. With neither present the served config stays empty and the app
falls back to the Settings "paste your key" prompt, exactly as in a fork.
**If you're set up on a machine where `.maps-api-key` is missing (a fresh
clone — the file is intentionally not in git), ask the user for their Google
Maps API key and write it to `.maps-api-key` at the repo root** (a single line,
no quotes); then `make run` / the preview server will pick it up. Never paste a
key into a tracked file or commit it.

## Documentation duties

- **Keep `README.md` updated.** Any user-visible feature, limitation, or
  workflow change must be reflected in the README (Features, How to use it,
  Notes & limitations). The README is the project's landing page; stale
  docs are treated as bugs.
- **Feature interesting algorithms and architecture decisions in the
  README's "Under the hood" section.** When a change introduces or replaces
  a non-obvious algorithm (e.g. the camera transition-arc kinematics or the
  climb-detection fatigue model) or makes an architecture decision worth
  explaining (an ADR-style "why this approach, not the obvious one"), add or
  update a subsection there in the same change — short intro, a bullet list
  of the techniques involved, and links to the pure module(s), their tests,
  and the relevant `tuning.yaml` section. Match the existing subsections'
  style. Routine bug fixes and small feature additions don't need this;
  reserve it for things a contributor would otherwise have to read the code
  to discover.
- Keep `AGENTS.md` and `CLAUDE.md` synchronized. Any change to one
  agent-instruction file must be reflected in the other in the same change
  (preserving only filename-specific titles if needed).
- Keep these files updated when the architecture or conventions change.
- Gallery route text and preview framing live in `gallery/*/metadata.json`.
  Use the setup page's Export to gallery card to copy the current map camera
  into that file, then run `make gallery-data`. The README does not contain a
  generated route gallery.

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
  for something only reachable through the DOM/3D map, reproduce it manually
  in the browser first (`make run`) and note the exact repro steps. Watch it
  fail for the reason you expect, then implement the fix and watch the same
  test/repro pass. For a new feature, write the test(s) for the pure logic
  it needs first, then implement against them. This is what caught, for
  example, that FIT's `activity.local_timestamp` needs to differ from
  `timestamp` by the local UTC offset (issue #4) rather than repeating the
  same UTC value — the failing test forced decoding the real encoded bytes
  instead of eyeballing the change.
- Unit tests cover the pure modules (`camera`, `route`, `units`, `fit`,
  `eta`). Add tests alongside any new pure logic.
- Web Bluetooth requires Chrome/Edge; hardware paths can't be unit-tested.
  When changing `trainer.mjs`/`heartrate.mjs`, preserve the existing
  logging (`[trainer]` console.debug lines) — it's the only field
  diagnostics available.
- The deployed site is GitHub Pages via
  `.github/workflows/deploy-pages.yml` (deploys `app/` on push to `main`).
