# GPX Rider

**A free, open-source, browser-based virtual cycling trainer.** Load any GPX
route, ride it on photorealistic 3D satellite terrain, and drive real grade
changes on a Bluetooth smart trainer — no app install, no subscription, no
account.

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Deploy to GitHub Pages](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/ziizii/gpx-rider/actions/workflows/deploy-pages.yml)

**[Try the live demo →](https://ziizii.github.io/gpx-rider/)**
(runs entirely in your browser — bring your own free Google Maps API key)

![GPX Rider](docs/screenshot.jpg)

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
- 🛰️ **Photorealistic 3D map** — a forward-facing follow camera tracks your
  position and heading along the route, with a satellite minimap overlay.
- 🚴 **Bluetooth FTMS trainer control** — connects to Wahoo KICKR and other
  FTMS-compatible trainers over Web Bluetooth and pushes live simulation
  grade as you ride.
- 📈 **Live stats & elevation profile** — distance, grade, altitude, power,
  and speed, plus a full-route elevation chart.
- 🖥️ **Fullscreen ride HUD** — a distraction-free overlay for pairing with a
  smart TV or tablet on the handlebars.
- 🔑 **Bring your own API key** — your Google Maps key is typed into the app
  and saved only in your browser's `localStorage`; it's never sent anywhere
  but Google.
- 💾 **Remembers your session** — last route, ride progress, fallback speed,
  camera settings, and previously paired trainer all persist locally.
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
   locally, one-time setup).
2. Choose a GPX file with track points and elevation.
3. Click `Connect KICKR`, select your trainer, then hit `Start`.
4. GPX Rider converts local route grade into FTMS indoor-bike simulation
   parameters in real time.
5. Once the trainer reports FTMS Indoor Bike Data, the app shows live power
   and speed and uses trainer speed to advance you along the route.
6. The map follows the route with a forward-facing camera based on GPX
   bearing; tune `Zoom`, `Camera angle`, and `Camera behind` to taste —
   those settings are remembered locally.

## Hosting your own copy

The `app/` folder is a fully static site — no server-side code at all — so
it can be hosted anywhere that serves static files (GitHub Pages, Netlify,
Vercel, S3, or just a laptop on your home network). This repo ships a
GitHub Actions workflow ([.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml))
that deploys `app/` to GitHub Pages automatically on every push to `main`.
To turn it on for your fork: **Settings → Pages → Source: GitHub Actions**.

Because the Google Maps key is entered per-visitor and stored in their own
browser, you can publish a live demo without ever exposing a key of your
own.

## Notes & limitations

- The app prefers Google Photorealistic 3D Maps; enable the **Maps
  JavaScript API** and the **Photorealistic 3D Maps** feature for your
  Google Cloud project, or the map fails to load instead of falling back to
  another renderer.
- Route and ride progress are stored in browser `localStorage`. Very large
  GPX files may exceed browser storage limits.
- Trainer reconnect relies on Chrome's remembered Web Bluetooth devices. If
  Chrome doesn't expose the saved device, click `Connect KICKR` again.
- Target hardware is FTMS-compatible trainers (e.g. Wahoo KICKR). Older
  firmware or proprietary-only control paths may need trainer-specific
  protocol work.
- Rider and bike weight are normally configured in the trainer ecosystem
  rather than sent with the FTMS grade command; this app currently sends
  slope, wind, rolling resistance, and drag-area values.
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
