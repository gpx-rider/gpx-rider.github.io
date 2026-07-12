// Settings dialog wiring (everything except the camera panel, which lives in
// camera-ui.mjs): the category rail/panel shell, units & formats, the rider
// profile, profile series toggles, Display & HUD toggles, rendering settings,
// and screenshot settings. Each update*FromControls reads the inputs into
// state, persists, and applies; each sync* writes state back into the inputs.

import { applyCameraDebug } from "../camera/camera-debug.mjs";
import { clamp } from "../core/geo.mjs";
import { applyHudFieldOrder, layoutMetricTiles, renderHudOrderControls, updateFullscreenLocalTime } from "../hud/map-hud.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { updateRecordingUi } from "../ride/recording-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { gradeAt, interpolateRoutePoint } from "../route/route.mjs";
import { prefetchTerrainAround } from "../map/terrain-tiles.mjs";
import { rebuildRiderBeacon, rebuildRouteStyle } from "../map/route-render.mjs";
import { parseAspectRatio, screenshotSupported } from "../map/screenshot.mjs";
import { els, state } from "../core/state.mjs";
import { updateTelemetryUi } from "../ride/telemetry-ui.mjs";
import { renderZoneSummaries, updateTrainingMeters } from "../ride/training-zones.mjs";
import {
  DEFAULT_BEACON_COLOR,
  DEFAULT_BEACON_DIAMETER_METERS,
  DEFAULT_BEACON_ENABLED,
  DEFAULT_BEACON_HEIGHT_METERS,
  DEFAULT_BEACON_OPACITY,
  DEFAULT_DURATION_FORMAT,
  DEFAULT_MAX_HEART_RATE_BPM,
  DEFAULT_RESTING_HEART_RATE_BPM,
  DEFAULT_ROUTE_GRADE_COLORS_ENABLED,
  DEFAULT_SCREENSHOT_ASPECT,
  DEFAULT_SCREENSHOT_WIDTH,
  DEFAULT_TERRAIN_AVOID_ENABLED,
  DEFAULT_TERRAIN_CLEARANCE_METERS,
  DEFAULT_TERRAIN_TILES_ENABLED,
  DEFAULT_TIME_FORMAT,
  GRADE_INTERVAL_MAX_SECONDS,
  GRADE_INTERVAL_MIN_SECONDS,
  SCREENSHOT_WIDTH_MAX,
  SCREENSHOT_WIDTH_MIN,
  TERRAIN_TILE_ATTRIBUTION,
} from "../core/tuning.mjs";
import { formatSpeed } from "../core/units.mjs";

// --- Settings dialog: category rail + panel ---------------------------------

export function selectSettingsTab(name) {
  els.settingsTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.settingsTab === name);
  });
  els.settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== name;
  });
  const active = [...els.settingsTabs].find((tab) => tab.dataset.settingsTab === name);
  if (active) {
    els.settingsPanelTitle.textContent = active.dataset.panelTitle;
    els.settingsPanelSubtitle.textContent = active.dataset.panelSubtitle;
  }
}

export function openSettings(tab = "camera") {
  selectSettingsTab(tab);
  els.settingsDialog.showModal();
}

// --- Simulation, units & rider profile -------------------------------------

export function updateGradeIntervalFromControl() {
  state.gradeUpdateIntervalSeconds = clamp(
    Number(els.gradeIntervalInput.value),
    GRADE_INTERVAL_MIN_SECONDS,
    GRADE_INTERVAL_MAX_SECONDS,
  );
  els.gradeIntervalOutput.value = `${state.gradeUpdateIntervalSeconds} s`;
  saveSettings();
}

export function updateUnitsFromControls() {
  state.distanceUnits = els.distanceUnitSelect.value === "imperial" ? "imperial" : "metric";
  state.energyUnits = els.energyUnitSelect.value === "kj" ? "kj" : "kcal";
  state.timeFormat = els.timeFormatSelect.value === "12" ? "12" : DEFAULT_TIME_FORMAT;
  state.durationFormat = els.durationFormatSelect.value === "clock" ? "clock" : DEFAULT_DURATION_FORMAT;
  saveSettings();

  updateFullscreenLocalTime();
  updateSpeedOutput();
  updateTelemetryUi();
  updateRecordingUi();
  renderHudOrderControls();
  if (state.route.length) updateRideUi({ force: true });
  else renderProfile();
}

export function updateSpeedOutput() {
  els.speedOutput.value = formatSpeed(Number(els.speedInput.value), state.distanceUnits, 0);
}

