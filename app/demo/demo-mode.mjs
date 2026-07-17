// Demo mode UI: drives the ride from the synthetic trainer/HR model in
// demo.mjs (which owns the pure math), keeps the demo chip/banner in sync,
// and hands the generated telemetry to the same state fields a real trainer
// would fill.

import { advanceDemoRide, createDemoRideModel, seedDemoHistory } from "./demo.mjs";
import { registerHudComponent } from "../hud/screen-manager.mjs";
import { isHeartRateConnected } from "../trainer/heartrate.mjs";
import { ensureMovementLoop, setPedaling, updatePedalingFromSpeed, updateStartButton } from "../ride/movement.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { gradeAt, interpolateRoutePoint } from "../route/route.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { updateTelemetryUi } from "../ride/telemetry-ui.mjs";
import { isTrainerConnected } from "../trainer/trainer.mjs";
import { updateTrainingMeters } from "../ride/training-zones.mjs";
import { CYCLING_GROSS_EFFICIENCY, DEMO_RIDE } from "../core/tuning.mjs";
import { activeCaloriesFromPower } from "../core/units.mjs";

export function toggleDemoMode() {
  if (state.demoModeActive) {
    stopDemoMode({ message: "Demo mode off." });
    return;
  }
  startDemoMode();
}

function startDemoMode() {
  if (state.route.length < 2) {
    updateProgressLabel("Load a route before starting Demo mode.");
    return;
  }
  if (isTrainerConnected() || isHeartRateConnected()) {
    updateProgressLabel("Demo mode is only available when real trainer and HR devices are disconnected.");
    syncDemoModeUi();
    return;
  }

  state.demoModeActive = true;
  state.demoModel = createDemoRideModel(DEMO_RIDE);
  seedDemoHistory(state.demoModel, {
    route: state.route,
    progressMeters: state.progressMeters,
  });
  state.demoHistorySamples = state.demoModel.historySamples;
  state.demoTimerSeconds = state.demoModel.elapsedSeconds;
  state.demoCaloriesKcal = state.demoModel.caloriesKcal;
  state.simulating = false;
  updateStartButton();
  advanceDemoTelemetry(0, gradeAt(state.route, state.progressMeters), 0, { recordHistory: false });
  updateProgressLabel("Demo mode on — synthetic trainer and HR are driving the ride.");
  syncDemoModeUi();
  ensureMovementLoop();
}

export function stopDemoMode({ message = null, silent = false, preserveHistory = false } = {}) {
  if (!state.demoModeActive) return;
  if (preserveHistory && state.demoModel) {
    state.demoHistorySamples = state.demoModel.historySamples;
    state.demoTimerSeconds = state.demoModel.elapsedSeconds;
    state.demoCaloriesKcal = state.demoModel.caloriesKcal;
  } else {
    clearDemoHistory();
  }
  state.demoModeActive = false;
  state.demoModel = null;
  state.trainerSpeedKph = null;
  state.trainerPowerWatts = null;
  state.trainerCadenceRpm = null;
  state.trainerCaloriesKcal = null;
  state.trainerHeartRateBpm = null;
  state.strapHeartRateBpm = null;
  els.trainerStat.textContent = "Idle";
  els.hrConnectionStat.textContent = state.heartRateStatusText || "Not connected";
  setPedaling(false);
  syncDemoModeUi();
  updateTelemetryUi();
  updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
  updateRideUi({ force: true });
  if (!silent && message) updateProgressLabel(message);
}

export function clearDemoHistory() {
  state.demoHistorySamples = [];
  state.demoTimerSeconds = 0;
  state.demoCaloriesKcal = 0;
}

export function advanceDemoTelemetry(elapsedSeconds, grade, metersAdvanced, { recordHistory = true } = {}) {
  if (!state.demoModeActive || !state.demoModel) return null;
  const point = state.route.length
    ? interpolateRoutePoint(state.route, state.progressMeters)
    : null;
  const caloriesFromPower = activeCaloriesFromPower(
    state.demoModel.powerWatts,
    elapsedSeconds,
    CYCLING_GROSS_EFFICIENCY,
  );
  const telemetry = advanceDemoRide(state.demoModel, {
    elapsedSeconds,
    gradePercent: grade,
    point,
    routeProgressMeters: state.progressMeters,
    metersAdvanced,
    caloriesFromPower,
    recordHistory,
  });
  state.trainerSpeedKph = telemetry.speedKph;
  state.trainerPowerWatts = telemetry.powerWatts;
  state.trainerCadenceRpm = telemetry.cadenceRpm;
  state.trainerCaloriesKcal = telemetry.caloriesKcal;
  state.trainerHeartRateBpm = telemetry.heartRateBpm;
  state.strapHeartRateBpm = telemetry.heartRateBpm;
  state.demoHistorySamples = state.demoModel.historySamples;
  state.demoTimerSeconds = state.demoModel.elapsedSeconds;
  state.demoCaloriesKcal = state.demoModel.caloriesKcal;
  updatePedalingFromSpeed();
  updateTelemetryUi();
  return telemetry;
}

export function syncDemoModeUi() {
  const hasRoute = state.route.length > 1;
  const blockedByRealDevice = !state.demoModeActive && (isTrainerConnected() || isHeartRateConnected());
  els.demoModeBtn.disabled = !hasRoute || blockedByRealDevice;
  els.demoModeBtn.setAttribute("aria-pressed", String(state.demoModeActive));
  els.demoModeBtn.textContent = state.demoModeActive ? "Stop demo" : "Demo mode";
  els.connectBtn.disabled = state.demoModeActive;
  els.connectHrBtn.disabled = state.demoModeActive;
  els.demoBanner.hidden = !(state.demoModeActive && state.pedaling);
}

// The demo chip stacks in the center column below the climb banner — the
// screen manager handles the spacing that used to be measured by hand here.
export function registerDemoBannerHud() {
  registerHudComponent({ id: "demo-banner", region: "center", weight: 20, element: els.demoBanner });
}
