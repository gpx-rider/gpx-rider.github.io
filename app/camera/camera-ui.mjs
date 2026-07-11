// Camera UI wiring: the map action bar's overview / climb-overview / camera-
// view split controls and their dropdown menus, the camera sliders in
// Settings › Camera & view, the first-person preset, and the reset-camera
// button state. The camera *drivers* live in follow-camera.mjs and
// overview-camera.mjs; this module only reads/writes settings state and
// delegates to them.

import { normalizeHeading } from "./camera.mjs";
import { updateOverviewDebugLine } from "./camera-debug.mjs";
import { focusedRouteRange } from "../route/climbs-ui.mjs";
import { clamp } from "../core/geo.mjs";
import { enterOverviewMode, returnToRiderCamera } from "./overview-camera.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { sliceRoute } from "../route/route.mjs";
import { removeRiderMarker } from "../map/route-render.mjs";
import { els, state } from "../core/state.mjs";
import {
  CAMERA_TILT_MAX,
  CAMERA_TILT_MIN,
  CLIMB_ORBIT_SECONDS_PER_REV_MAX,
  CLIMB_ORBIT_SECONDS_PER_REV_MIN,
  DEFAULT_CAMERA_ANGLE_DEGREES,
  DEFAULT_CAMERA_BEHIND_METERS,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_CLIMB_FOCUS_MODE,
  DEFAULT_CLIMB_ORBIT_SECONDS_PER_REV,
  DEFAULT_OVERVIEW_MODE,
  FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS,
  FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS,
  FIRST_PERSON_CAMERA_TILT_DEGREES,
  FIRST_PERSON_LOOK_AHEAD_METERS,
} from "../core/tuning.mjs";

export function syncCameraControls() {
  // Sliders display a rounded view, but the precise captured values stay in
  // state so resuming the follow camera does not snap.
  els.cameraZoomInput.value = String(Math.round(state.cameraZoom * 10) / 10);
  els.cameraAngleInput.value = String(Math.round(state.cameraAngleDegrees));
  els.cameraBehindInput.value = String(Math.round(state.cameraBehindMeters / 20) * 20);
  els.firstPersonHeightInput.min = String(FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS);
  els.firstPersonHeightInput.max = String(FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS);
  els.firstPersonHeightInput.value = String(Math.round(state.firstPersonCameraHeightMeters * 10) / 10);
  els.overviewModeSelect.value = state.overviewMode;
  els.climbFocusModeSelect.value = state.climbFocusMode;
  els.climbOrbitSpeedInput.value = String(state.climbOrbitSecondsPerRev);
  els.climbOrbitSpeedOutput.value = `${state.climbOrbitSecondsPerRev} s/lap`;
  syncOverviewControls();
}

// The overview mode is a display choice, not a follow-camera parameter, so it
// re-frames the route immediately when at rest (so the user sees the mode take
// effect) but never disturbs an in-progress ride.
export function updateOverviewModeFromControl() {
  state.overviewMode = normalizeOverviewMode(els.overviewModeSelect.value);
  saveSettings();
  updateOverviewDebugLine();
  syncOverviewControls();
  // Reframe immediately only if the overview is already showing; the settings
  // select changes the style but never activates the overview by itself.
  if (state.overviewActive && state.route.length) {
    enterOverviewMode();
  }
}

export function updateClimbFocusModeFromControl() {
  state.climbFocusMode = normalizeClimbFocusMode(els.climbFocusModeSelect.value);
  saveSettings();
  if (focusedRouteRange() && state.overviewActive) {
    const range = focusedRouteRange();
    const route = range && sliceRoute(
      state.route,
      range.startDistanceMeters,
      range.endDistanceMeters,
    );
    if (route?.length > 1) {
      enterOverviewMode({ route, mode: state.climbFocusMode });
    }
  }
}

