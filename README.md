# GPX Rider

**A free, open-source, browser-based virtual cycling trainer.** Load any GPX
route, ride it on photorealistic 3D satellite terrain, and drive real grade
changes on a Bluetooth smart trainer — no app install, no subscription, no
account.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Deploy to GitHub Pages](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml)

**[Try the live demo →](https://ziizii.github.io/gpx-rider/)**
(runs entirely in your browser — the demo ships with a domain-restricted
Google Maps key, or paste in your own)

![GPX Rider](gallery/0100_goldengate/screenshot.jpeg)

## Why GPX Rider?

Zwift, TrainerRoad, and RGT are great, but they're closed platforms with
subscriptions, fixed worlds, and no way to just point at *your* GPX file and
ride it on the actual terrain. GPX Rider is the opposite: a small,
hackable, static web app that

- turns any **GPX route** into a live indoor ride on **real photorealistic 3D
  satellite imagery** (Google Photorealistic 3D Maps),
- sends real **grade/slope changes** to your **Bluetooth FTMS smart
  trainer** (e.g. Wahoo KICKR) as you progress along the route,
- runs as a **static site with zero backend** — clone it, open it, ride,
- and is **free and MIT-licensed**, so you can fork it, self-host it, or
  send a PR.

If that sounds useful, contributions are very welcome — see
[Contributing](#contributing) below.

## Features

- 📍 **GPX import** — drag in any route with track points and elevation.
- 🏔️ **Route difficulty & detected climbs** — as soon as a route loads, the
  setup page shows its distance/terrain/difficulty classification (e.g.
  `M - Rolling · Moderate`) plus a list of the sustained climbs found along
  the way, each with its distance, length, elevation gain, and average
  grade. Classification uses only distance and elevation gain — no power,
  speed, or weather data — and every threshold is a documented constant in
  `app/tuning.mjs`.
- 🛰️ **Photorealistic 3D map** — a forward-facing follow camera tracks your
  position and heading along the route, with a satellite minimap overlay.
  Loading a route instantly shows a **whole-route overview**: the
  start-to-end line reads left-to-right from a 45° perch, with the route's
  far side facing away. Once you start moving, the camera **flies down
  behind the rider** — and from then on every camera move behaves like a
  physical object with limited acceleration: transition flights are quick,
  while the follow camera tracks gently and brakes smoothly instead of
  snapping.
  A translucent **rider beacon** (a tall cylinder above the rider) keeps
  your position visible behind trees and buildings, and the camera
  automatically **lifts over terrain** when a hillside would otherwise
  block the view, easing back down as the terrain allows. Both are
  adjustable in the **Rendering** settings (beacon size/color/opacity,
  terrain clearance) and remembered locally.
- 🚴 **Bluetooth FTMS trainer control** — connects to Wahoo KICKR and other
  FTMS-compatible trainers over Web Bluetooth and pushes live simulation
  grade as you ride. Start pedaling and the map moves with your real
  trainer speed; stop pedaling and it stops.
- ❤️ **BLE heart rate straps** — pair any standard Bluetooth heart-rate
  sensor (Polar, Garmin, Wahoo TICKR, …) and see live BPM in the stats and
  ride HUD.
- 📥 **FIT export** — every ride is recorded transparently in your browser
  (distance, time, GPS track, power, heart rate, calories) and can be
  downloaded at any time as a `.fit` file correctly tagged as a *virtual
  ride*, ready for Strava, Garmin Connect, or intervals.icu. After the
  download the app offers to clear the collected data.
- ▶️ **Simulation mode** — a "Start simulation" button rides the route at a
  chosen slider speed for previewing without pedaling; real pedaling
  automatically takes over and stops the simulation.
- 📈 **Live stats & elevation profile** — distance ridden/remaining, total
  ascent & descent, ascent still ahead, a smart ETA, grade, altitude, power,
  speed, heart rate, and calories (from the trainer), plus a full-route
  elevation chart. Below the distance progress bar a second, amber
  **climbing progress bar** shows how much of the route's total ascent is
  already behind you. Switch between km/mi and kcal/kJ display units.
- ⏱️ **Smart ETA** — the estimated time to the finish accounts for the
  climbing and descending still ahead: your pace so far is measured in
  "flat-equivalent" terms (a vertical meter climbed counts as extra flat
  distance, a descent gives some back), so grinding up a pass doesn't
  project a crawl onto the descent after it. In simulation mode the ETA is
  simply remaining distance at the slider speed.
- 🖥️ **Fullscreen ride HUD** — a distraction-free overlay for pairing with a
  smart TV or tablet on the handlebars. Pick exactly which tiles it shows
  (power, speed, heart rate, grade, ridden, remaining, ascent left, ETA) in
  ⚙ Settings → Display & HUD — where you can also hide the minimap or turn
  on **place labels** (roads, towns) on the 3D map.
- 🚀 **Ready to ride on first open** — with nothing loaded yet, the first
  gallery route is loaded automatically so the app never starts on an
  empty map.
- 📷 **One-click ride screenshots** — an optional `📷 Screenshot` button on
  the map (off by default; enable it in ⚙ Settings → Screenshots) saves a
  JPG of the exact view including the HUD, minimap, elevation profile, and
  the Google attribution (Chrome asks to share the tab — pick “This Tab”).
  Shots are center-cropped to a configurable aspect ratio (16:9 by
  default) and scaled to a fixed width, so every ride screenshot comes out
  at the same resolution — e.g. 1920×1080.
- 🔑 **Bring your own API key** — self-hosted copies without a deployed key
  ask for one on first run; it's typed into the app and saved only in your
  browser's `localStorage`, never sent anywhere but Google. The live demo
  ships with its own built-in key, so it skips this entirely.
- 💾 **Remembers your session** — last route, ride progress, recorded ride
  data, fallback speed, camera settings, and previously paired trainer and
  heart-rate sensor all persist locally.
- 🧩 **No build step** — plain HTML/CSS/JS ES modules, no bundler, no
  framework, no `node_modules` to run it.

## Quickstart

```sh
git clone https://github.com/ziizii/gpx-rider.git
cd gpx-rider
make run
```

Then open the printed URL in **Chrome or Edge on macOS** (Safari doesn't
support Web Bluetooth, so it can't talk to a trainer) and paste in a free
[Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key)
when prompted.

Run the unit tests with:

```sh
make test
```

## How to use it

The best tool for creating routes is [Mapy.com](https://mapy.com/). It
supports bicycle routing, displays an elevation profile, and exports routes
as GPX files ready to load into GPX Rider.

1. Open the page in Chrome and paste in your Google Maps API key (saved
   locally, one-time setup). The settings dialog opens by itself on first
   run; later it's behind the ⚙ icon at the top right.
2. Choose a GPX file with track points and elevation, or pick one from the
   ride gallery. (If nothing is loaded yet, the first gallery ride is
   loaded for you automatically.)
3. Click `Connect KICKR` and select your trainer. Optionally click
   `Connect HR` to pair a Bluetooth heart-rate strap.
4. Just start pedaling — the map follows your real trainer speed and stops
   when you stop. GPX Rider converts local route grade into FTMS
   indoor-bike simulation parameters in real time.
5. Not on the bike? `Start simulation` rides the route at the slider speed
   instead; pedaling automatically stops the simulation and takes over.
6. While you ride, the **Ride recording** panel shows exactly what has been
   collected (distance, time, track points, heart rate, calories) — all of
   it stored only in your browser. Hit `Download FIT` at any time to export
   the ride as a `.fit` file tagged as a virtual ride for Strava, Garmin
   Connect, etc.; afterwards the app offers to clear the collected data.
7. A freshly loaded route is framed whole from above right away; the camera
   stays on that overview (or wherever you drag it) until movement starts,
   then flies down behind the rider. While riding, the map follows the route
   with a forward-facing camera based on GPX bearing. Everything
   configurable lives in the ⚙ settings dialog: camera
   tuning (`Zoom`, `Camera angle`, `Camera behind`), km/mi and kcal/kJ
   display units, the **Display & HUD** section (minimap on/off, place
   labels on the 3D map, and which tiles the fullscreen ride HUD shows),
   the trainer grade update interval, and the **Rendering**
   section — the rider beacon (the translucent cylinder that marks your
   position above the trees — on/off, diameter, height, opacity, color)
   and the *keep camera above terrain* behavior with its clearance margin.
   All of it is remembered locally. If you host your own copy, every other
   behavior parameter (pedaling thresholds, ETA model factors, camera
   physics, ascent noise filtering, …) lives documented in one file:
   [`app/tuning.mjs`](app/tuning.mjs).

## Hosting your own copy

The `app/` folder is a fully static site — no server-side code at all — so
it can be hosted anywhere that serves static files (GitHub Pages, Netlify,
Vercel, S3, or just a laptop on your home network). This repo ships a
GitHub Actions workflow ([.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml))
that deploys `app/` to GitHub Pages automatically on every push to `main`.
To turn it on for your fork: **Settings → Pages → Source: GitHub Actions**.

Because the Google Maps key is entered per-visitor and stored in their own
browser, you can publish a live demo without ever exposing a key of your
own — visitors will be prompted to paste their own key on first load.

## Notes & limitations

- The app prefers Google Photorealistic 3D Maps; enable the **Maps
  JavaScript API** and the **Photorealistic 3D Maps** feature for your
  Google Cloud project, or the map fails to load instead of falling back to
  another renderer.
- Route, ride progress, and the recorded ride data are stored in browser
  `localStorage`. Very large GPX files or very long rides may exceed
  browser storage limits (recording then continues in memory only).
- Total ascent/descent are computed from the GPX elevation with a small
  noise filter (climbs only count once they exceed a couple of meters), so
  the totals can differ slightly from what another planner or head unit
  reports for the same file.
- The smart ETA needs a minute or so of real pedaling before it trusts
  your measured pace; until then it projects the current speed.
- Calories are shown and exported only if the trainer reports FTMS
  Expended Energy; heart rate comes from a paired strap or, as a fallback,
  from the trainer's own HR field.
- Trainer and heart-rate reconnect rely on Chrome's remembered Web
  Bluetooth devices. If Chrome doesn't expose the saved device, click
  `Connect KICKR` / `Connect HR` again.
- Target hardware is FTMS-compatible trainers (e.g. Wahoo KICKR). Older
  firmware or proprietary-only control paths may need trainer-specific
  protocol work.
- Rider and bike weight are normally configured in the trainer ecosystem
  rather than sent with the FTMS grade command; this app currently sends
  slope, wind, rolling resistance, and drag-area values.
- Camera terrain avoidance estimates the ground from the route's own
  elevation points (no Elevation API calls), so it works best where the
  road itself climbs the hill — switchbacks, mountain passes. An off-route
  ridge with no track points nearby is not detected.
- This is a young project. Test resistance changes at low speed and keep
  the bike/trainer clear before a real workout.

## Map imagery, routes, and trademarks

GPX Rider uses Google Maps Platform / Google Photorealistic 3D Maps when you provide your own API key. Google Maps, Google Earth, and related imagery are owned by Google and/or its data providers. Keep all map attribution visible in the app and in screenshots.

The GPX files in this repository are independently created demo routes for
personal training and testing. They are unofficial and are not affiliated
with, endorsed by, or sponsored by any race organizer, venue, mapping
provider, equipment manufacturer, or other third party.

Route and place names identify real-world locations only. Third-party
trademarks belong to their respective owners.

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

This is an early-stage prototype and could use help in a lot of directions:
more trainer protocols, a non-Google map renderer option, route
libraries/import from Strava or Komoot, better mobile support, tests,
docs, or just bug reports from riding it. Issues and PRs are welcome —
open an issue to discuss anything nontrivial before diving into a big
change.

## License

[MIT](LICENSE)
