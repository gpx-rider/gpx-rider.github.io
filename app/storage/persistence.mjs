// Settings & saved-ride persistence: restoreSettings/saveSettings round-trip
// every persisted user setting through storage.mjs, and restoreSavedRide/
// saveRide do the same for the last ride (route + progress). These functions
// deliberately touch every feature's state and sync helpers — persistence is
// the one cross-cutting concern — so when adding a persisted setting, add it
// to restoreSettings AND saveSettings here, plus the feature's own sync/apply.

import { syncCenterRiderButton, enterOverviewMode } from "../map/map-view.mjs";
import { syncDemoModeUi } from "../demo/demo-mode.mjs";
import { resetGalleryMetadataExportForRoute } from "../gallery-ui/gallery-export.mjs";
import { clamp, roundCoordinate } from "../core/geo.mjs";
import { normalizeHudOrder } from "../hud/map-hud.mjs";
import { updateStartButton } from "../ride/movement.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { enrichRoute, routeTotalDistance } from "../route/route.mjs";
import { renderRoute } from "../map/route-render.mjs";
import { updateRouteOverview } from "../route/route-load.mjs";
import { parseAspectRatio } from "../map/screenshot.mjs";
import {
  applyDisplaySettings,
  applyScreenshotButtonVisibility,
  syncDisplayControls,
  syncProfileSeriesButtons,
  syncRenderingControls,
  syncRiderProfileControls,
  updateSpeedOutput,
} from "../settings/settings-ui.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { readJson, removeStored, writeJson } from "./storage.mjs";
import { renderZoneSummaries } from "../ride/training-zones.mjs";
import {
  DEFAULT_HUD_FIELD_ORDER,
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

  if (typeof settings?.followRider === "boolean") {
    state.followRider = settings.followRider;
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

  if (typeof settings?.routeGradeColorsEnabled === "boolean") {
    state.routeGradeColorsEnabled = settings.routeGradeColorsEnabled;
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
  syncRenderingControls();
  els.screenshotButtonInput.checked = state.showScreenshotButton;
  els.screenshotAspectSelect.value = state.screenshotAspect;
  els.screenshotWidthSelect.value = String(state.screenshotWidth);
  applyScreenshotButtonVisibility();
  syncDisplayControls();
  applyDisplaySettings();
}

export function saveSettings() {
  writeJson(SETTINGS_STORAGE_KEY, {
    followRider: state.followRider,
    routeGradeColorsEnabled: state.routeGradeColorsEnabled,
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
    theaterHideClock: state.theaterHideClock,
    theaterHideMeters: state.theaterHideMeters,
    theaterHideDock: state.theaterHideDock,
    theaterHideClimbBanner: state.theaterHideClimbBanner,
    theaterHideDemoChip: state.theaterHideDemoChip,
    theaterHideControls: state.theaterHideControls,
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
  state.progressMeters = clamp(Number(savedRide.progressMeters) || 0, 0, routeTotalDistance(state.route));
  state.simulating = false;
  state.lastTick = 0;

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
