import assert from "node:assert/strict";
import test from "node:test";
import {
  buildElevationProfile,
  densifyRoute,
  elevationAt,
  enrichRoute,
  gradeAt,
  interpolateRoutePoint,
  maxElevationNear,
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

test("buildElevationProfile sums ascent/descent and classifies climb/descent/flat", () => {
  const route = enrichRoute([
    { lat: 50.000, lng: 14.400, ele: 100 },
    { lat: 50.009, lng: 14.400, ele: 200 }, // ~1000 m climb
    { lat: 50.0135, lng: 14.400, ele: 150 }, // ~500 m descent
    { lat: 50.016, lng: 14.400, ele: 150 }, // ~280 m flat
  ]);

  const profile = buildElevationProfile(route);
  const total = elevationAt(profile, routeTotalDistance(route));

  assert.ok(Math.abs(total.gain - 100) < 5, `gain ${total.gain}`);
  assert.ok(Math.abs(total.loss - 50) < 5, `loss ${total.loss}`);
  assert.ok(total.climbDistance > 900 && total.climbDistance < 1100, `climbDistance ${total.climbDistance}`);
  assert.ok(total.descentDistance > 400 && total.descentDistance < 600, `descentDistance ${total.descentDistance}`);
  assert.ok(total.flatDistance > 150, `flatDistance ${total.flatDistance}`);
});

test("elevationAt clamps at the ends and interpolates monotonically in between", () => {
  const route = enrichRoute(points);
  const profile = buildElevationProfile(route);
  const total = routeTotalDistance(route);

  assert.deepEqual(elevationAt(profile, -5), profile[0]);
  assert.deepEqual(elevationAt(profile, 1e9), profile.at(-1));

  const mid = elevationAt(profile, total / 2);
  assert.ok(mid.gain >= 0 && mid.gain <= elevationAt(profile, total).gain);
});

test("maxElevationNear reports the highest nearby track point", () => {
  const route = enrichRoute(points);

  // Right on the middle (highest) point.
  assert.equal(maxElevationNear(route, { lat: 50.001, lng: 14.400 }, 50), 105);

  // A wide radius sees the whole route; a tiny one near nothing sees nothing.
  assert.equal(maxElevationNear(route, { lat: 50.001, lng: 14.400 }, 500), 105);
  assert.equal(maxElevationNear(route, { lat: 50.000, lng: 14.400 }, 50), 100);
  assert.equal(maxElevationNear(route, { lat: 51.000, lng: 14.400 }, 100), null);
});