export function updateClimbOrbitSpeedFromControl() {
  const previous = state.climbOrbitSecondsPerRev;
  state.climbOrbitSecondsPerRev = clamp(
    Number(els.climbOrbitSpeedInput.value),
    CLIMB_ORBIT_SECONDS_PER_REV_MIN,
    CLIMB_ORBIT_SECONDS_PER_REV_MAX,
  );
  els.climbOrbitSpeedOutput.value = `${state.climbOrbitSecondsPerRev} s/lap`;

  // Preserve the current orbit phase while changing its pace, avoiding a
  // visible heading jump as the slider moves.
  const anim = state.overviewAnim;
  if (
    anim?.mode === "orbit" &&
    focusedRouteRange() &&
    state.overviewRoute !== state.route &&
    previous > 0
  ) {
    const now = performance.now();
    anim.startMs = now - (now - anim.startMs) * (state.climbOrbitSecondsPerRev / previous);
  }
  saveSettings();
}

export function toggleRouteOverview() {
  if (!state.route.length) {
    syncOverviewControls();
    return;
  }
  // A climb-focused camera is one level deeper than the whole-route overview:
  // its mountain button returns to that overview first. The plane button then
  // keeps its existing overview ↔ rider-camera behavior.
  const rangeFocused =
    state.overviewActive &&
    focusedRouteRange() &&
    state.overviewRoute !== state.route;
  if (rangeFocused) enterOverviewMode();
  else if (state.overviewActive) returnToRiderCamera();
  else enterOverviewMode();
}

export function toggleOverviewModeMenu(event) {
  event.stopPropagation();
  state.overviewMenuOpen = !state.overviewMenuOpen;
  syncOverviewControls();
}

export function toggleClimbOverviewModeMenu(event) {
  event.stopPropagation();
  state.climbOverviewMenuOpen = !state.climbOverviewMenuOpen;
  syncOverviewControls();
}

export function toggleCameraViewMenu(event) {
  event.stopPropagation();
  state.cameraViewMenuOpen = !state.cameraViewMenuOpen;
  syncResetCameraButton();
}

export function closeOverviewModeMenu() {
  if (!state.overviewMenuOpen) return;
  state.overviewMenuOpen = false;
  syncOverviewControls();
}

export function closeCameraViewMenu() {
  if (!state.cameraViewMenuOpen) return;
  state.cameraViewMenuOpen = false;
  syncResetCameraButton();
}

function closeClimbOverviewModeMenu() {
  if (!state.climbOverviewMenuOpen) return;
  state.climbOverviewMenuOpen = false;
  syncOverviewControls();
}

export function closeOverviewModeMenuOnOutsideClick(event) {
  if (state.overviewMenuOpen && !els.mapOverviewControl?.contains(event.target)) {
    closeOverviewModeMenu();
  }
  if (state.climbOverviewMenuOpen && !els.climbOverviewControl?.contains(event.target)) {
    closeClimbOverviewModeMenu();
  }
  if (state.cameraViewMenuOpen && !els.resetCameraControl?.contains(event.target)) {
    closeCameraViewMenu();
  }
}

export function selectOverviewModeFromMenu(event) {
  event.stopPropagation();
  const mode = normalizeOverviewMode(event.currentTarget.dataset.mapOverviewMode);
  state.overviewMode = mode;
  els.overviewModeSelect.value = mode;
  saveSettings();
  closeOverviewModeMenu();
  updateOverviewDebugLine();
  // Picking a style from the map dropdown activates the overview (parked or
  // riding — it's a deliberate choice), unlike the settings select.
  if (state.route.length) enterOverviewMode();
  else syncOverviewControls();
}

export function returnFromClimbOverview() {
  closeClimbOverviewModeMenu();
  if (state.route.length) enterOverviewMode();
}

