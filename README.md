# GPX Rider

**A free, open-source virtual cycling trainer that runs in your browser.** Load any GPX route, ride it on a live top-down map, and let the real road gradient control your Bluetooth smart trainer.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

**[Launch GPX Rider →](https://gpx-rider.github.io/app.html)**  
[About GPX Rider](https://gpx-rider.github.io/)

**Zero friction:** The live app requires **zero accounts, zero installations, and zero API keys** — the map is OpenStreetMap, which is free and needs no key for anyone, hosted or self-hosted. Open it and ride.

The landing page uses the Ještěd climb as an animated top-down backdrop and gives a quick overview of GPX Rider's features and riding workflow.

## Screenshots

![Ride HUD](screenshots/ride.jpg)
![Setup screen](screenshots/setup.jpg)
![Route gallery](screenshots/gallery.jpg)

## Why GPX Rider?

Most indoor cycling platforms give you fixed virtual worlds, subscriptions, and routes chosen for you. GPX Rider takes a different approach: bring any GPX track and ride the actual terrain, with trainer resistance following its grade in real time.

It is built for people who want to:

- ride their own routes indoors with a live top-down view of the real road;
- preview climbs before riding them outside;
- control an FTMS-compatible or Tacx FE-C smart trainer directly from the browser;
- export virtual rides as FIT files for services such as Strava and Garmin Connect;
- self-host, modify, or contribute without a backend, build system, or API key.

## Highlights

- **Bring any GPX track** — open a local file or choose a ready-to-ride route from the built-in gallery.
- **Live top-down map** — follow a grade-colored route line on OpenStreetMap, with a rider marker that follows and rotates to your heading. No API key, ever.
- **Bluetooth trainer control** — connect an FTMS-compatible smart trainer, or a Tacx FE-C trainer (the wheel-on Flow/Vortex/Bushido/Genius, which predate FTMS), through Web Bluetooth. Trainer-reported speed advances the rider while route grade drives simulated resistance.
- **Heart-rate support** — connect a standard Bluetooth heart-rate strap or use heart-rate data reported by the trainer.
- **Route intelligence** — calculate distance, noise-filtered ascent and descent, grade, difficulty, terrain classification, sustained climbs, and smart ETA directly from the GPX data.
- **Climb and segment focus** — inspect detected climbs or drag across the elevation profile to select any custom route segment; the map frames whichever is selected.
- **Adaptive ride HUD** — use the same standard ride screen in windowed and fullscreen views, with sensor meters appearing only when their data is available.
- **Follow and overview map modes** — the map recenters on the rider while riding, or frames the whole route (or a selected climb/segment) at any time.
- **FIT export** — record rides locally and download standards-compliant `.fit` files classified as virtual cycling activities.
- **Simulation and demo modes** — preview a route at a chosen speed, or drive the complete UI with synthetic trainer and heart-rate data.
- **Recording view** — frame the map at an exact recording size and choose which HUD components appear in the recording.
- **Local-first persistence** — routes, progress, recordings, settings, and remembered sensors survive reloads without an account.
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

Drag across any part of the elevation profile to select a custom segment. The app reports its start, end, length, ascent, and descent. While stationary, the map can frame the selection; while riding, the map keeps following the rider and the segment statistics move into the map HUD.

### Smart ETA

During a trainer ride, ETA measures the rider's pace through *flat-equivalent distance*: climbing is charged, descending is credited, and the result is projected across the terrain still ahead. It learns only from real pedaling, so artificial simulation speed never contaminates the estimate.

Simulation ETA remains a straightforward remaining-distance calculation at the selected speed.

## Map and HUD

### Top-down map

- A plain top-down [Leaflet](https://leafletjs.com/) map with OpenStreetMap tiles — pan and zoom like any slippy map, no 3D camera, no API key.
- The rider marker is a small amber dot with a directional arrow that rotates to the current heading.
- **Follow** mode recenters the map on the rider while riding (the "keep rider centered" toggle turns this off if you'd rather explore the map freely).
- **Overview** mode fits the whole route into view, and stays available mid-ride — the map is never locked to the rider.
- Selecting a detected climb or a custom segment fits the map to just that stretch of road; returning to the whole-route overview is one tap away.
- Dragging or zooming the map by hand switches to manual mode until you toggle overview or press recenter.

### Map HUD

The HUD belongs to the map viewport and remains a standard ride screen in both windowed and fullscreen layouts. Fullscreen expands the same surface instead of switching to a separate UI.

- The bottom dock presents the core ride metrics, road-ahead elevation profile, and distance and climbing progress.
- Power, heart-rate, and cadence meters appear only when those sensor values are available; grade appears when a route is loaded.
- Available power, heart-rate, and grade meters show live training zones; the cadence meter shows a fixed green (90-110 rpm) / yellow / red band.
- The clock chip combines local time, elapsed time, ridden distance, and ascent.
- The climb banner shows approaching-climb, active-climb, or custom-segment statistics.
- The data dock can collapse to a compact strip when more map is wanted.

The separate **Recording view** fixes the map to a consistent output size and lets you hide selected components—clock, meters, bottom dock, climb banner, demo chip, or controls—without changing the normal ride screen.

## Under the hood

GPX Rider is deliberately engineered as a small, inspectable static application rather than a packaged web platform.

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

### Why a top-down map, and why vendored Leaflet

GPX Rider used to render routes on Google's Photorealistic 3D Maps with a full follow-camera/cinematic-overview system (chase physics, terrain-avoidance lift, orbit/fly-by/fly-over flight patterns, physically-flown transition arcs between them). That system needed a Google Maps API key even for local development, and its complexity — thousands of lines of camera math — was disproportionate to what most riders actually look at while pedaling: where the road goes and how far there is left to climb. Replacing it with a plain top-down [Leaflet](https://leafletjs.com/) map removes the API key entirely (OpenStreetMap tiles are free and anonymous) and reduces "the camera" to three simple modes — follow, overview, and manual — described in [`AGENTS.md`](AGENTS.md).

Leaflet itself is vendored as pre-built static files (`app/vendor/leaflet/`) rather than loaded from a CDN `<script>` tag: it's still zero build step (the files are checked in exactly as published, no bundler involved), but it also means the map keeps working if a CDN is slow, down, or blocked by a restrictive network — a real failure mode this project hit directly while verifying the migration in a sandboxed environment whose network policy blocked several public CDNs outright.

### Architecture

- **Zero build step, vanilla ES modules, no package dependencies.** The deployed `app/` directory is static HTML, CSS, JavaScript, and assets (Leaflet is vendored as static files, not an npm dependency).
- Code is organized by feature: route processing, ride execution, trainer hardware, map rendering, HUD, persistence, gallery, and demo mode.
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

No setup or API key is needed — the map works immediately.

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

The included [GitHub Pages workflow](.github/workflows/deploy-pages.yml) publishes `app/` after regenerating gallery data. To use it in a fork, select **GitHub Actions** as the Pages source in the repository settings. No API key or secret needs configuring — the map works identically everywhere.

## Data and privacy

GPX Rider has no user accounts and no application backend. Routes, settings, ride progress, sensor preferences, and recorded samples remain in browser storage. Trainer and heart-rate communication happens directly between the browser and the selected Bluetooth devices.

Map tiles are fetched anonymously from OpenStreetMap's tile servers; no key, account, or ride data is ever sent anywhere.

## Browser, hardware, and limitations

- The complete visual app and Simulation mode work without cycling hardware.
- Trainer and heart-rate connections require a secure context and a browser with [Web Bluetooth support](https://developer.chrome.com/docs/capabilities/bluetooth). Chrome and Edge are the intended browsers.
- Bluetooth device selection, permissions, and remembered-device access are controlled by the browser. If a saved device is unavailable, select **Connect** again.
- FTMS-compatible trainers are the primary hardware target; wheel-on Tacx trainers are supported through their ANT+ FE-C over Bluetooth protocol. Other proprietary control protocols may still require trainer-specific work.
- Total ascent and descent are calculated from noise-filtered GPX elevation and may differ from another planner or head unit.
- Smart ETA needs about a minute of real pedaling before it trusts the measured pace; until then it projects from current speed.
- Calories are derived from power, or taken from FTMS Expended Energy when an FTMS trainer reports it (FE-C trainers report no energy field, so calories come from power).
- Heart rate comes from a paired strap or, as a fallback, the trainer's own heart-rate field.

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

generates `app/gallery.json`, including descriptions, route statistics, difficulty, and miniature elevation profiles. Gallery card previews are always auto-framed to each route's bounds, so there is nothing to hand-author for the preview itself.

To add or refresh a route, open its GPX in the app, complete the **Export to gallery** card, and select **Copy JSON** to produce a `metadata.json` draft with its title and description. Descriptions support simple Markdown.

## Map imagery, routes, and trademarks

GPX Rider uses [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles via [Leaflet](https://leafletjs.com/). Map data is © OpenStreetMap contributors. Keep all required attribution visible in the app.

The GPX files in this repository are independently created demonstration routes for personal training and testing. They are unofficial and are not affiliated with, endorsed by, or sponsored by any race organizer, venue, mapping provider, equipment manufacturer, or other third party.

Route and place names identify real-world locations only. Third-party trademarks belong to their respective owners.

## Contributing

Issues and pull requests are welcome. Please open an issue before beginning a large architectural or product change so the intended behavior can be discussed first.

GPX Rider is developed through human-directed AI collaboration. Architecture, module ownership, test expectations, and browser-verification procedures are documented in [`AGENTS.md`](AGENTS.md), so changes remain reviewable and reproducible regardless of who—or what—implements them.

Useful contribution areas include additional trainer protocols, real-hardware ride reports, broader browser and device testing, route libraries, import integrations, accessibility, mobile improvements, and more automated tests.

## License

[MIT](LICENSE)
