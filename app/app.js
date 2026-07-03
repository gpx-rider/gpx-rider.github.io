// GPX Rider entry point — orchestrates the modules in this folder: keeps the
// app state, wires DOM events, drives the 3D map + follow camera, and runs
// the movement loop that advances the rider from trainer speed (pedaling) or
// the simulation slider.

import {
  cameraDistanceToPoint,
  computeFollowCamera,
  measureCameraOffset,
  normalizeHeading,
  rangeForBehind,
  signedHeadingDelta,
} from "./camera.mjs";
import { bearing, clamp, destinationPoint, haversine, roundCoordinate, toRad } from "./geo.mjs";
import { densifyRoute, enrichRoute, gradeAt, interpolateRoutePoint, parseGpx, routeTotalDistance } from "./route.mjs";
import { distanceAtProfileX, drawEmptyProfile, drawProfile } from "./profile.mjs";
import { formatAltitude, formatDistance, formatDuration, formatEnergy, formatSpeed } from "./units.mjs";
import { readJson, removeStored, writeJson } from "./storage.mjs";
import {
  GRADE_INTERVAL_MAX_SECONDS,
  GRADE_INTERVAL_MIN_SECONDS,
  OP_START_OR_RESUME,
  OP_STOP_OR_PAUSE,
  connectTrainer,
  initTrainer,
  queueTrainerGradeSample,
  reconnectSavedTrainer,
  sendTrainerCommand,
  sendTrainerGrade,
} from "./trainer.mjs";
import { connectHeartRate, initHeartRate, reconnectSavedHeartRate } from "./heartrate.mjs";
import {
  clearRideLog,
  hasRideData,
  persistRideLog,
  recordRideTick,
  restoreRideLog,
  rideLogSamples,
  rideLogSummary,
} from "./recorder.mjs";
import { encodeFitActivity } from "./fit.mjs";
import { initGallery } from "./gallery.mjs";

const MAPS_API_KEY_STORAGE_KEY = "gpx-rider:maps-api-key";
const SETTINGS_STORAGE_KEY = "gpx-rider:settings";
const RIDE_STORAGE_KEY = "gpx-rider:last-ride";

const DEFAULT_CAMERA_ZOOM = 2.5;
const DEFAULT_CAMERA_ANGLE_DEGREES = 75;
const DEFAULT_CAMERA_BEHIND_METERS = 800;
const HEADING_SAMPLE_METERS = 4;
const INTERACTION_SETTLE_MS = 600;
const CAMERA_ZOOM_MIN = 0.05;
const CAMERA_ZOOM_MAX = 20;
const CAMERA_PAN_LIMIT_METERS = 5000;
const CAMERA_CENTER_ALTITUDE_LIMIT_METERS = 3000;
const CAMERA_TILT_MIN = 1;
const CAMERA_TILT_MAX = 89;
const DEFAULT_GRADE_INTERVAL_SECONDS = 2;

// Pedaling detection with hysteresis so a spinning-down flywheel does not
// flap the movement source on/off around a single threshold.
const PEDALING_START_KPH = 3;
const PEDALING_STOP_KPH = 1;
// A backgrounded tab stops requestAnimationFrame; without this cap the first
// frame after returning would teleport the rider minutes down the road.
const MAX_TICK_SECONDS = 5;

// Route line rendering: the line floats slightly above the terrain instead of
// being draped onto it (see renderGoogle3DRoute), so segments between points
// must stay short enough to follow the ground. Spacing grows on very long
// routes to cap the total vertex count the map engine has to handle.
const ROUTE_LINE_ALTITUDE_METERS = 2.5;
const ROUTE_LINE_SPACING_METERS = 15;
const ROUTE_LINE_MAX_POINTS = 5000;

const state = {
  route: [],
  progressMeters: 0,
  simulating: false,
  pedaling: false,
  movementLoopActive: false,
  tickRaf: null,
  tickTimeout: null,
  lastTick: 0,
  line: null,
  routeOutline: null,
  riderDot: null,
  riderDotOutline: null,
  riderHalo: null,
  map: null,
  mapProvider: null,
  maps3d: null,
  minimapMap: null,
  minimapPath: null,
  minimapMarker: null,
  trainerSpeedKph: null,
  trainerPowerWatts: null,
  trainerCaloriesKcal: null,
  trainerHeartRateBpm: null,
  strapHeartRateBpm: null,
  heartRateStatusText: null,
  gradeUpdateIntervalSeconds: DEFAULT_GRADE_INTERVAL_SECONDS,
  lastSlowUiAt: 0,
  lastRiderDot: null,
  lastRideSavedAt: 0,
  profileHoverMeters: null,
  userInteracting: false,
  interactionSettleTimer: null,
  interactionDotLoopActive: false,
  cameraZoom: DEFAULT_CAMERA_ZOOM,
  cameraAngleDegrees: DEFAULT_CAMERA_ANGLE_DEGREES,
  cameraBehindMeters: DEFAULT_CAMERA_BEHIND_METERS,
  cameraHeadingOffsetDegrees: 0,
  cameraOffsetForwardMeters: 0,
  cameraOffsetRightMeters: 0,
  cameraCenterAltitudeOffsetMeters: 0,
  centerRider: true,
  mapFullscreen: false,
  distanceUnits: "metric",
  energyUnits: "kcal",
};

