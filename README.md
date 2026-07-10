# GPX Rider

**A free, open-source, browser-based virtual cycling trainer.** Load any GPX route, ride it over photorealistic 3D satellite terrain, and drive real grade changes on a Bluetooth smart trainer. No app install, no subscription, no account.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Deploy to GitHub Pages](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml)

**[Launch the App](https://gpx-rider.github.io)**

The link opens a short landing page that replays a real route (the Ještěd climb) in photorealistic 3D; **Launch GPX Rider** opens the app with that same route loaded. The live demo runs entirely in your browser. It ships with a domain-restricted Google Maps key; self-hosted copies can use your own key, stored locally in your browser.

## Screenshots

![Ride HUD](screenshots/ride.jpg)
![Setup Screen](screenshots/setup.jpg)
![Route Gallery](screenshots/gallery.jpg)

## Why GPX Rider?

Most indoor cycling apps live inside closed platforms: fixed worlds, subscriptions, and routes chosen for you. GPX Rider is deliberately small and hackable. Point it at a GPX file and ride the actual terrain, with your trainer resistance following the route grade in real time.

GPX Rider is built for people who want to:

- ride their own GPX routes indoors on real-world 3D scenery,
- preview climbs and routes before taking them outside,
- control an FTMS-compatible smart trainer from the browser,
- export virtual rides as FIT files for services like Strava or Garmin Connect,
- self-host, fork, tweak, or contribute without a backend or build system.

Contributions are very welcome. See [Contributing](#contributing) below.

## Highlights

- **GPX import** — drag in any route with track points and elevation, or start from the built-in route gallery.
- **Photorealistic 3D terrain** — Google Photorealistic 3D Maps render the route with a follow camera, minimap, rider beacon, terrain-aware camera lift, and a whole-route overview (static, orbit, ellipse fly-by, figure-eight fly-over, or straight-down satellite) available before and during the ride.
- **Bluetooth FTMS trainer control** — connect Wahoo KICKR and other FTMS-compatible trainers over Web Bluetooth. Start pedaling and the map advances from your real trainer speed; stop pedaling and the ride stops.
- **Heart-rate sensors** — pair a standard Bluetooth heart-rate strap and see live BPM in the stats and ride HUD.
- **Route difficulty and climbs** — GPX Rider classifies the route, detects sustained climbs, lists each climb with distance/elevation/grade, and tracks live progress to the top while riding.
- **Map ride HUD** — the setup map and fullscreen map share the same configurable metric tiles, distance progress, climbing progress, road-ahead elevation, minimap, and climb/segment banner; fullscreen just expands the map to fill the screen.
- **FIT export** — rides are recorded locally in the browser and can be downloaded as `.fit` files tagged as virtual rides.
- **Simulation mode** — preview any route at a chosen speed without pedaling; real trainer input automatically takes over when you start riding.
- **Screenshot capture** — an optional map screenshot button saves consistent JPG captures including the HUD, minimap, elevation profile, and required Google attribution.
- **Session persistence** — route, ride progress, recorded ride data, camera settings, units, API key, and remembered sensors survive reloads via browser storage.
- **No build step** — plain HTML/CSS/JS ES modules. No framework, no bundler, no `node_modules` required to run the app.

## Quickstart

```sh
git clone https://github.com/ziizii/gpx-rider.git
cd gpx-rider
make run
```

`make run` prints two URLs: the **landing page** (`…/app/`) and the **app itself** (`…/app/app.html`, also one click away via "Launch GPX Rider" on the landing). Open either in **Chrome or Edge on macOS**. Safari does not support Web Bluetooth, so it cannot talk to a trainer. If you are running your own copy, paste in a free [Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) when prompted.

Run the unit tests with:

```sh
make test
```

Or run the default target:

```sh
make
```

That regenerates derived gallery data and runs the tests. The deploy GitHub Action performs the same generation before publishing.

## How to ride

The best tool for creating routes is [Mapy.com](https://mapy.com/). It supports bicycle routing, displays an elevation profile, and exports GPX files ready for GPX Rider.

1. Open GPX Rider in Chrome or Edge.
2. Paste your Google Maps API key if prompted. The key is saved locally in your browser and is only sent to Google Maps.
3. Open a GPX file with track points and elevation, or choose a route from `Browse gallery`. If nothing is loaded yet, GPX Rider automatically loads the first gallery route.
4. Click `Connect` on the smart trainer row and select your trainer. Optionally connect a Bluetooth heart-rate strap the same way.
5. Start pedaling. GPX Rider follows your real trainer speed and converts route grade into FTMS indoor-bike simulation parameters.
6. Export the ride from the FIT data card whenever you want a `.fit` file for Strava, Garmin Connect, intervals.icu, or similar tools.

Not on the bike? Use the Simulation card's `Start` button to preview the route at a fixed speed.

## Route Intelligence

When a route loads, GPX Rider shows the route name, distance, terrain type, and difficulty classification. The elevation panel lists detected sustained climbs with length, gain, and average grade, and each climb is clickable so you can jump to its start. You can also drag across any interval on the elevation profile to select a custom route segment. The normal hover readout becomes a segment readout with start, stop, length, ascent, and descent; clicking the profile clears the selection. While parked in overview this drills into the same focused segment camera used for climbs, and while riding it keeps the rider camera and shows the same segment stats in the map HUD.

During the ride, the same panel switches from planning to live context. On a climb, it shows remaining distance, remaining ascent, and remaining average grade to the top. Between climbs, it shows the next climb and the distance until it begins.

The classification uses distance and elevation gain only; it does not depend on power, speed, or weather. Thresholds and tuning constants live in [`app/tuning.mjs`](app/tuning.mjs), including ascent filtering, climb detection, ETA factors, camera physics, and trainer behavior.

## Camera And HUD

A freshly loaded route starts in a whole-route overview, framed from above so you can understand the shape of the ride before moving. The map action bar has a split overview button: the plane toggles between overview and the rider camera, and the chevron opens the overview style menu. The overview has six styles (also available in Settings › Camera & view → Route overview):

- **Static** — the classic framed still shot.
- **Orbit** — a slow turntable rotation around the route.
- **Fly-by** — a camera flies a PCA-aligned ellipse around the route, looking along its direction of travel.
- **Fly-over** — a camera flies a figure-eight over the route, crossing the middle once per loop. It shares every fly-by setting; only the path differs. Because the eight changes turn direction between its two lobes, the camera banks and looks into whichever turn it's in — leaning slightly left on one lobe, straightening through the crossing, then slightly right on the other.
- **Satellite** — a straight-down view with the route turned to lie across the screen and made as large as it fits.
- **Satellite (north up)** — the same straight-down view, but locked north-up.

The fly-by ellipse (and the fly-over figure-eight) can intentionally be smaller than the route footprint; altitude, pitch, field of view, inward horizontal look offset, and view distance determine how much of the route stays visible from the air. Direction, lap time, maximum speed, ellipse scale, minimum turning radius, baseline height, minimum terrain clearance, pitch, view distance, field of view, inward look offset, and maximum bank angle are configurable in `app/tuning.mjs`.

Once you start pedaling or simulation begins, the camera flies down behind the rider and follows the route using GPX bearing. The overview turns on automatically when a route loads and turns off automatically the moment you start moving — but it's never locked out: the overview button stays available during a ride, so you can flip back to any overview style mid-ride if you want to watch the whole route, then flip back to the rider camera.

The map reset-camera button restores the currently chosen camera surface after a manual drag. It does not turn the rider camera back into the route overview unless the overview button is active.

The ride HUD is part of the map viewport in both setup and fullscreen: metric tiles, the road-ahead elevation profile, distance progress, climbing progress, elapsed time, minimap, and climb/segment banner are intentionally the same overlays before and after fullscreen. Fullscreen only expands the map viewport to fill the screen and hides surrounding page chrome; it does not switch to a different HUD mode. You can collapse the data dock when you want maximum map.

Settings are grouped into practical categories: camera and view, rendering, HUD and data fields, units, trainer and sensors, screenshots, data storage, and debug. Preferences are remembered locally.

The debug category has a **camera debug overlay** — a collapsible translucent box on the map showing the live camera values the 3D map actually applies (tilt, range, heading, roll, field of view, look-at center, eye altitude) alongside ride progress. When the selected overview mode is Orbit, Fly-by, or Fly-over, it also draws that mode's travel path in red, including after you drag the camera into manual mode.

## Hosting Your Own Copy

The `app/` folder is a fully static site. It can be hosted anywhere that serves static files: GitHub Pages, Netlify, Vercel, S3, or a laptop on your home network. Its entry point (`app/index.html`) is the landing page; the app itself is `app/app.html`.

This repo includes a GitHub Actions workflow at [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) that deploys `app/` to GitHub Pages on every push to `main`. To enable it for your fork, go to **Settings -> Pages -> Source: GitHub Actions**.

Self-hosted copies can ask each visitor for their own Google Maps API key. The key is saved only in that visitor's browser storage and is never sent anywhere except Google Maps.

## Notes And Limitations

- GPX Rider uses Google Photorealistic 3D Maps. Enable the **Maps JavaScript API** and **Photorealistic 3D Maps** for your Google Cloud project.
- Route, ride progress, and recorded ride data are stored in IndexedDB. Browsers without working IndexedDB fall back to `localStorage`, where very long rides may exceed storage limits.
- Total ascent and descent are computed from GPX elevation with a small noise filter, so totals can differ from another planner or head unit.
- Smart ETA needs about a minute of real pedaling before it trusts your measured pace. Until then it projects from current speed.
- Calories are shown and exported only if the trainer reports FTMS Expended Energy.
- Heart rate comes from a paired strap or, as a fallback, from the trainer's own heart-rate field.
- Trainer and heart-rate reconnect rely on Chrome's remembered Web Bluetooth devices. If Chrome does not expose a saved device, click `Connect KICKR` or `Connect HR` again.
- Target hardware is FTMS-compatible trainers. Older firmware or proprietary-only control paths may need trainer-specific protocol work.
- Camera terrain avoidance estimates ground height from the route's own elevation points rather than the Elevation API, so it works best when the road itself follows the hillside.
- This is an early project. Test resistance changes at low speed and keep the bike/trainer area clear before a real workout.

## Map Imagery, Routes, And Trademarks

GPX Rider uses Google Maps Platform and Google Photorealistic 3D Maps when you provide an API key. Google Maps, Google Earth, and related imagery are owned by Google and/or its data providers. Keep all map attribution visible in the app and in screenshots.

The GPX files in this repository are independently created demo routes for personal training and testing. They are unofficial and are not affiliated with, endorsed by, or sponsored by any race organizer, venue, mapping provider, equipment manufacturer, or other third party.

Route and place names identify real-world locations only. Third-party trademarks belong to their respective owners.

## Routes

The in-app gallery ships with a small collection of ready-to-ride GPX routes. Each route lives under `gallery/<route-id>/` with `export.gpx` and `metadata.json`; `make gallery-data` parses those files into `app/gallery.json` for the static app.

To add or refresh a gallery route, load the GPX in GPX Rider, position the 3D map camera to frame the route, then use the setup page's **Export to gallery** card to copy a `metadata.json` draft. Descriptions can use simple Markdown formatting, and the gallery renders the preview as a live interactive Google Photorealistic 3D Map instead of a screenshot.

## Contributing

This is an early-stage prototype and could use help in a lot of directions: more trainer protocols, a non-Google map renderer option, route libraries, imports from Strava or Komoot, better mobile support, tests, docs, and ride reports from real trainers.

Issues and PRs are welcome. Please open an issue before diving into a large change so the design can be discussed first.

## License

[MIT](LICENSE)