export function updateRiderProfileFromControls() {
  const restingHeartRate = Number(els.restingHeartRateInput.value);
  state.restingHeartRateBpm = Number.isFinite(restingHeartRate) && restingHeartRate >= 30 && restingHeartRate <= 140
    ? Math.round(restingHeartRate)
    : DEFAULT_RESTING_HEART_RATE_BPM;

  const maxHeartRate = Number(els.maxHeartRateInput.value);
  state.maxHeartRateBpm = Number.isFinite(maxHeartRate) && maxHeartRate >= 80 && maxHeartRate <= 240
    ? Math.round(maxHeartRate)
    : DEFAULT_MAX_HEART_RATE_BPM;
  if (state.maxHeartRateBpm <= state.restingHeartRateBpm) {
    state.maxHeartRateBpm = Math.min(240, state.restingHeartRateBpm + 1);
  }

  const ftpWatts = Number(els.ftpInput.value);
  state.ftpWatts = Number.isFinite(ftpWatts) && ftpWatts > 0 && ftpWatts <= 1000
    ? Math.round(ftpWatts)
    : null;

  syncRiderProfileControls();
  renderZoneSummaries();
  saveSettings();
  updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
}

export function syncRiderProfileControls() {
  els.restingHeartRateInput.value = String(state.restingHeartRateBpm);
  els.maxHeartRateInput.value = String(state.maxHeartRateBpm);
  els.ftpInput.value = state.ftpWatts ?? "";
}

export function toggleProfileSeries(event) {
  const key = event.currentTarget.dataset.profileSeries;
  if (!(key in state.profileSeries)) return;
  state.profileSeries[key] = !state.profileSeries[key];
  syncProfileSeriesButtons();
  saveSettings();
  renderProfile();
}

export function syncProfileSeriesButtons() {
  els.profileSeriesButtons.forEach((button) => {
    const key = button.dataset.profileSeries;
    button.setAttribute("aria-pressed", String(state.profileSeries[key] !== false));
  });
}

// --- Display & HUD settings -----------------------------------------------------

export function updateDisplaySettingsFromControls() {
  state.showMinimap = els.minimapInput.checked;
  state.mapLabelsEnabled = els.mapLabelsInput.checked;
  state.cameraDebugEnabled = els.cameraDebugInput.checked;
  state.theaterHideClock = els.theaterHideClockInput.checked;
  state.theaterHideMeters = els.theaterHideMetersInput.checked;
  state.theaterHideDock = els.theaterHideDockInput.checked;
  state.theaterHideClimbBanner = els.theaterHideClimbBannerInput.checked;
  state.theaterHideDemoChip = els.theaterHideDemoChipInput.checked;
  state.theaterHideControls = els.theaterHideControlsInput.checked;
  state.theaterHideMinimap = els.theaterHideMinimapInput.checked;
  saveSettings();
  applyDisplaySettings();
}

export function syncDisplayControls() {
  els.minimapInput.checked = state.showMinimap;
  els.mapLabelsInput.checked = state.mapLabelsEnabled;
  els.cameraDebugInput.checked = state.cameraDebugEnabled;
  els.theaterHideClockInput.checked = state.theaterHideClock;
  els.theaterHideMetersInput.checked = state.theaterHideMeters;
  els.theaterHideDockInput.checked = state.theaterHideDock;
  els.theaterHideClimbBannerInput.checked = state.theaterHideClimbBanner;
  els.theaterHideDemoChipInput.checked = state.theaterHideDemoChip;
  els.theaterHideControlsInput.checked = state.theaterHideControls;
  els.theaterHideMinimapInput.checked = state.theaterHideMinimap;
  renderHudOrderControls();
}

export function applyDisplaySettings() {
  els.minimap.classList.toggle("minimap-hidden", !state.showMinimap);
  applyHudFieldOrder();
  layoutMetricTiles();
  applyMapMode();
  applyCameraDebug();
  applyTheaterHudToggles();
}

function applyTheaterHudToggles() {
  els.mapViewport.classList.toggle("theater-hide-clock", state.theaterHideClock);
  els.mapViewport.classList.toggle("theater-hide-meters", state.theaterHideMeters);
  els.mapViewport.classList.toggle("theater-hide-dock", state.theaterHideDock);
  els.mapViewport.classList.toggle("theater-hide-climb-banner", state.theaterHideClimbBanner);
  els.mapViewport.classList.toggle("theater-hide-demo-chip", state.theaterHideDemoChip);
  els.mapViewport.classList.toggle("theater-hide-controls", state.theaterHideControls);
  els.mapViewport.classList.toggle("theater-hide-minimap", state.theaterHideMinimap);
}

