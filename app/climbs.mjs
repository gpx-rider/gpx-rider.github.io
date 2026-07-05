import {
  CLIMB_FATIGUE_THRESHOLD,
  CLIMB_MAX_FATIGUE,
  CLIMB_RESTING_GRADIENT_PERCENT,
  CLIMB_RECOVERY_MULTIPLIER,
  CLIMB_SMOOTHING_WINDOW_SIZE,
  CLIMB_MIN_GAIN_METERS,
  CLIMB_MIN_AVERAGE_GRADE_PERCENT,
} from "./tuning.mjs";

/**
 * Detects sustained climbing segments in an enriched GPX route using a Leaky Bucket model.
 * * @param {Array} route - Array of point objects containing `distance` (meters) and `ele` (meters).
 * @param {Object} [options={}] - Optional overrides for tuning constants.
 * @returns {Array} Array of detected climb objects with start/end metrics and accumulated gain.
 */
export function detectClimbs(route, options = {}) {
  const fatigueThreshold = options.fatigueThreshold ?? CLIMB_FATIGUE_THRESHOLD;
  const maxFatigue = options.maxFatigue ?? CLIMB_MAX_FATIGUE;
  const restingGradient = options.restingGradientPercent ?? CLIMB_RESTING_GRADIENT_PERCENT;
  const recoveryMultiplier = options.recoveryMultiplier ?? CLIMB_RECOVERY_MULTIPLIER;
  const windowSize = options.smoothingWindowSize ?? CLIMB_SMOOTHING_WINDOW_SIZE;
  const minGain = options.minGainMeters ?? CLIMB_MIN_GAIN_METERS;
  const minAverageGrade = options.minAverageGradePercent ?? CLIMB_MIN_AVERAGE_GRADE_PERCENT;

  const climbs = [];
  if (route.length < 2) return climbs;

  // 1. Pre-filter: Apply a moving average to smooth out raw GPS micro-jitter.
  const smoothedRoute = route.map((point, i, arr) => {
    if (!Number.isFinite(point.ele)) return { ...point };
    
    let sum = 0;
    let count = 0;
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(arr.length - 1, i + halfWindow); j += 1) {
      if (Number.isFinite(arr[j].ele)) {
        sum += arr[j].ele;
        count += 1;
      }
    }
    
    return { ...point, ele: count > 0 ? sum / count : point.ele };
  });

  // 2. State variables for the Leaky Bucket integrator
  let fatigue = 0;
  let candidateStart = null;
  let candidatePeak = null;
  let isActiveClimb = false;
  
  // Track continuous upward effort separately from net geometry
  let runningAccumulatedGain = 0;
  let peakAccumulatedGain = 0;

  const closeCandidate = () => {
    if (isActiveClimb && candidateStart && candidatePeak) {
      const lengthMeters = candidatePeak.distance - candidateStart.distance;
      const netGainMeters = candidatePeak.ele - candidateStart.ele;
      
      // Average grade relies on net gain to accurately classify the overall steepness of the segment.
      const averageGrade = lengthMeters > 0 ? (netGainMeters / lengthMeters) * 100 : 0;
      
      // The threshold check relies on accumulated gain to respect rolling, jagged climbs.
      if (lengthMeters > 0 && peakAccumulatedGain >= minGain && averageGrade >= minAverageGrade) {
        climbs.push({
          startDistanceMeters: candidateStart.distance,
          endDistanceMeters: candidatePeak.distance,
          startElevationMeters: candidateStart.ele,
          endElevationMeters: candidatePeak.ele,
          lengthMeters,
          gainMeters: peakAccumulatedGain, // RESTORED: Exact key expected by your GUI
          netGainMeters: netGainMeters,    // Kept as an extra metric 
          accumulatedGainMeters: peakAccumulatedGain, // Kept as an extra metric
          averageGradePercent: averageGrade,
        });
      }
    }
    
    // Reset state for the next climb
    candidateStart = null;
    candidatePeak = null;
    isActiveClimb = false;
    fatigue = 0;
    runningAccumulatedGain = 0;
    peakAccumulatedGain = 0;
  };

  for (let i = 1; i < smoothedRoute.length; i += 1) {
    const point = smoothedRoute[i];
    const prev = smoothedRoute[i - 1];

    if (!Number.isFinite(point.ele) || !Number.isFinite(prev.ele)) continue;

    const distanceChange = point.distance - prev.distance;
    if (distanceChange <= 0) continue; 

    const elevChange = point.ele - prev.ele;
    
    // Base fatigue calculation
    let deltaFatigue = (elevChange * 100) - (restingGradient * distanceChange);
    
    // Apply drain multiplier if the road is flat or descending
    if (deltaFatigue < 0) {
      deltaFatigue *= recoveryMultiplier;
    }

    const wasEmpty = fatigue === 0;
    
    // Apply delta and constrain fatigue to bucket boundaries [0, maxFatigue]
    fatigue = Math.min(maxFatigue, Math.max(0, fatigue + deltaFatigue));

    if (fatigue > 0) {
      // If the bucket just received its first drop, retroactively tag the base of the climb
      if (wasEmpty) {
        candidateStart = { distance: prev.distance, ele: prev.ele };
        candidatePeak = { distance: point.distance, ele: point.ele };
        
        runningAccumulatedGain = Math.max(0, elevChange);
        peakAccumulatedGain = runningAccumulatedGain;
      } else {
        if (elevChange > 0) {
          runningAccumulatedGain += elevChange;
        }
      }
      
      // Update candidate peak if we reach a new highest elevation within the active fatigue window
      if (candidatePeak && point.ele > candidatePeak.ele) {
        candidatePeak = { distance: point.distance, ele: point.ele };
        
        // Snapshot the accumulated gain exclusively at the true geometric peak
        peakAccumulatedGain = runningAccumulatedGain;
      }

      // Officially transition from "potential effort" to "active climb"
      if (fatigue >= fatigueThreshold && !isActiveClimb) {
        isActiveClimb = true;
      }
    } 
    // The bucket has completely drained; the descent was long enough to fully recover
    else if (!wasEmpty) {
      closeCandidate();
    }
  }

  // Flush any climb that remained active directly through the finish line
  if (fatigue > 0) {
    closeCandidate();
  }

  return climbs;
}