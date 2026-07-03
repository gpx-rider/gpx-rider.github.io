import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCameraOffset,
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

test("camera helper bounds are stable", () => {
  assert.equal(normalizeHeading(-1), 359);
  assert.equal(rangeForBehind(0, 67), 35);
  assert.ok(rangeForBehind(1000, 45) > 1000);
});
