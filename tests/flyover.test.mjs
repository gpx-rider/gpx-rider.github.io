import test from "node:test";
import assert from "node:assert/strict";

import {
  orbitCamera,
  createFlyover,
  douglasPeucker,
  resampleClosed,
  smoothToTurnRadius,
  computeArcAndCurvature,
  buildSpeedProfile,
} from "../app/flyover.mjs";

// --- Orbit ----------------------------------------------------------------------

test("orbit spins the heading one full turn per period", () => {
  const base = { center: { lat: 50, lng: 14, altitude: 100 }, heading: 30, tilt: 60, range: 5000 };
  assert.equal(orbitCamera(base, 0, { secondsPerRevolution: 60 }).heading, 30);
  // Quarter of the way round.
  assert.ok(Math.abs(orbitCamera(base, 15, { secondsPerRevolution: 60 }).heading - (30 + 90)) < 1e-6);
  // A whole revolution returns to the start heading (mod 360).
  assert.ok(Math.abs(orbitCamera(base, 60, { secondsPerRevolution: 60 }).heading - 30) < 1e-6);
  // center/tilt/range are carried through untouched.
  const spun = orbitCamera(base, 10, { secondsPerRevolution: 60 });
  assert.equal(spun.tilt, 60);
  assert.equal(spun.range, 5000);
});

test("orbit direction reverses the spin", () => {
  const base = { center: { lat: 0, lng: 0, altitude: 0 }, heading: 0, tilt: 45, range: 1000 };
  const cw = orbitCamera(base, 15, { secondsPerRevolution: 60, direction: 1 });
  const ccw = orbitCamera(base, 15, { secondsPerRevolution: 60, direction: -1 });
  assert.ok(Math.abs(cw.heading - 90) < 1e-6);
  assert.ok(Math.abs(ccw.heading - 270) < 1e-6); // -90 wrapped
});

// --- Path simplification --------------------------------------------------------

test("Douglas-Peucker drops near-collinear points but keeps corners", () => {
  const line = [[0, 0, 0], [1, 0.001, 0], [2, 0, 0], [3, 0.0005, 0], [4, 0, 0]];
  assert.deepEqual(douglasPeucker(line, 0.1), [[0, 0, 0], [4, 0, 0]]);

  const corner = [[0, 0, 0], [5, 0, 0], [5, 5, 0]];
  // The corner point is far from the 0,0→5,5 line, so it survives.
  assert.equal(douglasPeucker(corner, 0.1).length, 3);
});

// --- Resampling -----------------------------------------------------------------

test("closed resample produces roughly uniform spacing around the loop", () => {
  const square = [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]]; // perimeter 400
  const samples = resampleClosed(square, 20);
  assert.ok(samples.length >= 12);
  // Every consecutive gap (including the wrap) is close to the step size.
  const step = 400 / samples.length;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(Math.abs(d - step) < step * 0.5, `gap ${d} near ${step}`);
  }
});

// --- Turn-radius smoothing ------------------------------------------------------

test("smoothing opens up corners until they clear the minimum turn radius", () => {
  // A tight square loop: sharp 90° corners have effectively zero radius.
  const square = resampleClosed([[0, 0, 0], [200, 0, 0], [200, 200, 0], [0, 200, 0]], 10);
  const before = peak(square);
  const smoothed = smoothToTurnRadius(square, { strength: 0.5, maxIterations: 300, minTurnRadiusMeters: 60 });
  const after = peak(smoothed);
  assert.ok(after < before, "smoothing reduces peak curvature");
  // Peak curvature should be at or under 1/minRadius once smoothing settles.
  assert.ok(after <= 1 / 60 + 1e-3, `peak radius ${1 / after} >= 60`);
});

function peak(points) {
  const { curvature } = computeArcAndCurvature(points);
  return Math.max(...curvature);
}

// --- Speed profile --------------------------------------------------------------

test("speed profile honours max speed, lateral accel in bends, and the floor", () => {
  const circle = [];
  const R = 300;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * 2 * Math.PI;
    circle.push([R * Math.cos(a), R * Math.sin(a), 0]);
  }
  const geometry = computeArcAndCurvature(circle);
  const limits = { maxSpeedMps: 100, minSpeedMps: 5, maxAccelMps2: 3, maxLateralAccelMps2: 4 };
  const v = buildSpeedProfile(geometry, limits);

  // On a constant-radius circle the curvature cap is √(a_lat·R) everywhere.
  const expected = Math.sqrt(limits.maxLateralAccelMps2 * R);
  for (const speed of v) {
    assert.ok(speed <= limits.maxSpeedMps + 1e-6, "never over max speed");
    assert.ok(speed >= limits.minSpeedMps - 1e-6, "never under the floor");
    assert.ok(Math.abs(speed - expected) < expected * 0.05, `curve speed ~${expected}, got ${speed}`);
  }
});

