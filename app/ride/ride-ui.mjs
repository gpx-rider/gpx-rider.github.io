// Live ride UI: updateRideUi is the per-tick UI driver — per-frame camera/dot
// work first, then (on the slow-UI cadence) the DOM stats, progress bars,
// profile redraw, HUD tiles, dock readouts, climb status/banner, and the
// trainer grade sample.

import { updateCameraSettingsLabels } from "../camera/camera-ui.mjs";
import { isFirstPersonCameraView } from "../camera/camera-ui.mjs";
import { updateClimbStatus, updateFullscreenClimbBanner } from "../route/climbs-ui.mjs";
import { estimateRemainingSeconds } from "./eta.mjs";
import { updateMapCamera } from "../camera/follow-camera.mjs";
import { updateGalleryMetadataExport } from "../gallery-ui/gallery-export.mjs";
import { clamp } from "../core/geo.mjs";
import { updateFullscreenClock } from "../hud/map-hud.mjs";
import { isMoving } from "./movement.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { updateRecordingUi } from "./recording-ui.mjs";
import {
  ascentAt,
  descentAt,
  gradeAt,
  interpolateRoutePoint,
  routeTotalAscent,
  routeTotalDescent,
  routeTotalDistance,
} from "../route/route.mjs";
import {
  removeRiderMarker,
  renderRiderDot,
  updateMinimapPosition,
  updateRiderDot,
} from "../map/route-render.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { currentCaloriesKcal, currentRideTimerSeconds } from "./telemetry-ui.mjs";
import { queueTrainerGradeSample } from "../trainer/trainer.mjs";
import { updateTrainingMeters } from "./training-zones.mjs";
import { SLOW_UI_INTERVAL_MS } from "../core/tuning.mjs";
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatEnergy,
} from "../core/units.mjs";

export function updateRideUi(options = {}) {
  if (!state.route.length) return;

  const point = interpolateRoutePoint(state.route, state.progressMeters);

  if (isFirstPersonCameraView()) {
    removeRiderMarker();
  } else if (state.riderDot) {
    updateRiderDot(point);
  } else if (state.mapProvider === "google3d" && state.map) {
    renderRiderDot(point);
  }
  updateMapCamera();

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
  const etaText = etaSeconds === null ? "--" : formatDuration(etaSeconds, state.durationFormat);
  const ascentText = formatAltitude(ascentSoFar, state.distanceUnits);
  const elapsedText = formatDuration(currentRideTimerSeconds(), state.durationFormat);
  const caloriesText = formatEnergy(currentCaloriesKcal() ?? NaN, state.energyUnits);

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
  updateGalleryMetadataExport();

  els.hudGradeStat.textContent = `${grade.toFixed(1)}%`;
  els.hudRiddenStat.textContent = riddenText;
  els.hudRemainingStat.textContent = remainingText;
  els.hudAscentLeftStat.textContent = ascentLeftText;
  els.hudEtaStat.textContent = etaText;
  els.hudCaloriesStat.textContent = caloriesText;
  els.hudAltitudeStat.textContent = formatAltitude(point.ele, state.distanceUnits);
  els.hudAscentStat.textContent = ascentText;
  els.hudElapsedStat.textContent = elapsedText;

  // Fullscreen dock extras: the road-ahead readouts and the two progress bars
  // that sit beside the profile, plus the clock chip and climb banner.
  els.fsRoadRouteName.textContent = state.routeName || "Route";
  els.fsRoadRouteProps.textContent =
    `${formatDistance(totalDistance, state.distanceUnits, 1)} · ` +
    `${formatAltitude(totalAscent, state.distanceUnits)} ascent`;
  els.fsDistLabel.textContent =
    `${riddenText} / ${formatDistance(totalDistance, state.distanceUnits, 1)}`;
  els.fsDistFill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  els.fsClimbLabel.textContent =
    `${ascentText} / ${formatAltitude(totalAscent, state.distanceUnits)}`;
  els.fsClimbFill.style.width = `${(totalAscent ? clamp(ascentSoFar / totalAscent, 0, 1) : 0) * 100}%`;
  updateFullscreenClock(riddenText, ascentText);
  updateFullscreenClimbBanner(point);
  updateTrainingMeters(grade);

  updateRecordingUi();
  if (!state.demoModeActive) {
    queueTrainerGradeSample(grade, {
      force: options.force,
      intervalSeconds: state.gradeUpdateIntervalSeconds,
    });
  }
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
