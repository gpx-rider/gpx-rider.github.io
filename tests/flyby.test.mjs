import test from "node:test";
import assert from "node:assert/strict";

import {
  createEllipseFlyby,
  fitFlybyEllipse,
  createFigureEightFlyover,
  fitFlyoverFigureEight,
} from "../app/camera/flyby.mjs";

const route = [];
for (let i = 0; i <= 80; i++) {
  const t = i / 80;
  route.push({
    lat: 46 + 0.018 * Math.sin(t * Math.PI * 2),
    lng: 7 + 0.065 * t,
    ele: 500 + 120 * Math.sin(t * Math.PI),
  });
}

const BASE = {
  ellipse_scale: 0.75,
  min_semi_major_meters: 100,
  min_semi_minor_meters: 100,
  min_turn_radius_meters: 900,
  direction: 1,
  seconds_per_lap: 90,
  max_speed_mps: 80,
  fly_height_meters_min: 1200,
  fly_height_meters_above_terrain_min: 250,
  camera_fov_degrees: 50,
  inward_look_degrees: 0,
  mount_pitch_degrees: 30,
  view_distance_meters: 2500,
  max_bank_degrees: 45,
  sample_count: 240,
};

test("ellipse flyby returns null for routes too small to fly", () => {
  assert.equal(createEllipseFlyby([{ lat: 46, lng: 7, ele: 0 }], BASE), null);
  assert.equal(createEllipseFlyby([{ lat: 46, lng: 7, ele: 0 }, { lat: 46, lng: 7, ele: 0 }], BASE), null);
});

test("ellipse scale can place the flight path inside the route footprint", () => {
  const ellipse = fitFlybyEllipse(route, {
    ...BASE,
    ellipse_scale: 0.55,
    min_turn_radius_meters: 0,
  });
  assert.ok(ellipse);
  assert.ok(ellipse.semiMajor < ellipse.routeHalfMajor, "semi-major can be smaller than route half-major");
  assert.ok(ellipse.semiMinor < ellipse.routeHalfMinor, "semi-minor can be smaller than route half-minor");
});

test("ellipse respects the configured minimum turning radius", () => {
  const ellipse = fitFlybyEllipse(route, BASE);
  assert.ok(ellipse);
  assert.ok(
    ellipse.actualMinTurnRadiusMeters >= BASE.min_turn_radius_meters - 1e-6,
    `turn radius ${ellipse.actualMinTurnRadiusMeters} >= ${BASE.min_turn_radius_meters}`,
  );
});

test("fly height honours the absolute minimum when terrain clearance is already enough", () => {
  const flyby = createEllipseFlyby(route, BASE);
  assert.equal(flyby.flyHeightMeters, BASE.fly_height_meters_min);
  assert.ok(flyby.terrainClearanceMeters >= BASE.fly_height_meters_above_terrain_min);
});

test("fly height climbs to clear the highest terrain under the ellipse", () => {
  const highRoute = route.map((point, index) => ({
    ...point,
    ele: index === Math.floor(route.length / 2) ? 5000 : point.ele,
  }));
  const flyby = createEllipseFlyby(highRoute, {
    ...BASE,
    fly_height_meters_min: 100,
    fly_height_meters_above_terrain_min: 700,
    ellipse_scale: 1,
    min_turn_radius_meters: 0,
  });
  assert.ok(flyby);

  const expected = flyby.curve.highestTerrainAltitudeMeters +
    700 -
    flyby.curve.centerAltitude;
  assert.equal(flyby.flyHeightMeters, expected);
  assert.equal(flyby.terrainClearanceMeters, 700);
});

test("camera FOV is configurable and clamped to Map3D's supported range", () => {
  assert.equal(createEllipseFlyby(route, { ...BASE, camera_fov_degrees: 65 }).cameraFovDegrees, 65);
  assert.equal(createEllipseFlyby(route, { ...BASE, camera_fov_degrees: 1 }).cameraFovDegrees, 5);
  assert.equal(createEllipseFlyby(route, { ...BASE, camera_fov_degrees: 100 }).cameraFovDegrees, 80);
});

test("ellipse path sampling emits a closed path for debug drawing", () => {
  const flyby = createEllipseFlyby(route, BASE);
  const path = flyby.pathAtAltitude(8, 32);
  assert.equal(path.length, 33);
  assert.equal(path[0].altitude, 8);
  assert.equal(path.at(-1).altitude, 8);
  assert.ok(Math.abs(path[0].lat - path.at(-1).lat) < 1e-12);
  assert.ok(Math.abs(path[0].lng - path.at(-1).lng) < 1e-12);
});

test("flyby speed targets the configured lap time", () => {
  const flyby = createEllipseFlyby(route, {
    ...BASE,
    seconds_per_lap: 120,
    max_speed_mps: 1000,
  });
  assert.ok(Math.abs(flyby.lapSeconds - 120) < 1e-6);
  assert.ok(Math.abs(flyby.speedAt(0) - flyby.loopLength / 120) < 1e-6);
});

