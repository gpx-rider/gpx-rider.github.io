import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCameraLift,
  applyCameraOffset,
  cameraDistanceToPoint,
  cameraEyePosition,
  cameraFromEyeAndCenter,
  chaseStep,
  computeFollowCamera,
  computeRouteOverviewCamera,
  measureCameraOffset,
  normalizeHeading,
  rangeForBehind,
} from "../app/camera.mjs";
import * as geo from "../app/geo.mjs";

const riderPosition = { lat: 50.087, lng: 14.421 };

test("photorealistic camera always centers on the rider", () => {
  const camera = computeFollowCamera({
    riderPosition,
    heading: 725,
    cameraZoom: 1,
    cameraBehindMeters: 300,
    cameraAngleDegrees: 67,
  });

  assert.deepEqual(camera.center, riderPosition);
  assert.equal(camera.heading, 5);
  assert.equal(camera.tilt, 67);
});

test("behind controls trailing range", () => {
  const close = computeFollowCamera({
    riderPosition,
    heading: 90,
    cameraZoom: 1,
    cameraBehindMeters: 100,
    cameraAngleDegrees: 67,
  });
  const far = computeFollowCamera({
    riderPosition,
    heading: 90,
    cameraZoom: 1,
    cameraBehindMeters: 1000,
    cameraAngleDegrees: 67,
  });

  assert.deepEqual(close.center, riderPosition);
  assert.ok(far.range > close.range);
});

test("zoom changes range without moving the rider target", () => {
  const normal = computeFollowCamera({
    riderPosition,
    heading: 180,
    cameraZoom: 1,
    cameraBehindMeters: 600,
    cameraAngleDegrees: 67,
  });
  const zoomedIn = computeFollowCamera({
    riderPosition,
    heading: 180,
    cameraZoom: 2,
    cameraBehindMeters: 600,
    cameraAngleDegrees: 67,
  });

  assert.deepEqual(normal.center, riderPosition);
  assert.deepEqual(zoomedIn.center, riderPosition);
  assert.ok(zoomedIn.range < normal.range);
});

test("angle changes tilt and preserves rider center", () => {
  const low = computeFollowCamera({
    riderPosition,
    heading: 180,
    cameraZoom: 1,
    cameraBehindMeters: 300,
    cameraAngleDegrees: 30,
  });
  const high = computeFollowCamera({
    riderPosition,
    heading: 180,
    cameraZoom: 1,
    cameraBehindMeters: 300,
    cameraAngleDegrees: 80,
  });

  assert.deepEqual(low.center, riderPosition);
  assert.deepEqual(high.center, riderPosition);
  assert.equal(low.tilt, 30);
  assert.equal(high.tilt, 80);
});

test("heading offset preserves manual rotation relative to the route", () => {
  const camera = computeFollowCamera({
    riderPosition,
    heading: 90,
    headingOffsetDegrees: -25,
    cameraZoom: 1,
    cameraBehindMeters: 300,
    cameraAngleDegrees: 67,
  });

  assert.equal(camera.heading, 65);
  assert.deepEqual(camera.center, riderPosition);
});

test("camera offset moves the look target relative to route heading", () => {
  const camera = computeFollowCamera({
    riderPosition,
    heading: 0,
    cameraOffsetForwardMeters: 100,
    cameraOffsetRightMeters: 50,
    cameraZoom: 1,
    cameraBehindMeters: 300,
    cameraAngleDegrees: 67,
  });

  const measured = measureCameraOffset(riderPosition, camera.center, 0);
  assert.ok(Math.abs(measured.forwardMeters - 100) < 0.1);
  assert.ok(Math.abs(measured.rightMeters - 50) < 0.1);
});

test("measured camera offset can be replayed", () => {
  const center = applyCameraOffset(riderPosition, 45, 120, -80);
  const measured = measureCameraOffset(riderPosition, center, 45);
  const replayed = applyCameraOffset(riderPosition, 45, measured.forwardMeters, measured.rightMeters);

  assert.ok(Math.abs(replayed.lat - center.lat) < 0.000001);
  assert.ok(Math.abs(replayed.lng - center.lng) < 0.000001);
});

test("camera distance to the look-at point equals the range", () => {
  // Regardless of tilt/heading, the eye is exactly `range` away from the
  // ground point it is looking at.
  for (const tilt of [0, 30, 67, 85]) {
    const distance = cameraDistanceToPoint(
      { center: { ...riderPosition, altitude: 0 }, range: 1000, tilt, heading: 42 },
      { ...riderPosition, ele: 0 },
    );
    assert.ok(Math.abs(distance - 1000) < 1, `tilt ${tilt}: got ${distance}`);
  }
});

