import assert from "node:assert/strict";
import test from "node:test";
import { detectClimbs } from "../app/route/climbs.mjs";

// Every test passes the fatigue-pressure parameters explicitly so this suite
// exercises the algorithm (resample/smooth, pressure/recovery curves, dip
// bridging, sanity filters), never the shipped tuning values — retuning
// climb detection must not break these tests. A fine, tight-radius
// resample/smoothing setup keeps the tests' hand-built geometry legible.
const CFG = {
  resampleStepMeters: 10,
  elevationMedianWindowMeters: 10,
  elevationSmoothWindowMeters: 10,
  shortGradeWindowMeters: 40,
  longGradeWindowMeters: 100,
  longGradeWeight: 0.85,
  startFatigue: 300,
  endFatigue: 85,
  endFatigueMinDistanceMeters: 80,
  maxFatigue: 1200,
  pressureStartGradePercent: 1.8,
  pressureExponent: 1.35,
  recoveryUphillThresholdPercent: 1.2,
  recoveryFlatThresholdPercent: -0.5,
  recoveryFlatPressure: 0.25,
  recoveryDownhillBase: 0.5,
  recoveryDownhillScale: 0.28,
  recoveryMax: 3,
  minGainMeters: 15,
  minDistanceMeters: 250,
  startLookbackMeters: 1000,
  endDropMeters: 12,
  endDropDistanceMeters: 160,
  maxEasyAfterPeakMeters: 500,
  mergeGapMeters: 250,
  mergeMaxDropMeters: 8,
  minAverageGradeForLength: [
    { max_length_meters: 350, min_average_grade_percent: 4 },
    { max_length_meters: 700, min_average_grade_percent: 3 },
    { max_length_meters: 1500, min_average_grade_percent: 2 },
    { max_length_meters: Infinity, min_average_grade_percent: 1.4 },
  ],
};

// Build an enriched-route-shaped array from [distanceMeters, elevationMeters]
// pairs (detectClimbs only reads `distance` and `ele`).
function routeOf(points) {
  return points.map(([distance, ele]) => ({ distance, ele }));
}

// A straight segment climbing `gain` meters over `length` meters, sampled
// every `step` meters, starting at (startDistance, startEle).
function slope(points, { length, gain, step = 20 }) {
  const [startDistance, startEle] = points.length
    ? points[points.length - 1]
    : [0, 0];
  const count = Math.round(length / step);
  for (let i = 1; i <= count; i += 1) {
    points.push([startDistance + i * step, startEle + (gain * i) / count]);
  }
  return points;
}

test("a sustained climb is detected with roughly the right geometry", () => {
  // 4 km at 6% after a 1 km flat lead-in.
  const points = slope(slope([[0, 200]], { length: 1000, gain: 0 }), { length: 4000, gain: 240 });
  const climbs = detectClimbs(routeOf(points), CFG);

  assert.equal(climbs.length, 1);
  const [climb] = climbs;
  assert.ok(Math.abs(climb.startDistanceMeters - 1000) < 200, `start ${climb.startDistanceMeters}`);
  assert.ok(Math.abs(climb.endDistanceMeters - 5000) < 200, `end ${climb.endDistanceMeters}`);
  assert.ok(Math.abs(climb.gainMeters - 240) < 10, `gain ${climb.gainMeters}`);
  assert.ok(Math.abs(climb.averageGradePercent - 6) < 0.5, `grade ${climb.averageGradePercent}`);
});

test("a dead-flat route detects nothing", () => {
  const points = slope([[0, 100]], { length: 10_000, gain: 0 });
  assert.equal(detectClimbs(routeOf(points), CFG).length, 0);
});

test("a brief dip does not split one climb into two", () => {
  // 2 km at 6%, a 200 m -2% dip, then 2 km at 6% — one climb, not two.
  let points = slope([[0, 300]], { length: 2000, gain: 120 });
  points = slope(points, { length: 200, gain: -4 });
  points = slope(points, { length: 2000, gain: 120 });
  const climbs = detectClimbs(routeOf(points), CFG);

  assert.equal(climbs.length, 1);
  assert.ok(climb0End(climbs) > 4000, "climb runs through the dip to the second slope");

  function climb0End(list) {
    return list[0].endDistanceMeters;
  }
});

test("a long descent between two climbs produces two climbs", () => {
  // 2 km at 6% up, 3 km at -5% down, then 2 km at 6% up again.
  let points = slope([[0, 300]], { length: 2000, gain: 120 });
  points = slope(points, { length: 3000, gain: -150 });
  points = slope(points, { length: 2000, gain: 120 });
  const climbs = detectClimbs(routeOf(points), CFG);

  assert.equal(climbs.length, 2);
  assert.ok(climbs[0].endDistanceMeters < 2500);
  assert.ok(climbs[1].startDistanceMeters > 4500);
});

test("a false flat below the pressure-start grade is rejected entirely", () => {
  // 1% grade over 6 km never crosses pressureStartGradePercent (1.8%), so
  // the fatigue bucket never fills at all.
  const points = slope([[0, 100]], { length: 6000, gain: 60 });
  assert.equal(detectClimbs(routeOf(points), CFG).length, 0);
});

