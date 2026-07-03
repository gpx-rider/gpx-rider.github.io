import {
  computeFollowCamera,
  measureCameraOffset,
  normalizeHeading,
  rangeForBehind,
  signedHeadingDelta,
} from "./camera.mjs";

const MAPS_API_KEY_STORAGE_KEY = "gpx-rider:maps-api-key";
const DEFAULT_CAMERA_ZOOM = 2.5;
const DEFAULT_CAMERA_ANGLE_DEGREES = 75;
const DEFAULT_CAMERA_BEHIND_METERS = 800;
const RESET_CAMERA_ZOOM = DEFAULT_CAMERA_ZOOM;
const RESET_CAMERA_ANGLE_DEGREES = DEFAULT_CAMERA_ANGLE_DEGREES;
const RESET_CAMERA_BEHIND_METERS = DEFAULT_CAMERA_BEHIND_METERS;
const SETTINGS_STORAGE_KEY = "gpx-rider:settings";
const HEADING_SAMPLE_METERS = 4;
const INTERACTION_SETTLE_MS = 600;
const CAMERA_ZOOM_MIN = 0.05;
const CAMERA_ZOOM_MAX = 20;
const CAMERA_PAN_LIMIT_METERS = 5000;
const CAMERA_CENTER_ALTITUDE_LIMIT_METERS = 3000;
const CAMERA_TILT_MIN = 1;
const CAMERA_TILT_MAX = 89;
const DEFAULT_GRADE_INTERVAL_SECONDS = 2;
const GRADE_INTERVAL_MIN_SECONDS = 1;
const GRADE_INTERVAL_MAX_SECONDS = 5;

const PROFILE_PADDING_LEFT = 44;
const PROFILE_PADDING_RIGHT = 14;
const PROFILE_PADDING_TOP = 10;
const PROFILE_PADDING_BOTTOM = 22;
const PROFILE_GRADE_STEEP_PERCENT = 12;
const PROFILE_BAR_SAMPLE_PX = 4;
const ELEVATION_STEP_CANDIDATES = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const DISTANCE_STEP_METERS_CANDIDATES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const DISTANCE_STEP_KM_CANDIDATES = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

const PROFILE_THEME_LIGHT = {
  background: "#f9faf8",
  gridline: "rgba(23, 33, 31, 0.12)",
  label: "#66716d",
  line: "#24312e",
  axisLine: "rgba(23, 33, 31, 0.25)",
  marker: "#24312e",
  hoverGuide: "rgba(23, 33, 31, 0.45)",
};
const PROFILE_THEME_DARK = {
  background: "rgba(23, 33, 31, 0.55)",
  gridline: "rgba(255, 255, 255, 0.16)",
  label: "rgba(255, 255, 255, 0.8)",
  line: "#ffffff",
  axisLine: "rgba(255, 255, 255, 0.35)",
  marker: "#ffffff",
  hoverGuide: "rgba(255, 255, 255, 0.55)",
};

const FTMS_SERVICE = 0x1826;
const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
const FTMS_CONTROL_POINT = 0x2ad9;
const FTMS_STATUS = 0x2ada;
const OP_REQUEST_CONTROL = 0x00;
const OP_RESET = 0x01;
const OP_START_OR_RESUME = 0x07;
const OP_STOP_OR_PAUSE = 0x08;
const OP_SET_SIMULATION = 0x11;
const FTMS_RESPONSE_CODE = 0x80;
const FTMS_RESULT_TEXT = {
  0x01: "Success",
  0x02: "Op code not supported",
  0x03: "Invalid parameter",
  0x04: "Operation failed",
  0x05: "Control not permitted",
};
const FTMS_OPCODE_NAMES = {
  [OP_REQUEST_CONTROL]: "Request Control",
  [OP_RESET]: "Reset",
  [OP_START_OR_RESUME]: "Start/Resume",
  [OP_STOP_OR_PAUSE]: "Stop/Pause",
  [OP_SET_SIMULATION]: "Set Simulation",
};
const RIDE_STORAGE_KEY = "gpx-rider:last-ride";
const TRAINER_STORAGE_KEY = "gpx-rider:last-trainer";