test("speed profile brakes into a tight bend and opens up on the straights", () => {
  // A long straight with a hairpin: a stadium/ellipse stretched along x.
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * 2 * Math.PI;
    pts.push([1500 * Math.cos(a), 120 * Math.sin(a), 0]); // very flat ellipse
  }
  const geometry = computeArcAndCurvature(pts);
  const v = buildSpeedProfile(geometry, {
    maxSpeedMps: 90, minSpeedMps: 10, maxAccelMps2: 3, maxLateralAccelMps2: 6,
  });
  // The tightest curvature (the ends) must be slower than the straight (sides).
  const straightIdx = pts.findIndex((p) => Math.abs(p[0]) < 50); // near an end-cap top... actually straight is where |y| grows
  // The ends of the ellipse (max |x|) are the tight turns; the long sides are fast.
  const tightEnd = argClosest(pts, [1500, 0]);
  const longSide = argClosest(pts, [0, 120]);
  assert.ok(v[tightEnd] < v[longSide], `bend ${v[tightEnd]} slower than straight ${v[longSide]}`);
  // The consecutive change never implies more than the accel limit.
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    const ds = geometry.cumulative[i + 1] - geometry.cumulative[i];
    const accel = Math.abs(v[j] * v[j] - v[i] * v[i]) / (2 * Math.max(ds, 1e-6));
    assert.ok(accel <= 3 + 0.5, `accel ${accel} within limit`);
  }
  void straightIdx;
});

function argClosest(points, target) {
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// --- The driver -----------------------------------------------------------------

const HELI = {
  simplifyToleranceMeters: 12,
  resampleSpacingMeters: 20,
  smoothingStrength: 0.5,
  smoothingMaxIterations: 200,
  minTurnRadiusMeters: 25,
  maxSpeedMps: 33,
  minSpeedMps: 4,
  maxAccelMps2: 4,
  maxLateralAccelMps2: 6,
  flyHeightMeters: 130,
  lookAheadMeters: 200,
};

// A ~4 km route with a couple of bends, at ~46°N.
const route = [];
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  route.push({
    lat: 46 + 0.02 * Math.sin(t * Math.PI * 2),
    lng: 7 + 0.05 * t,
    ele: 600 + 300 * t,
  });
}

test("flyover returns null for a route too small to fly", () => {
  assert.equal(createFlyover([{ lat: 46, lng: 7, ele: 0 }], HELI), null);
  assert.equal(createFlyover([{ lat: 46, lng: 7, ele: 0 }, { lat: 46, lng: 7, ele: 0 }], HELI), null);
});

test("flyover builds a loop and emits finite camera frames", () => {
  const fly = createFlyover(route, HELI);
  assert.ok(fly, "driver built");
  assert.ok(fly.loopLength > 1000, "loop spans the route");
  assert.ok(fly.lapSeconds > 0);

  const frame = fly.frameAt(0);
  for (const k of ["lat", "lng", "altitude"]) {
    assert.ok(Number.isFinite(frame.eye[k]), `eye.${k} finite`);
    assert.ok(Number.isFinite(frame.lookAt[k]), `lookAt.${k} finite`);
  }
  // Eye rides above the ground it's looking at by ~fly height.
  assert.ok(frame.eye.altitude > frame.lookAt.altitude, "eye is above the look-at");
  // Speed is within the envelope.
  assert.ok(frame.speedMps >= HELI.minSpeedMps - 1e-6 && frame.speedMps <= HELI.maxSpeedMps + 1e-6);
});

test("flyover advances and wraps around the loop over one lap", () => {
  const fly = createFlyover(route, HELI);
  let s = 0;
  let elapsed = 0;
  const dt = 1 / 30;
  // Integrate for a bit over one estimated lap and confirm it returns near start.
  const laps = fly.lapSeconds * 1.0;
  while (elapsed < laps) { s = fly.advance(s, dt); elapsed += dt; }
  // After ~one lap the arc-length has wrapped back near 0 (within a few samples).
  const nearStart = Math.min(s, fly.loopLength - s);
  assert.ok(nearStart < fly.loopLength * 0.1, `ended near start (s=${s}, loop=${fly.loopLength})`);
});

test("flyover look-at override aims the camera at a given point", () => {
  const fly = createFlyover(route, HELI);
  const target = { lat: 46.01, lng: 7.02, altitude: 700 };
  const frame = fly.frameAt(100, target);
  assert.equal(frame.lookAt.lat, target.lat);
  assert.equal(frame.lookAt.lng, target.lng);
  assert.equal(frame.lookAt.altitude, target.altitude);
});
