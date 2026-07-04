import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCameraLift,
  applyCameraOffset,
  cameraDistanceToPoint,
  cameraEyePosition,
  computeFollowCamera,
  measureCameraOffset,
  normalizeHeading,
  rangeForBehind,
} from "../app/camera.mjs";

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
