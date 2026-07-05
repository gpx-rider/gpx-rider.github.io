# GPX Rider

**A free, open-source, browser-based virtual cycling trainer.** Load any GPX route, ride it over photorealistic 3D satellite terrain, and drive real grade changes on a Bluetooth smart trainer. No app install, no subscription, no account.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Deploy to GitHub Pages](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml)

**[Try the live demo](https://ziizii.github.io/gpx-rider/)**

The live demo runs entirely in your browser. It ships with a domain-restricted Google Maps key; self-hosted copies can use your own key, stored locally in your browser.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="screenshots/setup_screen.jpeg" alt="GPX Rider setup screen with route, map, trainer, and ride controls">
      <br>
      <strong>Route setup</strong>
    </td>
    <td width="50%">
      <img src="screenshots/before_climb.jpeg" alt="GPX Rider ride view approaching a climb with the fullscreen HUD">
      <br>
      <strong>Before a climb</strong>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="screenshots/climbing.jpeg" alt="GPX Rider fullscreen ride HUD while climbing on photorealistic terrain">
      <br>
      <strong>Live climbing HUD</strong>
    </td>
    <td width="50%">
      <img src="screenshots/settings.jpeg" alt="GPX Rider settings dialog for trainer, camera, rendering, units, and data">
      <br>
      <strong>Settings</strong>
    </td>
  </tr>
</table>

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
- **Photorealistic 3D terrain** — Google Photorealistic 3D Maps render the route with a follow camera, minimap, rider beacon, terrain-aware camera lift, and a whole-route overview (static, orbit, or ellipse fly-by) before the ride starts.
- **Bluetooth FTMS trainer control** — connect Wahoo KICKR and other FTMS-compatible trainers over Web Bluetooth. Start pedaling and the map advances from your real trainer speed; stop pedaling and the ride stops.
- **Heart-rate sensors** — pair a standard Bluetooth heart-rate strap and see live BPM in the stats and ride HUD.
- **Route difficulty and climbs** — GPX Rider classifies the route, detects sustained climbs, lists each climb with distance/elevation/grade, and tracks live progress to the top while riding.
- **Fullscreen ride HUD** — a full-bleed map for TVs, tablets, and handlebar screens, with configurable metric tiles, distance progress, climbing progress, road-ahead elevation, minimap, and climb banner.
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

Open the printed URL in **Chrome or Edge on macOS**. Safari does not support Web Bluetooth, so it cannot talk to a trainer. If you are running your own copy, paste in a free [Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) when prompted.

Run the unit tests with:

```sh
make test
```

Or run the default target:

```sh
make
```

That regenerates derived gallery data, refreshes the generated README route gallery, and runs the tests. The deploy GitHub Action performs the same generation before publishing.

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

When a route loads, GPX Rider shows the route name, distance, terrain type, and difficulty classification. The elevation panel lists detected sustained climbs with length, gain, and average grade, and each climb is clickable so you can jump to its start.

During the ride, the same panel switches from planning to live context. On a climb, it shows remaining distance, remaining ascent, and remaining average grade to the top. Between climbs, it shows the next climb and the distance until it begins.

The classification uses distance and elevation gain only; it does not depend on power, speed, or weather. Thresholds and tuning constants live in [`app/tuning.mjs`](app/tuning.mjs), including ascent filtering, climb detection, ETA factors, camera physics, and trainer behavior.

## Camera And HUD

A freshly loaded route starts in a whole-route overview, framed from above so you can understand the shape of the ride before moving. The overview has three styles (Settings › Camera & view → Route overview):

- **Static** — the classic framed still shot.
- **Orbit** — a slow turntable rotation around the route.
- **Fly-by** — a camera flies a PCA-aligned ellipse around the route, looking along its direction of travel.

The fly-by ellipse can intentionally be smaller than the route footprint; altitude, pitch, field of view, inward horizontal look offset, and view distance determine how much of the route stays visible from the air. Direction, lap time, maximum speed, ellipse scale, minimum turning radius, baseline height, minimum terrain clearance, pitch, view distance, field of view, inward look offset, and maximum bank angle are configurable in `app/tuning.mjs`.

Once you start pedaling or simulation begins, the camera flies down behind the rider and follows the route using GPX bearing.

The fullscreen HUD is designed for riding, not just watching. It keeps the map full bleed while showing configurable metric tiles, the road-ahead elevation profile, distance progress, climbing progress, elapsed time, minimap, and climb banner. You can collapse the data dock when you want maximum map.

Settings are grouped into practical categories: camera and view, rendering, HUD and data fields, units, trainer and sensors, screenshots, data storage, and debug. Preferences are remembered locally.

The debug category has a **camera debug overlay** — a collapsible translucent box on the map showing the live camera values the 3D map actually applies (tilt, range, heading, roll, field of view, look-at center, eye altitude) alongside ride progress. When the selected overview mode is Orbit or Fly-by, it also draws that mode's travel path in red, including after you drag the camera into manual mode.

## Hosting Your Own Copy

The `app/` folder is a fully static site. It can be hosted anywhere that serves static files: GitHub Pages, Netlify, Vercel, S3, or a laptop on your home network.

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

A small collection of ready-to-ride GPX routes. Download any of them and load it straight into GPX Rider.

Gallery screenshots are rendered from Google Photorealistic 3D Maps. The screenshots are meant to keep the Google/data-provider attribution visible; do not crop, hide, or remove that attribution when adding new gallery images.

<!-- gallery-start -->
#### [Golden Gate Bridge](gallery/0100_goldengate/export.gpx)

![](gallery/0100_goldengate/screenshot.jpeg)

A short scenic ride along the San Francisco coast, heading toward the iconic red towers of the Golden Gate Bridge. Expect big ocean views, rolling hills, glimpses of San Francisco Bay, and a finish near Point Lobos.

**10 km** · **184 m up** · **184 m down**

[⬇ Download GPX](gallery/0100_goldengate/export.gpx)

---

#### [Stelvio Pass](gallery/0200_stelvio_pass/export.gpx)

![](gallery/0200_stelvio_pass/screenshot.jpeg)

A high-alpine ride from Stilfs over the legendary Stelvio Pass and down toward Bormio. Expect towering mountain views, dramatic switchbacks, exposed slopes, and one of the most recognizable roads in cycling.

**30 km** · **1,495 m up** · **866 m down**

[⬇ Download GPX](gallery/0200_stelvio_pass/export.gpx)

---

#### [Alpe d’Huez](gallery/0300_alpe_d_huez/export.gpx)

![](gallery/0300_alpe_d_huez/screenshot.jpeg)

A classic alpine climb from Le Bourg-d’Oisans to Alpe d’Huez, famous for its 21 hairpins and years of grand-tour drama. Expect tight switchbacks, big valley views, and a final stretch high above the mountains before an easy cooldown.

**20 km** · **1,174 m up** · **124 m down**

[⬇ Download GPX](gallery/0300_alpe_d_huez/export.gpx)

---

#### [Zlaté návrší](gallery/0400_zlate_navrsi/export.gpx)

![](gallery/0400_zlate_navrsi/screenshot.jpeg)

Climb from Semily deep into the Krkonoše mountains, taking on a 40 km ascent toward Zlaté návrší - often claimed to be the longest climb in the Czech Republic. After the main climb, the route crosses the high ridges past Labská bouda, the source of the Elbe, and Vosecká bouda - including a protected stretch that is much easier to enjoy when your bike is virtual.

**54.6 km** · **1,164 m up** · **711 m down**

[⬇ Download GPX](gallery/0400_zlate_navrsi/export.gpx)

---

#### [Amalfi Coast](gallery/0500_amalfi_coast/export.gpx)

![](gallery/0500_amalfi_coast/screenshot.jpeg)

A punchy coastal ride along the Amalfi Coast, where the road keeps climbing out of seaside towns and dropping back toward the Mediterranean. Expect cliffside views, tight bends, short hard efforts, and plenty of downhill breaks before finishing at Piazza Giacomo Matteotti.

**32.3 km** · **1,176 m up** · **1,237 m down**

[⬇ Download GPX](gallery/0500_amalfi_coast/export.gpx)

---

#### [Boulder Foothills](gallery/0600_boulder/export.gpx)

![](gallery/0600_boulder/screenshot.jpeg)

A punchy ride through the Colorado foothills around Boulder, where the road keeps kicking up into short climbs before dropping into fast descents. Expect canyon roads, open mountain views, dry Rocky Mountain scenery, and a sawtooth profile that feels made for natural intervals.

**48.2 km** · **1,473 m up** · **1,737 m down**

[⬇ Download GPX](gallery/0600_boulder/export.gpx)

---

#### [Griffith Observatory](gallery/0700_los_angeles/export.gpx)

![](gallery/0700_los_angeles/screenshot.jpeg)

Ride from downtown Los Angeles into the Hollywood Hills, passing city landmarks before climbing through Griffith Park to one of LA’s most famous viewpoints. Expect skyline views, dry canyon scenery, rolling park roads, and a finish near Griffith Observatory above the city.

**36.2 km** · **586 m up** · **341 m down**

[⬇ Download GPX](gallery/0700_los_angeles/export.gpx)

---

#### [Big Island Full-Distance Ride](gallery/0800_kona/export.gpx)

![](gallery/0800_kona/screenshot.jpeg)

Ride a full-distance route across Hawaiʻi’s Big Island: lava fields, ocean views, long exposed roads, and a distance that turns “I’ll just try it for a bit” into a very serious conversation with your legs.

Nobody expects anyone to finish a 180 km virtual ride in one go. Except Jan, obviously. But the route is there whenever you feel dangerously optimistic.

**182.4 km** · **781 m up** · **781 m down**

[⬇ Download GPX](gallery/0800_kona/export.gpx)

---

#### [Prague Landmarks](gallery/0900_prague/export.gpx)

![](gallery/0900_prague/screenshot.jpeg)

A compact sightseeing ride through the heart of Prague, linking Vyšehrad, the National Theatre, Old Town Square, the Astronomical Clock, Charles Bridge, Petřín, Prague Castle, Letná, and Vítkov. Expect river views, historic squares, park climbs, castle panoramas, and a steady stream of postcard moments.

**21.1 km** · **172 m up** · **200 m down**

[⬇ Download GPX](gallery/0900_prague/export.gpx)
<!-- gallery-end -->

## Contributing

This is an early-stage prototype and could use help in a lot of directions: more trainer protocols, a non-Google map renderer option, route libraries, imports from Strava or Komoot, better mobile support, tests, docs, and ride reports from real trainers.

Issues and PRs are welcome. Please open an issue before diving into a large change so the design can be discussed first.

## License

[MIT](LICENSE)
