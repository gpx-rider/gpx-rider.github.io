# GPX Rider for iPhone & iPad

A [Capacitor](https://capacitorjs.com) wrapper that ships the unmodified web
app from [`../app`](../app) as a native iOS/iPadOS app, adding the one thing
WKWebView is missing for indoor riding: Bluetooth. Android is supported by the
same code, but usually unnecessary — see [Android](#what-about-android) below.

## How the port works

- **`build.mjs`** rebuilds `www/` from scratch on every run by copying
  `../app` verbatim, so the native app is always the current web app — there
  is no forked copy to drift out of date. It then replaces the marketing
  landing page with a redirect straight into the app, optionally bakes in a
  Google Maps API key, and injects one extra `<script>` into `app.html`.
- **`native/web-bluetooth.mjs`** is that script's core: a Web Bluetooth
  polyfill built on
  [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le).
  It implements exactly the API subset `app/trainer/*.mjs` uses
  (`requestDevice`, `getDevices`, GATT connect/disconnect, service and
  characteristic lookup with Web-Bluetooth-shaped errors, notifications,
  writes), so the app's trainer, Tacx FE-C, and heart-rate code runs
  completely unchanged and the FTMS-vs-FE-C protocol detection still works.
- **`native/native-shim.mjs`** installs the polyfill and a screen wake lock
  (the display must not sleep mid-ride), and only when actually running
  inside the native container — opening `www/` in a desktop browser still
  uses real Web Bluetooth.

Nothing in `../app` changes for this port; all native-specific code lives in
this folder.

## What you need

- A **Mac with Xcode** (current version — Apple requires a recent Xcode for
  App Store uploads) and its iOS platform + command line tools installed.
- **Node.js 20+**.
- A **real iPhone or iPad** — the iOS Simulator has no Bluetooth, so trainer
  and heart-rate pairing can only be tested on hardware. iOS 16.4+ recommended
  (screen wake lock); the photorealistic 3D map is GPU-heavy, so recent
  A-series/M-series devices work best.
- An **Apple ID**. A free one is enough to run on your own device; the
  **Apple Developer Program** ($99/year) is required for TestFlight and the
  App Store.

## One-time setup

```sh
cd mobile
npm install
npm run build        # generates www/ from ../app
npx cap add ios      # generates the Xcode project in mobile/ios/
```

Then open `ios/App/App/Info.plist` and add the Bluetooth usage description —
iOS terminates the app at first pairing without it:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>GPX Rider connects to your smart trainer and heart-rate sensor over Bluetooth.</string>
```

If you plan to distribute the app, first change `appId` in
`capacitor.config.json` from the placeholder `io.github.gpxrider` to a
reverse-DNS id under a domain you own — the bundle ID must be globally unique
in Apple's ecosystem and can't be changed after the first App Store upload.

### Google Maps API key

Same as the web app, the map needs a Maps JavaScript API key
([cloud.google.com/maps-platform](https://cloud.google.com/maps-platform)).
Two options:

1. **Paste it in the app** — with no baked-in key, first launch opens the
   same Settings prompt as the hosted web app; the key is stored on the
   device. Fine for personal use.
2. **Bake it into the build** — put the key in the gitignored
   `.maps-api-key` file at the repo root (or export `MAPS_API_KEY`) and run
   `npm run build`; it is injected into `www/config.mjs` exactly like the dev
   server and deploy workflow do. Do this for TestFlight/App Store builds:
   reviewers and testers won't have their own key.

Do **not** reuse an HTTP-referrer-restricted key (like the GitHub Pages
deploy key): inside the native app the page origin is
`capacitor://localhost`, which never matches a referrer rule, and the map
stays black. Create a separate key restricted **by API** (Maps JavaScript API
only) instead, and treat it as visible to anyone who unzips the app bundle —
the same visibility trade-off every Maps web key has.

## Running on your own iPhone/iPad

```sh
npm run ios          # rebuild www/, cap sync, open Xcode
```

In Xcode:

1. Select the `App` target › **Signing & Capabilities**, choose your team
   (a free "Personal Team" works).
2. Plug in your device, select it as the run destination (first time: enable
   Developer Mode on the device when prompted — Settings › Privacy & Security
   › Developer Mode), and press **Run**.
3. With a free account, iOS asks you to trust your developer certificate
   once: Settings › General › VPN & Device Management › trust. Free-account
   installs expire after **7 days** — just run from Xcode again. Paid-account
   installs last a year.

Pairing works like the web app: Settings › Connections (or the setup panel),
tap connect, and pick the trainer/strap from the **native** device picker the
plugin shows. iOS asks for Bluetooth permission on first use.

Day-to-day iteration: edit files in `../app` as usual, then

```sh
npm run sync         # rebuild www/ + cap sync
```

and press Run in Xcode again (`npx cap run ios` also works from the CLI).

## Getting it to testers: TestFlight

1. Join the Apple Developer Program with the Apple ID you'll publish under.
2. In [App Store Connect](https://appstoreconnect.apple.com) › Apps › **+**,
   create the app record: platform iOS, your bundle ID, an app name (unique
   store-wide), primary language, SKU (any internal string).
3. In Xcode: set the run destination to **Any iOS Device (arm64)**, bump the
   version/build number on the `App` target, then **Product › Archive**.
4. In the Organizer window that opens: **Distribute App › TestFlight & App
   Store › Upload**. Xcode handles signing and the upload.
5. In App Store Connect › TestFlight, wait for the build to finish
   processing, answer the export-compliance question (the app uses only
   standard HTTPS → "standard encryption", exempt), then:
   - **Internal testing** — add up to 100 members of your App Store Connect
     team; available immediately, no review.
   - **External testing** — create a group, add up to 10,000 testers by email
     or public link; the first build needs a lightweight **Beta App Review**
     (usually a day).
6. Testers install the **TestFlight** app, accept the invite, and get your
   builds. Each build expires after 90 days; upload a new archive to refresh.

## Getting it into the App Store

Everything from TestFlight applies, plus, in the App Store Connect app
record:

- **Metadata**: description, keywords, support URL, marketing URL (the
  GitHub Pages site works for both).
- **Screenshots**: one set for the current large iPhone size and — since the
  app targets iPad — one for the 13" iPad size (App Store Connect lists the
  exact required sets; other sizes scale down from these).
- **Privacy policy URL** (required). GPX Rider's story is simple and worth
  stating: all rides, settings, and keys stay on the device; map imagery is
  loaded from Google Maps.
- **App Privacy questionnaire**: the app itself collects nothing ("Data Not
  Collected"), but note that Google Maps receives map-tile requests.
- **Age rating** questionnaire (comes out 4+).
- **App Review notes** — the important one. Reviewers have no smart trainer,
  so tell them how to see the full experience without hardware: load a
  gallery route and use **demo mode**, which simulates a complete ride with
  trainer and heart-rate telemetry. Also bake a Maps key into the build (see
  above) so the reviewer never sees a key prompt — "app requires setup to
  function" is a common rejection. If review pushes back with guideline 4.2
  ("minimum functionality" for web wrappers), the response is that the app
  integrates native Bluetooth trainer control (FTMS/FE-C), which no iOS
  browser can do.
- Pick the build, submit for review. First reviews typically take ~1–2 days;
  rejections come with specific guideline references and you can reply/resubmit.

## What about Android?

Two answers:

- **You may not need a native Android app at all.** Chrome and Edge on
  Android implement real Web Bluetooth, so the hosted web app already pairs
  with trainers and straps directly in the browser — that's the "Use Chrome"
  path the app was built for. iOS is the platform with no Web Bluetooth in
  any browser, which is why this port exists.
- **But you get Android nearly for free here.** Both the BLE plugin and the
  polyfill are cross-platform, and the shim's `androidNeverForLocation` flag
  is already set. To build it:

  ```sh
  npm install @capacitor/android
  npx cap add android
  npm run android      # rebuild www/, sync, open Android Studio
  ```

  Check the plugin's README for the `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`
  manifest permissions matching your target SDK. A native Android build buys
  a home-screen icon, the baked-in key, and the automatic wake lock — nice to
  have, not required.

## Known differences from the desktop web app

- **Map screenshots** are unavailable (the tab-capture API doesn't exist in
  WKWebView); the app already hides the button when unsupported.
- **The fullscreen toggle** falls back to its CSS-only mode — which is
  indistinguishable inside a native app that is always full screen.
- **Screen wake lock** requires iOS 16.4+; on older iOS the display can
  still sleep mid-ride.
- Everything else — ride recording, FIT export (via the share sheet), the
  gallery, persistence — is the same code and works as on the web.
