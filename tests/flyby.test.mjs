import test from "node:test";
import assert from "node:assert/strict";

import { createEllipseFlyby, fitFlybyEllipse } from "../app/flyby.mjs";

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
  ellipseScale: 0.75,
  minSemiMajorMeters: 100,
  minSemiMinorMeters: 100,
  minTurnRadiusMeters: 900,
  direction: 1,
  secondsPerLap: 90,
  maxSpeedMps: 80,
  flyHeightMetersMin: 1200,
  flyHeightMetersAboveTerrainMin: 250,
  cameraFovDegrees: 50,
  inwardLookDegrees: 0,
  mountPitchDegrees: 30,
  viewDistanceMeters: 2500,
  maxBankDegrees: 45,
  sampleCount: 240,
};

test("ellipse flyby returns null for routes too small to fly", () => {
  assert.equal(createEllipseFlyby([{ lat: 46, lng: 7, ele: 0 }], BASE), null);
  assert.equal(createEllipseFlyby([{ lat: 46, lng: 7, ele: 0 }, { lat: 46, lng: 7, ele: 0 }], BASE), null);
});

test("ellipse scale can place the flight path inside the route footprint", () => {
  const ellipse = fitFlybyEllipse(route, {
    ...BASE,
    ellipseScale: 0.55,
    minTurnRadiusMeters: 0,
  });
  assert.ok(ellipse);
  assert.ok(ellipse.semiMajor < ellipse.routeHalfMajor, "semi-major can be smaller than route half-major");
  assert.ok(ellipse.semiMinor < ellipse.routeHalfMinor, "semi-minor can be smaller than route half-minor");
});

test("ellipse respects the configured minimum turning radius", () => {
  const ellipse = fitFlybyEllipse(route, BASE);
  assert.ok(ellipse);
  assert.ok(
    ellipse.actualMinTurnRadiusMeters >= BASE.minTurnRadiusMeters - 1e-6,
    `turn radius ${ellipse.actualMinTurnRadiusMeters} >= ${BASE.minTurnRadiusMeters}`,
  );
});

test("fly height honours the absolute minimum when terrain clearance is already enough", () => {
  const flyby = createEllipseFlyby(route, BASE);
  assert.equal(flyby.flyHeightMeters, BASE.flyHeightMetersMin);
  assert.ok(flyby.terrainClearanceMeters >= BASE.flyHeightMetersAboveTerrainMin);
});

test("fly height climbs to clear the highest terrain under the ellipse", () => {
  const highRoute = route.map((point, index) => ({
    ...point,
    ele: index === Math.floor(route.length / 2) ? 5000 : point.ele,
  }));
  const flyby = createEllipseFlyby(highRoute, {
    ...BASE,
    flyHeightMetersMin: 100,
    flyHeightMetersAboveTerrainMin: 700,
    ellipseScale: 1,
    minTurnRadiusMeters: 0,
  });
  assert.ok(flyby);

  const expected = flyby.ellipse.highestTerrainAltitudeMeters +
    700 -
    flyby.ellipse.centerAltitude;
  assert.equal(flyby.flyHeightMeters, expected);
  assert.equal(flyby.terrainClearanceMeters, 700);
});

test("camera FOV is configurable and clamped to Map3D's supported range", () => {
  assert.equal(createEllipseFlyby(route, { ...BASE, cameraFovDegrees: 65 }).cameraFovDegrees, 65);
  assert.equal(createEllipseFlyby(route, { ...BASE, cameraFovDegrees: 1 }).cameraFovDegrees, 5);
  assert.equal(createEllipseFlyby(route, { ...BASE, cameraFovDegrees: 100 }).cameraFovDegrees, 80);
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
    secondsPerLap: 120,
    maxSpeedMps: 1000,
  });
  assert.ok(Math.abs(flyby.lapSeconds - 120) < 1e-6);
  assert.ok(Math.abs(flyby.speedAt(0) - flyby.loopLength / 120) < 1e-6);
});

test("flyby speed is capped by the configured maximum", () => {
  const flyby = createEllipseFlyby(route, {
    ...BASE,
    secondsPerLap: 1,
    maxSpeedMps: 30,
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
  assert.ok(frame.speedMps <= BASE.maxSpeedMps);
  assert.equal(frame.flyHeightMeters, flyby.flyHeightMeters);
  assert.equal(frame.terrainClearanceMeters, flyby.terrainClearanceMeters);
  assert.equal(frame.cameraFovDegrees, BASE.cameraFovDegrees);
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
  const clockwise = createEllipseFlyby(route, { ...BASE, direction: 1, inwardLookDegrees: offset });
  const counter = createEllipseFlyby(route, { ...BASE, direction: -1, inwardLookDegrees: offset });

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
  assert.ok(tight <= BASE.maxBankDegrees + 1e-6);
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
