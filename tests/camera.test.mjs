import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCameraLift,
  applyCameraOffset,
  cameraEyePosition,
  cameraFromEyeAndCenter,
  chaseStep,
  chaseTuning,
  computeFollowCamera,
  computeRouteOverviewCamera,
  measureCameraOffset,
  normalizeHeading,
  pickVisibilityNudge,
  rangeForBehind,
} from "../app/camera/camera.mjs";
import * as geo from "../app/core/geo.mjs";

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

test("overview headingOffset flips the view to the other side", () => {
  const bulge = [
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50.05, lng: 14.05, ele: 0 },
    { lat: 50, lng: 14.1, ele: 0 },
  ];
  const auto = computeRouteOverviewCamera(bulge);
  const flipped = computeRouteOverviewCamera(bulge, { headingOffsetDegrees: 180 });
  // 180° offset is exactly the opposite viewing side.
  assertHeadingNear(flipped.heading, auto.heading + 180, 1);
  // A 90° swing lands 90° off the auto heading, and the fit still returns a
  // usable range (every point is reframed, not dropped).
  const swung = computeRouteOverviewCamera(bulge, { headingOffsetDegrees: 90 });
  assertHeadingNear(swung.heading, auto.heading + 90, 1);
  assert.ok(swung.range > 0);
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

test("overview rangeFactor zooms the fitted range in and out", () => {
  const route = [
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50, lng: 14.2, ele: 0 }, // ~14 km, well clear of the min-range floor
  ];
  const fit = computeRouteOverviewCamera(route);
  const closer = computeRouteOverviewCamera(route, { rangeFactor: 0.5 });
  const farther = computeRouteOverviewCamera(route, { rangeFactor: 2 });
  assert.ok(Math.abs(closer.range - fit.range * 0.5) < 1, "0.5 halves the range");
  assert.ok(Math.abs(farther.range - fit.range * 2) < 1, "2 doubles the range");
  // Tilt/heading/center are unaffected — only the distance changes.
  assert.equal(closer.tilt, fit.tilt);
  assertHeadingNear(closer.heading, fit.heading, 0.001);
});

test("overview maxRangeMeters caps how far the camera pulls out", () => {
  const route = [
    { lat: 50, lng: 14, ele: 0 },
    { lat: 50, lng: 14.3, ele: 0 },
  ];
  const capped = computeRouteOverviewCamera(route, { maxRangeMeters: 3000 });
  assert.equal(capped.range, 3000);
  // A min above the max still wins, so the range never inverts.
  const floored = computeRouteOverviewCamera(route, { minRangeMeters: 5000, maxRangeMeters: 3000 });
  assert.equal(floored.range, 5000);
});

