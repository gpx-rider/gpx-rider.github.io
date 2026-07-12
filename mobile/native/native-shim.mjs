// Native-app shim, injected into www/app.html by build.mjs as a classic
// (bundled) script ahead of the app's own module. It adapts the unmodified
// web app to the Capacitor container:
//
//   - installs the Web Bluetooth polyfill (WKWebView has no
//     navigator.bluetooth), so trainer/heart-rate pairing works natively
//   - holds a screen wake lock so the display never sleeps mid-ride
//     (Screen Wake Lock API — supported by WKWebView since iOS 16.4)
//
// Everything is gated on actually running inside the native container, so
// opening www/ in a desktop browser (or a future PWA build) keeps the real
// Web Bluetooth implementation.

import { Capacitor } from "@capacitor/core";
import { installWebBluetoothPolyfill } from "./web-bluetooth.mjs";

function installScreenWakeLock() {
  if (!navigator.wakeLock?.request) return;
  let sentinel = null;
  const acquire = async () => {
    if (sentinel || document.visibilityState !== "visible") return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => {
        sentinel = null;
      });
    } catch {
      sentinel = null; // retried on the next visibility change / tap
    }
  };
  document.addEventListener("visibilitychange", acquire);
  window.addEventListener("pointerdown", acquire, { passive: true });
  acquire();
}

if (Capacitor.isNativePlatform()) {
  installWebBluetoothPolyfill();
  installScreenWakeLock();
}
