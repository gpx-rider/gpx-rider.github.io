// Camera debug overlay: a developer readout of the values the 3D map actually
// applies. It polls the live map camera (state.map.{tilt,range,heading,roll,
// fov,center}) on its own light interval while visible, so it keeps updating
// during a manual drag when nothing else is stepping the camera. Off by
// default; a diagnostics aid for reasoning about e.g. how far Google honours
// a requested tilt at a given range. When Orbit or a fly mode is the selected
// overview mode, it also draws that mode's travel path in red, even if the
// user has dragged the camera into manual mode.

import { cameraEyePosition } from "./camera.mjs";
import { createEllipseFlyby, createFigureEightFlyover } from "./flyby.mjs";
import { orbitPath } from "./flyover.mjs";
import { isFlyOverviewMode } from "./overview-camera.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { routeTotalDistance } from "../route/route.mjs";
import { registerHudComponent } from "../hud/screen-manager.mjs";
import { els, state } from "../core/state.mjs";
import {
  CAMERA_DEBUG_REFRESH_MS,
  ELLIPSE_FLYBY,
  OVERVIEW_DEBUG_LINE_ALTITUDE_METERS,
  OVERVIEW_DEBUG_LINE_COLOR,
  OVERVIEW_DEBUG_LINE_SAMPLE_COUNT,
  OVERVIEW_DEBUG_LINE_WIDTH,
} from "../core/tuning.mjs";

// The debug readout sits in the right column, under the map action bar.
export function registerCameraDebugHud() {
  registerHudComponent({ id: "camera-debug", region: "right", weight: 20, element: els.cameraDebug });
}

export function applyCameraDebug() {
  if (!els.cameraDebug) return;
  els.cameraDebug.hidden = !state.cameraDebugEnabled;
  els.cameraDebug.setAttribute("aria-hidden", String(!state.cameraDebugEnabled));
  els.cameraDebug.classList.toggle("collapsed", state.cameraDebugCollapsed);
  if (els.cameraDebugCollapseBtn) {
    const expanded = !state.cameraDebugCollapsed;
    els.cameraDebugCollapseBtn.setAttribute("aria-expanded", String(expanded));
    els.cameraDebugCollapseBtn.title = expanded ? "Collapse camera debug" : "Expand camera debug";
    els.cameraDebugCollapseBtn.setAttribute("aria-label", expanded ? "Collapse camera debug" : "Expand camera debug");
  }
  if (state.cameraDebugEnabled) {
    updateOverviewDebugLine();
    startCameraDebugLoop();
  } else {
    clearOverviewDebugLine();
  }
}

export function toggleCameraDebugCollapsed() {
  state.cameraDebugCollapsed = !state.cameraDebugCollapsed;
  saveSettings();
  applyCameraDebug();
  if (!state.cameraDebugCollapsed) renderCameraDebug();
}

export function updateOverviewDebugLine() {
  if (!state.cameraDebugEnabled || !state.map || !state.route.length) {
    clearOverviewDebugLine();
    return;
  }

  let path = null;
  let source = null;
  const mode = state.activeOverviewMode ?? state.overviewMode;
  const route = state.overviewRoute ?? state.route;
  if (mode === "orbit") {
    source = state.overviewCamera;
    path = orbitPath(state.overviewCamera, {
      altitudeMeters: OVERVIEW_DEBUG_LINE_ALTITUDE_METERS,
      sampleCount: OVERVIEW_DEBUG_LINE_SAMPLE_COUNT,
    });
  } else if (isFlyOverviewMode(mode)) {
    // Only reuse the live driver when it's for the *current* mode; during a mode
    // switch state.overviewAnim still holds the previous mode's driver (its
    // replacement is built moments later), so build a fresh one for the newly
    // selected mode or the debug line would draw one pattern behind.
    const anim = state.overviewAnim;
    const flyby = anim && anim.mode === mode && anim.flyby
      ? anim.flyby
      : (mode === "flyover"
        ? createFigureEightFlyover(route, ELLIPSE_FLYBY)
        : createEllipseFlyby(route, ELLIPSE_FLYBY));
    source = route;
    path = flyby?.pathAtAltitude(OVERVIEW_DEBUG_LINE_ALTITUDE_METERS, OVERVIEW_DEBUG_LINE_SAMPLE_COUNT);
  }

  if (!path?.length || !source) {
    clearOverviewDebugLine();
    return;
  }
  if (
    state.overviewDebugLine &&
    state.overviewDebugLineMode === mode &&
    state.overviewDebugLineSource === source
  ) {
    return;
  }

  clearOverviewDebugLine();
  const { AltitudeMode, Polyline3DElement } = state.maps3d ?? {};
  if (!Polyline3DElement) return;

  state.overviewDebugLine = new Polyline3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    path,
    strokeColor: OVERVIEW_DEBUG_LINE_COLOR,
    strokeWidth: OVERVIEW_DEBUG_LINE_WIDTH,
  });
  state.overviewDebugLineMode = mode;
  state.overviewDebugLineSource = source;
  state.map.append(state.overviewDebugLine);
}