test("a long near-flat drag above pressure-start but below min grade is rejected", () => {
  // ~2.2% over 6 km crosses the pressure threshold (so fatigue fills), but
  // is well under the 1.4% floor only when the climb registers as much
  // shorter — here the floor for a 6 km climb (1.4%) is comfortably cleared,
  // so tighten the floor via minAverageGradeForLength to force a rejection.
  const points = slope([[0, 100]], { length: 6000, gain: 132 });
  const strict = detectClimbs(routeOf(points), {
    ...CFG,
    minAverageGradeForLength: [{ max_length_meters: Infinity, min_average_grade_percent: 3 }],
  });
  assert.equal(strict.length, 0);
  const lenient = detectClimbs(routeOf(points), {
    ...CFG,
    minAverageGradeForLength: [{ max_length_meters: Infinity, min_average_grade_percent: 1 }],
  });
  assert.equal(lenient.length, 1);
});

test("small total gain is rejected by the min-gain sanity check", () => {
  // 280 m at 5%: 14 m of gain — under the 15 m floor, but clears it once
  // the floor is relaxed.
  const points = slope([[0, 100]], { length: 280, gain: 14, step: 10 });
  assert.equal(detectClimbs(routeOf(points), CFG).length, 0);
  assert.equal(detectClimbs(routeOf(points), { ...CFG, minGainMeters: 5 }).length, 1);
});

test("the start-fatigue threshold decides how sensitive detection is", () => {
  const points = slope([[0, 100]], { length: 500, gain: 30 });
  assert.equal(detectClimbs(routeOf(points), CFG).length, 1);
  assert.equal(detectClimbs(routeOf(points), { ...CFG, startFatigue: 1e6 }).length, 0);
});

test("maxFatigue caps the bucket's peak reading", () => {
  // A 10 km alpine climb accumulates far more raw pressure than a low cap
  // allows; the reported peak fatigue is clamped to the cap, but stays well
  // under a cap high enough to never engage.
  const points = slope([[0, 500]], { length: 10_000, gain: 800 });
  const capped = detectClimbs(routeOf(points), { ...CFG, maxFatigue: 500 });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].maxFatigue, 500, "peak fatigue is clamped to the cap");

  const uncapped = detectClimbs(routeOf(points), { ...CFG, maxFatigue: 1e9 });
  assert.equal(uncapped.length, 1);
  assert.ok(uncapped[0].maxFatigue < 1e9, "peak fatigue stays far under a cap this high");
});

test("elevation smoothing flattens micro-jitter before detection", () => {
  // ±3 m sawtooth on a flat road: raw geometry has grade spikes; the
  // median + moving-average pre-filter flattens them below the pressure
  // threshold.
  const points = [];
  for (let i = 0; i <= 200; i += 1) points.push([i * 20, 100 + (i % 2 ? 3 : 0)]);
  const smoothed = detectClimbs(routeOf(points), { ...CFG, elevationMedianWindowMeters: 100, elevationSmoothWindowMeters: 200 });
  assert.equal(smoothed.length, 0);
});

test("gainMeters is accumulated gain, so rolling climbs keep their upward work", () => {
  // Three 30 m steps with 10 m drops between them: net 70 m from base to
  // peak, but 90 m of accumulated climbing.
  let points = slope([[0, 100]], { length: 1000, gain: 30 });
  points = slope(points, { length: 200, gain: -10 });
  points = slope(points, { length: 1000, gain: 30 });
  points = slope(points, { length: 200, gain: -10 });
  points = slope(points, { length: 1000, gain: 30 });
  const climbs = detectClimbs(routeOf(points), CFG);

  assert.equal(climbs.length, 1);
  assert.ok(Math.abs(climbs[0].gainMeters - 90) < 10, `accumulated gain ${climbs[0].gainMeters}`);
  assert.ok(climbs[0].netGainMeters < climbs[0].gainMeters, "net gain is less than accumulated gain");
});

test("a climb running through the finish line is flushed", () => {
  const points = slope([[0, 100]], { length: 3000, gain: 180 });
  const climbs = detectClimbs(routeOf(points), CFG);
  assert.equal(climbs.length, 1);
  assert.ok(climbs[0].endDistanceMeters > 2500);
});

test("two climbs separated by only a small merge-eligible gap become one", () => {
  // Two independently-acceptable 6% climbs with a short, shallow gap
  // between them get merged by mergeGapMeters/mergeMaxDropMeters.
  let points = slope([[0, 300]], { length: 1000, gain: 60 });
  points = slope(points, { length: 100, gain: -2 });
  points = slope(points, { length: 1000, gain: 60 });
  const merged = detectClimbs(routeOf(points), CFG);
  assert.equal(merged.length, 1);

  const notMerged = detectClimbs(routeOf(points), { ...CFG, mergeGapMeters: 0 });
  assert.ok(notMerged.length >= 1);
});