test("camera distance grows for points away from the center", () => {
  const camera = { center: { ...riderPosition, altitude: 0 }, range: 500, tilt: 60, heading: 0 };
  const centered = cameraDistanceToPoint(camera, { ...riderPosition, ele: 0 });
  // ~1.1 km north of the look-at center.
  const offCenter = cameraDistanceToPoint(camera, { lat: riderPosition.lat + 0.01, lng: riderPosition.lng, ele: 0 });
  assert.ok(offCenter > centered);
});

test("camera distance handles missing camera state", () => {
  assert.equal(cameraDistanceToPoint({ center: null, range: 100 }, riderPosition), null);
  assert.equal(cameraDistanceToPoint({ center: riderPosition, range: NaN }, riderPosition), null);
});

test("camera helper bounds are stable", () => {
  assert.equal(normalizeHeading(-1), 359);
  assert.equal(rangeForBehind(0, 67), 35);
  assert.ok(rangeForBehind(1000, 45) > 1000);
});

test("camera eye position matches the distance reconstruction", () => {
  // Straight-down camera: the eye is directly above the center by `range`.
  const overhead = cameraEyePosition({ center: { ...riderPosition, altitude: 50 }, range: 400, tilt: 0, heading: 90 });
  assert.ok(Math.abs(overhead.lat - riderPosition.lat) < 0.000001);
  assert.ok(Math.abs(overhead.lng - riderPosition.lng) < 0.000001);
  assert.ok(Math.abs(overhead.altitude - 450) < 0.001);

  // Tilted camera: the eye pulls back along the opposite heading and drops.
  const tilted = cameraEyePosition({ center: { ...riderPosition, altitude: 0 }, range: 1000, tilt: 60, heading: 0 });
  assert.ok(tilted.lat < riderPosition.lat, "eye is south of a north-facing camera");
  assert.ok(Math.abs(tilted.altitude - 500) < 0.001, "eye height is range * cos(tilt)");

  assert.equal(cameraEyePosition({ center: null, range: 100 }), null);
  assert.equal(cameraEyePosition({ center: riderPosition, range: 0 }), null);
});

test("camera lift tilts toward overhead without changing range", () => {
  const base = { tiltDegrees: 75, rangeMeters: 1000, liftMeters: 0 };
  assert.deepEqual(applyCameraLift(base), { tilt: 75, extraCenterAltitude: 0 });

  // eye height at 75 deg is ~259 m; lifting 200 m must reduce the tilt so
  // that range * cos(tilt) covers the full desired height.
  const lifted = applyCameraLift({ ...base, liftMeters: 200 });
  assert.ok(lifted.tilt < 75);
  assert.equal(lifted.extraCenterAltitude, 0);
  const eyeHeight = 1000 * Math.cos(lifted.tilt * Math.PI / 180);
  const desired = 1000 * Math.cos(75 * Math.PI / 180) + 200;
  assert.ok(Math.abs(eyeHeight - desired) < 0.01);
});

test("camera lift beyond the tilt limit raises the look-at altitude", () => {
  // A 2 km lift cannot come from tilting a 1 km range; the remainder must be
  // reported as extra center altitude, and the tilt must respect its floor.
  const lifted = applyCameraLift({ tiltDegrees: 75, rangeMeters: 1000, liftMeters: 2000, minTiltDegrees: 5 });
  assert.ok(Math.abs(lifted.tilt - 5) < 0.01);
  const achieved = 1000 * Math.cos(lifted.tilt * Math.PI / 180) - 1000 * Math.cos(75 * Math.PI / 180);
  assert.ok(Math.abs(achieved + lifted.extraCenterAltitude - 2000) < 0.01);
});

// --- Route overview -----------------------------------------------------------

// A straight west→east route at ~50°N; ~7 km long.
const straightRoute = [
  { lat: 50, lng: 14, ele: 100 },
  { lat: 50, lng: 14.05, ele: 150 },
  { lat: 50, lng: 14.1, ele: 100 },
];

// Compass headings wrap at 360; compare via the shortest angular distance.
function assertHeadingNear(actual, expected, tolerance, message) {
  const delta = Math.abs(((actual - expected + 540) % 360) - 180);
  assert.ok(delta < tolerance, message ?? `heading ${actual} not within ${tolerance} of ${expected}`);
}

test("overview of a straight route reads start-left, end-right at 45 degrees", () => {
  const camera = computeRouteOverviewCamera(straightRoute);

  // Axis start→end points east; the default view looks north, which puts the
  // start on the left of the screen and the end on the right.
  assertHeadingNear(camera.heading, 0, 1);
  assert.equal(camera.tilt, 45);
  // Centered between the endpoints, at the middle of the elevation span.
  assert.ok(Math.abs(camera.center.lat - 50) < 0.0005);
  assert.ok(Math.abs(camera.center.lng - 14.05) < 0.0005);
  assert.ok(Math.abs(camera.center.altitude - 125) < 0.001);
  // The ~7 km width must fit the viewport, so the range is kilometers out.
  assert.ok(camera.range > 3500);
});

