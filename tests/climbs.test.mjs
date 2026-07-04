import assert from "node:assert/strict";
import test from "node:test";
import { detectClimbs } from "../app/climbs.mjs";

// Builds a synthetic enriched-route array (only the `distance`/`ele` fields
// detectClimbs reads) from [distanceMeters, elevationMeters] pairs.
function route(points) {
  return points.map(([distance, ele]) => ({ distance, ele }));
}

test("finds no climbs on a flat or descending route", () => {
  assert.deepEqual(detectClimbs(route([[0, 100], [1000, 100], [2000, 90]])), []);
});

test("detects a single steady climb", () => {
  const climbs = detectClimbs(route([[0, 0], [1000, 100], [2000, 200], [3000, 300]]));
  assert.equal(climbs.length, 1);
  assert.equal(climbs[0].startDistanceMeters, 0);
  assert.equal(climbs[0].endDistanceMeters, 3000);
  assert.equal(climbs[0].startElevationMeters, 0);
  assert.equal(climbs[0].endElevationMeters, 300);
  assert.equal(climbs[0].gainMeters, 300);
  assert.equal(climbs[0].lengthMeters, 3000);
  assert.ok(Math.abs(climbs[0].averageGradePercent - 10) < 1e-9);
});

test("merges a short flat stretch within the default merge gap", () => {
  const climbs = detectClimbs(
    route([
      [0, 0],
      [1000, 150],
      [1050, 150], // flat for 50 m: well within the default 100 m merge gap
      [1100, 152],
      [2000, 300],
    ]),
  );
  assert.equal(climbs.length, 1);
  assert.equal(climbs[0].gainMeters, 300);
});

test("merges a short dip within the descent tolerance and merge gap", () => {
  const climbs = detectClimbs(
    route([
      [0, 0],
      [1000, 150],
      [1050, 149], // 1 m dip: below the default 5 m descent tolerance, ignored
      [1100, 152],
      [2000, 300],
    ]),
  );
  assert.equal(climbs.length, 1);
  assert.equal(climbs[0].gainMeters, 300);
});

test("splits into two climbs when a dip clears the descent tolerance and merge gap", () => {
  const climbs = detectClimbs(
    route([
      [0, 0],
      [1000, 150], // peak of climb 1
      [1500, 100], // dropped 50 m, 500 m past the peak: clears both bars
      [1600, 250], // climb 2 starts and gains 150 m
    ]),
  );
  assert.equal(climbs.length, 2);
  assert.equal(climbs[0].gainMeters, 150);
  assert.equal(climbs[1].gainMeters, 150);
});

test("does not close a climb over a 100 m flat stretch or a few meters of downhill", () => {
  const climbs = detectClimbs(
    route([
      [0, 0],
      [1000, 200], // peak
      [1090, 197], // 3 m down, 90 m past the peak: within both default tolerances
      [1200, 250], // keeps climbing to a new peak
    ]),
  );
  assert.equal(climbs.length, 1);
  assert.equal(climbs[0].gainMeters, 250);
});

test("drops candidates below the minimum gain or average grade", () => {
  // 20 m gain over 1 km: fails the default 30 m minimum gain.
  assert.deepEqual(detectClimbs(route([[0, 0], [1000, 20]])), []);
  // 40 m gain over 4 km is a 1% average grade: fails the default 3% minimum.
  assert.deepEqual(detectClimbs(route([[0, 0], [4000, 40]])), []);
});

test("custom thresholds relax or tighten what counts as a climb", () => {
  // 10 m over 300 m is a 3.3% grade (clears the default 3% bar) but only
  // 10 m of gain (fails the default 30 m bar) until it's lowered.
  const climbs = detectClimbs(route([[0, 0], [300, 10]]), { minGainMeters: 10 });
  assert.equal(climbs.length, 1);
  assert.equal(climbs[0].gainMeters, 10);
});
