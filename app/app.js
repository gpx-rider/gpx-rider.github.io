// GPX Rider entry point. This file is deliberately thin: it boots the app
// (startApp) and wires DOM events to the feature modules (bindEvents) —
// nothing else. All state lives in state.mjs; every behavior lives in a
// focused feature module (see the module table in CLAUDE.md). If you are
// about to add a function here, it almost certainly belongs in one of those
// modules instead.

import {
  returnFromClimbOverview,
  toggleRouteOverview,
  updateCenterRiderFromControl,
} from "./map/map-view.mjs";
import { registerDemoBannerHud, toggleDemoMode } from "./demo/demo-mode.mjs";
import { copyGalleryMetadata, syncGalleryMetadataExportAvailability, updateGalleryMetadataExport } from "./gallery-ui/gallery-export.mjs";
import { initGallery } from "./gallery-ui/gallery.mjs";
import { connectHeartRate, initHeartRate, reconnectSavedHeartRate } from "./trainer/heartrate.mjs";
import { initMap } from "./map/map-init.mjs";
import {
  adjustHudVisibleCount,
  exitMapFullscreen,
  handleFullscreenChange,
  initializeMapHud,
  takeMapScreenshot,
  toggleHudDock,
  toggleMapFullscreen,
} from "./hud/map-hud.mjs";
import { handleVisibilityChange, resetRide, toggleSimulation } from "./ride/movement.mjs";
import { restoreSavedRide, restoreSettings, saveRide } from "./storage/persistence.mjs";
import {
  cancelProfileSelection,
  handleProfileClick,
  handleProfileHover,
  handleProfileLeave,
  handleProfilePointerDown,
  handleProfilePointerMove,
  handleProfilePointerUp,
} from "./route/profile-ui.mjs";
import { persistRideLog, restoreRideLog, rideLogSummary } from "./ride/recorder.mjs";
import { confirmClearRideData, downloadFitFile, updateRecordingUi } from "./ride/recording-ui.mjs";
import { loadGpxFile, loadGpxFromUrl } from "./route/route-load.mjs";
import {
  openSettings,
  resetRenderingToDefaults,
  selectSettingsTab,
  toggleProfileSeries,
  updateDisplaySettingsFromControls,
  updateGradeIntervalFromControl,
  updateRenderingSettingsFromControls,
  updateRiderProfileFromControls,
  updateScreenshotSettingsFromControls,
  updateSpeedOutput,
  updateUnitsFromControls,
} from "./settings/settings-ui.mjs";
import { els, state, updateProgressLabel } from "./core/state.mjs";
import { initStorage } from "./storage/storage.mjs";
import { registerClimbBannerHud } from "./route/climbs-ui.mjs";
import { initScreenManager } from "./hud/screen-manager.mjs";
import {
  handleHeartRateStatus,
  handleStrapHeartRate,
  handleTrainerStatus,
  handleTrainerTelemetry,
} from "./ride/telemetry-ui.mjs";
import { closeTheaterModeOnOutsideClick, exitTheaterMode, initTheaterModeUi, toggleTheaterMode } from "./hud/theater-mode.mjs";
import { connectTrainer, initTrainer, reconnectSavedTrainer } from "./trainer/trainer.mjs";
import {
  closeZoneHelpOnOutsideClick,
  closeZoneHelpPopovers,
  registerTrainingMetersHud,
  toggleZoneHelp,
} from "./ride/training-zones.mjs";
import {
  APP_NAME,
  DEFAULT_SIMULATION_SPEED_KPH,
  SIMULATION_SPEED_MAX_KPH,
  SIMULATION_SPEED_MIN_KPH,
} from "./core/tuning.mjs";

startApp();

async function startApp() {
  document.title = APP_NAME;
  els.brandName.textContent = APP_NAME;
  // Everything below reads persisted state through storage.mjs, so the
  // IndexedDB-backed cache must be loaded before anything else runs.
  await initStorage();

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

  // The simulation slider's range is defined once in tuning.mjs; apply it to
  // the input before any saved speed is restored/clamped against it.
  els.speedInput.min = String(SIMULATION_SPEED_MIN_KPH);
  els.speedInput.max = String(SIMULATION_SPEED_MAX_KPH);
  els.speedInput.value = String(DEFAULT_SIMULATION_SPEED_KPH);

  // The HUD layout regions must exist before any feature registers its
  // component with the screen manager. Each feature owns and registers its
  // own HUD element; the weights encode the column order (see each register
  // function). map-hud registers its own pieces inside initializeMapHud.
  initScreenManager(els.mapViewport);
  initTheaterModeUi();
  registerClimbBannerHud();
  registerDemoBannerHud();
  registerTrainingMetersHud();

  restoreSettings();
  restoreRideLog();
  state.powerCaloriesKcal = rideLogSummary().caloriesKcal ?? 0;
  updateRecordingUi();
  await initMap();
  bindEvents();
  initializeMapHud();
  restoreSavedRide();
  syncGalleryMetadataExportAvailability();
  void reconnectSavedTrainer();
  void reconnectSavedHeartRate();
  // First open with no saved ride: start on the first gallery route instead
  // of an empty map. The landing page's "Launch GPX Rider" button deep-links
  // a specific gallery route via ?route=<id>; that forces the route on load,
  // ahead of any saved ride or the first-open auto-load (handled in
  // gallery.mjs).
  const requestedRouteId = new URLSearchParams(location.search).get("route");
  void initGallery(loadGpxFromUrl, {
    shouldAutoLoadFirst: () => state.route.length < 2 && Boolean(state.map),
    getRequestedRouteId: () => requestedRouteId,
    getCurrentRouteName: () => state.routeName,
    getDistanceUnits: () => state.distanceUnits,
  });
}