const els = {
  mapsApiKeyInput: document.querySelector("#mapsApiKeyInput"),
  mapsApiKeySaveBtn: document.querySelector("#mapsApiKeySaveBtn"),
  gpxFile: document.querySelector("#gpxFile"),
  distanceStat: document.querySelector("#distanceStat"),
  gradeStat: document.querySelector("#gradeStat"),
  altitudeStat: document.querySelector("#altitudeStat"),
  powerStat: document.querySelector("#powerStat"),
  speedStat: document.querySelector("#speedStat"),
  trainerStat: document.querySelector("#trainerStat"),
  heartRateStat: document.querySelector("#heartRateStat"),
  caloriesStat: document.querySelector("#caloriesStat"),
  speedInput: document.querySelector("#speedInput"),
  speedOutput: document.querySelector("#speedOutput"),
  gradeIntervalInput: document.querySelector("#gradeIntervalInput"),
  gradeIntervalOutput: document.querySelector("#gradeIntervalOutput"),
  distanceUnitSelect: document.querySelector("#distanceUnitSelect"),
  energyUnitSelect: document.querySelector("#energyUnitSelect"),
  cameraZoomInput: document.querySelector("#cameraZoomInput"),
  cameraZoomOutput: document.querySelector("#cameraZoomOutput"),
  cameraAngleInput: document.querySelector("#cameraAngleInput"),
  cameraAngleOutput: document.querySelector("#cameraAngleOutput"),
  cameraBehindInput: document.querySelector("#cameraBehindInput"),
  cameraBehindOutput: document.querySelector("#cameraBehindOutput"),
  cameraReadout: document.querySelector("#cameraReadout"),
  centerRiderInput: document.querySelector("#centerRiderInput"),
  resetCameraBtn: document.querySelector("#resetCameraBtn"),
  connectBtn: document.querySelector("#connectBtn"),
  connectHrBtn: document.querySelector("#connectHrBtn"),
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  progress: document.querySelector("#progress"),
  progressLabel: document.querySelector("#progressLabel"),
  profile: document.querySelector("#profile"),
  mapViewport: document.querySelector("#mapViewport"),
  minimap: document.querySelector("#minimap"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
  fullscreenOverlayBottom: document.querySelector("#fullscreenOverlayBottom"),
  hudPowerStat: document.querySelector("#hudPowerStat"),
  hudSpeedStat: document.querySelector("#hudSpeedStat"),
  hudHeartRateStat: document.querySelector("#hudHeartRateStat"),
  hudGradeStat: document.querySelector("#hudGradeStat"),
  hudRiddenStat: document.querySelector("#hudRiddenStat"),
  hudRemainingStat: document.querySelector("#hudRemainingStat"),
  recDistanceStat: document.querySelector("#recDistanceStat"),
  recTimeStat: document.querySelector("#recTimeStat"),
  recPointsStat: document.querySelector("#recPointsStat"),
  recHeartRateStat: document.querySelector("#recHeartRateStat"),
  recCaloriesStat: document.querySelector("#recCaloriesStat"),
  downloadFitBtn: document.querySelector("#downloadFitBtn"),
  clearRideDataBtn: document.querySelector("#clearRideDataBtn"),
};

startApp();

async function startApp() {
  initTrainer({
    onTelemetry: handleTrainerTelemetry,
    onStatus: handleTrainerStatus,
    onMessage: updateProgressLabel,
  });
  initHeartRate({
    onHeartRate: handleStrapHeartRate,
    onStatus: handleHeartRateStatus,
    onMessage: updateProgressLabel,
  });

  restoreSettings();
  restoreRideLog();
  updateRecordingUi();
  els.mapsApiKeyInput.value = getStoredMapsApiKey();
  await initMap();
  bindEvents();
  restoreSavedRide();
  void reconnectSavedTrainer();
  void reconnectSavedHeartRate();
  void initGallery(loadGpxFromUrl);
}

function getStoredMapsApiKey() {
  return localStorage.getItem(MAPS_API_KEY_STORAGE_KEY) || "";
}

function saveMapsApiKey() {
  const key = els.mapsApiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(MAPS_API_KEY_STORAGE_KEY, key);
  } else {
    localStorage.removeItem(MAPS_API_KEY_STORAGE_KEY);
  }
  location.reload();
}

async function initMap() {
  const apiKey = getStoredMapsApiKey();
  if (!apiKey) {
    updateProgressLabel("Add your Google Maps API key above to load the map.");
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
    mode: MapMode?.SATELLITE,
    range: camera.range,
    tilt: camera.tilt,
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

function bindEvents() {
  els.mapsApiKeySaveBtn.addEventListener("click", saveMapsApiKey);
  els.mapsApiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveMapsApiKey();
    }
  });
  els.gpxFile.addEventListener("change", loadGpxFile);
  els.speedInput.addEventListener("input", () => {
    updateSpeedOutput();
    saveRide();
  });
  els.gradeIntervalInput.addEventListener("input", updateGradeIntervalFromControl);
  els.distanceUnitSelect.addEventListener("change", updateUnitsFromControls);
  els.energyUnitSelect.addEventListener("change", updateUnitsFromControls);
  els.cameraZoomInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraAngleInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraBehindInput.addEventListener("input", updateCameraSettingsFromControls);
  els.centerRiderInput.addEventListener("change", updateCenterRiderFromControl);
  els.resetCameraBtn.addEventListener("click", resetCameraToDefaults);
  els.connectBtn.addEventListener("click", connectTrainer);
  els.connectHrBtn.addEventListener("click", connectHeartRate);
  els.startBtn.addEventListener("click", toggleSimulation);
  els.resetBtn.addEventListener("click", resetRide);
  els.downloadFitBtn.addEventListener("click", downloadFitFile);
  els.clearRideDataBtn.addEventListener("click", confirmClearRideData);
  els.profile.addEventListener("mousemove", handleProfileHover);
  els.profile.addEventListener("mouseleave", handleProfileLeave);
  els.profile.addEventListener("click", handleProfileClick);
  els.fullscreenBtn.addEventListener("click", toggleMapFullscreen);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mapFullscreen) exitMapFullscreen();
  });
  window.addEventListener("beforeunload", () => {
    saveRide();
    persistRideLog();
  });
}

async function loadGpxFile(event) {
  const [file] = event.target.files;
  if (!file) return;

  const text = await file.text();
  applyGpxText(text);
}