test("overview faces the side of the route furthest from the axis", () => {
  const bulgeLeft = computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50.05, lng: 14.05, ele: 0 }, // north of the west→east axis = left
    { lat: 50, lng: 14.1, ele: 0 },
  ]);
  // Far side is north: the camera looks north, start stays on the left.
  assertHeadingNear(bulgeLeft.heading, 0, 1);

  const bulgeRight = computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 49.95, lng: 14.05, ele: 0 }, // south of the axis = right
    { lat: 50, lng: 14.1, ele: 0 },
  ]);
  // Far side is south: the camera flips to look south so the bulge sits away
  // from the viewer.
  assertHeadingNear(bulgeRight.heading, 180, 1);
});

test("wider routes need longer overview ranges", () => {
  const short = computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50, lng: 14.02, ele: 0 },
  ]);
  const long = computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50, lng: 14.3, ele: 0 },
  ]);
  assert.ok(long.range > short.range * 5);
});

test("overview handles loops and degenerate routes", () => {
  // Loop: start and end coincide; the axis falls back to the farthest point.
  const loop = computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50.02, lng: 14.02, ele: 0 },
    { lat: 50.04, lng: 14, ele: 0 },
    { lat: 50.02, lng: 13.98, ele: 0 },
    { lat: 50, lng: 14, ele: 0 },
  ]);
  assert.ok(Number.isFinite(loop.heading));
  assert.ok(loop.range > 0);

  // All points on the same spot: nothing to frame.
  assert.equal(computeRouteOverviewCamera([
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50, lng: 14, ele: 0 },
  ]), null);
  assert.equal(computeRouteOverviewCamera([{ lat: 50, lng: 14, ele: 0 }]), null);
  assert.equal(computeRouteOverviewCamera([]), null);
});

// --- Physical camera chase ------------------------------------------------------

function runChase({ start, target, maxAcceleration = 100, maxSpeed = Infinity, dt = 1 / 60, maxSteps = 100000 }) {
  let position = [...start];
  let velocity = [0, 0, 0];
  const speeds = [];
  for (let i = 0; i < maxSteps; i++) {
    const step = chaseStep({ position, velocity, target, maxAcceleration, maxSpeed, dt });
    position = step.position;
    velocity = step.velocity;
    // The final settle snap zeroes a residual sub-limit velocity; exclude it
    // so `speeds` reflects the physical motion.
    if (step.settled) return { position, velocity, speeds, settled: true };
    speeds.push(Math.hypot(...velocity));
  }
  return { position, velocity, speeds, settled: false };
}

test("chase arrives at a distant target and stops there", () => {
  const result = runChase({ start: [0, 0, 0], target: [5000, -2000, 300] });
  assert.ok(result.settled, "chase must settle");
  assert.deepEqual(result.position, [5000, -2000, 300]);
  assert.deepEqual(result.velocity, [0, 0, 0]);
});

test("chase respects the acceleration limit and decelerates to arrive", () => {
  const dt = 1 / 60;
  const maxAcceleration = 100;
  const result = runChase({ start: [0, 0, 0], target: [3000, 0, 0], maxAcceleration, dt });

  let previous = 0;
  for (const speed of result.speeds) {
    assert.ok(Math.abs(speed - previous) <= maxAcceleration * dt + 1e-9, "acceleration stays bounded");
    previous = speed;
  }
  // The peak speed happens mid-flight, not at the end: physical accelerate →
  // decelerate motion.
  const peakIndex = result.speeds.indexOf(Math.max(...result.speeds));
  assert.ok(peakIndex > 10 && peakIndex < result.speeds.length - 10);
});

test("chase moves slowly toward close targets, fast toward distant ones", () => {
  const near = runChase({ start: [0, 0, 0], target: [2, 0, 0] });
  const far = runChase({ start: [0, 0, 0], target: [2000, 0, 0] });
  const nearPeak = Math.max(...near.speeds);
  const farPeak = Math.max(...far.speeds);
  assert.ok(nearPeak < farPeak / 10, `near peak ${nearPeak} vs far peak ${farPeak}`);
  // Approach speed is bounded by the braking curve sqrt(2·a·d).
  assert.ok(nearPeak <= Math.sqrt(2 * 100 * 2) + 1e-9);
});

test("chase honors an optional top speed", () => {
  const result = runChase({ start: [0, 0, 0], target: [4000, 0, 0], maxSpeed: 50 });
  assert.ok(result.settled);
  assert.ok(Math.max(...result.speeds) <= 50 + 1e-9);
});