function bindEvents() {
  els.settingsBtn.addEventListener("click", () => openSettings());
  els.mapSettingsShortcutBtn?.addEventListener("click", () => openSettings());
  els.settingsCloseBtn.addEventListener("click", () => els.settingsDialog.close());
  els.settingsDoneBtn.addEventListener("click", () => els.settingsDialog.close());
  els.settingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => selectSettingsTab(tab.dataset.settingsTab));
  });
  els.settingsDialog.addEventListener("click", (event) => {
    // A click on the dialog element itself (not its content) is the backdrop.
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.gpxFile.addEventListener("change", loadGpxFile);
  els.speedInput.addEventListener("input", () => {
    updateSpeedOutput();
    saveRide();
  });
  els.gradeIntervalInput.addEventListener("input", updateGradeIntervalFromControl);
  els.distanceUnitSelect.addEventListener("change", updateUnitsFromControls);
  els.energyUnitSelect.addEventListener("change", updateUnitsFromControls);
  els.timeFormatSelect.addEventListener("change", updateUnitsFromControls);
  els.durationFormatSelect.addEventListener("change", updateUnitsFromControls);
  els.restingHeartRateInput.addEventListener("change", updateRiderProfileFromControls);
  els.maxHeartRateInput.addEventListener("change", updateRiderProfileFromControls);
  els.ftpInput.addEventListener("change", updateRiderProfileFromControls);
  els.zoneHelpButtons.forEach((button) => button.addEventListener("click", toggleZoneHelp));
  els.theaterHideClockInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.theaterHideMetersInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.theaterHideDockInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.theaterHideClimbBannerInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.theaterHideDemoChipInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.theaterHideControlsInput.addEventListener("change", updateDisplaySettingsFromControls);
  els.hudLessBtn.addEventListener("click", () => adjustHudVisibleCount(-1));
  els.hudMoreBtn.addEventListener("click", () => adjustHudVisibleCount(1));
  els.hudSettingsBtn.addEventListener("click", () => openSettings("hud"));
  els.hudVisibleLessBtn.addEventListener("click", () => adjustHudVisibleCount(-1));
  els.hudVisibleMoreBtn.addEventListener("click", () => adjustHudVisibleCount(1));
  els.profileSeriesButtons.forEach((button) => button.addEventListener("click", toggleProfileSeries));
  els.centerRiderInput.addEventListener("change", updateCenterRiderFromControl);
  els.centerRiderBtn.addEventListener("click", () => {
    els.centerRiderInput.checked = !els.centerRiderInput.checked;
    updateCenterRiderFromControl();
  });
  els.routeGradeColorsInput.addEventListener("change", updateRenderingSettingsFromControls);
  els.resetRenderingBtn.addEventListener("click", resetRenderingToDefaults);
  els.connectBtn.addEventListener("click", connectTrainer);
  els.connectHrBtn.addEventListener("click", connectHeartRate);
  els.demoModeBtn.addEventListener("click", toggleDemoMode);
  els.resizeRecordingWindowBtn.addEventListener("click", toggleTheaterMode);
  els.startBtn.addEventListener("click", toggleSimulation);
  els.resetBtn.addEventListener("click", resetRide);
  els.downloadFitBtn.addEventListener("click", downloadFitFile);
  els.clearRideDataBtn.addEventListener("click", confirmClearRideData);
  els.profile.addEventListener("mousemove", handleProfileHover);
  els.profile.addEventListener("mouseleave", handleProfileLeave);
  els.profile.addEventListener("pointerdown", handleProfilePointerDown);
  els.profile.addEventListener("pointermove", handleProfilePointerMove);
  els.profile.addEventListener("pointerup", handleProfilePointerUp);
  els.profile.addEventListener("pointercancel", cancelProfileSelection);
  els.profile.addEventListener("click", handleProfileClick);
  els.fullscreenBtn.addEventListener("click", toggleMapFullscreen);
  els.dockToggleBtn.addEventListener("click", toggleHudDock);
  els.overviewToggleBtn.addEventListener("click", toggleRouteOverview);
  els.climbOverviewToggleBtn.addEventListener("click", returnFromClimbOverview);
  els.screenshotBtn.addEventListener("click", takeMapScreenshot);
  els.screenshotButtonInput.addEventListener("change", updateScreenshotSettingsFromControls);
  els.screenshotAspectSelect.addEventListener("change", updateScreenshotSettingsFromControls);
  els.screenshotWidthSelect.addEventListener("change", updateScreenshotSettingsFromControls);
  els.galleryTitleInput.addEventListener("input", updateGalleryMetadataExport);
  els.galleryDescriptionInput.addEventListener("input", updateGalleryMetadataExport);
  els.copyGalleryMetadataBtn.addEventListener("click", copyGalleryMetadata);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && closeZoneHelpPopovers()) {
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && state.theaterMode) {
      exitTheaterMode();
      return;
    }
    // When the settings or gallery dialog is open, Escape closes it
    // (natively) and must not also kick the rider out of fullscreen.
    if (
      event.key === "Escape" && state.mapFullscreen &&
      !els.settingsDialog.open && !els.galleryDialog.open
    ) exitMapFullscreen();
  });
  document.addEventListener("click", closeZoneHelpOnOutsideClick);
  document.addEventListener("click", closeTheaterModeOnOutsideClick);
  window.addEventListener("beforeunload", () => {
    saveRide();
    persistRideLog();
  });
}