test("overview handles loops and degenerate routes", () => {
  // Loop: start and end coincide; the axis comes from the route's spread.
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

test("overview frames a loop along its long axis, not the start→end line", () => {
  // An east-west elongated loop (four times wider than it is tall) whose
  // start/end sit at the NORTH tip. The old start→farthest-point axis would
  // run north→south — the loop's short axis — and frame it side-on, letting
  // the wide east-west extent overflow the viewport. PCA picks the true long
  // (east-west) axis, so the camera looks across it (heading ≈ north/south)
  // and the whole loop reads left-to-right.
  const cx = 14;
  const cy = 50;
  const semiEast = 0.08; // ~5.7 km wide
  const semiNorth = 0.02; // ~2.2 km tall
  const loop = [];
  for (let i = 0; i <= 24; i++) {
    // Start the traversal at the north tip so start === end sits far from the
    // east-west long axis, which is exactly what tripped up the old axis.
    const angle = Math.PI / 2 + (i / 24) * 2 * Math.PI;
    loop.push({ lat: cy + semiNorth * Math.sin(angle), lng: cx + semiEast * Math.cos(angle), ele: 0 });
  }

  const camera = computeRouteOverviewCamera(loop);
  // Long axis is east-west, so the view must look across it: north or south.
  const acrossLongAxis = Math.min(
    Math.abs(((camera.heading - 0 + 540) % 360) - 180),
    Math.abs(((camera.heading - 180 + 540) % 360) - 180),
  );
  assert.ok(acrossLongAxis < 5, `loop heading ${camera.heading} should look across the long axis`);
  assert.ok(Math.abs(camera.center.lat - cy) < 0.001);
  assert.ok(Math.abs(camera.center.lng - cx) < 0.001);
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
  // Reproduces the follow-camera.mjs integration: both the eye and the look-at center
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
    const up = (target.altitude || 0) - (current.altitude || 0);
    const tuning = chaseTuning(Math.hypot(horizontal, up));
    const step = chaseStep({
      position: [0, 0, 0],
      velocity,
      target: [
        horizontal * Math.cos(towardTarget),
        horizontal * Math.sin(towardTarget),
        up,
      ],
      maxAcceleration: tuning.acceleration,
      maxSpeed: tuning.maxSpeed,
      dt: 1 / 60,
    });
    const [north, east, lifted] = step.position;
    const moved = Math.hypot(north, east);
    const ground = moved > 0.001
      ? destinationPoint(current, Math.atan2(east, north) * 180 / Math.PI, moved)
      : { lat: current.lat, lng: current.lng };
    return {
      point: { ...ground, altitude: (current.altitude || 0) + lifted },
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

test("chase tuning is gentle up close and punchy over distance", () => {
  const near = chaseTuning(1);
  const mid = chaseTuning(1000);
  const far = chaseTuning(1000000);

  // Near the target the floor applies: steady follow tracking stays gentle.
  assert.ok(Math.abs(near.acceleration - chaseTuning(0).acceleration) < 2);
  assert.ok(mid.acceleration > near.acceleration);
  // The ceiling caps runaway acceleration on continent-scale distances.
  assert.equal(far.acceleration, chaseTuning(2000000).acceleration);
  // The speed cap follows the margin-reduced braking curve.
  assert.ok(Math.abs(mid.maxSpeed - Math.sqrt(0.7 * mid.acceleration * 1000)) < 1e-9);
  assert.equal(chaseTuning(0).maxSpeed, 0);
});

test("distance-scaled chase flights arrive without overshooting", () => {
  // The acceleration allowance shrinks as the target nears; the braking
  // margin in chaseTuning must keep the approach speed low enough that the
  // flight still lands on the target instead of sailing past it.
  for (const targetDistance of [300, 3000, 100000]) {
    let position = [0, 0, 0];
    let velocity = [0, 0, 0];
    let overshoot = 0;
    let settled = false;
    for (let i = 0; i < 60 * 300 && !settled; i++) {
      const remaining = Math.hypot(targetDistance - position[0], position[1], position[2]);
      const tuning = chaseTuning(remaining);
      const step = chaseStep({
        position,
        velocity,
        target: [targetDistance, 0, 0],
        maxAcceleration: tuning.acceleration,
        maxSpeed: tuning.maxSpeed,
        dt: 1 / 60,
      });
      position = step.position;
      velocity = step.velocity;
      overshoot = Math.max(overshoot, position[0] - targetDistance);
      settled = step.settled;
    }
    assert.ok(settled, `flight over ${targetDistance} m settles`);
    assert.ok(overshoot < 1, `flight over ${targetDistance} m overshoots ${overshoot} m`);
  }
});

test("overview keeps every route point safely inside the viewport", () => {
  // Cross-check the frustum fit through cameraEyePosition (a spherical eye
  // reconstruction, independent of the fit's flat-earth search): every route
  // point — start and end included — must project inside the default 35°
  // field of view with visible slack left by the margin.
  const route = [
    { lat: 50, lng: 14, ele: 200 },
    { lat: 50.06, lng: 14.02, ele: 900 }, // tall detour on the near side
    { lat: 49.98, lng: 14.08, ele: 100 },
    { lat: 50, lng: 14.15, ele: 300 },
  ];
  const aspect = 16 / 9;
  const camera = computeRouteOverviewCamera(route, { viewportAspect: aspect });
  const eye = cameraEyePosition(camera);

  const enuFrom = (origin, originAltitude, point, pointAltitude) => {
    const distance = geo.haversine(origin, point);
    const b = geo.toRad(geo.bearing(origin, point));
    return [distance * Math.sin(b), distance * Math.cos(b), pointAltitude - originAltitude];
  };
  const normalize = (v) => {
    const length = Math.hypot(...v);
    return v.map((c) => c / length);
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const forward = normalize(enuFrom(eye, eye.altitude, camera.center, camera.center.altitude));
  const flat = Math.hypot(forward[0], forward[1]);
  const right = [forward[1] / flat, -forward[0] / flat, 0];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];

  // 35° on the larger (horizontal) axis, scaled down for the vertical.
  const tanHalfX = Math.tan(geo.toRad(35 / 2));
  const tanHalfY = tanHalfX / aspect;

  for (const point of route) {
    const v = enuFrom(eye, eye.altitude, point, point.ele);
    const depth = dot(v, forward);
    assert.ok(depth > 0, "point is in front of the camera");
    const x = Math.abs(dot(v, right)) / depth;
    const y = Math.abs(dot(v, up)) / depth;
    assert.ok(x < tanHalfX * 0.9, `horizontal projection ${x} leaves slack (limit ${tanHalfX})`);
    assert.ok(y < tanHalfY * 0.9, `vertical projection ${y} leaves slack (limit ${tanHalfY})`);
  }
});

test("pickVisibilityNudge keeps the straight view when it is already clear", () => {
  const candidates = [
    { degrees: 0, penetration: -5 },
    { degrees: 8, penetration: -9 },
    { degrees: -8, penetration: 3 },
  ];
  assert.equal(pickVisibilityNudge(candidates), 0);
});

test("pickVisibilityNudge picks the least swing that clears the rider", () => {
  const candidates = [
    { degrees: 0, penetration: 12 }, // blocked straight behind
    { degrees: 8, penetration: 4 }, // still blocked
    { degrees: -8, penetration: 6 }, // still blocked
    { degrees: 16, penetration: -2 }, // clears, magnitude 16
    { degrees: -16, penetration: -1 }, // clears, magnitude 16
    { degrees: 24, penetration: -8 }, // clears, but a bigger swing
  ];
  // Both ±16 clear; the clearer one (16, penetration -2) wins the tie.
  assert.equal(pickVisibilityNudge(candidates), 16);
});

test("pickVisibilityNudge falls back to the least-occluding swing when none clear", () => {
  const candidates = [
    { degrees: 0, penetration: 20 },
    { degrees: 8, penetration: 15 },
    { degrees: -8, penetration: 9 }, // least penetration
    { degrees: 16, penetration: 11 },
  ];
  assert.equal(pickVisibilityNudge(candidates), -8);
});

test("pickVisibilityNudge is a no-op on empty input", () => {
  assert.equal(pickVisibilityNudge([]), 0);
  assert.equal(pickVisibilityNudge(null), 0);
});