async function loadGpxFromUrl(url) {
  const response = await fetch(url);
  const text = await response.text();
  applyGpxText(text);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyGpxText(text) {
  const route = parseGpx(text);

  if (route.length < 2) {
    updateProgressLabel("That GPX file does not contain enough track points.");
    return;
  }

  state.route = enrichRoute(route);
  state.progressMeters = 0;
  state.simulating = false;
  state.lastTick = 0;
  state.profileHoverMeters = null;
  updateStartButton();
  renderRoute();
  renderProfile();
  updateRideUi({ force: true });
  saveRide();

  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
}

function renderRoute() {
  renderMinimapRoute();

  if (!state.map) {
    updateProgressLabel("Photorealistic 3D Maps are not available, so the route cannot be displayed.");
    return;
  }

  clearRouteFromMap();
  const currentPoint = interpolateRoutePoint(state.route, state.progressMeters);
  renderGoogle3DRoute(currentPoint);
}

function renderMinimapRoute() {
  if (!state.minimapMap || !state.route.length) return;

  if (state.minimapPath) state.minimapPath.setMap(null);

  const path = state.route.map((point) => ({ lat: point.lat, lng: point.lng }));
  state.minimapPath = new google.maps.Polyline({
    path,
    map: state.minimapMap,
    strokeColor: "#0a84ff",
    strokeOpacity: 0.95,
    strokeWeight: 3,
  });

  const bounds = new google.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  state.minimapMap.fitBounds(bounds, 18);

  if (!state.minimapMarker) {
    state.minimapMarker = new google.maps.Marker({
      map: state.minimapMap,
      clickable: false,
      zIndex: 10,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: "#0a84ff",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });
  }

  updateMinimapPosition(state.route[0]);
}

function updateMinimapPosition(point) {
  if (!state.minimapMarker) return;
  state.minimapMarker.setPosition({ lat: point.lat, lng: point.lng });
}

function renderGoogle3DRoute(currentPoint) {
  const { AltitudeMode, Polyline3DElement } = state.maps3d;

  // CLAMP_TO_GROUND drapes the stroke onto the terrain mesh like a decal, so
  // on steep slopes the line smears down the hillside into wide blobs. A line
  // held a couple of meters above the ground renders with a constant
  // screen-pixel width instead. Densify the path so the elevated segments
  // stay short enough to follow the terrain between GPX points.
  const spacing = Math.max(ROUTE_LINE_SPACING_METERS, routeTotalDistance(state.route) / ROUTE_LINE_MAX_POINTS);
  const linePoints = densifyRoute(state.route, spacing);
  const pathAt = (altitude) => linePoints.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    altitude,
  }));

  if (Polyline3DElement) {
    // The outline sits a touch lower than the line so the two never z-fight.
    state.routeOutline = new Polyline3DElement({
      altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
      path: pathAt(ROUTE_LINE_ALTITUDE_METERS - 0.4),
      strokeColor: "rgba(255, 255, 255, 0.72)",
      strokeWidth: 14,
    });
    state.map.append(state.routeOutline);

    state.line = new Polyline3DElement({
      altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
      path: pathAt(ROUTE_LINE_ALTITUDE_METERS),
      strokeColor: "#0a84ff",
      strokeWidth: 9,
    });
    state.map.append(state.line);
  }

  renderRiderDot(currentPoint);
  updateMapCamera({ lat: currentPoint.lat, lng: currentPoint.lng, ele: currentPoint.ele });
}

function renderRiderDot(point) {
  const { AltitudeMode, Polygon3DElement, Polyline3DElement } = state.maps3d;

  if (Polygon3DElement) {
    const styles = [
      ["riderHalo", "rgba(10, 132, 255, 0.22)"],
      ["riderDotOutline", "#ffffff"],
      ["riderDot", "#0a84ff"],
    ];
    styles.forEach(([key, fillColor]) => {
      state[key] = new Polygon3DElement({
        altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
        fillColor,
        strokeWidth: 0,
      });
      state.map.append(state[key]);
    });
    updateRiderDot(point);
    return;
  }

  if (!Polyline3DElement) return;
  const radius = riderDotRadiusMeters(point);
  state.riderDotOutline = new Polyline3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    path: riderCircleCoordinates(point, radius, 1),
    strokeColor: "#ffffff",
    strokeWidth: 10,
  });
  state.map.append(state.riderDotOutline);

  state.riderDot = new Polyline3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    path: riderCircleCoordinates(point, radius, 1.2),
    strokeColor: "#0a84ff",
    strokeWidth: 6,
  });
  state.map.append(state.riderDot);
}

function riderDotRadiusMeters(position) {
  // The dot is ground geometry sized in meters, so to read like a fixed-size
  // GPS marker its radius must track the camera-eye distance to the dot
  // itself — not the range to the look-at center, which is wrong the moment
  // the rider is off-center, and not a tightly clamped value, which visibly
  // grows/shrinks the dot at the clamp edges when zooming far in or out.
  const distance = cameraDistanceToPoint({
    center: state.map?.center,
    range: state.map?.range,
    tilt: state.map?.tilt,
    heading: state.map?.heading,
  }, position);
  return clamp((distance ?? 800) / 90, 0.5, 20000);
}

function clearRouteFromMap() {
  if (state.routeOutline) state.routeOutline.remove();
  if (state.line) state.line.remove();
  if (state.riderHalo) state.riderHalo.remove();
  if (state.riderDotOutline) state.riderDotOutline.remove();
  if (state.riderDot) state.riderDot.remove();

  state.routeOutline = null;
  state.line = null;
  state.riderHalo = null;
  state.riderDotOutline = null;
  state.riderDot = null;
  state.lastRiderDot = null;
}

// --- Movement: simulation button + pedaling detection -----------------------
//
// Two independent movement sources drive the rider along the route:
// 1. Pedaling — the trainer reports real speed; always wins when present.
// 2. Simulation — the slider speed, toggled by the Start/Stop simulation
//    button, for previewing a route without pedaling.
// Starting to pedal stops a running simulation; the map then follows trainer
// speed and stops when the rider stops pedaling.

function isMoving() {
  return state.simulating || state.pedaling;
}

