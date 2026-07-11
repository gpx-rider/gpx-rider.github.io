// Sustained-climb detection: resamples the route to a fixed step, smooths
// elevation (median then moving average), and drives a fatigue-pressure
// integrator off short/long rolling grade windows to decide where a
// human-perceived climb starts and ends. See "Climb detection" in
// tuning.yaml for the full model description and each constant's role.
import {
  CLIMB_RESAMPLE_STEP_METERS,
  CLIMB_ELEVATION_MEDIAN_WINDOW_METERS,
  CLIMB_ELEVATION_SMOOTH_WINDOW_METERS,
  CLIMB_SHORT_GRADE_WINDOW_METERS,
  CLIMB_LONG_GRADE_WINDOW_METERS,
  CLIMB_LONG_GRADE_WEIGHT,
  CLIMB_START_FATIGUE,
  CLIMB_END_FATIGUE,
  CLIMB_END_FATIGUE_MIN_DISTANCE_METERS,
  CLIMB_MAX_FATIGUE,
  CLIMB_PRESSURE_START_GRADE_PERCENT,
  CLIMB_PRESSURE_EXPONENT,
  CLIMB_RECOVERY_UPHILL_THRESHOLD_PERCENT,
  CLIMB_RECOVERY_FLAT_THRESHOLD_PERCENT,
  CLIMB_RECOVERY_FLAT_PRESSURE,
  CLIMB_RECOVERY_DOWNHILL_BASE,
  CLIMB_RECOVERY_DOWNHILL_SCALE,
  CLIMB_RECOVERY_MAX,
  CLIMB_MIN_GAIN_METERS,
  CLIMB_MIN_DISTANCE_METERS,
  CLIMB_START_LOOKBACK_METERS,
  CLIMB_END_DROP_METERS,
  CLIMB_END_DROP_DISTANCE_METERS,
  CLIMB_MAX_EASY_AFTER_PEAK_METERS,
  CLIMB_MERGE_GAP_METERS,
  CLIMB_MERGE_MAX_DROP_METERS,
  CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH,
} from "../core/tuning.mjs";
import { resampleAndSmoothElevation, rollingGrade } from "./climb-signal.mjs";

function lowestIndex(points, startIdx, endIdx) {
  let best = startIdx;
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    if (points[i].ele < points[best].ele) best = i;
  }
  return best;
}

function highestIndex(points, startIdx, endIdx) {
  let best = startIdx;
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    if (points[i].ele > points[best].ele) best = i;
  }
  return best;
}

function accumulatedGain(points, startIdx, endIdx) {
  let gain = 0;
  for (let i = startIdx + 1; i <= endIdx; i += 1) {
    const diff = points[i].ele - points[i - 1].ele;
    if (diff > 0) gain += diff;
  }
  return gain;
}

function minAverageGradeForLength(lengthMeters, thresholds) {
  for (const row of thresholds) {
    if (lengthMeters < row.max_length_meters) return row.min_average_grade_percent;
  }
  return thresholds[thresholds.length - 1].min_average_grade_percent;
}

const DEFAULT_OPTIONS = {
  resampleStepMeters: CLIMB_RESAMPLE_STEP_METERS,
  elevationMedianWindowMeters: CLIMB_ELEVATION_MEDIAN_WINDOW_METERS,
  elevationSmoothWindowMeters: CLIMB_ELEVATION_SMOOTH_WINDOW_METERS,
  shortGradeWindowMeters: CLIMB_SHORT_GRADE_WINDOW_METERS,
  longGradeWindowMeters: CLIMB_LONG_GRADE_WINDOW_METERS,
  longGradeWeight: CLIMB_LONG_GRADE_WEIGHT,
  startFatigue: CLIMB_START_FATIGUE,
  endFatigue: CLIMB_END_FATIGUE,
  endFatigueMinDistanceMeters: CLIMB_END_FATIGUE_MIN_DISTANCE_METERS,
  maxFatigue: CLIMB_MAX_FATIGUE,
  pressureStartGradePercent: CLIMB_PRESSURE_START_GRADE_PERCENT,
  pressureExponent: CLIMB_PRESSURE_EXPONENT,
  recoveryUphillThresholdPercent: CLIMB_RECOVERY_UPHILL_THRESHOLD_PERCENT,
  recoveryFlatThresholdPercent: CLIMB_RECOVERY_FLAT_THRESHOLD_PERCENT,
  recoveryFlatPressure: CLIMB_RECOVERY_FLAT_PRESSURE,
  recoveryDownhillBase: CLIMB_RECOVERY_DOWNHILL_BASE,
  recoveryDownhillScale: CLIMB_RECOVERY_DOWNHILL_SCALE,
  recoveryMax: CLIMB_RECOVERY_MAX,
  minGainMeters: CLIMB_MIN_GAIN_METERS,
  minDistanceMeters: CLIMB_MIN_DISTANCE_METERS,
  startLookbackMeters: CLIMB_START_LOOKBACK_METERS,
  endDropMeters: CLIMB_END_DROP_METERS,
  endDropDistanceMeters: CLIMB_END_DROP_DISTANCE_METERS,
  maxEasyAfterPeakMeters: CLIMB_MAX_EASY_AFTER_PEAK_METERS,
  mergeGapMeters: CLIMB_MERGE_GAP_METERS,
  mergeMaxDropMeters: CLIMB_MERGE_MAX_DROP_METERS,
  minAverageGradeForLength: CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH,
};