test("chase at the target reports settled immediately", () => {
  const step = chaseStep({
    position: [10, 20, 30],
    velocity: [0, 0, 0],
    target: [10, 20, 30],
    maxAcceleration: 100,
    dt: 1 / 60,
  });
  assert.ok(step.settled);
  assert.deepEqual(step.position, [10, 20, 30]);
});

// --- Eye/center round trip -------------------------------------------------------

test("cameraFromEyeAndCenter inverts cameraEyePosition", () => {
  for (const [heading, tilt, range] of [[45, 60, 1000], [200, 30, 5000], [0, 80, 400]]) {
    const center = { ...riderPosition, altitude: 250 };
    const eye = cameraEyePosition({ center, range, tilt, heading });
    const camera = cameraFromEyeAndCenter(eye, center, 0);
    assertHeadingNear(camera.heading, heading, 0.01, `heading ${heading}: got ${camera.heading}`);
    assert.ok(Math.abs(camera.tilt - tilt) < 0.01, `tilt ${tilt}: got ${camera.tilt}`);
    assert.ok(Math.abs(camera.range - range) < 1, `range ${range}: got ${camera.range}`);
  }
});

test("cameraFromEyeAndCenter keeps the fallback heading when overhead", () => {
  const center = { ...riderPosition, altitude: 0 };
  const overhead = cameraFromEyeAndCenter({ ...riderPosition, altitude: 500 }, center, 123);
  assert.equal(overhead.heading, 123);
  assert.ok(Math.abs(overhead.range - 500) < 0.001);
  assert.equal(overhead.tilt, 1); // clamped to the minimum tilt
});

test("a camera flight converges from the overview to the follow camera", () => {
  // Reproduces the app.js integration: both the eye and the look-at center
  // chase their follow-camera targets in a local north/east/up frame, and the
  // map pose is re-derived from the chased pair each frame.
  const { bearing, destinationPoint, haversine, toRad } = geo;

  const followTarget = computeFollowCamera({
    riderPosition,
    heading: 90,
    cameraZoom: 2.5,
    cameraBehindMeters: 800,
    cameraAngleDegrees: 75,
  });
  const targetCenter = { ...followTarget.center, altitude: 200 };
  const targetEye = cameraEyePosition({ ...followTarget, center: targetCenter });

  const overview = computeRouteOverviewCamera([
    { ...riderPosition, ele: 200 },
    { lat: riderPosition.lat, lng: riderPosition.lng + 0.1, ele: 400 },
  ]);
  let eye = cameraEyePosition(overview);
  let center = { ...overview.center };
  let eyeVelocity = [0, 0, 0];
  let centerVelocity = [0, 0, 0];

  const chaseGeoPoint = (current, velocity, target) => {
    const horizontal = haversine(current, target);
    const towardTarget = toRad(bearing(current, target));
    const step = chaseStep({
      position: [0, 0, 0],
      velocity,
      target: [
        horizontal * Math.cos(towardTarget),
        horizontal * Math.sin(towardTarget),
        (target.altitude || 0) - (current.altitude || 0),
      ],
      maxAcceleration: 120,
      dt: 1 / 60,
    });
    const [north, east, up] = step.position;
    const moved = Math.hypot(north, east);
    const ground = moved > 0.001
      ? destinationPoint(current, Math.atan2(east, north) * 180 / Math.PI, moved)
      : { lat: current.lat, lng: current.lng };
    return {
      point: { ...ground, altitude: (current.altitude || 0) + up },
      velocity: step.velocity,
      settled: step.settled,
    };
  };

  let settled = false;
  for (let frame = 0; frame < 60 * 120 && !settled; frame++) {
    const eyeStep = chaseGeoPoint(eye, eyeVelocity, targetEye);
    const centerStep = chaseGeoPoint(center, centerVelocity, targetCenter);
    eye = eyeStep.point;
    eyeVelocity = eyeStep.velocity;
    center = centerStep.point;
    centerVelocity = centerStep.velocity;
    settled = eyeStep.settled && centerStep.settled;

    // Every intermediate pose must stay valid for the map.
    const pose = cameraFromEyeAndCenter(eye, center, followTarget.heading);
    assert.ok(Number.isFinite(pose.heading) && Number.isFinite(pose.range) && Number.isFinite(pose.tilt));
    assert.ok(pose.range >= 1 && pose.tilt >= 1 && pose.tilt <= 89);
  }

  assert.ok(settled, "flight settles within two simulated minutes");
  assert.ok(haversine(center, targetCenter) < 0.1, "look-at lands on the rider");
  const finalPose = cameraFromEyeAndCenter(eye, center, followTarget.heading);
  assertHeadingNear(finalPose.heading, followTarget.heading, 0.5);
  assert.ok(Math.abs(finalPose.tilt - followTarget.tilt) < 0.5);
  assert.ok(Math.abs(finalPose.range - followTarget.range) < 2);
});