const state = {
  route: [],
  progressMeters: 0,
  riding: false,
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
  trainer: null,
  controlPoint: null,
  bikeData: null,
  bleWriteQueue: Promise.resolve(),
  trainerSpeedKph: null,
  trainerPowerWatts: null,
  gradeUpdateIntervalSeconds: DEFAULT_GRADE_INTERVAL_SECONDS,
  gradeSampleSum: 0,
  gradeSampleCount: 0,
  lastGradeAttemptAt: 0,
  lastGradeSentRaw: null,
  gradeWriteInFlight: false,
  lastSlowUiAt: 0,
  lastRiderDot: null,
  lastRideSavedAt: 0,
  profileHoverMeters: null,
  userInteracting: false,
  interactionSettleTimer: null,
  cameraZoom: DEFAULT_CAMERA_ZOOM,
  cameraAngleDegrees: DEFAULT_CAMERA_ANGLE_DEGREES,
  cameraBehindMeters: DEFAULT_CAMERA_BEHIND_METERS,
  cameraHeadingOffsetDegrees: 0,
  cameraOffsetForwardMeters: 0,
  cameraOffsetRightMeters: 0,
  cameraCenterAltitudeOffsetMeters: 0,
  centerRider: true,
  mapFullscreen: false,
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
  speedInput: document.querySelector("#speedInput"),
  speedOutput: document.querySelector("#speedOutput"),
  gradeIntervalInput: document.querySelector("#gradeIntervalInput"),
  gradeIntervalOutput: document.querySelector("#gradeIntervalOutput"),
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
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  browseGalleryBtn: document.querySelector("#browseGalleryBtn"),
  progress: document.querySelector("#progress"),
  progressLabel: document.querySelector("#progressLabel"),
  profile: document.querySelector("#profile"),
  mapViewport: document.querySelector("#mapViewport"),
  minimap: document.querySelector("#minimap"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
  fullscreenOverlayBottom: document.querySelector("#fullscreenOverlayBottom"),
  hudPowerStat: document.querySelector("#hudPowerStat"),
  hudSpeedStat: document.querySelector("#hudSpeedStat"),
  hudGradeStat: document.querySelector("#hudGradeStat"),
  hudRiddenStat: document.querySelector("#hudRiddenStat"),
  hudRemainingStat: document.querySelector("#hudRemainingStat"),
};

startApp();

async function startApp() {
  restoreSettings();
  els.mapsApiKeyInput.value = getStoredMapsApiKey();
  await initMap();
  bindEvents();
  restoreSavedRide();
  void reconnectSavedTrainer();
  void initGallery();
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
    els.speedOutput.value = `${els.speedInput.value} km/h`;
    saveRide();
  });
  els.gradeIntervalInput.addEventListener("input", updateGradeIntervalFromControl);
  els.cameraZoomInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraAngleInput.addEventListener("input", updateCameraSettingsFromControls);
  els.cameraBehindInput.addEventListener("input", updateCameraSettingsFromControls);
  els.centerRiderInput.addEventListener("change", updateCenterRiderFromControl);
  els.resetCameraBtn.addEventListener("click", resetCameraToDefaults);
  els.connectBtn.addEventListener("click", connectTrainer);
  els.startBtn.addEventListener("click", toggleRide);
  els.resetBtn.addEventListener("click", resetRide);
  els.profile.addEventListener("mousemove", handleProfileHover);
  els.profile.addEventListener("mouseleave", handleProfileLeave);
  els.profile.addEventListener("click", handleProfileClick);
  els.fullscreenBtn.addEventListener("click", toggleMapFullscreen);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mapFullscreen) exitMapFullscreen();
  });
  window.addEventListener("beforeunload", saveRide);
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
  state.riding = false;
  state.lastTick = 0;
  state.profileHoverMeters = null;
  renderRoute();
  drawProfile();
  updateRideUi();
  saveRide();

  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
}

async function initGallery() {
  try {
    const response = await fetch("./gallery.json");
    if (!response.ok) return;
    const data = await response.json();
    if (!data.routes?.length) return;
    renderGallery(data.routes);
  } catch {
    // gallery.json not present — gallery stays hidden
  }
}

