import {
  CLIMB_MERGE_GAP_METERS,
  CLIMB_MIN_AVERAGE_GRADE_PERCENT,
  CLIMB_MIN_GAIN_METERS,
  CLIMB_NOISE_THRESHOLD_METERS,
} from "./tuning.mjs";

// Detects sustained climbing segments in an enriched route (the `distance`
// and `ele` fields added by route.mjs#enrichRoute). Uses the same
// noise-anchor idea as the total ascent/descent counters there: a climb
// keeps extending through small dips and only closes once elevation has
// dropped CLIMB_NOISE_THRESHOLD_METERS below its peak *and* the route has
// moved on past that peak by CLIMB_MERGE_GAP_METERS — so GPX jitter and
// switchback dips don't fragment one climb into many. Candidates below
// CLIMB_MIN_GAIN_METERS of gain or CLIMB_MIN_AVERAGE_GRADE_PERCENT of
// average grade are dropped as not being a "climb" worth reporting.
export function detectClimbs(route, options = {}) {
  const noiseThreshold = options.noiseThresholdMeters ?? CLIMB_NOISE_THRESHOLD_METERS;
  const minGain = options.minGainMeters ?? CLIMB_MIN_GAIN_METERS;
  const minAverageGrade = options.minAverageGradePercent ?? CLIMB_MIN_AVERAGE_GRADE_PERCENT;
  const mergeGap = options.mergeGapMeters ?? CLIMB_MERGE_GAP_METERS;

  const climbs = [];
  if (route.length < 2) return climbs;

  let start = null; // { distance, ele } — foot of the candidate climb
  let peak = null; // { distance, ele } — highest point reached since start

  const closeCandidate = () => {
    if (!start || !peak) return;
    const lengthMeters = peak.distance - start.distance;
    const gainMeters = peak.ele - start.ele;
    if (lengthMeters > 0 && gainMeters >= minGain && (gainMeters / lengthMeters) * 100 >= minAverageGrade) {
      climbs.push({
        startDistanceMeters: start.distance,
        endDistanceMeters: peak.distance,
        lengthMeters,
        gainMeters,
        averageGradePercent: (gainMeters / lengthMeters) * 100,
      });
    }
    start = null;
    peak = null;
  };

  for (let i = 1; i < route.length; i += 1) {
    const point = route[i];
    const previous = route[i - 1];
    if (!Number.isFinite(point.ele) || !Number.isFinite(previous.ele)) continue;

    if (!start) {
      if (point.ele > previous.ele) {
        start = { distance: previous.distance, ele: previous.ele };
        peak = { distance: point.distance, ele: point.ele };
      }
      continue;
    }

    if (point.ele >= peak.ele) {
      peak = { distance: point.distance, ele: point.ele };
      continue;
    }

    const droppedBelowPeak = peak.ele - point.ele;
    const distancePastPeak = point.distance - peak.distance;
    if (droppedBelowPeak >= noiseThreshold && distancePastPeak >= mergeGap) closeCandidate();
  }
  closeCandidate();

  return climbs;
}
