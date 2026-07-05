# CLAUDE.md — instructions for AI agents working on GPX Rider

GPX Rider is a **no-build, static web app**: plain HTML/CSS/JS ES modules,
no bundler, no framework, no `node_modules`. Keep it that way — do not
introduce a build step, TypeScript, npm dependencies, or a framework unless
the user explicitly asks for one.

## Commands

```sh
make           # default: gallery-data + gallery + test (the deploy Action runs the same generation)
make run       # serve the repo at http://127.0.0.1:5173/app/ (scripts/dev_server.py — a no-cache static server so edits never load stale)
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
| `app/flyover.mjs` | Pure animated-overview math (tested): orbit turntable camera + orbit debug path |
| `app/flyby.mjs` | Pure ellipse fly-by math (tested): PCA-aligned route footprint ellipse, minimum turn-radius enforcement, clockwise/counter-clockwise travel, camera eye/look-at frames, and bank angle |
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
`app/tuning.mjs` with a doc comment each — never as inline magic values —
so users can adjust behavior in one place. This is not limited to numbers:
file paths, URLs, color strings, orientation/config objects — anything a
user or future contributor might reasonably want to retune belongs in
`tuning.mjs`, not inlined at its call site, even if it's only used once. When
adding a new adjustable behavior, add its constant to `tuning.mjs` in the
same change; don't leave it inline "for now." Deliberate exceptions:
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
  in sync. `gradeColor` is exported and reused (not re-copied) by the
  fullscreen climb banner's mini-profile in `app.js`; the climb-category chip
  colors in `CLIMB_CATEGORIES` (`tuning.mjs`) track the same palette.
- **Settings dialog.** A single `<dialog#settingsDialog>` with a left
  category rail (`[data-settings-tab]`) and a right panel per category
  (`[data-settings-panel]`); `selectSettingsTab` in `app.js` toggles the
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
  `"orbit"` or `"flyby"`, app.js also draws that mode's travel path as a red
  `Polyline3DElement` configured by `OVERVIEW_DEBUG_LINE_*`; for orbit this is
  the camera eye's ground track, and for fly-by this is the fitted travel
  ellipse. It stays visible if the user drags the camera into manual mode.
  `renderCameraDebug` rebuilds the rows and
  `startCameraDebugLoop` re-runs it on its own `CAMERA_DEBUG_REFRESH_MS`
  `setTimeout` chain while the overlay is on — a dedicated poll because when
  the user is dragging the camera at rest nothing else steps it. Wired through
  the same `updateDisplaySettingsFromControls`/`syncDisplayControls`/
  `applyDisplaySettings` trio as the other display toggles.
- **Fullscreen ride HUD (design 3a).** Entering fullscreen adds
  `.fullscreen-mode` to `#mapViewport` (a fixed, full-bleed container); the
  HUD overlays live inside it as children so they ride along, and CSS keeps
  them out of the normal windowed map pane (their base rule is
  `display:none`, only painted under `.map-viewport.fullscreen-mode`). Three
  overlays, all fed on the slow-UI cadence from `updateRideUi`:
  - **Bottom data dock** (`#fullscreenOverlayBottom` / `.fs-dock`): the metric
    tiles plus the *road-ahead* elevation profile and the distance/climbing
    progress bars. `enterMapFullscreen` **moves the shared `#profile` canvas**
    into `#fsProfileMount` (the same grade-coloured canvas the control panel
    uses — it already draws the grade bars, axes, ride marker, and the
    hover-tooltip/click-to-seek), and `exitMapFullscreen` moves it back above
    the climbs section. The dock collapses to a compact strip via
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
    banner, actions) also pull their insets in and the banner loses its desktop
    `min-width`.
  - **Top-left clock chip** (`#fullscreenClock`): elapsed time (from
    `rideLogSummary().timerSeconds`) + ridden distance, sitting above the
    minimap (which is repositioned in fullscreen).
  - **Top-right controls**: the existing `.map-actions` cluster, plus a
    fullscreen-only Settings shortcut (`#fullscreenSettingsBtn`, class
    `.map-action-btn-fs-only`, shown only under `.fullscreen-mode`) — the top
    bar's Settings button is off-screen in fullscreen, so this reopens the
    same dialog via `openSettings()` (a modal `<dialog>` renders in the top
    layer, above the fullscreen element).
  - **Top-centre climb banner** (`#climbBanner`, `updateFullscreenClimbBanner`):
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
    go stale).

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
  The rider dot is a `Model3DElement` loading the model at
  `RIDER_DOT_MODEL_PATH` (`tuning.mjs`; see `renderRiderDot`/`updateRiderDot`
  in `app.js`), **not** a `Polygon3DElement` and **not** a
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
  hand" approach `app/fit.mjs` takes for FIT files): a two-material puck,
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
  `app.js` — see the comments on those constants for what to expect when
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
  `state.cameraMode` becomes `"manual"` once the user grabs the overview, and
  `"follow"` from the moment movement starts. The overview snaps into place
  instantly on load (`applyCameraNow` — a new route may be across the
  world); every later camera move chases the target's eye/look-at pair with
  bounded acceleration (`chaseStep` + `chaseTuning` in `camera.mjs`: the
  acceleration budget grows with remaining distance, so follow tracking is
  gentle while transition flights are fast, braking to arrive), stepped by
  the movement loop while riding and by `ensureCameraFlightLoop` otherwise.
