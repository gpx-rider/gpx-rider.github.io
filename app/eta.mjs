// Smart ETA — estimates the remaining ride time from the ride so far.
//
// Plain remaining-distance ÷ current-speed is badly wrong on hilly routes:
// it projects your climbing crawl onto the descent ahead (or vice versa).
// Instead, everything is converted to "flat-equivalent meters": a meter of
// climbing costs extra flat meters, a meter of descending gives a few back
// (factors in tuning.mjs). The rider's average pace in flat-equivalent
// meters per second — measured over the ride so far — is then applied to
// the flat-equivalent distance still ahead. That pace is stable across
// terrain, so the ETA stays honest at the bottom of a climb and at the top.

import {
  ETA_CLIMB_EQUIVALENT_FACTOR,
  ETA_DESCENT_CREDIT_FACTOR,
  ETA_MIN_HISTORY_METERS,
  ETA_MIN_HISTORY_SECONDS,
} from "./tuning.mjs";

export function flatEquivalentMeters({ distanceMeters, ascentMeters = 0, descentMeters = 0 }) {
  return Math.max(
    0,
    distanceMeters
      + ascentMeters * ETA_CLIMB_EQUIVALENT_FACTOR
      - descentMeters * ETA_DESCENT_CREDIT_FACTOR,
  );
}

// The estimator is a per-ride accumulator (not persisted): feed it every
// movement tick, ask it for the remaining time whenever the UI refreshes.
export function createRideEstimator() {
  return { movingSeconds: 0, equivalentMeters: 0 };
}

export function recordEstimatorTick(estimator, { elapsedSeconds, distanceMeters, ascentMeters = 0, descentMeters = 0 }) {
  if (!(elapsedSeconds > 0) || !(distanceMeters > 0)) return;
  estimator.movingSeconds += elapsedSeconds;
  estimator.equivalentMeters += flatEquivalentMeters({ distanceMeters, ascentMeters, descentMeters });
}

// Remaining seconds to the finish, or null when there is nothing to go on
// (no ride history yet and no usable fallback speed). Until enough history
// accrues (ETA_MIN_HISTORY_*), the estimate falls back to raw
// remaining-distance ÷ fallbackSpeedKph.
export function estimateRemainingSeconds(estimator, {
  remainingMeters,
  remainingAscentMeters = 0,
  remainingDescentMeters = 0,
  fallbackSpeedKph = null,
}) {
  if (!(remainingMeters > 0)) return 0;

  const hasHistory = estimator.movingSeconds >= ETA_MIN_HISTORY_SECONDS
    && estimator.equivalentMeters >= ETA_MIN_HISTORY_METERS;
  if (hasHistory) {
    const paceMetersPerSecond = estimator.equivalentMeters / estimator.movingSeconds;
    if (paceMetersPerSecond > 0) {
      return flatEquivalentMeters({
        distanceMeters: remainingMeters,
        ascentMeters: remainingAscentMeters,
        descentMeters: remainingDescentMeters,
      }) / paceMetersPerSecond;
    }
  }

  if (Number.isFinite(fallbackSpeedKph) && fallbackSpeedKph > 0) {
    return remainingMeters / (fallbackSpeedKph / 3.6);
  }
  return null;
}