function renderGallery(routes) {
  const section = document.getElementById("gallery");
  const grid = document.getElementById("galleryGrid");

  for (const route of routes) {
    const card = document.createElement("article");
    card.className = "gallery-card";

    if (route.screenshot) {
      const img = document.createElement("img");
      img.src = route.screenshot;
      img.alt = route.title;
      img.className = "gallery-card-img";
      img.loading = "lazy";
      card.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "gallery-card-body";

    const title = document.createElement("h3");
    title.className = "gallery-card-title";
    title.textContent = route.title;

    const desc = document.createElement("p");
    desc.className = "gallery-card-desc";
    desc.innerHTML = route.description
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gallery-card-btn";
    btn.textContent = "Load ride";
    btn.addEventListener("click", () => loadGpxFromUrl(route.gpx));

    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(btn);
    card.appendChild(body);
    grid.appendChild(card);
  }

  section.hidden = false;
  els.browseGalleryBtn.hidden = false;
  els.browseGalleryBtn.addEventListener("click", () => {
    section.scrollIntoView({ behavior: "smooth" });
  });
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) return [];

  return [...doc.querySelectorAll("trkpt, rtept")].map((point) => ({
    lat: Number(point.getAttribute("lat")),
    lng: Number(point.getAttribute("lon")),
    ele: Number(point.querySelector("ele")?.textContent ?? 0),
  })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function enrichRoute(points) {
  let distance = 0;
  return points.map((point, index) => {
    if (index > 0) distance += haversine(points[index - 1], point);
    return { ...point, distance };
  });
}

function renderRoute() {
  renderMinimapRoute();

  if (!state.map) {
    updateProgressLabel("Photorealistic 3D Maps are not available, so the route cannot be displayed.");
    return;
  }

  clearRouteFromMap();
  const currentPoint = interpolateRoutePoint(state.progressMeters);
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
  const path = state.route.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    altitude: 0,
  }));

  if (Polyline3DElement) {
    state.routeOutline = new Polyline3DElement({
      altitudeMode: AltitudeMode?.CLAMP_TO_GROUND,
      path,
      strokeColor: "rgba(255, 255, 255, 0.72)",
      strokeWidth: 14,
    });
    state.map.append(state.routeOutline);

    state.line = new Polyline3DElement({
      altitudeMode: AltitudeMode?.CLAMP_TO_GROUND,
      path,
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
  const path = riderCircleCoordinates(point, riderDotRadiusMeters());
  state.riderDotOutline = new Polyline3DElement({
    altitudeMode: AltitudeMode?.CLAMP_TO_GROUND,
    path,
    strokeColor: "#ffffff",
    strokeWidth: 10,
  });
  state.map.append(state.riderDotOutline);

  state.riderDot = new Polyline3DElement({
    altitudeMode: AltitudeMode?.CLAMP_TO_GROUND,
    path,
    strokeColor: "#0a84ff",
    strokeWidth: 6,
  });
  state.map.append(state.riderDot);
}

function riderDotRadiusMeters() {
  // Scale the dot with the camera distance so it reads like Apple Maps'
  // fixed-size GPS dot instead of a ground decal that grows as you zoom in.
  const range = Number(state.map?.range);
  return clamp((Number.isFinite(range) && range > 0 ? range : 800) / 90, 2.5, 45);
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

function toggleRide() {
  state.riding = !state.riding;
  els.startBtn.textContent = state.riding ? "Pause" : "Start";
  state.lastTick = performance.now();
  if (state.riding) {
    void sendTrainerCommand(OP_START_OR_RESUME);
    requestAnimationFrame(tick);
  } else {
    void sendTrainerCommand(OP_STOP_OR_PAUSE, [0x02]);
    saveRide();
  }
}

function resetRide() {
  state.riding = false;
  state.progressMeters = 0;
  state.lastTick = 0;
  els.startBtn.textContent = "Start";
  updateRideUi();
  saveRide();
  void sendTrainerGrade(0);
}

function tick(now) {
  if (!state.riding || state.route.length < 2) return;

  const elapsedSeconds = (now - state.lastTick) / 1000;
  state.lastTick = now;
  const speedKph = Number.isFinite(state.trainerSpeedKph) ? state.trainerSpeedKph : Number(els.speedInput.value);
  const metersPerSecond = speedKph / 3.6;
  const totalDistance = state.route.at(-1).distance;

  state.progressMeters = Math.min(totalDistance, state.progressMeters + metersPerSecond * elapsedSeconds);
  updateRideUi();
  saveRideThrottled();

  if (state.progressMeters >= totalDistance) {
    state.riding = false;
    els.startBtn.textContent = "Start";
    saveRide();
    void sendTrainerGrade(0);
    return;
  }

  requestAnimationFrame(tick);
}

function updateRideUi(options = {}) {
  if (!state.route.length) return;

  const point = interpolateRoutePoint(state.progressMeters);

  if (state.riderDot) {
    updateRiderDot(point);
    updateMapCamera({ lat: point.lat, lng: point.lng, ele: point.ele });
  }

  // Per-frame work ends here. DOM stats, the profile canvas, and the trainer
  // grade only need a few updates per second while riding.
  const now = performance.now();
  if (!options.force && state.riding && now - state.lastSlowUiAt < 250) return;
  state.lastSlowUiAt = now;

  const totalDistance = state.route.at(-1).distance;
  const grade = currentGrade(state.progressMeters);
  const progress = totalDistance ? state.progressMeters / totalDistance : 0;
  const riddenKm = state.progressMeters / 1000;
  const remainingKm = (totalDistance - state.progressMeters) / 1000;

  els.distanceStat.textContent = `${(totalDistance / 1000).toFixed(1)} km`;
  els.gradeStat.textContent = `${grade.toFixed(1)}%`;
  els.altitudeStat.textContent = `${Math.round(point.ele)} m`;
  els.progress.value = progress;
  updateProgressLabel(`${riddenKm.toFixed(2)} km of ${(totalDistance / 1000).toFixed(2)} km`);
  drawProfile(progress);
  updateMinimapPosition(point);
  updateCameraSettingsLabels();

  els.hudGradeStat.textContent = `${grade.toFixed(1)}%`;
  els.hudRiddenStat.textContent = `${riddenKm.toFixed(2)} km`;
  els.hudRemainingStat.textContent = `${remainingKm.toFixed(2)} km`;

  queueTrainerGradeSample(grade, options);
}

function queueTrainerGradeSample(gradePercent, options = {}) {
  // Average every sample seen since the last send instead of firing the
  // instantaneous value: smooths out point-to-point jitter (2.9/3.0/2.9)
  // and, combined with the hard interval below, guarantees we never enqueue
  // BLE writes faster than the trainer can actually process them.
  state.gradeSampleSum += gradePercent;
  state.gradeSampleCount += 1;

  const now = performance.now();
  const intervalMs = clamp(state.gradeUpdateIntervalSeconds, GRADE_INTERVAL_MIN_SECONDS, GRADE_INTERVAL_MAX_SECONDS) * 1000;
  const dueForSend = options.force || state.lastGradeAttemptAt === 0 || now - state.lastGradeAttemptAt >= intervalMs;
  if (!dueForSend) return;

  const averageGrade = state.gradeSampleSum / state.gradeSampleCount;
  state.gradeSampleSum = 0;
  state.gradeSampleCount = 0;
  state.lastGradeAttemptAt = now;

  void sendTrainerGrade(averageGrade);
}

function handleProfileHover(event) {
  const distance = distanceAtProfileX(event.clientX);
  if (distance === null) return;
  state.profileHoverMeters = distance;
  drawProfile(currentRideProgress());
}

function handleProfileLeave() {
  if (state.profileHoverMeters === null) return;
  state.profileHoverMeters = null;
  drawProfile(currentRideProgress());
}

function handleProfileClick(event) {
  const distance = distanceAtProfileX(event.clientX);
  if (distance === null) return;
  state.progressMeters = distance;
  state.lastTick = performance.now();
  updateRideUi({ force: true });
  saveRide();
}

function distanceAtProfileX(clientX) {
  if (!state.route.length) return null;

  const rect = els.profile.getBoundingClientRect();
  const chartLeft = PROFILE_PADDING_LEFT;
  const chartRight = rect.width - PROFILE_PADDING_RIGHT;
  const chartWidth = Math.max(1, chartRight - chartLeft);
  const x = clamp(clientX - rect.left, chartLeft, chartRight);
  const totalDistance = state.route.at(-1).distance;
  return ((x - chartLeft) / chartWidth) * totalDistance;
}

function currentRideProgress() {
  if (!state.route.length) return 0;
  const totalDistance = state.route.at(-1).distance || 1;
  return state.progressMeters / totalDistance;
}

function updateRiderDot(position) {
  const radius = riderDotRadiusMeters();

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

  const path = riderCircleCoordinates(position, radius);
  if (state.riderDotOutline) state.riderDotOutline.path = path;
  if (state.riderDot) state.riderDot.path = path;
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

function updateGradeIntervalFromControl() {
  state.gradeUpdateIntervalSeconds = clamp(
    Number(els.gradeIntervalInput.value),
    GRADE_INTERVAL_MIN_SECONDS,
    GRADE_INTERVAL_MAX_SECONDS,
  );
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  saveSettings();
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
  state.cameraZoom = RESET_CAMERA_ZOOM;
  state.cameraAngleDegrees = RESET_CAMERA_ANGLE_DEGREES;
  state.cameraBehindMeters = RESET_CAMERA_BEHIND_METERS;
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
  const rider = state.route.length ? interpolateRoutePoint(state.progressMeters) : null;

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
  const total = state.route.at(-1).distance;
  const from = interpolateRoutePoint(clamp(state.progressMeters - HEADING_SAMPLE_METERS, 0, total));
  const to = interpolateRoutePoint(clamp(state.progressMeters + HEADING_SAMPLE_METERS, 0, total));
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

  els.centerRiderInput.checked = state.centerRider;
  els.gradeIntervalInput.value = String(state.gradeUpdateIntervalSeconds);
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  syncCameraControls();
  updateCameraSettingsLabels();
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
    cameraZoom: state.cameraZoom,
    cameraAngleDegrees: state.cameraAngleDegrees,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraHeadingOffsetDegrees: state.cameraHeadingOffsetDegrees,
    cameraOffsetForwardMeters: state.cameraOffsetForwardMeters,
    cameraOffsetRightMeters: state.cameraOffsetRightMeters,
    cameraCenterAltitudeOffsetMeters: state.cameraCenterAltitudeOffsetMeters,
    centerRider: state.centerRider,
    gradeUpdateIntervalSeconds: state.gradeUpdateIntervalSeconds,
  }));
}

function restoreSavedRide() {
  const savedRide = readJson(RIDE_STORAGE_KEY);
  const savedSpeed = Number(savedRide?.speedKph);

  if (Number.isFinite(savedSpeed)) {
    els.speedInput.value = String(clamp(savedSpeed, Number(els.speedInput.min), Number(els.speedInput.max)));
    els.speedOutput.value = `${els.speedInput.value} km/h`;
  }

  if (!savedRide?.route?.length) {
    drawEmptyProfile();
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
    drawEmptyProfile();
    return;
  }

  state.route = enrichRoute(route);
  state.progressMeters = clamp(Number(savedRide.progressMeters) || 0, 0, state.route.at(-1).distance);
  state.riding = false;
  state.lastTick = 0;

  renderRoute();
  drawProfile(state.progressMeters / (state.route.at(-1).distance || 1));
  updateRideUi();
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
    localStorage.removeItem(RIDE_STORAGE_KEY);
    return;
  }

  const route = state.route.map((point) => ({
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
    ele: Math.round(point.ele * 10) / 10,
  }));

  try {
    localStorage.setItem(RIDE_STORAGE_KEY, JSON.stringify({
      route,
      progressMeters: Math.round(state.progressMeters),
      speedKph: Number(els.speedInput.value),
      savedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn("Could not save this route locally.", error);
    updateProgressLabel("This GPX is too large to save locally, but the ride still works.");
  }
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function interpolateRoutePoint(distance) {
  const route = state.route;
  if (distance <= route[0].distance) return route[0];
  if (distance >= route.at(-1).distance) return route.at(-1);

  let low = 0;
  let high = route.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (route[mid].distance < distance) low = mid;
    else high = mid;
  }

  const previous = route[low];
  const next = route[high];
  const span = next.distance - previous.distance || 1;
  const ratio = (distance - previous.distance) / span;

  return {
    lat: lerp(previous.lat, next.lat, ratio),
    lng: lerp(previous.lng, next.lng, ratio),
    ele: lerp(previous.ele, next.ele, ratio),
  };
}

function currentGrade(distance) {
  const lookBehind = Math.max(0, distance - 18);
  const lookAhead = Math.min(state.route.at(-1).distance, distance + 18);
  const from = interpolateRoutePoint(lookBehind);
  const to = interpolateRoutePoint(lookAhead);
  const horizontal = Math.max(1, lookAhead - lookBehind);
  const rawGrade = ((to.ele - from.ele) / horizontal) * 100;
  return clamp(rawGrade, -15, 20);
}

async function connectTrainer() {
  if (!navigator.bluetooth) {
    els.trainerStat.textContent = "Use Chrome";
    updateProgressLabel("Web Bluetooth is available in Chrome or Edge, not Safari.");
    return;
  }

  try {
    els.trainerStat.textContent = "Pairing";
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }, { namePrefix: "KICKR" }],
      optionalServices: [FTMS_SERVICE],
    });

    await connectTrainerDevice(device);
  } catch (error) {
    console.error(error);
    els.trainerStat.textContent = "Failed";
    updateProgressLabel(error.message || "Could not connect to the trainer.");
  }
}