export function clearOverviewDebugLine() {
  if (state.overviewDebugLine) state.overviewDebugLine.remove();
  state.overviewDebugLine = null;
  state.overviewDebugLineMode = null;
  state.overviewDebugLineSource = null;
}

function startCameraDebugLoop() {
  if (state.cameraDebugTimer) return;
  const step = () => {
    if (!state.cameraDebugEnabled) {
      state.cameraDebugTimer = null;
      return;
    }
    renderCameraDebug();
    state.cameraDebugTimer = setTimeout(step, CAMERA_DEBUG_REFRESH_MS);
  };
  step();
}

// True while the user has an active (non-collapsed) text selection inside the
// debug box — so the refresh loop can leave the DOM alone and not wipe a
// selection mid-copy.
function hasSelectionInCameraDebug() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !els.cameraDebug) return false;
  return els.cameraDebug.contains(selection.anchorNode) || els.cameraDebug.contains(selection.focusNode);
}

function renderCameraDebug() {
  const body = els.cameraDebugBody;
  if (!body) return;
  if (state.cameraDebugCollapsed) return;

  // Rebuilding the rows would clear an in-progress selection; freeze the
  // readout while the user is selecting text to copy.
  if (hasSelectionInCameraDebug()) return;

  const map = state.map;
  const tilt = Number(map?.tilt);
  const range = Number(map?.range);
  const heading = Number(map?.heading);
  const roll = Number(map?.roll);
  const fov = Number(map?.fov);
  const center = map?.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const centerAlt = Number(center?.altitude);
  const eye = map ? cameraEyePosition({ center, range, tilt, heading }) : null;
  const totalDistance = routeTotalDistance(state.route);

  const num = (value, digits, suffix = "") =>
    (Number.isFinite(value) ? value.toFixed(digits) : "—") + (Number.isFinite(value) ? suffix : "");

  const flyby = state.overviewAnim?.flyby;
  const rows = [
    ["mode", state.cameraMode === "overview" ? `overview·${state.activeOverviewMode}` : state.cameraMode],
    ["tilt", num(tilt, 1, "°")],
    ["range", num(range, 0, " m")],
    ["heading", num(heading, 1, "°")],
    ["roll", num(roll, 1, "°")],
    ["fov", num(fov, 1, "°")],
    ["eye alt", num(eye?.altitude, 0, " m")],
    ["ctr alt", num(centerAlt, 0, " m")],
    ["ctr lat", num(lat, 5)],
    ["ctr lng", num(lng, 5)],
    ["progress", `${(state.progressMeters / 1000).toFixed(2)} / ${(totalDistance / 1000).toFixed(2)} km`],
  ];
  if (flyby) {
    const speed = flyby.speedAt(state.overviewAnim.s);
    const frame = state.overviewAnim.lastFrame ?? flyby.frameAt(state.overviewAnim.s);
    rows.push(["fly speed", `${num(speed, 1)} m/s · ${num(speed * 3.6, 0)} km/h`]);
    rows.push(["fly max", `${num(frame.maxSpeedMps, 1)} m/s · ${num(frame.maxSpeedMps * 3.6, 0)} km/h`]);
    rows.push(["target lap", num(frame.targetLapSeconds, 0, " s")]);
    rows.push(["fly height", num(frame.flyHeightMeters, 0, " m")]);
    rows.push(["terrain high", num(frame.highestTerrainAltitudeMeters, 0, " m")]);
    // Elevation profile of the whole flight path from online terrain: the
    // highest ground sampled along it and how many path points were covered
    // (— when online terrain is off or no tile has loaded, so the height falls
    // back to the route-based estimate above).
    rows.push(["path terrain", num(frame.pathTerrainSampledMeters, 0, " m")]);
    rows.push(["path pts", `${frame.pathTerrainSampleCount ?? 0}`]);
    rows.push(["terrain clr", num(frame.terrainClearanceMeters, 0, " m")]);
    rows.push(["fly fov", num(frame.cameraFovDegrees, 1, "°")]);
    rows.push(["fly inward", num(frame.inwardLookDegrees, 1, "°")]);
    rows.push(["fly inward now", num(frame.currentInwardLookDegrees, 1, "°")]);
    rows.push(["turn radius", num(frame.turnRadiusMeters, 0, " m")]);
    rows.push(["bank", num(frame.bankDegrees, 1, "°")]);
    rows.push(["lap", num(flyby.lapSeconds, 0, " s")]);
  }

  body.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
}
