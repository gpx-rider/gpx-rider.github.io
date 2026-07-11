// "Theater mode": rather than resizing the actual browser window (most
// browsers block scripted resizing of a window/tab they didn't open via
// window.open()), pin the map viewport itself to an exact recording size in
// CSS pixels via the .theater-mode class (styles.css), centered over a dimmed
// backdrop, so a screen recording always captures a consistent size.
// Dismissed by Escape or a click outside the map (see the shared document
// keydown/click handlers in app.js), same convention as the camera menus.

import { renderProfile } from "../route/profile-ui.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import {
  RECORDING_MAP_VIEWPORT_HEIGHT_PIXELS,
  RECORDING_MAP_VIEWPORT_TOLERANCE_PIXELS,
  RECORDING_MAP_VIEWPORT_WIDTH_PIXELS,
} from "../core/tuning.mjs";

export function toggleTheaterMode(event) {
  event.stopPropagation();
  if (state.theaterMode) exitTheaterMode();
  else enterTheaterMode();
}

export function enterTheaterMode() {
  if (document.fullscreenElement) {
    updateProgressLabel("Exit fullscreen before opening the 1280x720 map view.");
    return;
  }

  state.theaterMode = true;
  els.mapViewport.classList.add("theater-mode");
  els.resizeRecordingWindowBtn.setAttribute("aria-pressed", "true");
  els.resizeRecordingWindowBtn.title = "Exit the 1280x720 map view";
  reportTheaterModeSize();
}

export function exitTheaterMode() {
  state.theaterMode = false;
  els.mapViewport.classList.remove("theater-mode");
  els.resizeRecordingWindowBtn.setAttribute("aria-pressed", "false");
  els.resizeRecordingWindowBtn.title = "Frame the map at exactly 1280x720 px for recording";
  if (state.route.length) renderProfile();
}

export function closeTheaterModeOnOutsideClick(event) {
  if (state.theaterMode && !els.mapViewport.contains(event.target)) {
    exitTheaterMode();
  }
}

function currentMapViewportPixelSize() {
  const rect = els.mapViewport.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function recordingMapViewportIsSized(size) {
  return Math.abs(size.width - RECORDING_MAP_VIEWPORT_WIDTH_PIXELS) <= RECORDING_MAP_VIEWPORT_TOLERANCE_PIXELS
    && Math.abs(size.height - RECORDING_MAP_VIEWPORT_HEIGHT_PIXELS) <= RECORDING_MAP_VIEWPORT_TOLERANCE_PIXELS;
}

function reportTheaterModeSize() {
  if (state.route.length) renderProfile();

  const size = currentMapViewportPixelSize();
  if (recordingMapViewportIsSized(size)) {
    updateProgressLabel(
      `Map view set to ${RECORDING_MAP_VIEWPORT_WIDTH_PIXELS}x${RECORDING_MAP_VIEWPORT_HEIGHT_PIXELS} px.`,
    );
    return;
  }

  updateProgressLabel(
    `Map view is ${size.width}x${size.height} px — enlarge the browser window to fit the full `
      + `${RECORDING_MAP_VIEWPORT_WIDTH_PIXELS}x${RECORDING_MAP_VIEWPORT_HEIGHT_PIXELS} view.`,
  );
}