/**
 * Detects sustained climbing segments in an enriched GPX route.
 * @param {Array} route - Points with `distance` (meters) and `ele` (meters).
 * @param {Object} [options={}] - Optional overrides for tuning constants.
 * @returns {Array} Detected climb objects with start/end metrics.
 */
export function detectClimbs(route, options = {}) {
  const {
    resampleStepMeters,
    elevationMedianWindowMeters,
    elevationSmoothWindowMeters,
    shortGradeWindowMeters,
    longGradeWindowMeters,
    longGradeWeight,
    startFatigue,
    endFatigue,
    endFatigueMinDistanceMeters,
    maxFatigue,
    pressureStartGradePercent,
    pressureExponent,
    recoveryUphillThresholdPercent,
    recoveryFlatThresholdPercent,
    recoveryFlatPressure,
    recoveryDownhillBase,
    recoveryDownhillScale,
    recoveryMax,
    minGainMeters,
    minDistanceMeters,
    startLookbackMeters,
    endDropMeters,
    endDropDistanceMeters,
    maxEasyAfterPeakMeters,
    mergeGapMeters,
    mergeMaxDropMeters,
    minAverageGradeForLength: minAverageGradeForLengthThresholds,
  } = { ...DEFAULT_OPTIONS, ...options };

  if (route.length < 2) return [];

  const climbPressure = (gradePercent) => {
    const excess = gradePercent - pressureStartGradePercent;
    return excess <= 0 ? 0 : excess ** pressureExponent;
  };

  const recoveryPressure = (gradePercent) => {
    if (gradePercent >= recoveryUphillThresholdPercent) return 0;
    if (gradePercent >= recoveryFlatThresholdPercent) return recoveryFlatPressure;
    return Math.min(recoveryMax, recoveryDownhillBase + Math.abs(gradePercent) * recoveryDownhillScale);
  };

  const makeClimb = (points, startIdx, peakIdx, maxFatigueForCandidate) => {
    const start = points[startIdx];
    const peak = points[peakIdx];
    const lengthMeters = peak.distance - start.distance;
    if (lengthMeters <= 0) return null;

    const netGainMeters = peak.ele - start.ele;
    const accumulatedGainMeters = accumulatedGain(points, startIdx, peakIdx);
    const averageGrade = (netGainMeters / lengthMeters) * 100;
    const minGrade = minAverageGradeForLength(lengthMeters, minAverageGradeForLengthThresholds);

    const accepted =
      lengthMeters >= minDistanceMeters &&
      accumulatedGainMeters >= minGainMeters &&
      averageGrade >= minGrade &&
      maxFatigueForCandidate >= startFatigue;

    if (!accepted) return null;

    return {
      startDistanceMeters: start.distance,
      endDistanceMeters: peak.distance,
      startElevationMeters: start.ele,
      endElevationMeters: peak.ele,
      lengthMeters,
      gainMeters: accumulatedGainMeters,
      netGainMeters,
      accumulatedGainMeters,
      averageGradePercent: averageGrade,
      maxFatigue: maxFatigueForCandidate,
    };
  };

  const mergeNearbyClimbs = (climbs) => {
    if (!climbs.length) return [];

    const merged = [climbs[0]];
    for (const climb of climbs.slice(1)) {
      const prev = merged[merged.length - 1];
      const gapMeters = climb.startDistanceMeters - prev.endDistanceMeters;
      const dropMeters = prev.endElevationMeters - climb.startElevationMeters;

      const shouldMerge = gapMeters >= 0 && gapMeters <= mergeGapMeters && dropMeters <= mergeMaxDropMeters;
      if (!shouldMerge) {
        merged.push(climb);
        continue;
      }

      const startDistance = prev.startDistanceMeters;
      const endDistance = climb.endDistanceMeters;
      const lengthMeters = endDistance - startDistance;
      const startEle = prev.startElevationMeters;
      const endEle = climb.endElevationMeters;
      const netGainMeters = endEle - startEle;
      const totalGain = prev.gainMeters + climb.gainMeters;
      const averageGrade = lengthMeters > 0 ? (netGainMeters / lengthMeters) * 100 : 0;

      merged[merged.length - 1] = {
        ...prev,
        endDistanceMeters: endDistance,
        endElevationMeters: endEle,
        lengthMeters,
        gainMeters: totalGain,
        netGainMeters,
        accumulatedGainMeters: totalGain,
        averageGradePercent: averageGrade,
        maxFatigue: Math.max(prev.maxFatigue, climb.maxFatigue),
      };
    }

    return merged;
  };

  const points = resampleAndSmoothElevation(
    route,
    resampleStepMeters,
    elevationMedianWindowMeters,
    elevationSmoothWindowMeters,
  );
  if (points.length < 2) return [];

  const climbs = [];

  let fatigue = 0;
  let maxFatigueThisCandidate = 0;
  let active = false;
  let baseIdx = null;
  let startIdx = null;
  let peakIdx = null;
  let lastPressureIdx = null;

  const resetCandidate = () => {
    fatigue = 0;
    maxFatigueThisCandidate = 0;
    active = false;
    baseIdx = null;
    startIdx = null;
    peakIdx = null;
    lastPressureIdx = null;
  };

  const closeCandidate = () => {
    if (active && startIdx !== null && peakIdx !== null) {
      const climb = makeClimb(points, startIdx, peakIdx, maxFatigueThisCandidate);
      if (climb) climbs.push(climb);
    }
    resetCandidate();
  };

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const prev = points[i - 1];

    const distanceChange = point.distance - prev.distance;
    if (distanceChange <= 0) continue;

    const shortGrade = rollingGrade(points, i, shortGradeWindowMeters, resampleStepMeters);
    const longGrade = rollingGrade(points, i, longGradeWindowMeters, resampleStepMeters);

    // Use whichever window says "this feels more climb-like". Short handles
    // punchy ramps; long handles sustained drags.
    const shortPressure = climbPressure(shortGrade);
    const longPressure = climbPressure(longGrade) * longGradeWeight;
    const pressure = Math.max(shortPressure, longPressure);

    // For recovery, if either short or long still says uphill, do not
    // recover much.
    const recoveryGrade = Math.max(shortGrade, longGrade);
    const recovery = recoveryPressure(recoveryGrade);

    const oldFatigue = fatigue;
    const fatigueDelta = (pressure - recovery) * distanceChange;
    fatigue = Math.max(0, Math.min(maxFatigue, fatigue + fatigueDelta));
    maxFatigueThisCandidate = Math.max(maxFatigueThisCandidate, fatigue);

    // A candidate exists while there is either pressure or leftover fatigue.
    if (pressure > 0 || fatigue > 0) {
      if (baseIdx === null) baseIdx = i - 1;
      // Before the climb becomes active, keep moving the base to the lowest
      // point, so a first tiny uphill blip doesn't become the start.
      if (!active && points[i].ele < points[baseIdx].ele) baseIdx = i;
    }

    // Ghost candidate: drained before ever becoming an active climb.
    if (!active && oldFatigue > 0 && fatigue === 0) {
      resetCandidate();
      continue;
    }

    // Start the climb once fatigue has accumulated enough.
    if (!active && fatigue >= startFatigue) {
      let searchStartIdx = baseIdx !== null ? baseIdx : i;
      // Do not let a very old shallow drag dilute the climb forever.
      const minStartDistance = point.distance - startLookbackMeters;
      while (searchStartIdx < i && points[searchStartIdx].distance < minStartDistance) {
        searchStartIdx += 1;
      }

      startIdx = lowestIndex(points, searchStartIdx, i);
      peakIdx = highestIndex(points, startIdx, i);
      lastPressureIdx = i;
      active = true;
    }

    if (!active) continue;

    if (pressure > 0) lastPressureIdx = i;

    // The climb's visual end is the highest point before recovery.
    if (peakIdx === null || point.ele > points[peakIdx].ele) peakIdx = i;

    const distanceSincePeak = point.distance - points[peakIdx].distance;
    const dropFromPeak = points[peakIdx].ele - point.ele;
    const distanceSincePressure = lastPressureIdx !== null ? point.distance - points[lastPressureIdx].distance : 0;

    if (fatigue <= endFatigue && distanceSincePeak >= endFatigueMinDistanceMeters) {
      closeCandidate();
      continue;
    }

    if (dropFromPeak >= endDropMeters && distanceSincePeak >= endDropDistanceMeters) {
      closeCandidate();
      continue;
    }

    if (distanceSincePressure >= maxEasyAfterPeakMeters && distanceSincePeak >= maxEasyAfterPeakMeters) {
      closeCandidate();
      continue;
    }
  }

  if (active && startIdx !== null && peakIdx !== null) closeCandidate();

  return mergeNearbyClimbs(climbs);
}
