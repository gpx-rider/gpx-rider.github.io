# GPX Rider

**A free, open-source virtual cycling trainer that runs in your browser.** Load any GPX route, ride it over photorealistic 3D terrain, and let the real road gradient control your Bluetooth smart trainer.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

**[Launch GPX Rider →](https://gpx-rider.github.io/app.html)**  
[About GPX Rider](https://gpx-rider.github.io/)

**Zero friction:** The live app requires **zero accounts, zero installations, and zero API keys**. Open it and ride. The hosted version uses a domain-restricted Google Maps key.

The landing page uses the Ještěd climb as an animated 3D backdrop and gives a quick overview of GPX Rider’s features and riding workflow.

## Screenshots

![Ride HUD](screenshots/ride.jpg)
![Setup screen](screenshots/setup.jpg)
![Route gallery](screenshots/gallery.jpg)

## Why GPX Rider?

Most indoor cycling platforms give you fixed virtual worlds, subscriptions, and routes chosen for you. GPX Rider takes a different approach: bring any GPX track and ride the actual terrain, with trainer resistance following its grade in real time.

It is built for people who want to:

- ride their own routes indoors over real-world 3D scenery;
- preview climbs before riding them outside;
- control an FTMS-compatible or Tacx FE-C smart trainer directly from the browser;
- export virtual rides as FIT files for services such as Strava and Garmin Connect;
- self-host, modify, or contribute without a backend or build system.

## Highlights

- **Bring any GPX track** — open a local file or choose a ready-to-ride route from the built-in gallery.
- **Photorealistic 3D terrain** — follow elevated, grade-colored route lines through Google Photorealistic 3D Maps with a real 3D rider marker, beacon, minimap, and terrain-aware camera lift.
- **Bluetooth trainer control** — connect an FTMS-compatible smart trainer, or a Tacx FE-C trainer (the wheel-on Flow/Vortex/Bushido/Genius, which predate FTMS), through Web Bluetooth. Trainer-reported speed advances the rider while route grade drives simulated resistance.
- **Heart-rate support** — connect a standard Bluetooth heart-rate strap or use heart-rate data reported by the trainer.
- **Route intelligence** — calculate distance, noise-filtered ascent and descent, grade, difficulty, terrain classification, sustained climbs, and smart ETA directly from the GPX data.
- **Climb and segment focus** — inspect detected climbs or drag across the elevation profile to select any custom route segment.
- **Adaptive ride HUD** — use the same standard ride screen in windowed and fullscreen views, with sensor meters appearing only when their data is available.
- **Cinematic camera system** — switch among follow, first-person, static, orbit, fly-by, fly-over, and satellite views with physically flown transitions between the route overview and rider.
- **FIT export** — record rides locally and download standards-compliant `.fit` files classified as virtual cycling activities.
- **Simulation and demo modes** — preview a route at a chosen speed, or drive the complete UI with synthetic trainer and heart-rate data.
- **Recording view** — frame the map at an exact recording size and choose which HUD components appear in the recording.
- **Local-first persistence** — routes, progress, recordings, settings, camera preferences, and remembered sensors survive reloads without an account.
- **Zero build step** — vanilla HTML, CSS, and JavaScript ES modules. No framework, bundler, npm packages, or `node_modules`.

## How to ride

[Mapy.com](https://mapy.com/) is a convenient way to create routes: it supports bicycle routing, displays an elevation profile, and exports GPX files ready for GPX Rider.

1. Open GPX Rider in Chrome or Edge.
2. Choose **Open GPX file…** or select a route from **Browse gallery**. If there is no saved ride or route deep-link, the app automatically opens the first gallery route.
3. Select **Connect** beside the smart trainer and choose an FTMS-compatible or Tacx FE-C device.
4. Optionally connect a Bluetooth heart-rate strap the same way.
5. Start pedaling. Trainer speed moves the rider along the route, while the current GPX grade is sent back to the trainer.
6. Use **Download .FIT** whenever you want to export the recorded ride.

Not on the bike? Use the Simulation card's **Start** button to preview the route at a fixed speed. Real pedaling automatically stops a running simulation and takes priority.

## Route intelligence

When a route loads, GPX Rider shows its name, distance, ascent, descent, terrain class, and difficulty. The classification uses distance and elevation gain only; it does not depend on power, speed, or weather.

The climb detector tolerates short flats, small descents, and noisy elevation samples, so a sustained climb is not incorrectly split into several pieces. Detected climbs include:

- start and summit positions;
- length, elevation gain, average grade, and maximum grade;
- approach distance and climb order;
- live distance, ascent, and average grade remaining;
- distance and climbing progress to the summit.

Drag across any part of the elevation profile to select a custom segment. The app reports its start, end, length, ascent, and descent. While stationary, the camera can focus on the selection; while riding, the rider camera remains active and the segment statistics move into the map HUD.

### Smart ETA

During a trainer ride, ETA measures the rider's pace through *flat-equivalent distance*: climbing is charged, descending is credited, and the result is projected across the terrain still ahead. It learns only from real pedaling, so artificial simulation speed never contaminates the estimate.

Simulation ETA remains a straightforward remaining-distance calculation at the selected speed.

## Camera and HUD

### Rider camera

- The default follow camera flies behind the rider using the GPX route bearing.
- A first-person preset places the camera at rider height.
- Camera distance, angle, position, heading, and centering can be adjusted.
- Terrain avoidance lifts the camera when route elevation indicates intervening ground.
- Manual dragging gives the user direct control; reset restores the selected camera surface.

### Route overview

A newly loaded route opens in a whole-route overview. The same overview control remains available during a ride, so the camera is never locked to the rider.

Five overview styles are available:

- **Static** — a tightly framed still view of the complete route.
- **Orbit** — a continuous turntable rotation around the route.
- **Fly-by** — a camera flies a PCA-aligned ellipse around the route and looks into its direction of travel.
- **Fly-over** — a banking figure-eight that crosses the route's center and reverses its turn direction between lobes.
- **Satellite** — a near-vertical, north-up view fitted to the route.

Selecting a detected climb or custom segment opens a dedicated static, orbit, or satellite focus camera. Reaching the end of a ride can trigger a finish-line orbit around the rider.

### Cinematic handoffs

- Overview-to-rider, rider-to-overview, and movement-start handoffs are flown rather than cut.
- The camera intercepts a moving rider where it will be when the flight finishes, rather than chasing its old position.
- Entering Fly-by or Fly-over joins the pattern at the point needing the least turn of the current view — ahead along the line of sight at a natural climb angle, never where the pattern flies back at the camera; the pattern then continues from that exact point.
- Position, view direction, roll, field of view, and velocity continue through the dock without a separate alignment phase.
- Geometry that cannot satisfy the configured physical limits falls back to the classic chase flight.

The underlying kinematics are described in [Under the hood](#under-the-hood).

### Map HUD

The HUD belongs to the map viewport and remains a standard ride screen in both windowed and fullscreen layouts. Fullscreen expands the same surface instead of switching to a separate UI.

- The bottom dock presents the core ride metrics, road-ahead elevation profile, and distance and climbing progress.
- Power and heart-rate meters appear only when those sensor values are available; grade appears when a route is loaded.
- Available power, heart-rate, and grade meters show live training zones.
- The clock chip combines local time, elapsed time, ridden distance, and ascent.
- The climb banner shows approaching-climb, active-climb, or custom-segment statistics.
- The minimap and map controls remain available on the ride surface.
- The data dock can collapse to a compact strip when more map is wanted.

The separate **Recording view** fixes the map to a consistent output size and lets you hide selected components—clock, meters, bottom dock, climb banner, demo chip, controls, or minimap—without changing the normal ride screen.

### Camera diagnostics

The Debug settings category provides a collapsible overlay with the camera values the 3D map actually applies: look-at center, eye altitude, heading, tilt, range, roll, field of view, and ride progress. For Orbit, Fly-by, and Fly-over, it can also draw the camera travel path as a red 3D line.

## Under the hood

GPX Rider is deliberately engineered as a small, inspectable static application rather than a packaged web platform.

### Broadcast-quality camera kinematics

The camera system uses purpose-built geometry rather than canned animations:

- **Time-scaled cubic Hermite splines** fly the camera onto a continuously-moving target in a local east/north/up frame, executed as cubic Béziers whose control offsets encode the endpoint velocities. The arc is used only where docking with matching velocity reads as one motion — flying back to the rider (leaving an overview, starting to move, teleporting via the elevation profile) and flying onto the Fly-by / Fly-over pattern. Artificial framings (static, orbit, satellite) snap or ease through their own driver, and a camera reset eases the plain chase home. Which targets get the arc is a single tunable list.
- **Exact position-and-velocity docking** makes both ends of a flight continuous: the chase camera inherits the arc's terminal velocity so follow tracking picks up without a restart, and an arc onto a Fly-by/Fly-over pattern docks at the direction-aligned pattern point needing the least view turn — ahead along the line of sight at a natural climb angle — handing off at that exact arc-length.
- **Dual-arc, tangent POV** flies the camera eye on the Hermite path while looking strictly along its flight tangent mid-arc. Near each dock, Rodrigues rotation turns the view direction at a constant rate into the real endpoint view—never through independent heading and tilt interpolation.
- **Moving-target interception** solves the rider's future follow-camera pose for each candidate flight duration instead of aiming where the rider was when the transition began.
- **Centripetal banking** derives roll from the path's lateral acceleration, producing aircraft-like banking into turns.
- **Physical constraints** bound turn radius, climb and dive angle, and velocity-control offsets. A duration solver chooses the shortest valid arc and rejects geometry that would loop or break exact docking.
- **Principal Component Analysis (PCA)** finds the route footprint's true axis of greatest spread, giving stable framing to diagonal routes, loops, lollipops, and out-and-backs.
- **Frustum projection and binary search** calculate the tightest camera range that keeps the complete route inside the real viewport.
- **Arc-length parameterization** keeps Fly-by and Fly-over ground speed consistent around their curves.

The pure transition solver is isolated in [`app/camera/transition-arc.mjs`](app/camera/transition-arc.mjs) and exercised by tests for endpoint docking, velocity continuity, physical limits, orientation smoothness, moving-target interception, and impossible-flight rejection. The browser-facing driver lives in [`app/camera/transition-camera.mjs`](app/camera/transition-camera.mjs). Every behavior knob is documented under `camera_transition` in [`app/core/tuning.yaml`](app/core/tuning.yaml).

### Human-perceived climb detection

Climb detection reads like a rider's own sense of effort rather than raw point-to-point geometry:

- **Resample and dual-filter elevation** to a fixed distance step, then a median filter followed by a moving average, so detection depends only on the terrain's real shape — not the source GPX's point density or GPS jitter.
- **Short- and long-window rolling grade** are read at every point; whichever reads more "climb-like" wins, so the same detector catches punchy ramps and long sustained drags alike.
- **A nonlinear pressure curve** converts grade into "fatigue" pressure, modeling how perceived effort ramps up faster than grade does — a jump from 2% to 4% barely registers, but 8%+ hurts far more than twice as much.
- **A fatigue integrator** (a leaky bucket) accumulates that pressure and drains it on flats and descents; a climb becomes officially active once the bucket crosses a start threshold.
- **Elevation-based exit conditions** — a large enough drop past the peak, or a long enough flat/downhill spell with no climb pressure at all — can close a climb even before its fatigue has fully drained, so a long descent is never mistaken for part of the climb.
- **Small-gap merging** stitches climbs separated only by a brief, shallow dip into one human-perceived climb.

The pure signal-processing helpers (resample, smoothing, rolling grade) live in [`app/route/climb-signal.mjs`](app/route/climb-signal.mjs); the fatigue state machine sits in [`app/route/climbs.mjs`](app/route/climbs.mjs). Both are covered by unit tests. Every behavior knob is documented under `climb_detection` in [`app/core/tuning.yaml`](app/core/tuning.yaml); [`scripts/climb_tester.py`](scripts/climb_tester.py) is a standalone CLI that reads the exact same tunables for verbose, step-by-step diagnostics against any GPX file.

### Two trainer protocols behind one interface

Most modern smart trainers speak the standard Fitness Machine Service (FTMS) over Bluetooth, but the wheel-on Tacx trainers (Flow, Vortex, Bushido, Genius) predate it and expose no FTMS service at all — they tunnel ANT+ FE-C over a vendor Bluetooth service instead. GPX Rider supports both from a single pairing flow:

- **Protocol detection at connect time.** The pairing dialog advertises both services; once a device is chosen, the app inspects which control service it actually exposes and routes to the matching backend — FTMS for KICKR-class trainers, FE-C for Tacx. The rest of the app (movement, grade updates, telemetry, status) talks to one unchanged interface and never learns which protocol is underneath.
- **A hand-rolled ANT+ FE-C codec.** Rather than pull in a dependency, the FE-C wire format is encoded and decoded by hand — the same approach the FIT exporter takes. It builds ANT serial frames (sync byte, length, XOR checksum), encodes the grade as a *Track Resistance* page (page 51, with its −200 %-offset fixed-point grade field), and decodes the trainer's *General FE Data* (speed) and *Specific Trainer Data* (power, cadence) telemetry pages.
- **Framing that adapts to the device.** Some FE-C peripherals wrap their pages in ANT framing and some send them bare; the backend learns which from the first parseable notification and mirrors it — including the ANT channel — on every control write.

The pure framing and page codec is isolated in [`app/trainer/fec.mjs`](app/trainer/fec.mjs) and covered by unit tests for checksums, frame round-tripping, grade encoding across the clamped range, and telemetry decoding. The Bluetooth backend that composes it lives in [`app/trainer/trainer-fec.mjs`](app/trainer/trainer-fec.mjs); protocol detection and routing stay in [`app/trainer/trainer.mjs`](app/trainer/trainer.mjs). The rolling-resistance coefficient sent with each grade command is tunable under `trainer` in [`app/core/tuning.yaml`](app/core/tuning.yaml).

### Architecture

- **Zero build step, vanilla ES modules, no package dependencies.** The deployed `app/` directory is static HTML, CSS, JavaScript, and assets.
- Code is organized by feature: camera, route processing, ride execution, trainer hardware, map rendering, HUD, persistence, gallery, and demo mode.
- Pure geometry, routing, climb, ETA, units, FIT, and simulation logic is separated from browser and DOM coordination and tested with Node's built-in test runner.
- A deliberately thin `app.js` performs startup and event wiring; it does not contain feature logic.
- Shared mutable application state lives in one documented foundation module.
- Adjustable physics, thresholds, defaults, colors, timings, and paths live in `app/core/tuning.yaml`.
- A central screen manager lays out dynamic HUD components without feature-specific positioning hacks.
- IndexedDB stores routes and long recordings, with `localStorage` as a compatibility fallback.
- The app has no account system, application server, or database backend.

For the complete module map, import boundaries, contributor rules, and browser-verification checklist, see [`AGENTS.md`](AGENTS.md).

## Run locally

```sh
git clone git@github.com:gpx-rider/gpx-rider.github.io.git
cd gpx-rider
make run
```

`make run` starts a no-cache development server and prints two URLs:

- the landing page at `http://127.0.0.1:5173/app/`;
- the application at `http://127.0.0.1:5173/app/app.html`.

Local development needs a Google Maps API key with the **Maps JavaScript API** and **Photorealistic 3D Maps** enabled. Save the key as a single line in the gitignored `.maps-api-key` file at the repository root, then run `make run`. The development server injects it into the served `app/config.mjs` response without modifying the file on disk. The `MAPS_API_KEY` environment variable is also supported and takes precedence.

Run the tests with:

```sh
make test
```

Or run the default project check:

```sh
make
```

The default target regenerates derived gallery data and runs the tests. The GitHub Pages deployment performs the same generation before publishing.

## Hosting your own copy

The `app/` directory is a complete static site and can be served from GitHub Pages, Netlify, Vercel, S3, or a machine on your local network. Its entry points are:

- `app/index.html` — public landing page;
- `app/app.html` — GPX Rider application.

The included [GitHub Pages workflow](.github/workflows/deploy-pages.yml) publishes `app/` after regenerating gallery data. To use it in a fork, select **GitHub Actions** as the Pages source in the repository settings.

Self-hosted deployments can request a visitor-supplied Maps key. It is stored in that browser and sent only to Google Maps.

## iPhone and iPad app

No iOS browser implements Web Bluetooth, so Safari cannot pair a trainer. The [`mobile/`](mobile/) folder wraps the unmodified web app in a native iOS/iPadOS shell with [Capacitor](https://capacitorjs.com): its build script copies `app/` as-is on every build and injects a Web Bluetooth polyfill backed by the native Bluetooth stack, so trainer and heart-rate pairing work natively while the app itself stays exactly the web app. [`mobile/README.md`](mobile/README.md) walks through building it, testing on your own device, TestFlight, and App Store submission. Android users generally don't need it — Chrome on Android has real Web Bluetooth — though the same folder can build an Android app too.

## Data and privacy

GPX Rider has no user accounts and no application backend. Routes, settings, ride progress, sensor preferences, and recorded samples remain in browser storage. Trainer and heart-rate communication happens directly between the browser and the selected Bluetooth devices.

The hosted application's Maps key is restricted to the GPX Rider domain. Self-hosted installations use their own key.

## Browser, hardware, and limitations

- The complete visual app and Simulation mode work without cycling hardware.
- Trainer and heart-rate connections require a secure context and a browser with [Web Bluetooth support](https://developer.chrome.com/docs/capabilities/bluetooth). Chrome and Edge are the intended browsers. On iPhone and iPad, where no browser offers Web Bluetooth, use the [native app](mobile/) instead.
- Bluetooth device selection, permissions, and remembered-device access are controlled by the browser. If a saved device is unavailable, select **Connect** again.
- FTMS-compatible trainers are the primary hardware target; wheel-on Tacx trainers are supported through their ANT+ FE-C over Bluetooth protocol. Other proprietary control protocols may still require trainer-specific work.
- Total ascent and descent are calculated from noise-filtered GPX elevation and may differ from another planner or head unit.
- Smart ETA needs about a minute of real pedaling before it trusts the measured pace; until then it projects from current speed.
- Calories are derived from power, or taken from FTMS Expended Energy when an FTMS trainer reports it (FE-C trainers report no energy field, so calories come from power).
- Heart rate comes from a paired strap or, as a fallback, the trainer's own heart-rate field.
- Terrain avoidance estimates ground height from route elevation rather than a separate Elevation API, so it works best where the route itself follows the hillside.

## Tested hardware

The primary development and real-ride setup is:

- **Wahoo KICKR v4** — smart trainer (FTMS);
- **Wahoo TICKR** — Bluetooth heart-rate monitor;
- **Tacx Flow (smart)** — smart trainer (ANT+ FE-C); verified: pairing, grade/resistance control, and speed and power telemetry.

Other FTMS-compatible trainers and standard Bluetooth heart-rate sensors are expected to work, but this is the reference hardware tested against the app.

Successfully tested another trainer or heart-rate sensor? Please open a pull request to add it to this list, including the exact model, firmware version when available, and the features you verified.

## Routes and gallery

The built-in gallery contains ready-to-ride GPX routes. Each source route lives under `gallery/<route-id>/` with an `export.gpx` and `metadata.json`. Running:

```sh
make gallery-data
```

generates `app/gallery.json`, including descriptions, preview cameras, route statistics, difficulty, and miniature elevation profiles.

To add or refresh a route, open its GPX in the app, position the 3D camera for the preview, complete the **Export to gallery** card, and select **Copy JSON** to produce a `metadata.json` draft. Descriptions support simple Markdown, and gallery previews use live interactive 3D maps.

## Map imagery, routes, and trademarks

GPX Rider uses Google Maps Platform and Google Photorealistic 3D Maps. Google Maps, Google Earth, and related imagery are owned by Google and/or its data providers. Keep all required attribution visible in the app.

The GPX files in this repository are independently created demonstration routes for personal training and testing. They are unofficial and are not affiliated with, endorsed by, or sponsored by any race organizer, venue, mapping provider, equipment manufacturer, or other third party.

Route and place names identify real-world locations only. Third-party trademarks belong to their respective owners.

## Contributing

Issues and pull requests are welcome. Please open an issue before beginning a large architectural or product change so the intended behavior can be discussed first.

GPX Rider is developed through human-directed AI collaboration. Architecture, module ownership, test expectations, and browser-verification procedures are documented in [`AGENTS.md`](AGENTS.md), so changes remain reviewable and reproducible regardless of who—or what—implements them.

Useful contribution areas include additional trainer protocols, real-hardware ride reports, broader browser and device testing, route libraries, import integrations, accessibility, mobile improvements, alternative map-rendering experiments, and more automated tests.

## License

[MIT](LICENSE)