test("flyby speed is capped by the configured maximum", () => {
  const flyby = createEllipseFlyby(route, {
    ...BASE,
    seconds_per_lap: 1,
    max_speed_mps: 30,
  });
  assert.equal(flyby.speedAt(0), 30);
  assert.ok(flyby.lapSeconds > 1);
});

test("ellipse flyby emits finite frames and advances around the loop", () => {
  const flyby = createEllipseFlyby(route, BASE);
  assert.ok(flyby);
  assert.ok(flyby.loopLength > 1000);
  assert.ok(flyby.lapSeconds > 0);

  let s = 0;
  s = flyby.advance(s, 1);
  assert.ok(s > 0);

  const frame = flyby.frameAt(s);
  for (const key of ["lat", "lng", "altitude"]) {
    assert.ok(Number.isFinite(frame.eye[key]), `eye.${key} finite`);
    assert.ok(Number.isFinite(frame.lookAt[key]), `lookAt.${key} finite`);
  }
  assert.equal(frame.speedMps, flyby.speedAt(s));
  assert.ok(frame.speedMps <= BASE.max_speed_mps);
  assert.equal(frame.flyHeightMeters, flyby.flyHeightMeters);
  assert.equal(frame.terrainClearanceMeters, flyby.terrainClearanceMeters);
  assert.equal(frame.cameraFovDegrees, BASE.camera_fov_degrees);
  assert.ok(frame.eye.altitude > frame.lookAt.altitude, "camera is pitched down");
});

