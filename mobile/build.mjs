#!/usr/bin/env node
// Builds the Capacitor web assets (www/) from the real app.
//
// The app in ../app is the single source of truth — nothing is forked. This
// script re-creates www/ from scratch on every run:
//   1. copies ../app verbatim
//   2. injects the native shim <script> into app.html ahead of app.js
//   3. replaces index.html (the public landing page, pointless inside a
//      native app) with an instant redirect to app.html
//   4. optionally bakes a Google Maps API key into config.mjs, read from the
//      MAPS_API_KEY_IOS environment variable or the gitignored
//      mobile/.maps-api-key file — deliberately NOT the repo-root
//      .maps-api-key: the web keys are HTTP-referrer-restricted and never
//      match the native app's capacitor://localhost origin, so the native
//      build needs its own (API-restricted) key. Same base64 substitution
//      as the repo's dev server and deploy workflow.
//   5. bundles native/native-shim.mjs (+ the Capacitor plugin JS) with
//      esbuild into www/native/native-shim.js
//
// Run via `npm run build` (or the sync/ios scripts, which chain `cap sync`).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const appDir = path.join(repoRoot, "app");
const wwwDir = path.join(here, "www");

// 1. Fresh copy of the app.
rmSync(wwwDir, { recursive: true, force: true });
mkdirSync(wwwDir, { recursive: true });
cpSync(appDir, wwwDir, { recursive: true });

// 2. Inject the native shim before the app's module script. Anchored on the
// exact tag from app.html so a drive-by change there fails loudly here
// instead of silently shipping an app without BLE.
const appHtmlPath = path.join(wwwDir, "app.html");
const appJsTag = '<script src="./app.js" type="module"></script>';
const appHtml = readFileSync(appHtmlPath, "utf8");
if (!appHtml.includes(appJsTag)) {
  throw new Error(`Could not find ${appJsTag} in app.html — update build.mjs to match the new script tag.`);
}
writeFileSync(
  appHtmlPath,
  appHtml.replace(appJsTag, `<script src="./native/native-shim.js"></script>\n    ${appJsTag}`),
);

// 3. Native apps skip the marketing landing page.
writeFileSync(
  path.join(wwwDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0; url=./app.html">
    <style>html { background: #0e1116; }</style>
    <script>location.replace("./app.html");</script>
  </head>
  <body></body>
</html>
`,
);

// 4. Optional iOS-specific Maps API key (see the header comment for why the
// web app's key is never reused). Without one the app falls back to its own
// first-run "paste your key" prompt in Settings, which also works.
const keyFile = path.join(here, ".maps-api-key");
const mapsKey = (process.env.MAPS_API_KEY_IOS || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "")).trim();
if (mapsKey) {
  const configPath = path.join(wwwDir, "config.mjs");
  const keyLine = /const DEPLOYED_MAPS_API_KEY_B64 = ".*";/;
  const config = readFileSync(configPath, "utf8");
  if (!keyLine.test(config)) {
    throw new Error("Could not find the DEPLOYED_MAPS_API_KEY_B64 line in config.mjs.");
  }
  const encoded = Buffer.from(mapsKey, "utf8").toString("base64");
  writeFileSync(configPath, config.replace(keyLine, `const DEPLOYED_MAPS_API_KEY_B64 = "${encoded}";`));
  console.log("[build] baked Maps API key into www/config.mjs");
} else {
  console.log("[build] no Maps API key (MAPS_API_KEY_IOS env or mobile/.maps-api-key) — the app will prompt for one");
}

// 5. Bundle the native shim. Classic IIFE script so it installs the
// polyfill synchronously before the (deferred) app module executes.
await build({
  entryPoints: [path.join(here, "native", "native-shim.mjs")],
  outfile: path.join(wwwDir, "native", "native-shim.js"),
  bundle: true,
  format: "iife",
  target: "safari16",
  logLevel: "info",
});

console.log("[build] www/ is ready — run `npx cap sync` to push it into the native project");