async function reconnectSavedTrainer() {
  const savedTrainer = readJson(TRAINER_STORAGE_KEY);
  if (!savedTrainer || !navigator.bluetooth?.getDevices) return;

  try {
    els.trainerStat.textContent = "Reconnecting";
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((candidate) => (
      candidate.id === savedTrainer.id ||
      candidate.name === savedTrainer.name ||
      candidate.name?.startsWith("KICKR")
    ));

    if (!device) {
      els.trainerStat.textContent = savedTrainer.name || "Saved";
      return;
    }

    await connectTrainerDevice(device);
  } catch (error) {
    console.warn("Could not reconnect saved trainer.", error);
    els.trainerStat.textContent = savedTrainer.name || "Saved";
  }
}

async function connectTrainerDevice(device) {
  device.addEventListener("gattserverdisconnected", () => {
    state.trainer = null;
    state.controlPoint = null;
    state.bikeData = null;
    state.bleWriteQueue = Promise.resolve();
    state.trainerSpeedKph = null;
    state.trainerPowerWatts = null;
    updateTelemetryUi();
    els.trainerStat.textContent = "Disconnected";
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(FTMS_SERVICE);
  state.controlPoint = await service.getCharacteristic(FTMS_CONTROL_POINT);
  await subscribeToControlPointResponses();
  await subscribeToBikeData(service);

  try {
    const status = await service.getCharacteristic(FTMS_STATUS);
    await status.startNotifications();
  } catch {
    // Some trainers expose indications only on the control point.
  }

  state.trainer = device;
  localStorage.setItem(TRAINER_STORAGE_KEY, JSON.stringify({
    id: device.id,
    name: device.name || "KICKR",
    savedAt: new Date().toISOString(),
  }));
  await sendTrainerCommand(OP_REQUEST_CONTROL);

  // Clears any stale ERG/resistance target left over from a previous
  // session (Zwift, TrainerRoad, etc.) — some trainers keep enforcing that
  // target and silently ignore Set Simulation Parameters until reset.
  await sendTrainerCommand(OP_RESET);

  els.trainerStat.textContent = device.name || "Connected";
}

async function subscribeToControlPointResponses() {
  try {
    state.controlPoint.addEventListener("characteristicvaluechanged", handleControlPointResponse);
    await state.controlPoint.startNotifications();
  } catch (error) {
    console.warn("Control point responses are not available.", error);
  }
}

function handleControlPointResponse(event) {
  const data = event.target.value;
  if (data.byteLength < 3 || data.getUint8(0) !== FTMS_RESPONSE_CODE) return;

  const requestOpcode = data.getUint8(1);
  const resultCode = data.getUint8(2);
  const resultText = FTMS_RESULT_TEXT[resultCode] || `Error ${resultCode}`;
  const opcodeName = FTMS_OPCODE_NAMES[requestOpcode] || `0x${requestOpcode.toString(16)}`;

  console.debug(`[trainer] response: ${opcodeName} -> ${resultText}`);

  if (resultCode !== 0x01) {
    els.trainerStat.textContent = resultText;
  }
}

async function subscribeToBikeData(service) {
  try {
    state.bikeData = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
    state.bikeData.addEventListener("characteristicvaluechanged", handleBikeData);
    await state.bikeData.startNotifications();
  } catch (error) {
    console.warn("Indoor Bike Data notifications are not available.", error);
  }
}

function handleBikeData(event) {
  const data = event.target.value;
  const flags = data.getUint16(0, true);
  let index = 2;

  if ((flags & 0x0001) === 0 && index + 2 <= data.byteLength) {
    state.trainerSpeedKph = data.getUint16(index, true) / 100;
    index += 2;
  }

  if (flags & 0x0002) index += 2;
  if (flags & 0x0004) index += 2;
  if (flags & 0x0008) index += 2;
  if (flags & 0x0010) index += 3;
  if (flags & 0x0020) index += 2;

  if ((flags & 0x0040) && index + 2 <= data.byteLength) {
    state.trainerPowerWatts = data.getInt16(index, true);
    index += 2;
  }

  updateTelemetryUi();
}

function updateTelemetryUi() {
  const powerText = Number.isFinite(state.trainerPowerWatts) ? `${state.trainerPowerWatts} W` : "--";
  const speedText = Number.isFinite(state.trainerSpeedKph) ? `${state.trainerSpeedKph.toFixed(1)} km/h` : "--";
  els.powerStat.textContent = powerText;
  els.speedStat.textContent = speedText;
  els.hudPowerStat.textContent = powerText;
  els.hudSpeedStat.textContent = speedText;
}

async function sendTrainerGrade(gradePercent) {
  if (!state.controlPoint) return;

  // Never let a slow write build a backlog: if one is still in flight, skip
  // this attempt entirely rather than queueing another. The next window
  // (or the next queueTrainerGradeSample call) will pick up wherever the
  // rider actually is by then.
  if (state.gradeWriteInFlight) {
    console.debug(`[trainer] grade ${gradePercent.toFixed(1)}% dropped, previous write still in flight`);
    return;
  }

  const grade = Math.round(gradePercent * 100);
  if (grade === state.lastGradeSentRaw) return;

  const payload = [
    OP_SET_SIMULATION,
    0x00, 0x00,
    grade & 0xff, (grade >> 8) & 0xff,
    0x40,
    0x51,
  ];

  console.debug(`[trainer] sending grade ${gradePercent.toFixed(1)}% (raw int16 ${grade})`);
  state.gradeWriteInFlight = true;

  try {
    await sendBytes(payload);
    state.lastGradeSentRaw = grade;
    clearTrainerErrorStat();
    console.debug(`[trainer] grade ${gradePercent.toFixed(1)}% write acknowledged`);
  } catch (error) {
    console.error(`[trainer] grade ${gradePercent.toFixed(1)}% write failed`, error);
    els.trainerStat.textContent = "BLE error";
  } finally {
    state.gradeWriteInFlight = false;
  }
}

async function sendTrainerCommand(opcode, payload = []) {
  if (!state.controlPoint) return;
  const opcodeName = FTMS_OPCODE_NAMES[opcode] || `0x${opcode.toString(16)}`;
  console.debug(`[trainer] sending command ${opcodeName}`);
  try {
    await sendBytes([opcode, ...payload]);
    clearTrainerErrorStat();
    console.debug(`[trainer] command ${opcodeName} acknowledged`);
  } catch (error) {
    console.error(`[trainer] command ${opcodeName} failed`, error);
    els.trainerStat.textContent = "BLE error";
  }
}

function clearTrainerErrorStat() {
  if (els.trainerStat.textContent === "BLE error") {
    els.trainerStat.textContent = state.trainer?.name || "Connected";
  }
}

function sendBytes(bytes) {
  // The device only allows one outstanding GATT operation at a time.
  // Grade writes fire independently of Start/Pause/Reset commands, so
  // without a queue two overlapping writes throw "GATT operation already
  // in progress" and the losing write is simply never applied.
  const task = state.bleWriteQueue.then(() => writeBytesNow(bytes));
  state.bleWriteQueue = task.catch(() => {});
  return task;
}

async function writeBytesNow(bytes) {
  // FTMS requires the Control Point to be written with a Write Request
  // (writeValue) so the machine treats it as a real control transaction and
  // sends back a Response Code indication. Write Without Response is a
  // fire-and-forget command some machines silently accept without ever
  // applying it. Only fall back to it for non-compliant peripherals that
  // don't support Write Request at all.
  try {
    await state.controlPoint.writeValue(new Uint8Array(bytes));
  } catch {
    await state.controlPoint.writeValueWithoutResponse(new Uint8Array(bytes));
  }
}

function drawEmptyProfile() {
  const canvas = els.profile;
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = state.mapFullscreen ? PROFILE_THEME_DARK : PROFILE_THEME_LIGHT;
  fillProfileBackground(ctx, theme, width, height);
}

function fillProfileBackground(ctx, theme, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  if (state.mapFullscreen) {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 10);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, width, height);
  }
}