export function selectClimbOverviewModeFromMenu(event) {
  event.stopPropagation();
  state.climbFocusMode = normalizeClimbFocusMode(event.currentTarget.dataset.mapClimbMode);
  els.climbFocusModeSelect.value = state.climbFocusMode;
  saveSettings();
  closeClimbOverviewModeMenu();

  const range = focusedRouteRange();
  const route = range && sliceRoute(
    state.route,
    range.startDistanceMeters,
    range.endDistanceMeters,
  );
  if (route?.length > 1) {
    enterOverviewMode({ route, mode: state.climbFocusMode });
  }
}

export function selectCameraViewPresetFromMenu(event) {
  event.stopPropagation();
  const preset = event.currentTarget.dataset.cameraViewPreset;
  closeCameraViewMenu();
  if (preset === "firstPerson") {
    applyFirstPersonCameraView();
    return;
  }
  resetCameraView();
}

export function syncOverviewControls() {
  const hasRoute = state.route.length > 1;
  // The overview is always the user's to toggle when a route is loaded — even
  // while riding. It is never force-disabled by movement; movement only turns
  // it off automatically once (in ensureMovementLoop).
  const canToggle = hasRoute;
  const active = hasRoute && state.overviewActive;
  const rangeFocused =
    active &&
    focusedRouteRange() &&
    state.overviewRoute !== state.route;

  const routeOverviewActive = active && !rangeFocused;
  els.mapOverviewControl.classList.toggle("active", routeOverviewActive);
  els.overviewToggleBtn.disabled = !canToggle;
  els.overviewToggleBtn.setAttribute("aria-pressed", String(routeOverviewActive));
  const toggleLabel = routeOverviewActive ? "Return to rider camera" : "Show route overview";
  els.overviewToggleBtn.title = toggleLabel;
  els.overviewToggleBtn.setAttribute("aria-label", toggleLabel);

  els.overviewMenuBtn.disabled = !hasRoute;
  els.overviewMenuBtn.setAttribute("aria-expanded", String(state.overviewMenuOpen));
  els.overviewModeMenu.hidden = !state.overviewMenuOpen;
  els.overviewModeButtons.forEach((button) => {
    const checked = normalizeOverviewMode(button.dataset.mapOverviewMode) === state.overviewMode;
    button.setAttribute("aria-checked", String(checked));
  });

  els.climbOverviewControl.hidden = !rangeFocused;
  els.climbOverviewControl.classList.toggle("active", rangeFocused);
  els.climbOverviewControl.classList.toggle("segment-focus", Boolean(rangeFocused && state.selectedProfileSegment));
  els.climbOverviewToggleBtn.setAttribute("aria-pressed", String(rangeFocused));
  els.climbOverviewMenuBtn.setAttribute("aria-expanded", String(state.climbOverviewMenuOpen));
  els.climbOverviewModeMenu.hidden = !state.climbOverviewMenuOpen || !rangeFocused;
  els.climbOverviewModeButtons.forEach((button) => {
    const checked = normalizeClimbFocusMode(button.dataset.mapClimbMode) === state.climbFocusMode;
    button.setAttribute("aria-checked", String(checked));
  });

  syncResetCameraButton();
}

// True when the camera is exactly where "Reset camera" would leave it — all
// follow-camera offsets at their defaults and no manual takeover in effect —
// so pressing reset would change nothing.
function cameraAtDefaults() {
  return state.cameraMode !== "manual" &&
    state.cameraZoom === DEFAULT_CAMERA_ZOOM &&
    state.cameraAngleDegrees === DEFAULT_CAMERA_ANGLE_DEGREES &&
    state.cameraBehindMeters === DEFAULT_CAMERA_BEHIND_METERS &&
    state.cameraHeadingOffsetDegrees === 0 &&
    state.cameraOffsetForwardMeters === 0 &&
    state.cameraOffsetRightMeters === 0 &&
    state.cameraCenterAltitudeOffsetMeters === 0;
}

