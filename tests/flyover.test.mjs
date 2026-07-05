import test from "node:test";
import assert from "node:assert/strict";

import { orbitCamera } from "../app/flyover.mjs";

test("orbit spins the heading one full turn per period", () => {
  const base = { center: { lat: 50, lng: 14, altitude: 100 }, heading: 30, tilt: 60, range: 5000 };
  assert.equal(orbitCamera(base, 0, { secondsPerRevolution: 60 }).heading, 30);
  assert.ok(Math.abs(orbitCamera(base, 15, { secondsPerRevolution: 60 }).heading - 120) < 1e-6);
  assert.ok(Math.abs(orbitCamera(base, 60, { secondsPerRevolution: 60 }).heading - 30) < 1e-6);

  const spun = orbitCamera(base, 10, { secondsPerRevolution: 60 });
  assert.equal(spun.tilt, 60);
  assert.equal(spun.range, 5000);
});

test("orbit direction reverses the spin", () => {
  const base = { center: { lat: 0, lng: 0, altitude: 0 }, heading: 0, tilt: 45, range: 1000 };
  const cw = orbitCamera(base, 15, { secondsPerRevolution: 60, direction: 1 });
  const ccw = orbitCamera(base, 15, { secondsPerRevolution: 60, direction: -1 });
  assert.ok(Math.abs(cw.heading - 90) < 1e-6);
  assert.ok(Math.abs(ccw.heading - 270) < 1e-6);
});
