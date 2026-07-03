import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatSpeed,
} from "../app/units.mjs";

test("distance formatting respects the unit system", () => {
  assert.equal(formatDistance(10000, "metric"), "10.00 km");
  assert.equal(formatDistance(10000, "imperial"), "6.21 mi");
  assert.equal(formatDistance(1609.344, "imperial"), "1.00 mi");
});

test("speed formatting converts km/h to mph", () => {
  assert.equal(formatSpeed(24, "metric"), "24.0 km/h");
  assert.equal(formatSpeed(24, "imperial"), "14.9 mph");
  assert.equal(formatSpeed(NaN, "metric"), "--");
});

test("altitude formatting converts to feet", () => {
  assert.equal(formatAltitude(1000, "metric"), "1000 m");
  assert.equal(formatAltitude(1000, "imperial"), "3281 ft");
});

test("energy formatting converts kcal to kJ", () => {
  assert.equal(formatEnergy(100, "kcal"), "100 kcal");
  assert.equal(formatEnergy(100, "kj"), "418 kJ");
  assert.equal(formatEnergy(NaN, "kcal"), "--");
});

test("durations format as m:ss and h:mm:ss", () => {
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3725), "1:02:05");
});