function firstPersonCameraPreset() {
  const tilt = clamp(FIRST_PERSON_CAMERA_TILT_DEGREES, CAMERA_TILT_MIN, CAMERA_TILT_MAX);
  return {
    cameraZoom: 1,
    cameraAngleDegrees: tilt,
    cameraBehindMeters: FIRST_PERSON_LOOK_AHEAD_METERS,
    cameraHeadingOffsetDegrees: 0,
    cameraOffsetForwardMeters: FIRST_PERSON_LOOK_AHEAD_METERS,
    cameraOffsetRightMeters: 0,
    cameraCenterAltitudeOffsetMeters: 0,
    centerRider: false,
  };
}

export function isFirstPersonCameraView() {
  return state.cameraViewPreset === "firstPerson" &&
    state.cameraMode !== "manual" &&
    !state.overviewActive;
}

function cameraAtFirstPerson() {
  return isFirstPersonCameraView();
}

// The reset-camera button is only usable when it would actually do something:
// disabled while the camera is already at its defaults, enabled once the user
// has moved it (a drag captures new offsets, or leaves the camera in manual).
export function syncResetCameraButton() {
  const hasRoute = state.route.length > 1;
  if (els.resetCameraViewBtn) els.resetCameraViewBtn.disabled = cameraAtDefaults();
  if (els.cameraViewMenuBtn) {
    els.cameraViewMenuBtn.disabled = !hasRoute;
    els.cameraViewMenuBtn.setAttribute("aria-expanded", String(state.cameraViewMenuOpen));
  }
  if (els.cameraViewMenu) els.cameraViewMenu.hidden = !state.cameraViewMenuOpen;
  if (els.resetCameraControl) els.resetCameraControl.classList.toggle("active", cameraAtFirstPerson());
  els.cameraViewButtons?.forEach((button) => {
    const preset = button.dataset.cameraViewPreset;
    const checked = preset === "firstPerson" ? cameraAtFirstPerson() : cameraAtDefaults();
    button.setAttribute("aria-checked", String(checked));
  });
}

export function normalizeOverviewMode(mode) {
  if (mode === "heli" || mode === "airplane") return "flyby";
  if (mode === "figure8" || mode === "eight") return "flyover";
  if (mode === "satellite-north") return "satellite"; // satellite is now north-up only
  return ["static", "orbit", "flyby", "flyover", "satellite"].includes(mode)
    ? mode
    : DEFAULT_OVERVIEW_MODE;
}

export function normalizeClimbFocusMode(mode) {
  return ["static", "orbit", "satellite"].includes(mode)
    ? mode
    : DEFAULT_CLIMB_FOCUS_MODE;
}

export function updateCameraSettingsLabels() {
  els.cameraZoomOutput.value = `${state.cameraZoom.toFixed(1)}x`;
  els.cameraAngleOutput.value = `${Math.round(state.cameraAngleDegrees)} deg`;
  els.cameraBehindOutput.value = `${Math.round(state.cameraBehindMeters)} m`;
  els.firstPersonHeightOutput.value = `${state.firstPersonCameraHeightMeters.toFixed(1)} m`;
  const range = Number(state.map?.range);
  const heading = Number(state.map?.heading);
  els.cameraReadout.value = [
    `zoom ${state.cameraZoom.toFixed(1)}x`,
    `tilt ${Math.round(state.cameraAngleDegrees)} deg`,
    `behind ${Math.round(state.cameraBehindMeters)} m`,
    `range ${Number.isFinite(range) ? `${Math.round(range)} m` : "--"}`,
    `heading ${Number.isFinite(heading) ? `${Math.round(normalizeHeading(heading))} deg` : "--"}`,
    `offset ${Math.round(state.cameraHeadingOffsetDegrees)} deg`,
    `pan F ${Math.round(state.cameraOffsetForwardMeters)} m`,
    `R ${Math.round(state.cameraOffsetRightMeters)} m`,
    `alt Δ ${Math.round(state.cameraCenterAltitudeOffsetMeters)} m`,
    `1st ${state.firstPersonCameraHeightMeters.toFixed(1)} m`,
  ].join("  ");
}