function toggleSimulation() {
  if (state.simulating) {
    state.simulating = false;
    updateStartButton();
    void sendTrainerCommand(OP_STOP_OR_PAUSE, [0x02]);
    if (!state.pedaling) handleMovementStopped();
    return;
  }

  if (state.route.length < 2) return;
  if (state.pedaling) {
    updateProgressLabel("You're pedaling — the ride is already following trainer speed.");
    return;
  }

  if (state.progressMeters >= routeTotalDistance(state.route)) {
    state.progressMeters = 0;
  }
  state.simulating = true;
  updateStartButton();
  void sendTrainerCommand(OP_START_OR_RESUME);
  ensureMovementLoop();
}

function updateStartButton() {
  els.startBtn.textContent = state.simulating ? "Stop simulation" : "Start simulation";
}

function updatePedalingFromSpeed() {
  const speed = state.trainerSpeedKph;
  if (!Number.isFinite(speed)) {
    setPedaling(false);
    return;
  }
  if (!state.pedaling && speed >= PEDALING_START_KPH) setPedaling(true);
  else if (state.pedaling && speed <= PEDALING_STOP_KPH) setPedaling(false);
}

function setPedaling(pedaling) {
  if (pedaling === state.pedaling) return;
  state.pedaling = pedaling;

  if (pedaling) {
    if (state.simulating) {
      state.simulating = false;
      updateStartButton();
      updateProgressLabel("Pedaling detected — simulation stopped, following trainer speed.");
    }
    ensureMovementLoop();
  } else if (!state.simulating) {
    handleMovementStopped();
  }
}

function ensureMovementLoop() {
  if (state.movementLoopActive || state.route.length < 2) return;
  state.movementLoopActive = true;
  state.lastTick = performance.now();
  scheduleTick();
}

// requestAnimationFrame stops in hidden tabs, which would freeze the ride —
// and the recording — while the user is pedaling with another tab focused.
// Fall back to a coarse timeout whenever the page is hidden.
function scheduleTick() {
  cancelScheduledTick();
  if (document.hidden) {
    state.tickTimeout = window.setTimeout(() => tick(performance.now()), 500);
  } else {
    state.tickRaf = requestAnimationFrame(tick);
  }
}

function cancelScheduledTick() {
  if (state.tickRaf !== null) cancelAnimationFrame(state.tickRaf);
  if (state.tickTimeout !== null) window.clearTimeout(state.tickTimeout);
  state.tickRaf = null;
  state.tickTimeout = null;
}

function handleVisibilityChange() {
  // A pending rAF from before the tab was hidden only fires once the tab is
  // visible again; reschedule so the loop keeps ticking either way.
  if (state.movementLoopActive) scheduleTick();
}

function handleMovementStopped() {
  saveRide();
  persistRideLog();
  updateRecordingUi();
}

function resetRide() {
  state.simulating = false;
  state.progressMeters = 0;
  state.lastTick = performance.now();
  updateStartButton();
  updateRideUi({ force: true });
  saveRide();
  void sendTrainerGrade(0);
}

function tick(now) {
  if (!isMoving() || state.route.length < 2) {
    state.movementLoopActive = false;
    return;
  }

  const elapsedSeconds = clamp((now - state.lastTick) / 1000, 0, MAX_TICK_SECONDS);
  state.lastTick = now;
  const speedKph = state.pedaling && Number.isFinite(state.trainerSpeedKph)
    ? state.trainerSpeedKph
    : Number(els.speedInput.value);
  const metersPerSecond = speedKph / 3.6;
  const totalDistance = routeTotalDistance(state.route);

  const previousProgress = state.progressMeters;
  state.progressMeters = Math.min(totalDistance, state.progressMeters + metersPerSecond * elapsedSeconds);

  recordRideTick({
    elapsedSeconds,
    metersAdvanced: state.progressMeters - previousProgress,
    point: interpolateRoutePoint(state.route, state.progressMeters),
    speedKph,
    powerWatts: state.trainerPowerWatts,
    heartRateBpm: currentHeartRate(),
    caloriesKcal: state.trainerCaloriesKcal,
  });

  updateRideUi();
  saveRideThrottled();

  if (state.progressMeters >= totalDistance) {
    state.simulating = false;
    state.movementLoopActive = false;
    updateStartButton();
    saveRide();
    persistRideLog();
    updateRecordingUi();
    void sendTrainerGrade(0);
    return;
  }

  scheduleTick();
}

function updateRideUi(options = {}) {
  if (!state.route.length) return;

  const point = interpolateRoutePoint(state.route, state.progressMeters);

  if (state.riderDot) {
    updateRiderDot(point);
    updateMapCamera({ lat: point.lat, lng: point.lng, ele: point.ele });
  }

  // Per-frame work ends here. DOM stats, the profile canvas, and the trainer
  // grade only need a few updates per second while riding.
  const now = performance.now();
  if (!options.force && isMoving() && now - state.lastSlowUiAt < 250) return;
  state.lastSlowUiAt = now;

  const totalDistance = routeTotalDistance(state.route);
  const grade = gradeAt(state.route, state.progressMeters);
  const progress = totalDistance ? state.progressMeters / totalDistance : 0;

  els.distanceStat.textContent = formatDistance(totalDistance, state.distanceUnits, 1);
  els.gradeStat.textContent = `${grade.toFixed(1)}%`;
  els.altitudeStat.textContent = formatAltitude(point.ele, state.distanceUnits);
  els.progress.value = progress;
  updateProgressLabel(
    `${formatDistance(state.progressMeters, state.distanceUnits)} of ${formatDistance(totalDistance, state.distanceUnits)}`,
  );
  renderProfile(progress);
  updateMinimapPosition(point);
  updateCameraSettingsLabels();

  els.hudGradeStat.textContent = `${grade.toFixed(1)}%`;
  els.hudRiddenStat.textContent = formatDistance(state.progressMeters, state.distanceUnits);
  els.hudRemainingStat.textContent = formatDistance(totalDistance - state.progressMeters, state.distanceUnits);

  updateRecordingUi();
  queueTrainerGradeSample(grade, {
    force: options.force,
    intervalSeconds: state.gradeUpdateIntervalSeconds,
  });
}