function drawProfile(progress = 0) {
  const route = state.route;
  const canvas = els.profile;
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = state.mapFullscreen ? PROFILE_THEME_DARK : PROFILE_THEME_LIGHT;

  fillProfileBackground(ctx, theme, width, height);

  if (route.length < 2) return;

  const chartLeft = PROFILE_PADDING_LEFT;
  const chartRight = width - PROFILE_PADDING_RIGHT;
  const chartTop = PROFILE_PADDING_TOP;
  const chartBottom = height - PROFILE_PADDING_BOTTOM;
  const chartWidth = Math.max(1, chartRight - chartLeft);
  const totalDistance = route.at(-1).distance || 1;

  const elevations = route.map((point) => point.ele);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);
  const paddedMin = min - span * 0.08;
  const paddedMax = max + span * 0.08;
  const paddedSpan = Math.max(1, paddedMax - paddedMin);

  const xFor = (distance) => chartLeft + (distance / totalDistance) * chartWidth;
  const yFor = (ele) => chartBottom - ((ele - paddedMin) / paddedSpan) * (chartBottom - chartTop);

  drawElevationGridlines(ctx, { min, max, chartLeft, chartRight, chartTop, yFor, theme });
  drawGradeBars(ctx, { totalDistance, chartLeft, chartRight, chartBottom, xFor, yFor });
  drawElevationLine(ctx, { route, totalDistance, xFor, yFor, theme });
  drawDistanceAxis(ctx, { totalDistance, chartLeft, chartRight, chartBottom, height, xFor, theme });

  const markerX = chartLeft + progress * chartWidth;
  ctx.beginPath();
  ctx.moveTo(markerX, chartTop);
  ctx.lineTo(markerX, chartBottom);
  ctx.strokeStyle = theme.marker;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (state.profileHoverMeters !== null) {
    drawProfileHover(ctx, { totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, yFor, theme });
  }
}

