import assert from "node:assert/strict";
import test from "node:test";

import { enrichRoute } from "../app/route.mjs";
import { gradeColoredRouteSegments } from "../app/route-style.mjs";

test("grade-colored route segments merge adjacent points with the same color", () => {
  const route = enrichRoute([
    { lat: 50, lng: 14, ele: 100 },
    { lat: 50.001, lng: 14, ele: 110 },
    { lat: 50.002, lng: 14, ele: 120 },
    { lat: 50.003, lng: 14, ele: 110 },
  ]);
  const colorForGrade = (grade) => grade >= 0 ? "up" : "down";
  const segments = gradeColoredRouteSegments(route, route, colorForGrade);

  assert.deepEqual(segments.map(({ color }) => color), ["up", "down"]);
  assert.deepEqual(segments[0].path, route.slice(0, 3));
  assert.deepEqual(segments[1].path, route.slice(2));
});

test("grade-colored route segments ignore unusable paths", () => {
  const route = enrichRoute([{ lat: 50, lng: 14, ele: 100 }]);
  assert.deepEqual(gradeColoredRouteSegments(route, [], () => "flat"), []);
  assert.deepEqual(gradeColoredRouteSegments(route, route, () => "flat"), []);
});