function applyMapMode() {
  const MapMode = state.maps3d?.MapMode;
  if (!state.map || !MapMode) return;
  state.map.mode = state.mapLabelsEnabled ? MapMode.HYBRID : MapMode.SATELLITE;
}

// --- Rendering settings -----------------------------------------------------------

export function updateRenderingSettingsFromControls() {
  const routeGradeColorsChanged = state.routeGradeColorsEnabled !== els.routeGradeColorsInput.checked;
  state.routeGradeColorsEnabled = els.routeGradeColorsInput.checked;
  state.beaconEnabled = els.beaconEnabledInput.checked;
  state.beaconDiameterMeters = Number(els.beaconDiameterInput.value);
  state.beaconHeightMeters = Number(els.beaconHeightInput.value);
  state.beaconOpacity = Number(els.beaconOpacityInput.value);
  state.beaconColor = els.beaconColorInput.value;
  state.terrainAvoidEnabled = els.terrainAvoidInput.checked;
  state.terrainClearanceMeters = Number(els.terrainClearanceInput.value);
  state.terrainTilesEnabled = els.terrainTilesInput.checked;
  updateRenderingSettingsLabels();
  applyTerrainTilesSetting();
  saveSettings();
  rebuildRiderBeacon();
  if (routeGradeColorsChanged) rebuildRouteStyle();
  updateRideUi();
}

export function resetRenderingToDefaults() {
  const routeGradeColorsChanged = state.routeGradeColorsEnabled !== DEFAULT_ROUTE_GRADE_COLORS_ENABLED;
  state.routeGradeColorsEnabled = DEFAULT_ROUTE_GRADE_COLORS_ENABLED;
  state.beaconEnabled = DEFAULT_BEACON_ENABLED;
  state.beaconDiameterMeters = DEFAULT_BEACON_DIAMETER_METERS;
  state.beaconHeightMeters = DEFAULT_BEACON_HEIGHT_METERS;
  state.beaconOpacity = DEFAULT_BEACON_OPACITY;
  state.beaconColor = DEFAULT_BEACON_COLOR;
  state.terrainAvoidEnabled = DEFAULT_TERRAIN_AVOID_ENABLED;
  state.terrainClearanceMeters = DEFAULT_TERRAIN_CLEARANCE_METERS;
  state.terrainTilesEnabled = DEFAULT_TERRAIN_TILES_ENABLED;
  syncRenderingControls();
  updateRenderingSettingsLabels();
  applyTerrainTilesSetting();
  saveSettings();
  rebuildRiderBeacon();
  if (routeGradeColorsChanged) rebuildRouteStyle();
  updateRideUi();
}

export function syncRenderingControls() {
  els.routeGradeColorsInput.checked = state.routeGradeColorsEnabled;
  els.beaconEnabledInput.checked = state.beaconEnabled;
  els.beaconDiameterInput.value = String(state.beaconDiameterMeters);
  els.beaconHeightInput.value = String(state.beaconHeightMeters);
  els.beaconOpacityInput.value = String(state.beaconOpacity);
  els.beaconColorInput.value = state.beaconColor;
  els.terrainAvoidInput.checked = state.terrainAvoidEnabled;
  els.terrainClearanceInput.value = String(state.terrainClearanceMeters);
  els.terrainTilesInput.checked = state.terrainTilesEnabled;
}

export function updateRenderingSettingsLabels() {
  els.beaconDiameterOutput.value = `${state.beaconDiameterMeters} m`;
  els.beaconHeightOutput.value = `${state.beaconHeightMeters} m`;
  els.beaconOpacityOutput.value = `${Math.round(state.beaconOpacity * 100)}%`;
  els.terrainClearanceOutput.value = `${state.terrainClearanceMeters} m`;
}

// Show the open-data attribution while online terrain is on, and warm the tile
// cache around the rider when it is switched on mid-session so the camera has
// real ground to work with without waiting for the next route load.
export function applyTerrainTilesSetting() {
  if (els.terrainAttribution) {
    els.terrainAttribution.textContent = TERRAIN_TILE_ATTRIBUTION;
    els.terrainAttribution.hidden = !state.terrainTilesEnabled;
  }
  if (state.terrainTilesEnabled && state.route.length) {
    const rider = interpolateRoutePoint(state.route, state.progressMeters);
    if (rider) prefetchTerrainAround(rider.lat, rider.lng);
  }
}

// --- Screenshot settings -----------------------------------------------------------

export function updateScreenshotSettingsFromControls() {
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

export function applyScreenshotButtonVisibility() {
  els.screenshotBtn.hidden = !state.showScreenshotButton || !screenshotSupported();
}
