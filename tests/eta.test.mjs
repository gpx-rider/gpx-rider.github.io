import assert from "node:assert/strict";
import test from "node:test";
import {
  createRideEstimator,
  estimateRemainingSeconds,
  flatEquivalentMeters,
  recordEstimatorTick,
} from "../app/ride/eta.mjs";
import {
  ETA_CLIMB_EQUIVALENT_FACTOR,
  ETA_DESCENT_CREDIT_FACTOR,
  ETA_MIN_HISTORY_SECONDS,
} from "../app/core/tuning.mjs";

test("flatEquivalentMeters charges climbs and credits descents", () => {
  assert.equal(flatEquivalentMeters({ distanceMeters: 1000 }), 1000);
  assert.equal(
    flatEquivalentMeters({ distanceMeters: 1000, ascentMeters: 80 }),
    1000 + 80 * ETA_CLIMB_EQUIVALENT_FACTOR,
  );
  assert.equal(
    flatEquivalentMeters({ distanceMeters: 1000, descentMeters: 80 }),
    1000 - 80 * ETA_DESCENT_CREDIT_FACTOR,
  );
  // Never negative, whatever the descent credit adds up to.
  assert.equal(flatEquivalentMeters({ distanceMeters: 10, descentMeters: 1000 }), 0);
});

test("estimator falls back to the given speed until history accrues", () => {
  const estimator = createRideEstimator();

  // 36 km/h = 10 m/s → 1000 m remaining = 100 s.
  const eta = estimateRemainingSeconds(estimator, { remainingMeters: 1000, fallbackSpeedKph: 36 });
  assert.equal(eta, 100);

  assert.equal(estimateRemainingSeconds(estimator, { remainingMeters: 1000 }), null);
  assert.equal(estimateRemainingSeconds(estimator, { remainingMeters: 0, fallbackSpeedKph: 36 }), 0);
});

test("estimator projects the measured flat-equivalent pace onto the remaining route", () => {
  const estimator = createRideEstimator();

  // Ride 10 minutes on the flat at 6 m/s (fed in one-second ticks).
  for (let i = 0; i < 600; i += 1) {
    recordEstimatorTick(estimator, { elapsedSeconds: 1, distanceMeters: 6 });
  }
  assert.ok(estimator.movingSeconds >= ETA_MIN_HISTORY_SECONDS);

  // Flat finish: plain distance/speed.
  assert.equal(Math.round(estimateRemainingSeconds(estimator, { remainingMeters: 3600 })), 600);

  // The same distance with 100 m of climbing left takes longer; with 100 m
  // of descending left it takes less.
  const climbing = estimateRemainingSeconds(estimator, { remainingMeters: 3600, remainingAscentMeters: 100 });
  const descending = estimateRemainingSeconds(estimator, { remainingMeters: 3600, remainingDescentMeters: 100 });
  assert.ok(climbing > 600, `climbing ETA ${climbing} should exceed flat 600`);
  assert.ok(descending < 600, `descending ETA ${descending} should beat flat 600`);
});

test("a slow climb does not project a slow descent", () => {
  const estimator = createRideEstimator();

  // Climb for 10 minutes: 2.5 m/s ground speed on an 8% grade. In
  // flat-equivalent terms this is a normal recreational pace.
  for (let i = 0; i < 600; i += 1) {
    recordEstimatorTick(estimator, { elapsedSeconds: 1, distanceMeters: 2.5, ascentMeters: 0.2 });
  }

  // Naive distance/speed for the remaining flat 3 km would say 1200 s; the
  // flat-equivalent model knows the crawl was the climb's fault.
  const eta = estimateRemainingSeconds(estimator, { remainingMeters: 3000 });
  assert.ok(eta < 600, `flat finish after a climb should be fast, got ${eta}`);

  // Standing still contributes nothing (guards against divide-by-zero).
  recordEstimatorTick(estimator, { elapsedSeconds: 1, distanceMeters: 0 });
  assert.ok(Number.isFinite(estimateRemainingSeconds(estimator, { remainingMeters: 100 })));
});
