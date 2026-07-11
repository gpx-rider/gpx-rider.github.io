// Ride recording & FIT export: the FIT buffer card (recording indicator +
// summary stats), the FIT file download, and clearing collected ride data.
// The recording itself lives in recorder.mjs; the FIT encoding in fit.mjs.

import { encodeFitActivity } from "./fit.mjs";
import {
  clearRideLog,
  hasRideData,
  persistRideLog,
  rideLogSamples,
  rideLogSummary,
} from "./recorder.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { formatDistance, formatDuration, formatEnergy } from "../core/units.mjs";

export function updateRecordingUi() {
  // The bucket only grows while the rider is actually moving — mirror that
  // with the pulsing RECORDING indicator on the FIT buffer card.
  els.recIndicator.hidden = !state.pedaling || state.demoModeActive;

  const summary = rideLogSummary();
  els.recDistanceStat.textContent = formatDistance(summary.distanceMeters, state.distanceUnits);
  els.recTimeStat.textContent = formatDuration(summary.timerSeconds, state.durationFormat);
  els.recPointsStat.textContent = String(summary.sampleCount);
  els.recHeartRateStat.textContent = summary.heartRateSampleCount > 0
    ? `${summary.heartRateSampleCount} samples`
    : "--";
  els.recCaloriesStat.textContent = formatEnergy(summary.caloriesKcal ?? NaN, state.energyUnits);
  els.downloadFitBtn.disabled = summary.sampleCount < 2;
  els.clearRideDataBtn.disabled = summary.sampleCount === 0;
}

export function downloadFitFile() {
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
      state.powerCaloriesKcal = 0;
      updateRecordingUi();
      updateProgressLabel("Ride data cleared.");
    }
  }, 300);
}

export function confirmClearRideData() {
  if (!hasRideData()) return;
  const summary = rideLogSummary();
  const description = `${formatDistance(summary.distanceMeters, state.distanceUnits)} / ${formatDuration(summary.timerSeconds, state.durationFormat)}`;
  if (!window.confirm(`Discard the collected ride data (${description}) without downloading?`)) return;
  clearRideLog();
  state.powerCaloriesKcal = 0;
  updateRecordingUi();
  updateProgressLabel("Ride data cleared.");
}
