// Settings & saved-ride persistence: restoreSettings/saveSettings round-trip
// every persisted user setting through storage.mjs, and restoreSavedRide/
// saveRide do the same for the last ride (route + progress). These functions
// deliberately touch every feature's state and sync helpers — persistence is
// the one cross-cutting concern — so when adding a persisted setting, add it
// to restoreSettings AND saveSettings here, plus the feature's own sync/apply.

import {
  normalizeClimbFocusMode,
  normalizeOverviewMode,
  syncCameraControls,
  syncCenterRiderButton,
  updateCameraSettingsLabels,
} from "../camera/camera-ui.mjs";
import { syncDemoModeUi } from "../demo/demo-mode.mjs";
import { resetGalleryMetadataExportForRoute } from "../gallery-ui/gallery-export.mjs";
import { clamp, roundCoordinate } from "../core/geo.mjs";
import { normalizeHudOrder } from "../hud/map-hud.mjs";
import { updateStartButton } from "../ride/movement.mjs";
import { enterOverviewMode } from "../camera/overview-camera.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { enrichRoute, routeTotalDistance } from "../route/route.mjs";
import { BEACON_COLOR_PATTERN, renderRoute } from "../map/route-render.mjs";
import { updateRouteOverview } from "../route/route-load.mjs";
import { parseAspectRatio } from "../map/screenshot.mjs";
import {
  applyDisplaySettings,
  applyScreenshotButtonVisibility,
  applyTerrainTilesSetting,
  syncDisplayControls,
  syncProfileSeriesButtons,
  syncRenderingControls,
  syncRiderProfileControls,
  updateRenderingSettingsLabels,
  updateSpeedOutput,
} from "../settings/settings-ui.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { readJson, removeStored, writeJson } from "./storage.mjs";
import { renderZoneSummaries } from "../ride/training-zones.mjs";
import {
  CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
  CAMERA_PAN_LIMIT_METERS,
  CAMERA_TILT_MAX,
  CAMERA_TILT_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CLIMB_ORBIT_SECONDS_PER_REV_MAX,
  CLIMB_ORBIT_SECONDS_PER_REV_MIN,
  DEFAULT_HUD_FIELD_ORDER,
  FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS,
  FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS,
  GRADE_INTERVAL_MAX_SECONDS,
  GRADE_INTERVAL_MIN_SECONDS,
  HEART_RATE_MAX_AGE_FORMULA_BASE,
  RIDE_SAVE_THROTTLE_MS,
  SCREENSHOT_WIDTH_MAX,
  SCREENSHOT_WIDTH_MIN,
} from "../core/tuning.mjs";

const SETTINGS_STORAGE_KEY = "gpx-rider:settings";
const RIDE_STORAGE_KEY = "gpx-rider:last-ride";

