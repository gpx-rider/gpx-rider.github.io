// GPX Rider entry point — orchestrates the modules in this folder: keeps the
// app state, wires DOM events, drives the 3D map + follow camera, and runs
// the movement loop that advances the rider from trainer speed (pedaling) or
// the simulation slider.

import {
  applyCameraLift,
  cameraDistanceToPoint,
  cameraEyePosition,
  cameraFromEyeAndCenter,
  chaseStep,
  chaseTuning,
  computeFollowCamera,
  computeRouteOverviewCamera,
  measureCameraOffset,
  normalizeHeading,
  rangeForBehind,
  signedHeadingDelta,
} from "./camera.mjs";
import { bearing, clamp, destinationPoint, haversine, lerp, roundCoordinate, toRad } from "./geo.mjs";
import { deployedMapsApiKey } from "./config.mjs";
import {
  ascentAt,
  densifyRoute,
  descentAt,
  enrichRoute,
  gradeAt,
  interpolateRoutePoint,
  maxElevationNear,
  parseGpx,
  routeTotalAscent,
  routeTotalDescent,
  routeTotalDistance,
} from "./route.mjs";
import { createRideEstimator, estimateRemainingSeconds, recordEstimatorTick } from "./eta.mjs";
import { classifyRoute } from "./difficulty.mjs";
import { detectClimbs } from "./climbs.mjs";
import { distanceAtProfileX, drawEmptyProfile, drawProfile } from "./profile.mjs";
import { formatAltitude, formatDistance, formatDuration, formatEnergy, formatSpeed } from "./units.mjs";
import { readJson, removeStored, writeJson } from "./storage.mjs";
import {
  CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
  CAMERA_PAN_LIMIT_METERS,
  CAMERA_TILT_MAX,
  CAMERA_TILT_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  DEFAULT_BEACON_COLOR,
  DEFAULT_BEACON_DIAMETER_METERS,
  DEFAULT_BEACON_ENABLED,
  DEFAULT_BEACON_HEIGHT_METERS,
  DEFAULT_BEACON_OPACITY,
  DEFAULT_CAMERA_ANGLE_DEGREES,
  DEFAULT_CAMERA_BEHIND_METERS,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GRADE_INTERVAL_SECONDS,
  DEFAULT_HUD_ELEMENTS,
  DEFAULT_MAP_LABELS_ENABLED,
  DEFAULT_SCREENSHOT_ASPECT,
  DEFAULT_SCREENSHOT_WIDTH,
  DEFAULT_SHOW_MINIMAP,
  DEFAULT_SHOW_SCREENSHOT_BUTTON,
  DEFAULT_TERRAIN_AVOID_ENABLED,
  DEFAULT_TERRAIN_CLEARANCE_METERS,
  GRADE_INTERVAL_MAX_SECONDS,
  GRADE_INTERVAL_MIN_SECONDS,
  HEADING_SAMPLE_METERS,
  INTERACTION_SETTLE_MS,
  MAX_TICK_SECONDS,
  OVERVIEW_TILT_DEGREES,
  PEDALING_START_KPH,
  PEDALING_STOP_KPH,
  RIDE_SAVE_THROTTLE_MS,
  ROUTE_LINE_ALTITUDE_METERS,
  ROUTE_LINE_MAX_POINTS,
  ROUTE_LINE_SPACING_METERS,
  SCREENSHOT_WIDTH_MAX,
  SCREENSHOT_WIDTH_MIN,
  SLOW_UI_INTERVAL_MS,
  TERRAIN_LIFT_FALL_TAU_SECONDS,
  TERRAIN_LIFT_RECOMPUTE_MS,
  TERRAIN_LIFT_RISE_TAU_SECONDS,
  TERRAIN_SAMPLE_RADIUS_METERS,
} from "./tuning.mjs";
import {
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
import { captureViewportJpeg, parseAspectRatio, screenshotSupported } from "./screenshot.mjs";

// All tunable behavior parameters live in tuning.mjs — the constants below
// are wiring, not knobs.
const MAPS_API_KEY_STORAGE_KEY = "gpx-rider:maps-api-key";
const SETTINGS_STORAGE_KEY = "gpx-rider:settings";
const RIDE_STORAGE_KEY = "gpx-rider:last-ride";

const BEACON_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Physical camera motion: after the load-time snap, every camera move chases
// its target like an object with bounded acceleration — it eases into
// motion, brakes to arrive without snapping, and never jumps. The
// acceleration budget scales with the remaining distance (chaseTuning in
// camera.mjs): steady follow tracking stays gentle while transition flights
// (overview down to the rider, long seeks) cross fast.

const state = {
  route: [],
  // Display name shown above the route classification: a gallery ride's
  // curated title, else the GPX's own <name>, else the uploaded filename.
  routeName: null,
  // Detected climbs for the loaded route (see climbs.mjs), recomputed once
  // per route load in updateRouteOverview and read every ride tick to drive
  // the live "current climb" / "next climb" status.
  climbs: [],
  progressMeters: 0,
  simulating: false,
  pedaling: false,
  movementLoopActive: false,
  tickRaf: null,
  tickTimeout: null,
  lastTick: 0,
  line: null,
  riderDot: null,
  riderDotOutline: null,
  riderHalo: null,
  riderBeacon: null,
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
  // "overview" while a freshly loaded route is framed whole, "manual" after
  // the user grabs the overview camera, "follow" once movement starts.
  cameraMode: "follow",
  overviewCamera: null,
  cameraFlight: null,
  cameraFlightLoopActive: false,
  cameraZoom: DEFAULT_CAMERA_ZOOM,
  cameraAngleDegrees: DEFAULT_CAMERA_ANGLE_DEGREES,
  cameraBehindMeters: DEFAULT_CAMERA_BEHIND_METERS,
  cameraHeadingOffsetDegrees: 0,
  cameraOffsetForwardMeters: 0,
  cameraOffsetRightMeters: 0,
  cameraCenterAltitudeOffsetMeters: 0,
  centerRider: true,
  screenshotInProgress: false,
  showScreenshotButton: DEFAULT_SHOW_SCREENSHOT_BUTTON,
  screenshotAspect: DEFAULT_SCREENSHOT_ASPECT,
  screenshotWidth: DEFAULT_SCREENSHOT_WIDTH,
  beaconEnabled: DEFAULT_BEACON_ENABLED,
  beaconDiameterMeters: DEFAULT_BEACON_DIAMETER_METERS,
  beaconHeightMeters: DEFAULT_BEACON_HEIGHT_METERS,
  beaconOpacity: DEFAULT_BEACON_OPACITY,
  beaconColor: DEFAULT_BEACON_COLOR,
  terrainAvoidEnabled: DEFAULT_TERRAIN_AVOID_ENABLED,
  terrainClearanceMeters: DEFAULT_TERRAIN_CLEARANCE_METERS,
  cameraLiftMeters: 0,
  cameraLiftTargetMeters: 0,
  lastLiftComputeMs: 0,
  lastLiftSmoothMs: 0,
  mapFullscreen: false,
  distanceUnits: "metric",
  energyUnits: "kcal",
  showMinimap: DEFAULT_SHOW_MINIMAP,
  mapLabelsEnabled: DEFAULT_MAP_LABELS_ENABLED,
  hudElements: { ...DEFAULT_HUD_ELEMENTS },
  // Per-session pace tracker feeding the smart ETA; reset on new GPX load.
  rideEstimator: createRideEstimator(),
};

const els = {
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsCloseBtn: document.querySelector("#settingsCloseBtn"),
  apiKeySection: document.querySelector("#apiKeySection"),
  mapsApiKeyInput: document.querySelector("#mapsApiKeyInput"),
  mapsApiKeySaveBtn: document.querySelector("#mapsApiKeySaveBtn"),
  gpxFile: document.querySelector("#gpxFile"),
  routeOverview: document.querySelector("#routeOverview"),
  routeNameHeading: document.querySelector("#routeNameHeading"),
  routeClassSummary: document.querySelector("#routeClassSummary"),
  routeClassDetail: document.querySelector("#routeClassDetail"),
  climbsSection: document.querySelector("#climbsSection"),
  climbStatus: document.querySelector("#climbStatus"),
  climbStatusHeadline: document.querySelector("#climbStatusHeadline"),
  climbStatusDetail: document.querySelector("#climbStatusDetail"),
  climbsList: document.querySelector("#climbsList"),
  distanceStat: document.querySelector("#distanceStat"),
  riddenStat: document.querySelector("#riddenStat"),
  remainingStat: document.querySelector("#remainingStat"),
  etaStat: document.querySelector("#etaStat"),
  ascentStat: document.querySelector("#ascentStat"),
  descentStat: document.querySelector("#descentStat"),
  ascentLeftStat: document.querySelector("#ascentLeftStat"),
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
  beaconEnabledInput: document.querySelector("#beaconEnabledInput"),
  beaconDiameterInput: document.querySelector("#beaconDiameterInput"),
  beaconDiameterOutput: document.querySelector("#beaconDiameterOutput"),
  beaconHeightInput: document.querySelector("#beaconHeightInput"),
  beaconHeightOutput: document.querySelector("#beaconHeightOutput"),
  beaconOpacityInput: document.querySelector("#beaconOpacityInput"),
  beaconOpacityOutput: document.querySelector("#beaconOpacityOutput"),
  beaconColorInput: document.querySelector("#beaconColorInput"),
  terrainAvoidInput: document.querySelector("#terrainAvoidInput"),
  terrainClearanceInput: document.querySelector("#terrainClearanceInput"),
  terrainClearanceOutput: document.querySelector("#terrainClearanceOutput"),
  resetRenderingBtn: document.querySelector("#resetRenderingBtn"),
  connectBtn: document.querySelector("#connectBtn"),
  connectHrBtn: document.querySelector("#connectHrBtn"),
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  progress: document.querySelector("#progress"),
  progressLabel: document.querySelector("#progressLabel"),
  ascentProgress: document.querySelector("#ascentProgress"),
  ascentProgressLabel: document.querySelector("#ascentProgressLabel"),
  profile: document.querySelector("#profile"),
  mapViewport: document.querySelector("#mapViewport"),
  minimap: document.querySelector("#minimap"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
  resetCameraViewBtn: document.querySelector("#resetCameraViewBtn"),
  screenshotBtn: document.querySelector("#screenshotBtn"),
  screenshotButtonInput: document.querySelector("#screenshotButtonInput"),
  screenshotAspectSelect: document.querySelector("#screenshotAspectSelect"),
  screenshotWidthSelect: document.querySelector("#screenshotWidthSelect"),
  fullscreenOverlayBottom: document.querySelector("#fullscreenOverlayBottom"),
  hudPowerStat: document.querySelector("#hudPowerStat"),
  hudSpeedStat: document.querySelector("#hudSpeedStat"),
  hudHeartRateStat: document.querySelector("#hudHeartRateStat"),
  hudGradeStat: document.querySelector("#hudGradeStat"),
  hudRiddenStat: document.querySelector("#hudRiddenStat"),
  hudRemainingStat: document.querySelector("#hudRemainingStat"),
  hudAscentLeftStat: document.querySelector("#hudAscentLeftStat"),
  hudEtaStat: document.querySelector("#hudEtaStat"),
  hudTiles: document.querySelectorAll("#fullscreenHud [data-hud]"),
  hudToggles: document.querySelectorAll("#settingsDialog [data-hud-toggle]"),
  minimapInput: document.querySelector("#minimapInput"),
  mapLabelsInput: document.querySelector("#mapLabelsInput"),
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
  // A deployment with its own baked-in key has no need for visitors to see
  // or manage one — hide the whole control instead of just leaving it empty.
  els.apiKeySection.hidden = Boolean(deployedMapsApiKey());
  await initMap();
  bindEvents();
  restoreSavedRide();
  void reconnectSavedTrainer();
  void reconnectSavedHeartRate();
  // First open with no saved ride: start on the first gallery route instead
  // of an empty map (only once the map is actually up — a missing API key
  // keeps the "paste your key" flow front and center instead).
  void initGallery(loadGpxFromUrl, {
    shouldAutoLoadFirst: () => state.route.length < 2 && Boolean(state.map),
  });
}

function getStoredMapsApiKey() {
  return localStorage.getItem(MAPS_API_KEY_STORAGE_KEY) || "";
}

// A key a visitor pasted into Settings always wins; otherwise fall back to
// whatever this deployment baked in at build time (see config.mjs).
function resolveMapsApiKey() {
  return getStoredMapsApiKey() || deployedMapsApiKey();
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
  const apiKey = resolveMapsApiKey();
  if (!apiKey) {
    updateProgressLabel("Add your Google Maps API key in Settings (⚙, top right) to load the map.");
    // First run: the key input now lives in the settings dialog, so open it.
    els.settingsDialog.showModal();
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

function bindEvents() {
  els.settingsBtn.addEventListener("click", () => els.settingsDialog.showModal());
  els.settingsCloseBtn.addEventListener("click", () => els.settingsDialog.close());
  els.settingsDialog.addEventListener("click", (event) => {
    // A click on the dialog element itself (not its content) is the backdrop.
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
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
  els.minimapInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.mapLabelsInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.hudToggles.forEach((input) => input.addEventListener("change", updateDisplaySettingsFromControls));
  els.cameraZoomInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraAngleInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraBehindInput.addEventListener("input", updateCameraSettingsFromControls);
  els.centerRiderInput.addEventListener("change", updateCenterRiderFromControl);
  els.resetCameraBtn.addEventListener("click", resetCameraView);
  els.beaconEnabledInput.addEventListener("change", updateRenderingSettingsFromControls);
  els.beaconDiameterInput.addEventListener("input", updateRenderingSettingsFromControls);
  els.beaconHeightInput.addEventListener("input", updateRenderingSettingsFromControls);
  els.beaconOpacityInput.addEventListener("input", updateRenderingSettingsFromControls);
  els.beaconColorInput.addEventListener("input", updateRenderingSettingsFromControls);
  els.terrainAvoidInput.addEventListener("change", updateRenderingSettingsFromControls);
  els.terrainClearanceInput.addEventListener("input", updateRenderingSettingsFromControls);
  els.resetRenderingBtn.addEventListener("click", resetRenderingToDefaults);
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
  els.resetCameraViewBtn.addEventListener("click", resetCameraView);
  els.screenshotBtn.addEventListener("click", takeMapScreenshot);
  els.screenshotButtonInput.addEventListener("change", updateScreenshotSettingsFromControls);
  els.screenshotAspectSelect.addEventListener("change", updateScreenshotSettingsFromControls);
  els.screenshotWidthSelect.addEventListener("change", updateScreenshotSettingsFromControls);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", (event) => {
    // When the settings dialog is open, Escape closes it (natively) and must
    // not also kick the rider out of fullscreen.
    if (event.key === "Escape" && state.mapFullscreen && !els.settingsDialog.open) exitMapFullscreen();
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
  applyGpxText(text, { fallbackName: filenameToRouteName(file.name) });
}

// Gallery rides pass their curated title as `overrideName`, which wins over
// whatever technical name the GPX export itself carries (e.g. a
// map-tool-generated "Route from A to B").
async function loadGpxFromUrl(url, overrideName) {
  const response = await fetch(url);
  const text = await response.text();
  applyGpxText(text, { overrideName });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function filenameToRouteName(filename) {
  return filename.replace(/\.[^./\\]+$/, "").trim() || null;
}

function applyGpxText(text, { overrideName = null, fallbackName = null } = {}) {
  const { points: route, name: gpxName } = parseGpx(text);

  if (route.length < 2) {
    updateProgressLabel("That GPX file does not contain enough track points.");
    return;
  }

  state.route = enrichRoute(route);
  state.routeName = overrideName || gpxName || fallbackName;
  state.progressMeters = 0;
  state.simulating = false;
  state.lastTick = 0;
  state.profileHoverMeters = null;
  // A new route is a new ride: the ETA pace history starts over.
  state.rideEstimator = createRideEstimator();
  enterOverviewMode({ instant: true });
  updateStartButton();
  renderRoute();
  renderProfile();
  updateRouteOverview();
  updateRideUi({ force: true });
  saveRide();

  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
}

// Route classification and detected climbs, shown on the setup page once a
// GPX loads. Both are cheap single passes over the whole route and only
// depend on its fixed distance/elevation totals, so this runs once per load
// rather than on every ride-progress tick like updateRideUi.
function updateRouteOverview() {
  if (!state.route.length) {
    state.climbs = [];
    els.routeOverview.hidden = true;
    return;
  }

  const totalDistance = routeTotalDistance(state.route);
  const totalAscent = routeTotalAscent(state.route);
  const classification = classifyRoute(totalDistance, totalAscent);
  if (!classification) {
    state.climbs = [];
    els.routeOverview.hidden = true;
    return;
  }

  els.routeOverview.hidden = false;
  els.routeNameHeading.hidden = !state.routeName;
  els.routeNameHeading.textContent = state.routeName ?? "";
  els.routeClassSummary.textContent =
    `${formatDistance(totalDistance, state.distanceUnits, 1)} · ${formatAltitude(totalAscent, state.distanceUnits)}`;
  els.routeClassDetail.textContent =
    `${classification.distanceClass} - ${classification.terrainClass} · ${classification.difficulty}`;

  state.climbs = detectClimbs(state.route);
  els.climbsSection.hidden = state.climbs.length === 0;
  els.climbsList.replaceChildren(
    ...state.climbs.map((climb, index) => {
      const item = document.createElement("li");
      const index_ = document.createElement("span");
      index_.className = "climb-index";
      index_.textContent = `${index + 1}.`;
      const label = document.createElement("span");
      label.textContent =
        `${formatDistance(climb.startDistanceMeters, state.distanceUnits, 1)} → ` +
        `${formatDistance(climb.endDistanceMeters, state.distanceUnits, 1)} · ` +
        `${formatDistance(climb.lengthMeters, state.distanceUnits, 1)} · ` +
        `${formatAltitude(climb.gainMeters, state.distanceUnits)}`;
      const line = document.createElement("span");
      line.append(index_, document.createTextNode(" "), label);
      const grade = document.createElement("span");
      grade.className = "climb-grade";
      grade.textContent = `${climb.averageGradePercent.toFixed(1)}%`;
      item.append(line, grade);
      return item;
    }),
  );
}

// Live "current climb" / "next climb" status shown above the climbs list
// while riding. Reuses the climbs detected once at route load (state.climbs)
// rather than re-scanning the route every tick — those boundaries already
// tolerate the flat/downhill noise a naive live-grade check would flicker
// on (see CLIMB_MERGE_GAP_METERS / CLIMB_DESCENT_TOLERANCE_METERS).
function updateClimbStatus(point) {
  if (!state.climbs.length) return;

  const progress = state.progressMeters;
  const currentIndex = state.climbs.findIndex(
    (climb) => progress >= climb.startDistanceMeters && progress <= climb.endDistanceMeters,
  );

  [...els.climbsList.children].forEach((item, index) => {
    item.classList.toggle("active", index === currentIndex);
  });

  if (currentIndex !== -1) {
    const climb = state.climbs[currentIndex];
    const remainingDistance = Math.max(0, climb.endDistanceMeters - progress);
    const remainingAscent = Math.max(0, climb.endElevationMeters - point.ele);
    const remainingGrade = remainingDistance > 0 ? (remainingAscent / remainingDistance) * 100 : 0;
    els.climbStatusHeadline.textContent = `Climbing — climb ${currentIndex + 1} of ${state.climbs.length}`;
    els.climbStatusDetail.textContent =
      `${formatDistance(remainingDistance, state.distanceUnits, 1)} left · ` +
      `${formatAltitude(remainingAscent, state.distanceUnits)} to climb · ` +
      `${remainingGrade.toFixed(1)}% avg remaining`;
    return;
  }

  const next = state.climbs.find((climb) => climb.startDistanceMeters > progress);
  if (!next) {
    els.climbStatusHeadline.textContent = "No more climbs";
    els.climbStatusDetail.textContent = "";
    return;
  }

  const distanceToClimb = next.startDistanceMeters - progress;
  els.climbStatusHeadline.textContent = `Next climb in ${formatDistance(distanceToClimb, state.distanceUnits, 1)}`;
  els.climbStatusDetail.textContent =
    `${formatDistance(next.lengthMeters, state.distanceUnits, 1)} · ` +
    `${formatAltitude(next.gainMeters, state.distanceUnits)} · ` +
    `${next.averageGradePercent.toFixed(1)}% avg`;
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
    // One polyline with the built-in casing (outerColor/outerWidth), never a
    // second stacked line for the outline: separate geometries a fraction of
    // a meter apart z-fight once the camera is far enough that their altitude
    // gap falls below depth precision, leaving only the outline visible.
    state.line = new Polyline3DElement({
      altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
      path: pathAt(ROUTE_LINE_ALTITUDE_METERS),
      strokeColor: "#0a84ff",
      strokeWidth: 14,
      outerColor: "rgba(255, 255, 255, 0.72)",
      outerWidth: 0.35,
    });
    state.map.append(state.line);
  }

  renderRiderDot(currentPoint);
  updateMapCamera();
}

function renderRiderDot(point) {
  const { AltitudeMode, Polygon3DElement, Polyline3DElement } = state.maps3d;

  renderRiderBeacon();

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

function renderRiderBeacon() {
  if (state.riderBeacon) {
    state.riderBeacon.remove();
    state.riderBeacon = null;
  }

  const { AltitudeMode, Polygon3DElement } = state.maps3d ?? {};
  if (!state.beaconEnabled || !Polygon3DElement || !state.map) return;

  // Extruded from the ground up to the path altitude, with occluded segments
  // drawn so nearby trees and buildings never hide the rider's position.
  state.riderBeacon = new Polygon3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    extruded: true,
    drawsOccludedSegments: true,
    fillColor: beaconFillColor(),
    strokeWidth: 0,
  });
  state.map.append(state.riderBeacon);
}

function beaconFillColor() {
  const hex = BEACON_COLOR_PATTERN.test(state.beaconColor) ? state.beaconColor : DEFAULT_BEACON_COLOR;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${state.beaconOpacity})`;
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
  if (state.line) state.line.remove();
  if (state.riderHalo) state.riderHalo.remove();
  if (state.riderDotOutline) state.riderDotOutline.remove();
  if (state.riderDot) state.riderDot.remove();
  if (state.riderBeacon) state.riderBeacon.remove();

  state.line = null;
  state.riderHalo = null;
  state.riderDotOutline = null;
  state.riderDot = null;
  state.riderBeacon = null;
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
  if (state.route.length < 2) return;
  // Actual movement (not a mere seek) hands the camera over to the follow
  // view; the camera flight then flies it in from wherever it is — e.g. down
  // from the route overview when the rider starts pedaling.
  if (isMoving()) state.cameraMode = "follow";
  if (state.movementLoopActive) return;
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
  // A reset while stationary returns to the whole-route overview, like a
  // fresh load; while pedaling the camera stays with the rider.
  if (!isMoving()) enterOverviewMode();
  updateStartButton();
  updateRideUi({ force: true });
  saveRide();
  void sendTrainerGrade(0);
}

function tick(now) {
  if (!isMoving() || state.route.length < 2) {
    state.movementLoopActive = false;
    // The movement loop was driving the camera flight; let the flight loop
    // finish any move still in progress.
    ensureCameraFlightLoop();
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

  // Feed the ETA pace history only from real pedaling — simulated movement
  // rides at an artificial constant speed and would poison the estimate.
  if (state.pedaling) {
    recordEstimatorTick(state.rideEstimator, {
      elapsedSeconds,
      distanceMeters: state.progressMeters - previousProgress,
      ascentMeters: ascentAt(state.route, state.progressMeters) - ascentAt(state.route, previousProgress),
      descentMeters: descentAt(state.route, state.progressMeters) - descentAt(state.route, previousProgress),
    });
  }

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
    ensureCameraFlightLoop();
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
    updateMapCamera();
  }

  // Per-frame work ends here. DOM stats, the profile canvas, and the trainer
  // grade only need a few updates per second while riding.
  const now = performance.now();
  if (!options.force && isMoving() && now - state.lastSlowUiAt < SLOW_UI_INTERVAL_MS) return;
  state.lastSlowUiAt = now;

  const totalDistance = routeTotalDistance(state.route);
  const grade = gradeAt(state.route, state.progressMeters);
  const progress = totalDistance ? state.progressMeters / totalDistance : 0;
  const totalAscent = routeTotalAscent(state.route);
  const totalDescent = routeTotalDescent(state.route);
  const ascentSoFar = ascentAt(state.route, state.progressMeters);
  const ascentLeft = Math.max(0, totalAscent - ascentSoFar);
  const riddenText = formatDistance(state.progressMeters, state.distanceUnits);
  const remainingText = formatDistance(totalDistance - state.progressMeters, state.distanceUnits);
  const ascentLeftText = formatAltitude(ascentLeft, state.distanceUnits);
  const etaSeconds = currentEtaSeconds(totalDistance, totalAscent, totalDescent);
  const etaText = etaSeconds === null ? "--" : formatDuration(etaSeconds);

  els.distanceStat.textContent = formatDistance(totalDistance, state.distanceUnits, 1);
  els.riddenStat.textContent = riddenText;
  els.remainingStat.textContent = remainingText;
  els.etaStat.textContent = etaText;
  els.ascentStat.textContent = formatAltitude(totalAscent, state.distanceUnits);
  els.descentStat.textContent = formatAltitude(totalDescent, state.distanceUnits);
  els.ascentLeftStat.textContent = ascentLeftText;
  els.gradeStat.textContent = `${grade.toFixed(1)}%`;
  els.altitudeStat.textContent = formatAltitude(point.ele, state.distanceUnits);
  els.progress.value = progress;
  updateProgressLabel(
    `${formatDistance(state.progressMeters, state.distanceUnits)} of ${formatDistance(totalDistance, state.distanceUnits)}`,
  );
  updateAscentProgress(ascentSoFar, totalAscent);
  updateClimbStatus(point);
  renderProfile(progress);
  updateMinimapPosition(point);
  updateCameraSettingsLabels();

  els.hudGradeStat.textContent = `${grade.toFixed(1)}%`;
  els.hudRiddenStat.textContent = riddenText;
  els.hudRemainingStat.textContent = remainingText;
  els.hudAscentLeftStat.textContent = ascentLeftText;
  els.hudEtaStat.textContent = etaText;

  updateRecordingUi();
  queueTrainerGradeSample(grade, {
    force: options.force,
    intervalSeconds: state.gradeUpdateIntervalSeconds,
  });
}

// Second progress bar under the distance one: how much of the route's total
// climbing is already behind the rider. Hidden on flat routes, where it
// would only ever show 0% or 100%.
function updateAscentProgress(ascentSoFar, totalAscent) {
  const show = totalAscent >= 1;
  els.ascentProgress.hidden = !show;
  els.ascentProgressLabel.hidden = !show;
  if (!show) return;
  els.ascentProgress.value = clamp(ascentSoFar / totalAscent, 0, 1);
  els.ascentProgressLabel.textContent =
    `${formatAltitude(ascentSoFar, state.distanceUnits)} of ${formatAltitude(totalAscent, state.distanceUnits)} climbed`;
}

// Estimated seconds to the finish (see eta.mjs for the model), or null when
// there is nothing to base an estimate on yet.
function currentEtaSeconds(totalDistance, totalAscent, totalDescent) {
  const remainingMeters = totalDistance - state.progressMeters;
  if (remainingMeters <= 0) return 0;

  // The simulation rides at a constant slider speed — plain arithmetic is
  // exact there, no model needed.
  if (state.simulating && !state.pedaling) {
    return remainingMeters / (Number(els.speedInput.value) / 3.6);
  }

  return estimateRemainingSeconds(state.rideEstimator, {
    remainingMeters,
    remainingAscentMeters: Math.max(0, totalAscent - ascentAt(state.route, state.progressMeters)),
    remainingDescentMeters: Math.max(0, totalDescent - descentAt(state.route, state.progressMeters)),
    // Before enough pedaling history exists: project the trainer speed while
    // pedaling, otherwise preview at the simulation slider speed.
    fallbackSpeedKph: state.pedaling && Number.isFinite(state.trainerSpeedKph)
      ? state.trainerSpeedKph
      : Number(els.speedInput.value),
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

  if (state.riderBeacon) {
    // Real-world-sized geometry, so a coarse circle keeps the extruded
    // cylinder cheap to re-tessellate as it follows the rider.
    state.riderBeacon.path = riderCircleCoordinates(
      position,
      state.beaconDiameterMeters / 2,
      state.beaconHeightMeters,
      15,
    );
  }

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

function riderCircleCoordinates(center, radiusMeters, altitude = 0, stepDegrees = 6) {
  const points = [];
  for (let angle = 0; angle < 360; angle += stepDegrees) {
    const point = destinationPoint(center, angle, radiusMeters);
    points.push({ ...point, altitude });
  }
  return points;
}

function updateMapCamera() {
  if (state.mapProvider !== "google3d" || !state.route.length || !state.map) return;
  if (state.userInteracting || state.cameraMode === "manual") return;

  const settled = stepCameraFlight(performance.now());
  // While the rider moves, the movement loop calls this every frame; when
  // nothing else ticks, the flight loop keeps an unfinished move animating.
  if (!settled && !state.movementLoopActive) ensureCameraFlightLoop();
}

// The camera the flight is heading for: the whole-route overview after a
// load, otherwise the configured follow camera behind the rider.
function cameraFlightTarget() {
  if (state.cameraMode === "overview") {
    const overview = state.overviewCamera;
    if (!overview) return null;
    const eye = cameraEyePosition(overview);
    return eye ? { eye, center: overview.center, heading: overview.heading } : null;
  }
  return followCameraTarget();
}

function followCameraTarget() {
  const position = interpolateRoutePoint(state.route, state.progressMeters);
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

  let tilt = camera.tilt;
  let liftedCenterAltitude = centerAltitude;
  const liftMeters = currentTerrainLift(camera, centerAltitude);
  if (liftMeters > 0) {
    const lifted = applyCameraLift({
      tiltDegrees: camera.tilt,
      rangeMeters: camera.range,
      liftMeters,
    });
    tilt = lifted.tilt;
    liftedCenterAltitude = centerAltitude + lifted.extraCenterAltitude;
  }

  const center = { lat: camera.center.lat, lng: camera.center.lng, altitude: liftedCenterAltitude };
  const eye = cameraEyePosition({ center, range: camera.range, tilt, heading: camera.heading });
  return eye ? { eye, center, heading: camera.heading } : null;
}

// Advance the camera flight one step: chase the target's eye and look-at
// points with bounded acceleration (chaseStep), then write the map camera
// re-derived from the chased pair. Returns true once the flight has settled
// on its target.
function stepCameraFlight(now) {
  const target = cameraFlightTarget();
  if (!target) return true;

  if (!state.cameraFlight) {
    const pose = currentMapCameraPose();
    state.cameraFlight = {
      eye: pose?.eye ?? { ...target.eye },
      center: pose?.center ?? { ...target.center },
      eyeVelocity: [0, 0, 0],
      centerVelocity: [0, 0, 0],
      lastStepMs: now,
    };
  }

  const flight = state.cameraFlight;
  const dt = clamp((now - flight.lastStepMs) / 1000, 0, 0.5);
  flight.lastStepMs = now;

  let settled = false;
  if (dt > 0) {
    const eyeStep = chaseGeoPoint(flight.eye, flight.eyeVelocity, target.eye, dt);
    const centerStep = chaseGeoPoint(flight.center, flight.centerVelocity, target.center, dt);
    flight.eye = eyeStep.point;
    flight.eyeVelocity = eyeStep.velocity;
    flight.center = centerStep.point;
    flight.centerVelocity = centerStep.velocity;
    settled = eyeStep.settled && centerStep.settled;
  }

  const camera = cameraFromEyeAndCenter(flight.eye, flight.center, target.heading);
  state.map.center = { ...flight.center };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
  return settled;
}

// Chase one geo point toward its target in a local north/east/up meter
// frame; the velocity array persists across frames in that same frame.
function chaseGeoPoint(current, velocity, target, dt) {
  const horizontal = haversine(current, target);
  const towardTarget = toRad(bearing(current, target));
  const up = (Number(target.altitude) || 0) - (Number(current.altitude) || 0);
  const tuning = chaseTuning(Math.hypot(horizontal, up));
  const step = chaseStep({
    position: [0, 0, 0],
    velocity,
    target: [
      horizontal * Math.cos(towardTarget),
      horizontal * Math.sin(towardTarget),
      up,
    ],
    maxAcceleration: tuning.acceleration,
    maxSpeed: tuning.maxSpeed,
    dt,
  });

  const [north, east, lifted] = step.position;
  const moved = Math.hypot(north, east);
  const ground = moved > 0.001
    ? destinationPoint(current, Math.atan2(east, north) * 180 / Math.PI, moved)
    : { lat: current.lat, lng: current.lng };
  return {
    point: { ...ground, altitude: (Number(current.altitude) || 0) + lifted },
    velocity: step.velocity,
    settled: step.settled,
  };
}

function currentMapCameraPose() {
  const center = state.map?.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const range = Number(state.map?.range);
  const tilt = Number(state.map?.tilt);
  const heading = Number(state.map?.heading);
  if (![lat, lng, range, tilt, heading].every(Number.isFinite)) return null;

  const centerPoint = { lat, lng, altitude: Number(center?.altitude) || 0 };
  const eye = cameraEyePosition({ center: centerPoint, range, tilt, heading });
  return eye ? { eye, center: centerPoint } : null;
}

// The movement loop drives the camera while the rider moves; this loop keeps
// an in-progress flight animating when nothing else ticks — route just
// loaded, movement stopped mid-flight, or a seek/settings change while
// paused.
function ensureCameraFlightLoop() {
  if (state.cameraFlightLoopActive) return;
  state.cameraFlightLoopActive = true;
  const step = () => {
    if (
      !state.route.length || !state.map || state.userInteracting ||
      state.movementLoopActive || state.cameraMode === "manual"
    ) {
      state.cameraFlightLoopActive = false;
      return;
    }
    const settled = stepCameraFlight(performance.now());
    // Keep the ground dot's apparent size steady while the camera flies.
    if (state.riderDot) updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    if (settled) {
      state.cameraFlightLoopActive = false;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Frame the whole loaded route: start→end reads left-to-right, the side of
// the route bulging furthest from that axis faces away, seen from 45° with
// margin. The camera stays there until movement starts. A fresh load snaps
// there instantly (a new route can be on the other side of the world — no
// flight); a reset flies back smoothly.
function enterOverviewMode({ instant = false } = {}) {
  // A rider already moving (e.g. a new GPX loaded mid-pedaling) stays in the
  // follow view — the overview is for routes loaded at rest.
  if (!state.route.length || !state.map || isMoving()) return;
  const width = els.mapViewport?.clientWidth;
  const height = els.mapViewport?.clientHeight;
  state.overviewCamera = computeRouteOverviewCamera(state.route, {
    tiltDegrees: OVERVIEW_TILT_DEGREES,
    viewportAspect: width && height ? width / height : undefined,
    // Newer Maps versions expose the actual field of view; older ones fall
    // back to the module's default (Google's documented 35° default).
    fovDegrees: Number(state.map.fov) || undefined,
  });
  if (!state.overviewCamera) return;
  state.cameraMode = "overview";
  if (instant) {
    applyCameraNow(state.overviewCamera);
    return;
  }
  ensureCameraFlightLoop();
}

// Jump the map straight to `camera` with no flight, and park the chase state
// there (zero velocity) so the next target change starts a fresh smooth move.
function applyCameraNow(camera) {
  state.map.center = { ...camera.center };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;

  const eye = cameraEyePosition(camera);
  state.cameraFlight = eye
    ? {
      eye,
      center: { ...camera.center },
      eyeVelocity: [0, 0, 0],
      centerVelocity: [0, 0, 0],
      lastStepMs: performance.now(),
    }
    : null;
}

// --- Terrain avoidance ---------------------------------------------------------
//
// The follow camera can end up inside a hillside when the rider turns in
// front of rising terrain. Check the ground at several points along the view
// ray (eye through to the rider) against nearby route elevations, and when the
// ray would dip below terrain + clearance anywhere along it, lift the camera;
// the lift eases back to zero once the terrain allows. The lift is always
// computed from the configured (unlifted) camera, so it never feeds back on
// itself.

function currentTerrainLift(camera, centerAltitude) {
  if (!state.terrainAvoidEnabled) {
    state.cameraLiftMeters = 0;
    state.cameraLiftTargetMeters = 0;
    return 0;
  }

  const now = performance.now();
  if (now - state.lastLiftComputeMs >= TERRAIN_LIFT_RECOMPUTE_MS) {
    state.lastLiftComputeMs = now;
    state.cameraLiftTargetMeters = computeTerrainLiftTarget(camera, centerAltitude);
  }

  // Time-based smoothing, since frames tick at 60 fps in front and ~2 fps in
  // a hidden tab.
  const dt = clamp((now - state.lastLiftSmoothMs) / 1000, 0, 1);
  state.lastLiftSmoothMs = now;
  const tau = state.cameraLiftTargetMeters > state.cameraLiftMeters
    ? TERRAIN_LIFT_RISE_TAU_SECONDS
    : TERRAIN_LIFT_FALL_TAU_SECONDS;
  state.cameraLiftMeters += (state.cameraLiftTargetMeters - state.cameraLiftMeters) * (1 - Math.exp(-dt / tau));
  if (state.cameraLiftMeters < 0.5 && state.cameraLiftTargetMeters === 0) state.cameraLiftMeters = 0;
  return state.cameraLiftMeters;
}

function computeTerrainLiftTarget(camera, centerAltitude) {
  const eye = cameraEyePosition({
    center: { lat: camera.center.lat, lng: camera.center.lng, altitude: centerAltitude },
    range: camera.range,
    tilt: camera.tilt,
    heading: camera.heading,
  });
  if (!eye) return 0;

  // Sample the view ray at several points between the eye and the rider (a
  // ridge anywhere along it hides the rider just as badly as terrain at the
  // eye itself, and hairpin turns can hide a rise close to either end). The
  // required clearance tapers toward the rider, who genuinely is on the ground.
  let target = 0;
  for (const fraction of [0, 0.25, 0.5, 0.75]) {
    const samplePoint = {
      lat: lerp(eye.lat, camera.center.lat, fraction),
      lng: lerp(eye.lng, camera.center.lng, fraction),
    };
    const terrainEle = maxElevationNear(state.route, samplePoint, TERRAIN_SAMPLE_RADIUS_METERS);
    if (terrainEle === null) continue;
    const rayAltitude = lerp(eye.altitude, centerAltitude, fraction);
    const clearance = state.terrainClearanceMeters * (1 - fraction);
    target = Math.max(target, terrainEle + clearance - rayAltitude);
  }
  return target;
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
  if (state.cameraMode === "follow") {
    captureManualCameraSettings();
  } else if (state.cameraMode === "overview") {
    // The user took over the overview; leave the camera where they put it
    // (don't fly back, don't bake overview framing into the follow settings)
    // until movement starts.
    state.cameraMode = "manual";
  }
  state.userInteracting = false;
  // The next flight step restarts from wherever the gesture left the camera.
  state.cameraFlight = null;

  // The capture bakes whatever the user sees — including any active terrain
  // lift — into the camera settings, so the lift restarts from zero against
  // that new baseline instead of stacking on top of it.
  state.cameraLiftMeters = 0;
  state.cameraLiftTargetMeters = 0;

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
  els.cameraAngleOutput.value = `${Math.round(state.cameraAngleDegrees)} deg`;
  els.cameraBehindOutput.value = `${Math.round(state.cameraBehindMeters)} m`;
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

// --- Display & HUD settings -----------------------------------------------------

function updateDisplaySettingsFromControls() {
  state.showMinimap = els.minimapInput.checked;
  state.mapLabelsEnabled = els.mapLabelsInput.checked;
  els.hudToggles.forEach((input) => {
    state.hudElements[input.dataset.hudToggle] = input.checked;
  });
  saveSettings();
  applyDisplaySettings();
}

function syncDisplayControls() {
  els.minimapInput.checked = state.showMinimap;
  els.mapLabelsInput.checked = state.mapLabelsEnabled;
  els.hudToggles.forEach((input) => {
    input.checked = state.hudElements[input.dataset.hudToggle] !== false;
  });
}

function applyDisplaySettings() {
  els.minimap.classList.toggle("minimap-hidden", !state.showMinimap);
  els.hudTiles.forEach((tile) => {
    tile.hidden = state.hudElements[tile.dataset.hud] === false;
  });
  applyMapMode();
}

function applyMapMode() {
  const MapMode = state.maps3d?.MapMode;
  if (!state.map || !MapMode) return;
  state.map.mode = state.mapLabelsEnabled ? MapMode.HYBRID : MapMode.SATELLITE;
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

// The map-action-bar shortcut for resetCameraToDefaults: it also has to pull
// the camera out of "manual" mode (parked overview the user dragged away from
// while stationary — cameraMode can't be "manual" while moving, see
// ensureMovementLoop), or the default settings would apply invisibly while
// updateMapCamera keeps ignoring a manually-parked camera.
function resetCameraView() {
  resetCameraToDefaults();
  if (!isMoving()) enterOverviewMode();
}

function updateRenderingSettingsFromControls() {
  state.beaconEnabled = els.beaconEnabledInput.checked;
  state.beaconDiameterMeters = Number(els.beaconDiameterInput.value);
  state.beaconHeightMeters = Number(els.beaconHeightInput.value);
  state.beaconOpacity = Number(els.beaconOpacityInput.value);
  state.beaconColor = els.beaconColorInput.value;
  state.terrainAvoidEnabled = els.terrainAvoidInput.checked;
  state.terrainClearanceMeters = Number(els.terrainClearanceInput.value);
  updateRenderingSettingsLabels();
  saveSettings();
  rebuildRiderBeacon();
  updateRideUi();
}

function resetRenderingToDefaults() {
  state.beaconEnabled = DEFAULT_BEACON_ENABLED;
  state.beaconDiameterMeters = DEFAULT_BEACON_DIAMETER_METERS;
  state.beaconHeightMeters = DEFAULT_BEACON_HEIGHT_METERS;
  state.beaconOpacity = DEFAULT_BEACON_OPACITY;
  state.beaconColor = DEFAULT_BEACON_COLOR;
  state.terrainAvoidEnabled = DEFAULT_TERRAIN_AVOID_ENABLED;
  state.terrainClearanceMeters = DEFAULT_TERRAIN_CLEARANCE_METERS;
  syncRenderingControls();
  updateRenderingSettingsLabels();
  saveSettings();
  rebuildRiderBeacon();
  updateRideUi();
}

function rebuildRiderBeacon() {
  renderRiderBeacon();
  if (!state.route.length || !state.riderBeacon) return;
  state.lastRiderDot = null;
  updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
}

function syncRenderingControls() {
  els.beaconEnabledInput.checked = state.beaconEnabled;
  els.beaconDiameterInput.value = String(state.beaconDiameterMeters);
  els.beaconHeightInput.value = String(state.beaconHeightMeters);
  els.beaconOpacityInput.value = String(state.beaconOpacity);
  els.beaconColorInput.value = state.beaconColor;
  els.terrainAvoidInput.checked = state.terrainAvoidEnabled;
  els.terrainClearanceInput.value = String(state.terrainClearanceMeters);
}

function updateRenderingSettingsLabels() {
  els.beaconDiameterOutput.value = `${state.beaconDiameterMeters} m`;
  els.beaconHeightOutput.value = `${state.beaconHeightMeters} m`;
  els.beaconOpacityOutput.value = `${Math.round(state.beaconOpacity * 100)}%`;
  els.terrainClearanceOutput.value = `${state.terrainClearanceMeters} m`;
}

function updateScreenshotSettingsFromControls() {
  state.showScreenshotButton = els.screenshotButtonInput.checked;
  const aspect = els.screenshotAspectSelect.value;
  state.screenshotAspect = aspect === "viewport" || parseAspectRatio(aspect) ? aspect : DEFAULT_SCREENSHOT_ASPECT;
  state.screenshotWidth = clamp(
    Math.round(Number(els.screenshotWidthSelect.value)) || DEFAULT_SCREENSHOT_WIDTH,
    SCREENSHOT_WIDTH_MIN,
    SCREENSHOT_WIDTH_MAX,
  );
  saveSettings();
  applyScreenshotButtonVisibility();
}

function applyScreenshotButtonVisibility() {
  els.screenshotBtn.hidden = !state.showScreenshotButton || !screenshotSupported();
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

// --- Screenshots -----------------------------------------------------------------

async function takeMapScreenshot() {
  if (state.screenshotInProgress) return;
  state.screenshotInProgress = true;
  // Hide our own buttons for the shot; the map's Google attribution stays.
  els.mapViewport.classList.add("capturing");
  updateProgressLabel("Choose “This Tab” in the share dialog to save the screenshot…");
  try {
    await captureViewportJpeg(els.mapViewport, updateProgressLabel, {
      aspectRatio: parseAspectRatio(state.screenshotAspect),
      outputWidth: state.screenshotWidth,
    });
  } finally {
    els.mapViewport.classList.remove("capturing");
    state.screenshotInProgress = false;
  }
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

  if (typeof settings?.beaconEnabled === "boolean") {
    state.beaconEnabled = settings.beaconEnabled;
  }

  const beaconDiameter = Number(settings?.beaconDiameterMeters);
  if (Number.isFinite(beaconDiameter)) {
    state.beaconDiameterMeters = clamp(beaconDiameter, Number(els.beaconDiameterInput.min), Number(els.beaconDiameterInput.max));
  }

  const beaconHeight = Number(settings?.beaconHeightMeters);
  if (Number.isFinite(beaconHeight)) {
    state.beaconHeightMeters = clamp(beaconHeight, Number(els.beaconHeightInput.min), Number(els.beaconHeightInput.max));
  }

  const beaconOpacity = Number(settings?.beaconOpacity);
  if (Number.isFinite(beaconOpacity)) {
    state.beaconOpacity = clamp(beaconOpacity, Number(els.beaconOpacityInput.min), Number(els.beaconOpacityInput.max));
  }

  if (typeof settings?.beaconColor === "string" && BEACON_COLOR_PATTERN.test(settings.beaconColor)) {
    state.beaconColor = settings.beaconColor;
  }

  if (typeof settings?.terrainAvoidEnabled === "boolean") {
    state.terrainAvoidEnabled = settings.terrainAvoidEnabled;
  }

  const terrainClearance = Number(settings?.terrainClearanceMeters);
  if (Number.isFinite(terrainClearance)) {
    state.terrainClearanceMeters = clamp(terrainClearance, Number(els.terrainClearanceInput.min), Number(els.terrainClearanceInput.max));
  }

  if (typeof settings?.showScreenshotButton === "boolean") {
    state.showScreenshotButton = settings.showScreenshotButton;
  }

  const savedAspect = settings?.screenshotAspect;
  if (savedAspect === "viewport" || parseAspectRatio(savedAspect)) {
    state.screenshotAspect = savedAspect;
  }

  const savedShotWidth = Number(settings?.screenshotWidth);
  if (Number.isFinite(savedShotWidth)) {
    state.screenshotWidth = clamp(Math.round(savedShotWidth), SCREENSHOT_WIDTH_MIN, SCREENSHOT_WIDTH_MAX);
  }

  if (typeof settings?.showMinimap === "boolean") {
    state.showMinimap = settings.showMinimap;
  }

  if (typeof settings?.mapLabelsEnabled === "boolean") {
    state.mapLabelsEnabled = settings.mapLabelsEnabled;
  }

  if (settings?.hudElements && typeof settings.hudElements === "object") {
    // Only known keys, only booleans — unknown junk in storage is ignored.
    for (const key of Object.keys(state.hudElements)) {
      if (typeof settings.hudElements[key] === "boolean") {
        state.hudElements[key] = settings.hudElements[key];
      }
    }
  }

  els.centerRiderInput.checked = state.centerRider;
  els.gradeIntervalInput.value = String(state.gradeUpdateIntervalSeconds);
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  els.distanceUnitSelect.value = state.distanceUnits;
  els.energyUnitSelect.value = state.energyUnits;
  updateSpeedOutput();
  syncCameraControls();
  updateCameraSettingsLabels();
  syncRenderingControls();
  updateRenderingSettingsLabels();
  els.screenshotButtonInput.checked = state.showScreenshotButton;
  els.screenshotAspectSelect.value = state.screenshotAspect;
  els.screenshotWidthSelect.value = String(state.screenshotWidth);
  applyScreenshotButtonVisibility();
  syncDisplayControls();
  applyDisplaySettings();
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
    beaconEnabled: state.beaconEnabled,
    beaconDiameterMeters: state.beaconDiameterMeters,
    beaconHeightMeters: state.beaconHeightMeters,
    beaconOpacity: state.beaconOpacity,
    beaconColor: state.beaconColor,
    terrainAvoidEnabled: state.terrainAvoidEnabled,
    terrainClearanceMeters: state.terrainClearanceMeters,
    showScreenshotButton: state.showScreenshotButton,
    screenshotAspect: state.screenshotAspect,
    screenshotWidth: state.screenshotWidth,
    gradeUpdateIntervalSeconds: state.gradeUpdateIntervalSeconds,
    distanceUnits: state.distanceUnits,
    energyUnits: state.energyUnits,
    showMinimap: state.showMinimap,
    mapLabelsEnabled: state.mapLabelsEnabled,
    hudElements: { ...state.hudElements },
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
  state.routeName = typeof savedRide.name === "string" ? savedRide.name : null;
  state.progressMeters = clamp(Number(savedRide.progressMeters) || 0, 0, routeTotalDistance(state.route));
  state.simulating = false;
  state.lastTick = 0;

  enterOverviewMode({ instant: true });
  updateStartButton();
  renderRoute();
  renderProfile();
  updateRouteOverview();
  updateRideUi({ force: true });
  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
}

function saveRideThrottled() {
  const now = performance.now();
  if (now - state.lastRideSavedAt < RIDE_SAVE_THROTTLE_MS) return;
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
    name: state.routeName,
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