test("ellipse flyby looks in the direction of travel", () => {
  const flyby = createEllipseFlyby(route, { ...BASE, direction: 1 });
  const s = flyby.loopLength * 0.2;
  const frame = flyby.frameAt(s);
  const eyeLocal = toLocalEN(frame.eye);
  const lookLocal = toLocalEN(frame.lookAt);
  const viewBearing = Math.atan2(lookLocal.e - eyeLocal.e, lookLocal.n - eyeLocal.n);

  const p0 = flyby.positionAt(s);
  const p1 = flyby.positionAt(s + 10);
  const tangentBearing = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
  const delta = Math.abs(((viewBearing - tangentBearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(delta < 0.05, `camera faces travel direction (off by ${delta} rad)`);
});

test("inward look offset rotates clockwise right and counter-clockwise left", () => {
  const offset = 12;
  const sRatio = 0.2;
  const clockwise = createEllipseFlyby(route, { ...BASE, direction: 1, inward_look_degrees: offset });
  const counter = createEllipseFlyby(route, { ...BASE, direction: -1, inward_look_degrees: offset });

  for (const [flyby, expected] of [[clockwise, offset], [counter, -offset]]) {
    const s = flyby.loopLength * sRatio;
    const frame = flyby.frameAt(s);
    const viewBearing = bearingLocal(frame.eye, frame.lookAt);
    const p0 = flyby.positionAt(s);
    const p1 = flyby.positionAt(s + 10);
    const tangentBearing = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const deltaDegrees = signedDeltaDegrees(viewBearing, tangentBearing);

    assert.ok(Math.abs(deltaDegrees - expected) < 0.5, `expected ${expected}°, got ${deltaDegrees}°`);
    assert.equal(frame.inwardLookDegrees, offset);
  }
});

test("direction reverses travel around the ellipse", () => {
  const clockwise = createEllipseFlyby(route, { ...BASE, direction: 1 });
  const counter = createEllipseFlyby(route, { ...BASE, direction: -1 });
  const cw = clockwise.frameAt(0);
  const ccw = counter.frameAt(0);
  const cwBearing = bearingLocal(cw.eye, cw.lookAt);
  const ccwBearing = bearingLocal(ccw.eye, ccw.lookAt);
  const delta = Math.abs(((cwBearing - ccwBearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(Math.abs(delta - Math.PI) < 0.05, `directions differ by 180 deg (${delta} rad)`);
});

test("bank is strongest at the tightest turn", () => {
  const flyby = createEllipseFlyby(route, BASE);
  const tight = Math.abs(flyby.bankAt(0));
  const broad = Math.abs(flyby.bankAt(flyby.loopLength / 4));
  assert.ok(tight > broad, `tight bank ${tight} > broad bank ${broad}`);
  assert.ok(tight <= BASE.max_bank_degrees + 1e-6);
});

test("figure-eight fly-over returns null for routes too small to fly", () => {
  assert.equal(createFigureEightFlyover([{ lat: 46, lng: 7, ele: 0 }], BASE), null);
});

test("figure-eight shares the ellipse footprint frame", () => {
  const ellipse = fitFlybyEllipse(route, BASE);
  const eight = fitFlyoverFigureEight(route, BASE);
  assert.ok(eight);
  assert.equal(eight.semiMajor, ellipse.semiMajor);
  assert.equal(eight.semiMinor, ellipse.semiMinor);
  assert.deepEqual(eight.center, ellipse.center);
  assert.deepEqual(eight.major, ellipse.major);
});

test("figure-eight crosses its own center twice per lap", () => {
  const eight = fitFlyoverFigureEight(route, BASE);
  // u = π/2 and u = 3π/2 both land on the footprint center (the crossing).
  const mid = eight.pointAt(Math.PI / 2);
  const other = eight.pointAt(3 * Math.PI / 2);
  assert.ok(Math.hypot(mid[0] - eight.center[0], mid[1] - eight.center[1]) < 1e-6);
  assert.ok(Math.hypot(other[0] - eight.center[0], other[1] - eight.center[1]) < 1e-6);
});

test("figure-eight fly-over emits finite frames and advances around the loop", () => {
  const flyover = createFigureEightFlyover(route, BASE);
  assert.ok(flyover);
  assert.ok(flyover.loopLength > 1000);
  assert.ok(flyover.lapSeconds > 0);

  let s = 0;
  s = flyover.advance(s, 1);
  assert.ok(s > 0);

  const frame = flyover.frameAt(s);
  for (const key of ["lat", "lng", "altitude"]) {
    assert.ok(Number.isFinite(frame.eye[key]), `eye.${key} finite`);
    assert.ok(Number.isFinite(frame.lookAt[key]), `lookAt.${key} finite`);
  }
  assert.ok(frame.eye.altitude > frame.lookAt.altitude, "camera is pitched down");
});

test("figure-eight fly-over looks in the direction of travel", () => {
  const flyover = createFigureEightFlyover(route, { ...BASE, inward_look_degrees: 0 });
  const s = flyover.loopLength * 0.15;
  const frame = flyover.frameAt(s);
  const viewBearing = bearingLocal(frame.eye, frame.lookAt);
  const p0 = flyover.positionAt(s);
  const p1 = flyover.positionAt(s + 5);
  const tangentBearing = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
  const delta = Math.abs(((viewBearing - tangentBearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(delta < 0.1, `camera faces travel direction (off by ${delta} rad)`);
});

test("figure-eight inward look follows the changing turn direction", () => {
  const offset = 20;
  const flyover = createFigureEightFlyover(route, { ...BASE, inward_look_degrees: offset });
  const samples = 240;
  let maxRight = -Infinity;
  let maxLeft = Infinity;
  let minAbs = Infinity;
  for (let i = 0; i < samples; i++) {
    const s = flyover.loopLength * (i / samples);
    const frame = flyover.frameAt(s);
    const viewBearing = bearingLocal(frame.eye, frame.lookAt);
    const p0 = flyover.positionAt(s);
    const p1 = flyover.positionAt(s + 5);
    const tangentBearing = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const delta = signedDeltaDegrees(viewBearing, tangentBearing);
    maxRight = Math.max(maxRight, delta);
    maxLeft = Math.min(maxLeft, delta);
    minAbs = Math.min(minAbs, Math.abs(delta));
    assert.ok(Math.abs(delta) <= offset + 0.5, `inward look stays within the configured offset (${delta}°)`);
  }
  // Looks right on one lobe, left on the other, and straight ahead in between.
  assert.ok(maxRight > 3, `looks into a right turn somewhere (${maxRight}°)`);
  assert.ok(maxLeft < -3, `looks into a left turn somewhere (${maxLeft}°)`);
  assert.ok(minAbs < 1, `passes through looking straight ahead (${minAbs}°)`);
});

test("figure-eight bank reverses between the two lobes", () => {
  const flyover = createFigureEightFlyover(route, BASE);
  const samples = 240;
  let maxBank = -Infinity;
  let minBank = Infinity;
  for (let i = 0; i < samples; i++) {
    const bank = flyover.bankAt(flyover.loopLength * (i / samples));
    maxBank = Math.max(maxBank, bank);
    minBank = Math.min(minBank, bank);
    assert.ok(Math.abs(bank) <= BASE.max_bank_degrees + 1e-6);
  }
  assert.ok(maxBank > 1, `banks one way (${maxBank}°)`);
  assert.ok(minBank < -1, `banks the other way (${minBank}°)`);
});

function bearingLocal(a, b) {
  const al = toLocalEN(a);
  const bl = toLocalEN(b);
  return Math.atan2(bl.e - al.e, bl.n - al.n);
}

function signedDeltaDegrees(a, b) {
  return (((a - b) * 180 / Math.PI + 540) % 360) - 180;
}

function toLocalEN(point) {
  const R = 6371000;
  const mPerDeg = R * Math.PI / 180;
  const cosLat = Math.cos(route[0].lat * Math.PI / 180);
  return {
    e: (point.lng - route[0].lng) * mPerDeg * cosLat,
    n: (point.lat - route[0].lat) * mPerDeg,
  };
}
