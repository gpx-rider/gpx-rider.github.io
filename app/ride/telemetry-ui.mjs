// Live telemetry: callbacks the trainer/heart-rate hardware modules feed
// (trainer.mjs / heartrate.mjs hold the BLE state; this module owns what the
// app does with the numbers), the HR source-of-truth resolution, calories and
// ride-timer accessors, and the telemetry readouts in the panel + HUD.

import { stopDemoMode, syncDemoModeUi } from "../demo/demo-mode.mjs";
import { isHeartRateConnected } from "../trainer/heartrate.mjs";
import { setPedaling, updatePedalingFromSpeed } from "./movement.mjs";
import { rideLogSummary } from "./recorder.mjs";
import { gradeAt } from "../route/route.mjs";
import { els, state } from "../core/state.mjs";
import { isTrainerConnected } from "../trainer/trainer.mjs";
import { updateTrainingMeters } from "./training-zones.mjs";
import { HEART_RATE_REFRESH_MS } from "../core/tuning.mjs";
import { formatEnergy, formatSpeed } from "../core/units.mjs";

export function handleTrainerTelemetry(telemetry) {
  if (telemetry && state.demoModeActive) {
    stopDemoMode({ message: "Demo mode turned off because a real trainer connected." });
  }
  // Live telemetry is the one dependable "actually connected" signal.
  els.trainerDot.classList.toggle("connected", Boolean(telemetry));

  if (!telemetry) {
    state.trainerSpeedKph = null;
    state.trainerPowerWatts = null;
    state.trainerHeartRateBpm = null;
    setPedaling(false);
    updateTelemetryUi();
    updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
    return;
  }

  if (telemetry.speedKph !== null) state.trainerSpeedKph = telemetry.speedKph;
  if (telemetry.powerWatts !== null) state.trainerPowerWatts = telemetry.powerWatts;
  if (telemetry.totalCaloriesKcal !== null) state.trainerCaloriesKcal = telemetry.totalCaloriesKcal;
  state.trainerHeartRateBpm = telemetry.heartRateBpm;

  updatePedalingFromSpeed();
  updateTelemetryUi();
  updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
}

export function handleTrainerStatus(text, { onlyClearError = false } = {}) {
  if (state.demoModeActive) {
    if (isTrainerConnected()) {
      stopDemoMode({ message: "Demo mode turned off because a real trainer connected." });
    } else {
      return;
    }
  }
  if (onlyClearError && els.trainerStat.textContent !== "BLE error") return;
  els.trainerStat.textContent = text;
}

export function handleStrapHeartRate(bpm) {
  if (state.demoModeActive && Number.isFinite(bpm)) {
    stopDemoMode({ message: "Demo mode turned off because a real heart-rate strap connected." });
  }
  state.strapHeartRateBpm = Number.isFinite(bpm) ? bpm : null;
  refreshHeartRateUi();
  syncHeartRateRefreshLoop();
}

export function handleHeartRateStatus(text) {
  if (state.demoModeActive) {
    if (isHeartRateConnected()) {
      stopDemoMode({ message: "Demo mode turned off because a real heart-rate strap connected." });
    } else {
      return;
    }
  }
  state.heartRateStatusText = text;
  refreshHeartRateUi();
  syncHeartRateRefreshLoop();
}

export function currentHeartRate() {
  if (state.demoModeActive) return state.strapHeartRateBpm ?? state.trainerHeartRateBpm ?? null;
  // A connected strap is the HR source of truth. Only fall back to a
  // trainer-relayed HR field when no dedicated strap is connected.
  if (isHeartRateConnected()) return state.strapHeartRateBpm;
  return state.trainerHeartRateBpm ?? null;
}

function refreshHeartRateUi() {
  updateTelemetryUi();
  updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
}

function syncHeartRateRefreshLoop() {
  if (state.demoModeActive) {
    stopHeartRateRefreshLoop();
    return;
  }
  if (isHeartRateConnected()) {
    startHeartRateRefreshLoop();
  } else {
    stopHeartRateRefreshLoop();
  }
}

function startHeartRateRefreshLoop() {
  if (state.heartRateRefreshTimer) return;
  const step = () => {
    if (!isHeartRateConnected()) {
      state.heartRateRefreshTimer = null;
      refreshHeartRateUi();
      return;
    }
    refreshHeartRateUi();
    state.heartRateRefreshTimer = window.setTimeout(step, HEART_RATE_REFRESH_MS);
  };
  step();
}

function stopHeartRateRefreshLoop() {
  window.clearTimeout(state.heartRateRefreshTimer);
  state.heartRateRefreshTimer = null;
}

export function currentCaloriesKcal() {
  if (state.demoModeActive && state.demoModel) {
    return state.demoModel.caloriesKcal;
  }
  if (state.demoHistorySamples.length && state.demoCaloriesKcal > 0) {
    return state.demoCaloriesKcal;
  }
  if (state.powerCaloriesKcal > 0 || Number.isFinite(state.trainerPowerWatts)) {
    return state.powerCaloriesKcal;
  }
  return Number.isFinite(state.trainerCaloriesKcal) ? state.trainerCaloriesKcal : null;
}

export function currentRideTimerSeconds() {
  if (state.demoModeActive && state.demoModel) {
    return state.demoModel.elapsedSeconds;
  }
  if (state.demoHistorySamples.length && state.demoTimerSeconds > 0) {
    return state.demoTimerSeconds;
  }
  return rideLogSummary().timerSeconds;
}

export function updateTelemetryUi() {
  const powerText = Number.isFinite(state.trainerPowerWatts) ? `${state.trainerPowerWatts} W` : "--";
  const speedText = formatSpeed(state.trainerSpeedKph, state.distanceUnits);
  const heartRate = currentHeartRate();
  const heartRateText = Number.isFinite(heartRate) ? `${heartRate} bpm` : "--";
  const caloriesText = formatEnergy(currentCaloriesKcal() ?? NaN, state.energyUnits);
  const trainerConnected = state.demoModeActive || Boolean(state.trainerSpeedKph !== null || state.trainerPowerWatts !== null);
  const heartRateConnected = state.demoModeActive || isHeartRateConnected();

  els.powerStat.textContent = powerText;
  els.speedStat.textContent = speedText;
  els.heartRateStat.textContent = heartRateText;
  els.trainerStat.textContent = state.demoModeActive ? "Demo trainer" : els.trainerStat.textContent;
  els.trainerDot.classList.toggle("connected", trainerConnected);
  els.hrConnectionStat.textContent = state.demoModeActive
    ? `${heartRateText} demo`
    : isHeartRateConnected() && Number.isFinite(state.strapHeartRateBpm)
    ? `${state.strapHeartRateBpm} bpm`
    : (state.heartRateStatusText || (isHeartRateConnected() ? "Connected" : "Not connected"));
  els.hrDot.classList.toggle("connected", heartRateConnected);
  els.caloriesStat.textContent = caloriesText;
  els.hudPowerStat.textContent = powerText;
  els.hudSpeedStat.textContent = speedText;
  els.hudHeartRateStat.textContent = heartRateText;
  els.hudCaloriesStat.textContent = caloriesText;
  syncDemoModeUi();
}