function drawElevationGridlines(ctx, { min, max, chartLeft, chartRight, chartTop, yFor, theme }) {
  const step = niceStep(Math.max(1, max - min), ELEVATION_STEP_CANDIDATES);
  const first = Math.ceil(min / step) * step;

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "10px Inter, ui-sans-serif, system-ui, sans-serif";

  for (let value = first; value <= max; value += step) {
    const y = yFor(value);
    if (y < chartTop - 1) continue;

    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.strokeStyle = theme.gridline;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = theme.label;
    ctx.fillText(`${Math.round(value)} m`, chartLeft - 6, y);
  }
}

function drawGradeBars(ctx, { totalDistance, chartLeft, chartRight, chartBottom, xFor, yFor }) {
  const chartWidth = chartRight - chartLeft;
  const sampleCount = clamp(Math.round(chartWidth / PROFILE_BAR_SAMPLE_PX), 20, 400);
  const samples = [];
  for (let i = 0; i <= sampleCount; i += 1) {
    const distance = (i / sampleCount) * totalDistance;
    samples.push({ distance, ele: interpolateRoutePoint(distance).ele });
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    const from = samples[i];
    const to = samples[i + 1];
    const midDistance = (from.distance + to.distance) / 2;
    const grade = currentGrade(midDistance);

    const x0 = xFor(from.distance);
    const x1 = xFor(to.distance);
    const y0 = yFor(from.ele);
    const y1 = yFor(to.ele);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, chartBottom);
    ctx.lineTo(x0, chartBottom);
    ctx.closePath();
    ctx.fillStyle = gradeColor(grade);
    ctx.fill();
  }
}

