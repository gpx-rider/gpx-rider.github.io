import assert from "node:assert/strict";
import test from "node:test";
import { resampleAndSmoothElevation, rollingGrade } from "../app/route/climb-signal.mjs";

test("resampling produces evenly-spaced points spanning the original distance", () => {
  const route = [
    { distance: 0, ele: 0 },
    { distance: 137, ele: 10 },
    { distance: 305, ele: 5 },
  ];
  const points = resampleAndSmoothElevation(route, 50, 1, 1);

  assert.equal(points[0].distance, 0);
  assert.equal(points[points.length - 1].distance, 305);
  for (let i = 1; i < points.length - 1; i += 1) {
    assert.ok(Math.abs(points[i].distance - points[i - 1].distance - 50) < 1e-6);
  }
});

test("smoothing flattens a single-point elevation spike", () => {
  const route = [];
  for (let i = 0; i <= 20; i += 1) route.push({ distance: i * 20, ele: i === 10 ? 50 : 0 });
  const points = resampleAndSmoothElevation(route, 20, 100, 100);
  const peak = Math.max(...points.map((p) => p.ele));
  assert.ok(peak < 50, `spike should be smoothed down, got ${peak}`);
});

test("rollingGrade reads the average grade over the requested window", () => {
  const points = [];
  for (let i = 0; i <= 20; i += 1) points.push({ distance: i * 10, ele: i * 1 }); // 10% grade throughout
  const grade = rollingGrade(points, 10, 100, 10);
  assert.ok(Math.abs(grade - 10) < 0.5, `grade ${grade}`);
});

test("rollingGrade is flat over a flat profile", () => {
  const points = [];
  for (let i = 0; i <= 20; i += 1) points.push({ distance: i * 10, ele: 100 });
  assert.equal(rollingGrade(points, 10, 100, 10), 0);
});
