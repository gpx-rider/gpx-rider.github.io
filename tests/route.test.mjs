import assert from "node:assert/strict";
import test from "node:test";
import {
  ascentAt,
  densifyRoute,
  descentAt,
  enrichRoute,
  gradeAt,
  headingAt,
  interpolateRoutePoint,
  routeTotalAscent,
  routeTotalDescent,
  routeTotalDistance,
  sliceRoute,
} from "../app/route/route.mjs";

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

test("sliceRoute interpolates exact endpoints and rebases distance", () => {
  const route = enrichRoute(points);
  const start = route[1].distance * 0.5;
  const end = route[1].distance * 1.5;
  const slice = sliceRoute(route, start, end);

  assert.equal(slice[0].distance, 0);
  assert.ok(Math.abs(routeTotalDistance(slice) - (end - start)) < 0.1);
  assert.ok(Math.abs(slice[0].ele - interpolateRoutePoint(route, start).ele) < 1e-9);
  assert.ok(Math.abs(slice.at(-1).ele - interpolateRoutePoint(route, end).ele) < 1e-9);
});

// Ascent/descent assertions pass the noise threshold explicitly so retuning
// CLIMB_NOISE_THRESHOLD_METERS can't break them.
const NOISE = { noiseThresholdMeters: 2 };

test("enrichRoute accumulates ascent and descent along the track", () => {
  const route = enrichRoute(points, NOISE); // +5 m up, then -2 m down
  assert.equal(route[0].ascent, 0);
  assert.equal(route[0].descent, 0);
  assert.equal(routeTotalAscent(route), 5);
  assert.equal(routeTotalDescent(route), 2);
});

test("ascent/descent ignore sub-threshold elevation noise", () => {
  // A flat road whose GPX elevation jitters by ±1 m point-to-point.
  const noisy = enrichRoute([
    { lat: 50.000, lng: 14.400, ele: 100 },
    { lat: 50.001, lng: 14.400, ele: 101 },
    { lat: 50.002, lng: 14.400, ele: 100 },
    { lat: 50.003, lng: 14.400, ele: 101 },
    { lat: 50.004, lng: 14.400, ele: 100 },
  ], NOISE);
  assert.equal(routeTotalAscent(noisy), 0);
  assert.equal(routeTotalDescent(noisy), 0);

  // A genuine steady climb is counted in full.
  const climb = enrichRoute([
    { lat: 50.000, lng: 14.400, ele: 100 },
    { lat: 50.001, lng: 14.400, ele: 150 },
    { lat: 50.002, lng: 14.400, ele: 200 },
  ], NOISE);
  assert.equal(routeTotalAscent(climb), 100);
  assert.equal(routeTotalDescent(climb), 0);
});

test("ascentAt and descentAt interpolate cumulative climbing at a distance", () => {
  const route = enrichRoute(points, NOISE);

  assert.equal(ascentAt(route, 0), 0);
  assert.equal(ascentAt(route, 1e9), routeTotalAscent(route));
  assert.equal(descentAt(route, -5), 0);
  assert.equal(descentAt(route, 1e9), routeTotalDescent(route));

  // Halfway along the first (climbing) leg: half the leg's 5 m gained.
  const halfway = ascentAt(route, route[1].distance / 2);
  assert.ok(halfway > 2 && halfway < 3, `expected ~2.5, got ${halfway}`);

  // No descent happens before the second leg.
  assert.equal(descentAt(route, route[1].distance), 0);
});

test("gradeAt reports climbing and descending", () => {
  const route = enrichRoute(points);
  assert.ok(gradeAt(route, route[1].distance / 2) > 0, "first leg climbs");
  assert.ok(gradeAt(route, (route[1].distance + route[2].distance) / 2) < 0, "second leg descends");
});

test("headingAt reports the compass direction of travel", () => {
  const route = enrichRoute(points);

  // The route heads due north throughout.
  assert.ok(Math.abs(headingAt(route, route[1].distance) - 0) < 1);

  // Clamped sampling at the very start/end still reads the route's direction.
  assert.ok(Math.abs(headingAt(route, 0) - 0) < 1);
  assert.ok(Math.abs(headingAt(route, routeTotalDistance(route)) - 0) < 1);
});