function renderProfile(progress = currentRideProgress()) {
  if (!state.route.length) {
    drawEmptyProfile(els.profile, { dark: state.mapFullscreen });
    return;
  }
  drawProfile(els.profile, {
    route: state.route,
    progress,
    hoverMeters: state.profileHoverMeters,
    dark: state.mapFullscreen,
    distanceUnits: state.distanceUnits,
  });
}

function handleProfileHover(event) {
  const distance = distanceAtProfileX(els.profile, event.clientX, state.route);
  if (distance === null) return;
  state.profileHoverMeters = distance;
  renderProfile();
}

function handleProfileLeave() {
  if (state.profileHoverMeters === null) return;
  state.profileHoverMeters = null;
  renderProfile();
}

function handleProfileClick(event) {
  const distance = distanceAtProfileX(els.profile, event.clientX, state.route);
  if (distance === null) return;
  state.progressMeters = distance;
  state.lastTick = performance.now();
  updateRideUi({ force: true });
  saveRide();
  ensureMovementLoop();
}

function currentRideProgress() {
  if (!state.route.length) return 0;
  const totalDistance = routeTotalDistance(state.route) || 1;
  return state.progressMeters / totalDistance;
}

// --- Telemetry ---------------------------------------------------------------

function handleTrainerTelemetry(telemetry) {
  if (!telemetry) {
    state.trainerSpeedKph = null;
    state.trainerPowerWatts = null;
    state.trainerHeartRateBpm = null;
    setPedaling(false);
    updateTelemetryUi();
    return;
  }

  if (telemetry.speedKph !== null) state.trainerSpeedKph = telemetry.speedKph;
  if (telemetry.powerWatts !== null) state.trainerPowerWatts = telemetry.powerWatts;
  if (telemetry.totalCaloriesKcal !== null) state.trainerCaloriesKcal = telemetry.totalCaloriesKcal;
  state.trainerHeartRateBpm = telemetry.heartRateBpm;

  updatePedalingFromSpeed();
  updateTelemetryUi();
}

function handleTrainerStatus(text, { onlyClearError = false } = {}) {
  if (onlyClearError && els.trainerStat.textContent !== "BLE error") return;
  els.trainerStat.textContent = text;
}

function handleStrapHeartRate(bpm) {
  state.strapHeartRateBpm = Number.isFinite(bpm) ? bpm : null;
  updateTelemetryUi();
}

function handleHeartRateStatus(text) {
  state.heartRateStatusText = text;
  updateTelemetryUi();
}

function currentHeartRate() {
  // Prefer the dedicated strap; fall back to a trainer-relayed heart rate.
  return state.strapHeartRateBpm ?? state.trainerHeartRateBpm ?? null;
}

function updateTelemetryUi() {
  const powerText = Number.isFinite(state.trainerPowerWatts) ? `${state.trainerPowerWatts} W` : "--";
  const speedText = formatSpeed(state.trainerSpeedKph, state.distanceUnits);
  const heartRate = currentHeartRate();
  const heartRateText = Number.isFinite(heartRate) ? `${heartRate} bpm` : "--";
  const caloriesText = formatEnergy(state.trainerCaloriesKcal ?? NaN, state.energyUnits);

  els.powerStat.textContent = powerText;
  els.speedStat.textContent = speedText;
  els.heartRateStat.textContent = heartRate !== null
    ? heartRateText
    : (state.heartRateStatusText || "--");
  els.caloriesStat.textContent = caloriesText;
  els.hudPowerStat.textContent = powerText;
  els.hudSpeedStat.textContent = speedText;
  els.hudHeartRateStat.textContent = heartRateText;
}

// --- Ride recording & FIT export ----------------------------------------------

function updateRecordingUi() {
  const summary = rideLogSummary();
  els.recDistanceStat.textContent = formatDistance(summary.distanceMeters, state.distanceUnits);
  els.recTimeStat.textContent = formatDuration(summary.timerSeconds);
  els.recPointsStat.textContent = String(summary.sampleCount);
  els.recHeartRateStat.textContent = summary.heartRateSampleCount > 0
    ? `${summary.heartRateSampleCount} samples`
    : "--";
  els.recCaloriesStat.textContent = formatEnergy(summary.caloriesKcal ?? NaN, state.energyUnits);
  els.downloadFitBtn.disabled = summary.sampleCount < 2;
  els.clearRideDataBtn.disabled = summary.sampleCount === 0;
}

