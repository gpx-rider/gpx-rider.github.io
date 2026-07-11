// Map bootstrap: Maps API key resolution (visitor-saved key wins over the
// deploy-time key baked into config.mjs), the Google Maps JS loader, and the
// creation of the 3D map and the 2D minimap.

import { computeFollowCamera } from "../camera/camera.mjs";
import { deployedMapsApiKey } from "../config.mjs";
import { bindManualCameraCapture } from "../camera/follow-camera.mjs";
import { registerHudComponent } from "../hud/screen-manager.mjs";
import { openSettings } from "../settings/settings-ui.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";

// Deliberately localStorage, not storage.mjs: saving the key reloads the page
// immediately, and only a synchronous write is guaranteed to survive that.
const MAPS_API_KEY_STORAGE_KEY = "gpx-rider:maps-api-key";

export function getStoredMapsApiKey() {
  return localStorage.getItem(MAPS_API_KEY_STORAGE_KEY) || "";
}

// A key a visitor pasted into Settings always wins; otherwise fall back to
// whatever this deployment baked in at build time (see config.mjs).
export function resolveMapsApiKey() {
  return getStoredMapsApiKey() || deployedMapsApiKey();
}

export function saveMapsApiKey() {
  const key = els.mapsApiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(MAPS_API_KEY_STORAGE_KEY, key);
  } else {
    localStorage.removeItem(MAPS_API_KEY_STORAGE_KEY);
  }
  location.reload();
}

// The minimap pins to the far end of the right column (align "end"), so it
// sits just above the bottom dock no matter what stacks above it.
export function registerMinimapHud() {
  registerHudComponent({ id: "minimap", region: "right", weight: 30, element: els.minimap, align: "end" });
}

export async function initMap() {
  const apiKey = resolveMapsApiKey();
  if (!apiKey) {
    updateProgressLabel("Add your Google Maps API key in Settings (⚙, top right) to load the map.");
    // First run: the key input lives in the settings dialog's Data &
    // storage panel, so open the dialog on that panel.
    openSettings("data");
    return;
  }

  try {
    await loadGoogleMaps(apiKey);
  } catch (error) {
    console.error(error);
    updateProgressLabel("Photorealistic 3D Maps did not load. Check that the 3D Maps feature is enabled for your Google API key.");
    return;
  }

  initMinimap();

  try {
    await initGooglePhotorealistic3DMap();
  } catch (error) {
    console.error(error);
    updateProgressLabel("Photorealistic 3D Maps did not load. Check that the 3D Maps feature is enabled for your Google API key.");
  }
}

function initMinimap() {
  try {
    state.minimapMap = new google.maps.Map(els.minimap, {
      mapTypeId: google.maps.MapTypeId.HYBRID,
      center: { lat: 46.8182, lng: 8.2275 },
      zoom: 12,
      disableDefaultUI: true,
      gestureHandling: "none",
      clickableIcons: false,
      keyboardShortcuts: false,
      backgroundColor: "#cdd7d1",
    });
  } catch (error) {
    console.error(error);
  }
}

async function initGooglePhotorealistic3DMap() {
  state.maps3d = await google.maps.importLibrary("maps3d");
  const { Map3DElement, MapMode } = state.maps3d;
  if (!Map3DElement) throw new Error("Map3DElement is not available.");

  state.mapProvider = "google3d";
  const mapEl = document.querySelector("#map");
  mapEl.replaceChildren();
  const camera = computeFollowCamera({
    riderPosition: { lat: 46.8182, lng: 8.2275 },
    heading: 0,
    cameraZoom: state.cameraZoom,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraAngleDegrees: state.cameraAngleDegrees,
  });
  state.map = new Map3DElement({
    center: { ...camera.center, altitude: 0 },
    heading: camera.heading,
    // HYBRID adds place labels (roads, towns) on top of the satellite
    // imagery; toggled in Settings → Display & HUD.
    mode: state.mapLabelsEnabled ? MapMode?.HYBRID : MapMode?.SATELLITE,
    range: camera.range,
    tilt: camera.tilt,
    // Hide the default UI buttons (compass, zoom); gestures still work and
    // the view stays clean for riding and screenshots. Never touch
    // googleLogoDisabled/legalNoticesDisabled — attribution must stay
    // visible under the Google Maps ToS.
    defaultUIDisabled: true,
  });
  mapEl.append(state.map);
  bindManualCameraCapture();
}

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=beta`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the Google Maps JavaScript API."));
    document.head.append(script);
  });
}