export function updateCameraSettingsFromControls() {
  state.cameraViewPreset = null;
  state.cameraZoom = Number(els.cameraZoomInput.value);
  state.cameraAngleDegrees = Number(els.cameraAngleInput.value);
  state.cameraBehindMeters = Number(els.cameraBehindInput.value);
  updateCameraSettingsLabels();
  syncResetCameraButton();
  saveSettings();

  updateRideUi();
}

export function updateFirstPersonHeightFromControl() {
  const wasFirstPerson = cameraAtFirstPerson();
  state.firstPersonCameraHeightMeters = clamp(
    Number(els.firstPersonHeightInput.value),
    FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS,
    FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS,
  );
  updateCameraSettingsLabels();
  saveSettings();

  if (wasFirstPerson) {
    applyFirstPersonCameraView();
  }
}

function resetCameraToDefaults() {
  state.cameraViewPreset = null;
  state.cameraZoom = DEFAULT_CAMERA_ZOOM;
  state.cameraAngleDegrees = DEFAULT_CAMERA_ANGLE_DEGREES;
  state.cameraBehindMeters = DEFAULT_CAMERA_BEHIND_METERS;
  state.cameraHeadingOffsetDegrees = 0;
  state.cameraOffsetForwardMeters = 0;
  state.cameraOffsetRightMeters = 0;
  state.cameraCenterAltitudeOffsetMeters = 0;
  state.climbFocusMode = DEFAULT_CLIMB_FOCUS_MODE;
  state.climbOrbitSecondsPerRev = DEFAULT_CLIMB_ORBIT_SECONDS_PER_REV;

  syncCameraControls();
  updateCameraSettingsLabels();
  saveSettings();

  updateRideUi();
}

export function applyFirstPersonCameraView() {
  const preset = firstPersonCameraPreset();
  state.cameraViewPreset = "firstPerson";
  state.cameraZoom = preset.cameraZoom;
  state.cameraAngleDegrees = preset.cameraAngleDegrees;
  state.cameraBehindMeters = preset.cameraBehindMeters;
  state.cameraHeadingOffsetDegrees = preset.cameraHeadingOffsetDegrees;
  state.cameraOffsetForwardMeters = preset.cameraOffsetForwardMeters;
  state.cameraOffsetRightMeters = preset.cameraOffsetRightMeters;
  state.cameraCenterAltitudeOffsetMeters = preset.cameraCenterAltitudeOffsetMeters;
  state.centerRider = preset.centerRider;
  state.cameraFlight = null;

  syncCameraControls();
  syncCenterRiderButton();
  updateCameraSettingsLabels();
  saveSettings();
  removeRiderMarker();

  if (state.route.length) returnToRiderCamera();
  else updateRideUi();
}

// The map-action-bar shortcut for resetCameraToDefaults. It is fully decoupled
// from the overview: it only resets the manual follow-camera adjustments and,
// if the rider camera is the active surface, flies it back into place. An
// active overview is left untouched (the reset never activates or deactivates
// it) — the overview control is the only thing that toggles the overview.
export function resetCameraView() {
  closeCameraViewMenu();
  resetCameraToDefaults();
  if (!state.route.length || state.overviewActive) return;
  returnToRiderCamera();
}

export function updateCenterRiderFromControl() {
  state.cameraViewPreset = null;
  state.centerRider = els.centerRiderInput.checked;
  if (state.centerRider) {
    state.cameraOffsetForwardMeters = 0;
    state.cameraOffsetRightMeters = 0;
    state.cameraCenterAltitudeOffsetMeters = 0;
  }
  syncCenterRiderButton();
  saveSettings();
  updateCameraSettingsLabels();

  updateRideUi();
}

// The map-corner toggle mirrors the settings checkbox; aria-pressed drives
// its dimmed/lit styling.
export function syncCenterRiderButton() {
  els.centerRiderBtn.setAttribute("aria-pressed", String(state.centerRider));
}