function downloadFitFile() {
  const samples = rideLogSamples();
  if (samples.length < 2) {
    updateProgressLabel("Not enough recorded ride data yet — ride a little first.");
    return;
  }

  persistRideLog();
  const summary = rideLogSummary();

  let bytes;
  try {
    bytes = encodeFitActivity({
      samples,
      summary: {
        startTimeMs: summary.startedAtMs,
        totalElapsedSeconds: summary.elapsedSeconds,
        totalTimerSeconds: summary.timerSeconds,
        totalDistanceMeters: summary.distanceMeters,
        totalCalories: summary.caloriesKcal,
      },
    });
  } catch (error) {
    console.error("Could not encode the FIT file.", error);
    updateProgressLabel("Could not build the FIT file from the recorded data.");
    return;
  }

  const started = new Date(summary.startedAtMs);
  const stamp = [
    started.getFullYear(),
    String(started.getMonth() + 1).padStart(2, "0"),
    String(started.getDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(started.getHours()).padStart(2, "0"),
    String(started.getMinutes()).padStart(2, "0"),
  ].join("");

  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gpx-rider-virtual-ride-${stamp}.fit`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  // Give the browser a beat to hand the file off before asking.
  window.setTimeout(() => {
    if (window.confirm("FIT file downloaded. Clear the collected ride data to start fresh?")) {
      clearRideLog();
      updateRecordingUi();
      updateProgressLabel("Ride data cleared.");
    }
  }, 300);
}

function confirmClearRideData() {
  if (!hasRideData()) return;
  const summary = rideLogSummary();
  const description = `${formatDistance(summary.distanceMeters, state.distanceUnits)} / ${formatDuration(summary.timerSeconds)}`;
  if (!window.confirm(`Discard the collected ride data (${description}) without downloading?`)) return;
  clearRideLog();
  updateRecordingUi();
  updateProgressLabel("Ride data cleared.");
}

// --- Camera ------------------------------------------------------------------

function updateRiderDot(position) {
  const radius = riderDotRadiusMeters(position);

  // Rebuilding the polygons re-tessellates them in the map engine, which is
  // far too expensive to do per frame. Skip updates smaller than a pixel or
  // two on screen; the camera still follows the rider every frame.
  const last = state.lastRiderDot;
  if (
    last &&
    Math.abs(radius - last.radius) < last.radius * 0.04 &&
    haversine(last, position) < radius * 0.08
  ) {
    return;
  }
  state.lastRiderDot = { lat: position.lat, lng: position.lng, radius };

  if (state.riderHalo) {
    // Stacked a little apart above the ground so the three fills don't z-fight.
    state.riderHalo.path = riderCircleCoordinates(position, radius * 2.2, 0.5);
    state.riderDotOutline.path = riderCircleCoordinates(position, radius * 1.35, 1);
    state.riderDot.path = riderCircleCoordinates(position, radius, 1.5);
    return;
  }

  if (state.riderDotOutline) state.riderDotOutline.path = riderCircleCoordinates(position, radius, 1);
  if (state.riderDot) state.riderDot.path = riderCircleCoordinates(position, radius, 1.2);
}

function riderCircleCoordinates(center, radiusMeters, altitude = 0) {
  const points = [];
  for (let angle = 0; angle < 360; angle += 6) {
    const point = destinationPoint(center, angle, radiusMeters);
    points.push({ ...point, altitude });
  }
  return points;
}

function updateMapCamera(position) {
  if (state.mapProvider !== "google3d" || !state.route.length) return;
  if (state.userInteracting) return;

  const heading = currentRouteHeading();
  const camera = computeFollowCamera({
    riderPosition: position,
    heading,
    headingOffsetDegrees: state.cameraHeadingOffsetDegrees,
    cameraOffsetForwardMeters: state.cameraOffsetForwardMeters,
    cameraOffsetRightMeters: state.cameraOffsetRightMeters,
    cameraZoom: state.cameraZoom,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraAngleDegrees: state.cameraAngleDegrees,
  });

  // The look-at point must sit on the actual terrain: Map3D altitudes are
  // absolute, so a fixed value ends up underground in the mountains and every
  // range/tilt Google reports back is measured against that buried point.
  const groundAltitude = Number(position.ele) || 0;
  const centerAltitude = Math.max(0, groundAltitude + state.cameraCenterAltitudeOffsetMeters);
  state.map.center = { lat: camera.center.lat, lng: camera.center.lng, altitude: centerAltitude };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
}

function bindManualCameraCapture() {
  // Only genuine input events mark a manual interaction. The gmp-* camera
  // change events also fire for programmatic follow-camera writes, so they
  // cannot distinguish the user from the app.
  const begin = () => beginUserInteraction();
  state.map.addEventListener("pointerdown", begin);
  state.map.addEventListener("keydown", begin);
  state.map.addEventListener("wheel", () => {
    beginUserInteraction();
    scheduleInteractionEnd();
  }, { passive: true });

  const end = () => scheduleInteractionEnd();
  state.map.addEventListener("pointerup", end);
  state.map.addEventListener("pointercancel", end);
  state.map.addEventListener("keyup", end);
}

function beginUserInteraction() {
  state.userInteracting = true;
  window.clearTimeout(state.interactionSettleTimer);
  startInteractionDotResizeLoop();
}

// While the user zooms or pans, the follow camera is suspended and nothing
// else recomputes the dot radius, so a paused rider's dot would balloon or
// vanish mid-gesture. Track the camera every frame until the gesture settles;
// the change threshold inside updateRiderDot keeps re-tessellation cheap.
function startInteractionDotResizeLoop() {
  if (state.interactionDotLoopActive) return;
  state.interactionDotLoopActive = true;
  const step = () => {
    if (!state.userInteracting) {
      state.interactionDotLoopActive = false;
      return;
    }
    if (state.route.length && state.riderDot) {
      updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function scheduleInteractionEnd() {
  if (!state.userInteracting) return;
  window.clearTimeout(state.interactionSettleTimer);
  state.interactionSettleTimer = window.setTimeout(endUserInteraction, INTERACTION_SETTLE_MS);
}

function endUserInteraction() {
  captureManualCameraSettings();
  state.userInteracting = false;

  updateRideUi();
}

function captureManualCameraSettings() {
  if (!state.map) return;

  const tilt = Number(state.map.tilt);
  const range = Number(state.map.range);
  const heading = Number(state.map.heading);
  const centerAltitude = Number(state.map.center?.altitude);
  const rider = state.route.length ? interpolateRoutePoint(state.route, state.progressMeters) : null;

  let capturedTilt = Number.isFinite(tilt) ? clamp(tilt, CAMERA_TILT_MIN, CAMERA_TILT_MAX) : state.cameraAngleDegrees;
  let capturedRange = Number.isFinite(range) && range > 0
    ? range
    : rangeForBehind(state.cameraBehindMeters, capturedTilt) / state.cameraZoom;

  // Gestures move several camera parameters at once: a pan re-casts the map
  // center onto the terrain (changing its altitude and therefore range), and
  // a tilt pivots around the point under the cursor (sliding the center).
  // Raw tilt/range are measured against wherever the center landed, so when
  // the look-at point snaps back to the rider they must be re-solved from
  // the camera eye's actual height and horizontal standoff.
  if (rider && state.centerRider && Number.isFinite(centerAltitude)) {
    const eyeBehindMeters = capturedRange * Math.sin(toRad(capturedTilt));
    const eyeHeightMeters = centerAltitude + capturedRange * Math.cos(toRad(capturedTilt)) - rider.ele;
    if (eyeHeightMeters > 1) {
      capturedTilt = clamp(Math.atan2(eyeBehindMeters, eyeHeightMeters) * 180 / Math.PI, CAMERA_TILT_MIN, CAMERA_TILT_MAX);
      capturedRange = Math.hypot(eyeBehindMeters, eyeHeightMeters);
    }
  }

  state.cameraAngleDegrees = capturedTilt;
  const baseRange = rangeForBehind(state.cameraBehindMeters, capturedTilt);
  state.cameraZoom = clamp(baseRange / capturedRange, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);

  if (Number.isFinite(heading) && rider) {
    const routeHeading = currentRouteHeading();
    state.cameraHeadingOffsetDegrees = signedHeadingDelta(routeHeading, heading);
  }

  if (rider && state.centerRider) {
    state.cameraCenterAltitudeOffsetMeters = 0;
  } else if (rider) {
    const center = mapCenter();
    if (center) {
      const routeHeading = currentRouteHeading();
      const offset = measureCameraOffset({ lat: rider.lat, lng: rider.lng }, center, routeHeading);
      state.cameraOffsetForwardMeters = clamp(offset.forwardMeters, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
      state.cameraOffsetRightMeters = clamp(offset.rightMeters, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
    }
    if (Number.isFinite(centerAltitude)) {
      state.cameraCenterAltitudeOffsetMeters = clamp(
        centerAltitude - rider.ele,
        -CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
        CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
      );
    }
  }

  syncCameraControls();
  saveSettings();
  updateCameraSettingsLabels();
}

function currentRouteHeading() {
  if (state.route.length < 2) return 0;
  // Sample a short window around the rider so the camera points exactly the
  // way the rider is moving, rather than at a spot far up the road.
  const total = routeTotalDistance(state.route);
  const from = interpolateRoutePoint(state.route, clamp(state.progressMeters - HEADING_SAMPLE_METERS, 0, total));
  const to = interpolateRoutePoint(state.route, clamp(state.progressMeters + HEADING_SAMPLE_METERS, 0, total));
  return normalizeHeading(bearing(from, to));
}

function mapCenter() {
  const center = state.map?.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function syncCameraControls() {
  // Sliders display a rounded view, but the precise captured values stay in
  // state so resuming the follow camera does not snap.
  els.cameraZoomInput.value = String(Math.round(state.cameraZoom * 10) / 10);
  els.cameraAngleInput.value = String(Math.round(state.cameraAngleDegrees));
  els.cameraBehindInput.value = String(Math.round(state.cameraBehindMeters / 20) * 20);
}

function updateCameraSettingsLabels() {
  els.cameraZoomOutput.value = `${state.cameraZoom.toFixed(1)}x`;
  els.cameraAngleOutput.value = `${state.cameraAngleDegrees} deg`;
  els.cameraBehindOutput.value = `${state.cameraBehindMeters} m`;
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
  ].join("  ");
}

function updateGradeIntervalFromControl() {
  state.gradeUpdateIntervalSeconds = clamp(
    Number(els.gradeIntervalInput.value),
    GRADE_INTERVAL_MIN_SECONDS,
    GRADE_INTERVAL_MAX_SECONDS,
  );
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  saveSettings();
}

function updateUnitsFromControls() {
  state.distanceUnits = els.distanceUnitSelect.value === "imperial" ? "imperial" : "metric";
  state.energyUnits = els.energyUnitSelect.value === "kj" ? "kj" : "kcal";
  saveSettings();

  updateSpeedOutput();
  updateTelemetryUi();
  updateRecordingUi();
  if (state.route.length) updateRideUi({ force: true });
  else renderProfile();
}

function updateSpeedOutput() {
  els.speedOutput.value = formatSpeed(Number(els.speedInput.value), state.distanceUnits, 0);
}

function updateCameraSettingsFromControls() {
  state.cameraZoom = Number(els.cameraZoomInput.value);
  state.cameraAngleDegrees = Number(els.cameraAngleInput.value);
  state.cameraBehindMeters = Number(els.cameraBehindInput.value);
  updateCameraSettingsLabels();
  saveSettings();

  updateRideUi();
}

function resetCameraToDefaults() {
  state.cameraZoom = DEFAULT_CAMERA_ZOOM;
  state.cameraAngleDegrees = DEFAULT_CAMERA_ANGLE_DEGREES;
  state.cameraBehindMeters = DEFAULT_CAMERA_BEHIND_METERS;
  state.cameraHeadingOffsetDegrees = 0;
  state.cameraOffsetForwardMeters = 0;
  state.cameraOffsetRightMeters = 0;
  state.cameraCenterAltitudeOffsetMeters = 0;

  syncCameraControls();
  updateCameraSettingsLabels();
  saveSettings();

  updateRideUi();
}

function updateCenterRiderFromControl() {
  state.centerRider = els.centerRiderInput.checked;
  if (state.centerRider) {
    state.cameraOffsetForwardMeters = 0;
    state.cameraOffsetRightMeters = 0;
    state.cameraCenterAltitudeOffsetMeters = 0;
  }
  saveSettings();
  updateCameraSettingsLabels();

  updateRideUi();
}

// --- Fullscreen ----------------------------------------------------------------

function toggleMapFullscreen() {
  if (state.mapFullscreen) exitMapFullscreen();
  else enterMapFullscreen();
}

function enterMapFullscreen() {
  state.mapFullscreen = true;
  els.mapViewport.classList.add("fullscreen-mode");
  els.fullscreenBtn.textContent = "⤢ Exit fullscreen";
  els.fullscreenOverlayBottom.hidden = false;

  // Move the elevation profile into the fullscreen HUD stack so it renders as
  // a translucent overlay below the stat tiles instead of staying hidden
  // behind the now-fixed-position map viewport.
  els.fullscreenOverlayBottom.append(els.profile);
  els.profile.classList.add("profile-translucent");

  // The Fullscreen API also hides the browser chrome, but it can fail (no
  // user gesture in the event tick, unsupported platform); the CSS class
  // above already delivers the "just the map" view either way.
  els.mapViewport.requestFullscreen?.().catch(() => {});

  updateRideUi({ force: true });
}

function exitMapFullscreen() {
  state.mapFullscreen = false;
  els.mapViewport.classList.remove("fullscreen-mode");
  els.fullscreenBtn.textContent = "⛶ Fullscreen";
  els.fullscreenOverlayBottom.hidden = true;

  els.mapViewport.after(els.profile);
  els.profile.classList.remove("profile-translucent");

  if (document.fullscreenElement === els.mapViewport) document.exitFullscreen?.().catch(() => {});

  updateRideUi({ force: true });
}

function handleFullscreenChange() {
  if (!document.fullscreenElement && state.mapFullscreen) exitMapFullscreen();
}

// --- Settings & saved ride ------------------------------------------------------

function restoreSettings() {
  const settings = readJson(SETTINGS_STORAGE_KEY);
  const zoom = Number(settings?.cameraZoom ?? settings?.cameraDistanceMeters);
  const angle = Number(settings?.cameraAngleDegrees);
  const behind = Number(settings?.cameraBehindMeters);
  const headingOffset = Number(settings?.cameraHeadingOffsetDegrees);
  const offsetForward = Number(settings?.cameraOffsetForwardMeters);
  const offsetRight = Number(settings?.cameraOffsetRightMeters);

  if (Number.isFinite(zoom)) {
    state.cameraZoom = clamp(zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  }

  if (Number.isFinite(angle)) {
    state.cameraAngleDegrees = clamp(angle, CAMERA_TILT_MIN, CAMERA_TILT_MAX);
  }

  if (Number.isFinite(behind)) {
    state.cameraBehindMeters = clamp(behind, Number(els.cameraBehindInput.min), Number(els.cameraBehindInput.max));
  }

  if (Number.isFinite(headingOffset)) {
    state.cameraHeadingOffsetDegrees = clamp(headingOffset, -180, 180);
  }

  if (Number.isFinite(offsetForward)) {
    state.cameraOffsetForwardMeters = clamp(offsetForward, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
  }

  if (Number.isFinite(offsetRight)) {
    state.cameraOffsetRightMeters = clamp(offsetRight, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
  }

  const centerAltitudeOffset = Number(settings?.cameraCenterAltitudeOffsetMeters);
  if (Number.isFinite(centerAltitudeOffset)) {
    state.cameraCenterAltitudeOffsetMeters = clamp(
      centerAltitudeOffset,
      -CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
      CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
    );
  }

  if (typeof settings?.centerRider === "boolean") {
    state.centerRider = settings.centerRider;
  }

  if (state.centerRider) {
    state.cameraOffsetForwardMeters = 0;
    state.cameraOffsetRightMeters = 0;
    state.cameraCenterAltitudeOffsetMeters = 0;
  }

  const gradeInterval = Number(settings?.gradeUpdateIntervalSeconds);
  if (Number.isFinite(gradeInterval)) {
    state.gradeUpdateIntervalSeconds = clamp(gradeInterval, GRADE_INTERVAL_MIN_SECONDS, GRADE_INTERVAL_MAX_SECONDS);
  }

  if (settings?.distanceUnits === "imperial") state.distanceUnits = "imperial";
  if (settings?.energyUnits === "kj") state.energyUnits = "kj";

  els.centerRiderInput.checked = state.centerRider;
  els.gradeIntervalInput.value = String(state.gradeUpdateIntervalSeconds);
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  els.distanceUnitSelect.value = state.distanceUnits;
  els.energyUnitSelect.value = state.energyUnits;
  updateSpeedOutput();
  syncCameraControls();
  updateCameraSettingsLabels();
}

function saveSettings() {
  writeJson(SETTINGS_STORAGE_KEY, {
    cameraZoom: state.cameraZoom,
    cameraAngleDegrees: state.cameraAngleDegrees,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraHeadingOffsetDegrees: state.cameraHeadingOffsetDegrees,
    cameraOffsetForwardMeters: state.cameraOffsetForwardMeters,
    cameraOffsetRightMeters: state.cameraOffsetRightMeters,
    cameraCenterAltitudeOffsetMeters: state.cameraCenterAltitudeOffsetMeters,
    centerRider: state.centerRider,
    gradeUpdateIntervalSeconds: state.gradeUpdateIntervalSeconds,
    distanceUnits: state.distanceUnits,
    energyUnits: state.energyUnits,
  });
}

function restoreSavedRide() {
  const savedRide = readJson(RIDE_STORAGE_KEY);
  const savedSpeed = Number(savedRide?.speedKph);

  if (Number.isFinite(savedSpeed)) {
    els.speedInput.value = String(clamp(savedSpeed, Number(els.speedInput.min), Number(els.speedInput.max)));
    updateSpeedOutput();
  }

  if (!savedRide?.route?.length) {
    renderProfile();
    return;
  }

  const route = savedRide.route
    .map((point) => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
      ele: Number(point.ele),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (route.length < 2) {
    renderProfile();
    return;
  }

  state.route = enrichRoute(route);
  state.progressMeters = clamp(Number(savedRide.progressMeters) || 0, 0, routeTotalDistance(state.route));
  state.simulating = false;
  state.lastTick = 0;

  updateStartButton();
  renderRoute();
  renderProfile();
  updateRideUi({ force: true });
  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
}

function saveRideThrottled() {
  const now = performance.now();
  if (now - state.lastRideSavedAt < 1500) return;
  saveRide();
}

function saveRide() {
  state.lastRideSavedAt = performance.now();

  if (!state.route.length) {
    removeStored(RIDE_STORAGE_KEY);
    return;
  }

  const route = state.route.map((point) => ({
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
    ele: Math.round(point.ele * 10) / 10,
  }));

  const saved = writeJson(RIDE_STORAGE_KEY, {
    route,
    progressMeters: Math.round(state.progressMeters),
    speedKph: Number(els.speedInput.value),
    savedAt: new Date().toISOString(),
  });
  if (!saved) {
    updateProgressLabel("This GPX is too large to save locally, but the ride still works.");
  }
}

function updateProgressLabel(text) {
  els.progressLabel.textContent = text;
}