export function restoreSettings() {
  const settings = readJson(SETTINGS_STORAGE_KEY);
  const zoom = Number(settings?.cameraZoom ?? settings?.cameraDistanceMeters);
  const angle = Number(settings?.cameraAngleDegrees);
  const behind = Number(settings?.cameraBehindMeters);
  const headingOffset = Number(settings?.cameraHeadingOffsetDegrees);
  const offsetForward = Number(settings?.cameraOffsetForwardMeters);
  const offsetRight = Number(settings?.cameraOffsetRightMeters);
  const climbOrbitSeconds = Number(settings?.climbOrbitSecondsPerRev);
  const firstPersonHeight = Number(settings?.firstPersonCameraHeightMeters);

  state.overviewMode = normalizeOverviewMode(settings?.overviewMode);
  state.climbFocusMode = normalizeClimbFocusMode(settings?.climbFocusMode);
  state.cameraViewPreset = settings?.cameraViewPreset === "firstPerson" ? "firstPerson" : null;
  state.activeOverviewMode = state.overviewMode;
  if (Number.isFinite(climbOrbitSeconds)) {
    state.climbOrbitSecondsPerRev = clamp(
      climbOrbitSeconds,
      CLIMB_ORBIT_SECONDS_PER_REV_MIN,
      CLIMB_ORBIT_SECONDS_PER_REV_MAX,
    );
  }

  if (Number.isFinite(firstPersonHeight)) {
    state.firstPersonCameraHeightMeters = clamp(
      firstPersonHeight,
      FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS,
      FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS,
    );
  }

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
  if (settings?.timeFormat === "12") state.timeFormat = "12";
  if (settings?.durationFormat === "clock") state.durationFormat = "clock";

  const restingHeartRate = Number(settings?.restingHeartRateBpm);
  if (Number.isFinite(restingHeartRate) && restingHeartRate >= 30 && restingHeartRate <= 140) {
    state.restingHeartRateBpm = Math.round(restingHeartRate);
  }

  const maxHeartRate = Number(settings?.maxHeartRateBpm);
  if (Number.isFinite(maxHeartRate) && maxHeartRate >= 80 && maxHeartRate <= 240) {
    state.maxHeartRateBpm = Math.round(maxHeartRate);
  } else {
    const legacyBirthYear = Number(settings?.birthYear);
    if (Number.isInteger(legacyBirthYear) && legacyBirthYear >= 1900 && legacyBirthYear <= 2100) {
      state.maxHeartRateBpm = clamp(
        HEART_RATE_MAX_AGE_FORMULA_BASE - (new Date().getFullYear() - legacyBirthYear),
        80,
        240,
      );
    }
  }

  if (state.maxHeartRateBpm <= state.restingHeartRateBpm) {
    state.maxHeartRateBpm = Math.min(240, state.restingHeartRateBpm + 1);
  }

  const ftpWatts = Number(settings?.ftpWatts);
  if (Number.isFinite(ftpWatts) && ftpWatts > 0 && ftpWatts <= 1000) {
    state.ftpWatts = Math.round(ftpWatts);
  }

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

  if (typeof settings?.terrainTilesEnabled === "boolean") {
    state.terrainTilesEnabled = settings.terrainTilesEnabled;
  }

  if (typeof settings?.routeGradeColorsEnabled === "boolean") {
    state.routeGradeColorsEnabled = settings.routeGradeColorsEnabled;
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

  if (typeof settings?.cameraDebugEnabled === "boolean") {
    state.cameraDebugEnabled = settings.cameraDebugEnabled;
  }

  if (typeof settings?.cameraDebugCollapsed === "boolean") {
    state.cameraDebugCollapsed = settings.cameraDebugCollapsed;
  }

  if (typeof settings?.theaterHideClock === "boolean") {
    state.theaterHideClock = settings.theaterHideClock;
  }
  if (typeof settings?.theaterHideMeters === "boolean") {
    state.theaterHideMeters = settings.theaterHideMeters;
  }
  if (typeof settings?.theaterHideDock === "boolean") {
    state.theaterHideDock = settings.theaterHideDock;
  }
  if (typeof settings?.theaterHideClimbBanner === "boolean") {
    state.theaterHideClimbBanner = settings.theaterHideClimbBanner;
  }
  if (typeof settings?.theaterHideDemoChip === "boolean") {
    state.theaterHideDemoChip = settings.theaterHideDemoChip;
  }
  if (typeof settings?.theaterHideControls === "boolean") {
    state.theaterHideControls = settings.theaterHideControls;
  }
  if (typeof settings?.theaterHideMinimap === "boolean") {
    state.theaterHideMinimap = settings.theaterHideMinimap;
  }

  if (Array.isArray(settings?.hudFieldOrder)) {
    state.hudFieldOrder = normalizeHudOrder(settings.hudFieldOrder);
  } else if (settings?.hudElements && typeof settings.hudElements === "object") {
    const enabled = [];
    const disabled = [];
    for (const key of DEFAULT_HUD_FIELD_ORDER) {
      (settings.hudElements[key] === false ? disabled : enabled).push(key);
    }
    state.hudFieldOrder = [...enabled, ...disabled];
    state.hudVisibleCount = Math.max(1, enabled.length);
  }

  const hudVisibleCount = Number(settings?.hudVisibleCount);
  if (Number.isFinite(hudVisibleCount)) {
    state.hudVisibleCount = clamp(Math.round(hudVisibleCount), 1, DEFAULT_HUD_FIELD_ORDER.length);
  }

  if (settings?.profileSeries && typeof settings.profileSeries === "object") {
    for (const key of Object.keys(state.profileSeries)) {
      if (typeof settings.profileSeries[key] === "boolean") {
        state.profileSeries[key] = settings.profileSeries[key];
      }
    }
  }

  if (typeof settings?.hudDockCollapsed === "boolean") {
    state.hudDockCollapsed = settings.hudDockCollapsed;
  }

  els.centerRiderInput.checked = state.centerRider;
  syncCenterRiderButton();
  els.gradeIntervalInput.value = String(state.gradeUpdateIntervalSeconds);
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  els.distanceUnitSelect.value = state.distanceUnits;
  els.energyUnitSelect.value = state.energyUnits;
  els.timeFormatSelect.value = state.timeFormat;
  els.durationFormatSelect.value = state.durationFormat;
  syncRiderProfileControls();
  renderZoneSummaries();
  syncProfileSeriesButtons();
  updateSpeedOutput();
  syncCameraControls();
  updateCameraSettingsLabels();
  syncRenderingControls();
  updateRenderingSettingsLabels();
  applyTerrainTilesSetting();
  els.screenshotButtonInput.checked = state.showScreenshotButton;
  els.screenshotAspectSelect.value = state.screenshotAspect;
  els.screenshotWidthSelect.value = String(state.screenshotWidth);
  applyScreenshotButtonVisibility();
  syncDisplayControls();
  applyDisplaySettings();
}

export function saveSettings() {
  writeJson(SETTINGS_STORAGE_KEY, {
    cameraZoom: state.cameraZoom,
    overviewMode: state.overviewMode,
    climbFocusMode: state.climbFocusMode,
    climbOrbitSecondsPerRev: state.climbOrbitSecondsPerRev,
    cameraAngleDegrees: state.cameraAngleDegrees,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraHeadingOffsetDegrees: state.cameraHeadingOffsetDegrees,
    cameraOffsetForwardMeters: state.cameraOffsetForwardMeters,
    cameraOffsetRightMeters: state.cameraOffsetRightMeters,
    cameraCenterAltitudeOffsetMeters: state.cameraCenterAltitudeOffsetMeters,
    firstPersonCameraHeightMeters: state.firstPersonCameraHeightMeters,
    cameraViewPreset: state.cameraViewPreset === "firstPerson" ? "firstPerson" : null,
    centerRider: state.centerRider,
    routeGradeColorsEnabled: state.routeGradeColorsEnabled,
    beaconEnabled: state.beaconEnabled,
    beaconDiameterMeters: state.beaconDiameterMeters,
    beaconHeightMeters: state.beaconHeightMeters,
    beaconOpacity: state.beaconOpacity,
    beaconColor: state.beaconColor,
    terrainAvoidEnabled: state.terrainAvoidEnabled,
    terrainTilesEnabled: state.terrainTilesEnabled,
    terrainClearanceMeters: state.terrainClearanceMeters,
    showScreenshotButton: state.showScreenshotButton,
    screenshotAspect: state.screenshotAspect,
    screenshotWidth: state.screenshotWidth,
    gradeUpdateIntervalSeconds: state.gradeUpdateIntervalSeconds,
    distanceUnits: state.distanceUnits,
    energyUnits: state.energyUnits,
    timeFormat: state.timeFormat,
    durationFormat: state.durationFormat,
    restingHeartRateBpm: state.restingHeartRateBpm,
    maxHeartRateBpm: state.maxHeartRateBpm,
    ftpWatts: state.ftpWatts,
    showMinimap: state.showMinimap,
    mapLabelsEnabled: state.mapLabelsEnabled,
    cameraDebugEnabled: state.cameraDebugEnabled,
    cameraDebugCollapsed: state.cameraDebugCollapsed,
    theaterHideClock: state.theaterHideClock,
    theaterHideMeters: state.theaterHideMeters,
    theaterHideDock: state.theaterHideDock,
    theaterHideClimbBanner: state.theaterHideClimbBanner,
    theaterHideDemoChip: state.theaterHideDemoChip,
    theaterHideControls: state.theaterHideControls,
    theaterHideMinimap: state.theaterHideMinimap,
    hudFieldOrder: [...state.hudFieldOrder],
    hudVisibleCount: state.hudVisibleCount,
    hudDockCollapsed: state.hudDockCollapsed,
    profileSeries: { ...state.profileSeries },
  });
}

export function restoreSavedRide() {
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
  state.focusedClimbIndex = null;
  state.selectedProfileSegment = null;
  state.galleryMetadata = savedRide.galleryMetadata && typeof savedRide.galleryMetadata === "object"
    ? structuredClone(savedRide.galleryMetadata)
    : null;
  state.lastGalleryMetadataRefreshMs = 0;
  state.progressMeters = clamp(Number(savedRide.progressMeters) || 0, 0, routeTotalDistance(state.route));
  state.simulating = false;
  state.lastTick = 0;

  state.overviewActive = true;
  resetGalleryMetadataExportForRoute();
  enterOverviewMode({ instant: true });
  updateStartButton();
  renderRoute();
  renderProfile();
  updateRouteOverview();
  updateRideUi({ force: true });
  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
  syncDemoModeUi();
}

export function saveRideThrottled() {
  const now = performance.now();
  if (now - state.lastRideSavedAt < RIDE_SAVE_THROTTLE_MS) return;
  saveRide();
}

export function saveRide() {
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
    galleryMetadata: state.galleryMetadata,
    progressMeters: Math.round(state.progressMeters),
    speedKph: Number(els.speedInput.value),
    savedAt: new Date().toISOString(),
  });
  if (!saved) {
    updateProgressLabel("This GPX is too large to save locally, but the ride still works.");
  }
}
