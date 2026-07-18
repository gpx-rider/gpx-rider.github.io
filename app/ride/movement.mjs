// Movement: simulation button + pedaling detection + the movement loop.
//
// Two independent movement sources drive the rider along the route:
// 1. Pedaling — the trainer reports real speed; always wins when present.
// 2. Simulation — the slider speed, toggled by the Start/Stop simulation
//    button, for previewing a route without pedaling.
// Starting to pedal stops a running simulation; the map then follows trainer
// speed and stops when the rider stops pedaling.

import { enterOverviewMode, returnToFollow, syncOverviewControls } from "../map/map-view.mjs";
import { syncFocusedClimbList } from "../route/climbs-ui.mjs";
import { advanceDemoTelemetry, stopDemoMode, syncDemoModeUi } from "../demo/demo-mode.mjs";
import { recordEstimatorTick } from "./eta.mjs";
import { clamp } from "../core/geo.mjs";
import { saveRide, saveRideThrottled } from "../storage/persistence.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { persistRideLog, recordRideTick } from "./recorder.mjs";
import { updateRecordingUi } from "./recording-ui.mjs";
import { updateRideUi } from "./ride-ui.mjs";
import {
  ascentAt,
  descentAt,
  gradeAt,
  interpolateRoutePoint,
  routeTotalDistance,
} from "../route/route.mjs";
import { rebuildRouteStyle } from "../map/route-render.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { currentCaloriesKcal, currentHeartRate } from "./telemetry-ui.mjs";
import {
  OP_START_OR_RESUME,
  OP_STOP_OR_PAUSE,
  sendTrainerCommand,
  sendTrainerGrade,
} from "../trainer/trainer.mjs";
import {
  CYCLING_GROSS_EFFICIENCY,
  MAX_TICK_SECONDS,
  PEDALING_START_KPH,
  PEDALING_STOP_KPH,
} from "../core/tuning.mjs";
import { activeCaloriesFromPower } from "../core/units.mjs";

export function isMoving() {
  return state.simulating || state.pedaling;
}

export function toggleSimulation() {
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

export function updateStartButton() {
  els.startBtnLabel.textContent = state.simulating ? "Stop" : "Start";
  // Swaps the play triangle for a stop square (see styles.css).
  els.startBtn.classList.toggle("sim-running", state.simulating);
}

export function updatePedalingFromSpeed() {
  const speed = state.trainerSpeedKph;
  if (!Number.isFinite(speed)) {
    setPedaling(false);
    return;
  }
  if (!state.pedaling && speed >= PEDALING_START_KPH) setPedaling(true);
  else if (state.pedaling && speed <= PEDALING_STOP_KPH) setPedaling(false);
}

export function setPedaling(pedaling) {
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
  syncDemoModeUi();
}

export function ensureMovementLoop() {
  if (state.route.length < 2) return;
  // Actual movement (not a mere seek) hands the map over to follow mode.
  if (isMoving()) {
    if (state.focusedClimbIndex !== null) {
      state.focusedClimbIndex = null;
      syncFocusedClimbList();
      renderProfile();
      rebuildRouteStyle();
    }
    if (state.mapMode !== "follow") returnToFollow();
    syncOverviewControls();
  }
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

export function handleVisibilityChange() {
  // A pending rAF from before the tab was hidden only fires once the tab is
  // visible again; reschedule so the loop keeps ticking either way.
  if (state.movementLoopActive) scheduleTick();
  // Going hidden is the last dependable moment to persist: a background tab
  // can be discarded without beforeunload, and an IndexedDB write started
  // only in beforeunload may not get to commit.
  if (document.hidden) {
    saveRide();
    persistRideLog();
  }
}

function handleMovementStopped() {
  saveRide();
  persistRideLog();
  updateRecordingUi();
}

export function resetRide() {
  state.simulating = false;
  state.progressMeters = 0;
  state.lastTick = performance.now();
  // A reset while stationary honors the current map mode: overview stays
  // overview, the follow map re-centers on the rider's reset position.
  if (!isMoving()) {
    if (state.overviewActive) enterOverviewMode();
    else returnToFollow({ instant: true });
  }
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
  const currentGrade = gradeAt(state.route, state.progressMeters);
  if (state.demoModeActive) advanceDemoTelemetry(elapsedSeconds, currentGrade, 0, { recordHistory: false });
  const speedKph = state.pedaling && Number.isFinite(state.trainerSpeedKph)
    ? state.trainerSpeedKph
    : Number(els.speedInput.value);
  const metersPerSecond = speedKph / 3.6;
  const totalDistance = routeTotalDistance(state.route);

  const previousProgress = state.progressMeters;
  const metersAdvanced = metersPerSecond * elapsedSeconds;
  state.progressMeters = Math.min(totalDistance, state.progressMeters + metersAdvanced);
  if (state.demoModeActive) {
    advanceDemoTelemetry(0, gradeAt(state.route, state.progressMeters), state.progressMeters - previousProgress);
  }

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

  if (state.pedaling && !state.demoModeActive && Number.isFinite(state.trainerPowerWatts) && elapsedSeconds > 0) {
    state.powerCaloriesKcal += activeCaloriesFromPower(
      state.trainerPowerWatts,
      elapsedSeconds,
      CYCLING_GROSS_EFFICIENCY,
    );
  }

  if (state.pedaling && !state.demoModeActive) {
    recordRideTick({
      elapsedSeconds,
      metersAdvanced: state.progressMeters - previousProgress,
      point: interpolateRoutePoint(state.route, state.progressMeters),
      speedKph,
      powerWatts: state.trainerPowerWatts,
      heartRateBpm: currentHeartRate(),
      caloriesKcal: currentCaloriesKcal(),
      routeProgressMeters: state.progressMeters,
    });
  }

  updateRideUi();
  saveRideThrottled();

  if (state.progressMeters >= totalDistance) {
    state.simulating = false;
    if (state.demoModeActive) {
      stopDemoMode({
        message: "Demo mode finished at the end of the route.",
        preserveHistory: true,
      });
    }
    state.movementLoopActive = false;
    enterOverviewMode();
    updateStartButton();
    saveRide();
    persistRideLog();
    updateRecordingUi();
    void sendTrainerGrade(0);
    return;
  }

  scheduleTick();
}

// Jump the rider to a distance along the route (profile click, climb click).
export function seekToMeters(meters) {
  if (!state.route.length) return;
  const wasMoving = isMoving();
  state.progressMeters = clamp(meters, 0, routeTotalDistance(state.route));
  state.lastTick = performance.now();
  // A teleport while parked in follow mode (clicking the elevation profile)
  // recenters the map on the new rider position. Skip it while moving (the
  // map is already following), in an overview (the framing shouldn't move),
  // and in manual mode (a manual drag should stay put).
  if (!wasMoving && state.mapMode === "follow") {
    returnToFollow({ instant: true });
  }
  updateRideUi({ force: true });
  saveRide();
  ensureMovementLoop();
}
