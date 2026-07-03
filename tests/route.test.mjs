import assert from "node:assert/strict";
import test from "node:test";
import {
  densifyRoute,
  enrichRoute,
  gradeAt,
  interpolateRoutePoint,
  routeTotalDistance,
} from "../app/route.mjs";

// A short straight route heading north; consecutive points ~111 m apart.
const points = [
  { lat: 50.000, lng: 14.400, ele: 100 },
  { lat: 50.001, lng: 14.400, ele: 105 },
  { lat: 50.002, lng: 14.400, ele: 103 },
];

test("enrichRoute accumulates distance along the track", () => {
  const route = enrichRoute(points);
  assert.equal(route[0].distance, 0);
  assert.ok(route[1].distance > 100 && route[1].distance < 125);
  assert.ok(route[2].distance > route[1].distance);
  assert.equal(routeTotalDistance(route), route.at(-1).distance);
});

test("interpolateRoutePoint blends position and elevation", () => {
  const route = enrichRoute(points);
  const midpoint = interpolateRoutePoint(route, route[1].distance / 2);
  assert.ok(midpoint.lat > 50.000 && midpoint.lat < 50.001);
  assert.ok(midpoint.ele > 100 && midpoint.ele < 105);

  assert.deepEqual(interpolateRoutePoint(route, -5), route[0]);
  assert.deepEqual(interpolateRoutePoint(route, 1e9), route.at(-1));
});

test("densifyRoute keeps originals and bounds the gap between points", () => {
  const route = enrichRoute(points); // consecutive points ~111 m apart
  const dense = densifyRoute(route, 25);

  for (const original of route) {
    assert.ok(dense.some((p) => p.lat === original.lat && p.lng === original.lng), "original point kept");
  }

  const enrichedDense = enrichRoute(dense);
  for (let i = 1; i < enrichedDense.length; i += 1) {
    const gap = enrichedDense[i].distance - enrichedDense[i - 1].distance;
    assert.ok(gap <= 25 + 1, `gap ${gap} exceeds spacing`);
  }

  // Already-dense routes gain nothing.
  assert.equal(densifyRoute(route, 500).length, route.length);
});

test("gradeAt reports climbing and descending", () => {
  const route = enrichRoute(points);
  assert.ok(gradeAt(route, route[1].distance / 2) > 0, "first leg climbs");
  assert.ok(gradeAt(route, (route[1].distance + route[2].distance) / 2) < 0, "second leg descends");
});