function drawElevationLine(ctx, { route, totalDistance, xFor, yFor, theme }) {
  ctx.beginPath();
  route.forEach((point, index) => {
    const x = xFor(point.distance);
    const y = yFor(point.ele);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDistanceAxis(ctx, { totalDistance, chartLeft, chartRight, chartBottom, height, xFor, theme }) {
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth = 1;
  ctx.stroke();

  const useKm = totalDistance >= 3000;
  const step = useKm
    ? niceStep(totalDistance / 1000, DISTANCE_STEP_KM_CANDIDATES) * 1000
    : niceStep(totalDistance, DISTANCE_STEP_METERS_CANDIDATES);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "10px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = theme.label;
  ctx.strokeStyle = theme.axisLine;

  for (let distance = 0; distance <= totalDistance; distance += step) {
    const x = xFor(distance);
    ctx.beginPath();
    ctx.moveTo(x, chartBottom);
    ctx.lineTo(x, chartBottom + 4);
    ctx.stroke();

    const label = useKm ? `${Math.round(distance / 1000)} km` : `${Math.round(distance)} m`;
    ctx.fillText(label, clamp(x, chartLeft + 14, chartRight - 14), chartBottom + 6);
  }
}

function drawProfileHover(ctx, { totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, yFor, theme }) {
  const distance = clamp(state.profileHoverMeters, 0, totalDistance);
  const point = interpolateRoutePoint(distance);
  const grade = currentGrade(distance);
  const x = xFor(distance);
  const y = yFor(point.ele);

  ctx.beginPath();
  ctx.moveTo(x, chartTop);
  ctx.lineTo(x, chartBottom);
  ctx.strokeStyle = theme.hoverGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = theme.marker;
  ctx.fill();

  const label = `${(distance / 1000).toFixed(2)} km  ${grade >= 0 ? "+" : ""}${grade.toFixed(1)}%`;
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + 16;
  const boxHeight = 22;
  let boxX = x - boxWidth / 2;
  boxX = clamp(boxX, chartLeft, chartRight - boxWidth);
  const boxY = chartTop + 4;

  ctx.fillStyle = "rgba(36, 49, 46, 0.92)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.5);
}

function niceStep(range, candidates) {
  for (const candidate of candidates) {
    if (range / candidate <= 6) return candidate;
  }
  return candidates.at(-1);
}

function gradeColor(grade) {
  const intensity = clamp(Math.abs(grade) / PROFILE_GRADE_STEEP_PERCENT, 0, 1);
  const lightness = 88 - intensity * 40;
  if (grade > 0.3) return `hsl(4, 72%, ${lightness}%)`;
  if (grade < -0.3) return `hsl(142, 55%, ${lightness}%)`;
  return "hsl(60, 6%, 84%)";
}

function configureCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  // Assigning width/height resets and reallocates the canvas, so only touch
  // them when the element size actually changed.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x) * 180 / Math.PI;
}

function riderCircleCoordinates(center, radiusMeters, altitude = 0) {
  const points = [];
  for (let angle = 0; angle < 360; angle += 6) {
    const point = destinationPoint(center, angle, radiusMeters);
    points.push({ ...point, altitude });
  }
  return points;
}

function destinationPoint(position, bearingDegrees, distanceMeters) {
  const earthRadius = 6371000;
  const angularDistance = distanceMeters / earthRadius;
  const bearingRadians = toRad(bearingDegrees);
  const lat1 = toRad(position.lat);
  const lng1 = toRad(position.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: ((lng2 * 180 / Math.PI + 540) % 360) - 180,
  };
}

function haversine(a, b) {
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function updateProgressLabel(text) {
  els.progressLabel.textContent = text;
}

function lerp(a, b, ratio) {
  return a + (b - a) * ratio;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value) {
  return Math.round(value * 1000000) / 1000000;
}

function toRad(value) {
  return value * Math.PI / 180;
}
