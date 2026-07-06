import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCaloriesFromPower,
  formatAltitude,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatLocalTime,
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

test("power calories convert mechanical work through human efficiency", () => {
  // 200 W for one hour is 720 kJ at the pedals. At 24% gross efficiency,
  // active human energy is 720 / (4.184 * 0.24) = ~717 kcal.
  assert.equal(Math.round(activeCaloriesFromPower(200, 3600, 0.24)), 717);
  assert.equal(activeCaloriesFromPower(200, 0, 0.24), 0);
  assert.equal(activeCaloriesFromPower(200, 3600, 0), 0);
});

test("durations format as m:ss and h:mm:ss", () => {
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3725), "1:02:05");
});

test("compact durations show seconds until the hour mark", () => {
  assert.equal(formatDuration(65, "compact"), "1:05");
  assert.equal(formatDuration(3600, "compact"), "1h");
  assert.equal(formatDuration(5400, "compact"), "1h30m");
  assert.equal(formatDuration(12, "compact"), "0:12");
});

test("local time includes seconds in 24-hour and 12-hour formats", () => {
  const morning = new Date(2026, 0, 2, 0, 5, 9);
  const afternoon = new Date(2026, 0, 2, 13, 7, 4);

  assert.equal(formatLocalTime(morning), "00:05:09");
  assert.equal(formatLocalTime(morning, "12"), "12:05:09 AM");
  assert.equal(formatLocalTime(afternoon, "24"), "13:07:04");
  assert.equal(formatLocalTime(afternoon, "12"), "1:07:04 PM");
});