- **Overview motion modes** (`state.overviewMode`, a persisted user setting in
  Settings › Camera & view, default `DEFAULT_OVERVIEW_MODE` in `tuning.mjs`):
  `"static"` is the framed still (the `ensureCameraFlightLoop` path above);
  `"orbit"` and `"flyby"` are *animated* and driven through a separate
  `ensureOverviewAnimationLoop`/`stepOverviewAnimation` loop that writes the map
  camera **directly** every frame (the motion is already smooth, so there is no
  chase). `enterOverviewMode` still computes the static `state.overviewCamera`
  (orbit spins its heading via `orbitCamera`; it's also the fallback), then
  `startOverviewAnimation` takes over for animated modes — building a
  `createEllipseFlyby` driver for `"flyby"` (returns `false` and falls back to
  static if the route is too small to fly). Both animation and the static flight
  write `state.map` directly, so only one runs at a time (`enterOverviewMode`
  starts exactly one; `startOverviewAnimation` nulls `state.cameraFlight`). The
  animated loop self-exits the instant the camera leaves overview — grabbing the
  map (`endUserInteraction` → `"manual"`) or movement starting (`"follow"`) —
  and eases in from the current pose over `OVERVIEW_ANIM_INTRO_SECONDS` so
  switching modes never jumps. The ellipse fly-by (`app/flyby.mjs`, configured by
  `ELLIPSE_FLYBY` in `tuning.mjs`) fits a PCA-aligned ellipse to the route
  footprint, scales it independently of the route bounds, enforces
  `minTurnRadiusMeters`, and supports `direction` (`1` clockwise seen from
  above, `-1` counter-clockwise). Its camera looks along the direction of travel
  and pitches down by `mountPitchDegrees`; `secondsPerLap`, `maxSpeedMps`,
  `flyHeightMetersMin`, `flyHeightMetersAboveTerrainMin`, `cameraFovDegrees`,
  `inwardLookDegrees`, `viewDistanceMeters`, `ellipseScale`, `minSemiMajorMeters`,
  `minSemiMinorMeters`, `sampleCount`, and `startAngleDegrees` are all tunable.
  `inwardLookDegrees` rotates the horizontal look direction toward the ellipse
  interior (clockwise = right, counter-clockwise = left), while the route travel
  direction still drives the baseline heading.
  The actual fly height is the higher of the baseline height and the height
  needed to clear the highest route elevation sample under the fitted ellipse by
  `flyHeightMetersAboveTerrainMin`. `maxBankDegrees` scales the bank angle from
  the current turn radius
  (`minTurnRadiusMeters` = max bank), and app.js applies it to `state.map.roll`.
  The red debug line shown while the camera debug overlay is active is shared
  by orbit and fly-by and tuned by `OVERVIEW_DEBUG_LINE_COLOR`,
  `OVERVIEW_DEBUG_LINE_WIDTH`, `OVERVIEW_DEBUG_LINE_ALTITUDE_METERS`, and
  `OVERVIEW_DEBUG_LINE_SAMPLE_COUNT`.
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
- Keep `AGENTS.md` and `CLAUDE.md` synchronized. Any change to one
  agent-instruction file must be reflected in the other in the same change
  (preserving only filename-specific titles if needed).
- Keep these files updated when the architecture or conventions change.
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
