import assert from "node:assert/strict";
import test from "node:test";

import { decodeTerrarium, tileForLngLat } from "../app/map/terrain-tiles-math.mjs";

test("decodeTerrarium applies the base-256 offset formula", () => {
  // Sea level is (128, 0, 0): 128*256 + 0 + 0/256 - 32768 = 0.
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  // One meter above the offset floor.
  assert.equal(decodeTerrarium(0, 1, 0), -32767);
  // Blue channel carries the fractional meter.
  assert.equal(decodeTerrarium(128, 0, 128), 0.5);
  // A mountain: 128*256 + 200 + 0 - 32768 = 200.
  assert.equal(decodeTerrarium(128, 200, 0), 200);
});

test("tileForLngLat maps 0,0 to the center of the world at low zoom", () => {
  // At zoom 1 the world is a 2×2 grid; the equator/prime-meridian corner is
  // the boundary between all four tiles, so it rounds into tile (1,1) pixel 0.
  const tile = tileForLngLat(0, 0, 1, 256);
  assert.deepEqual(tile, { z: 1, x: 1, y: 1, px: 0, py: 0 });
});

test("tileForLngLat returns a valid tile and in-range pixels for a real point", () => {
  // Jested, Czechia — a route in the shipped gallery.
  const tile = tileForLngLat(50.7333, 15.0075, 12, 256);
  assert.equal(tile.z, 12);
  const scale = 2 ** 12;
  assert.ok(tile.x >= 0 && tile.x < scale, "x in range");
  assert.ok(tile.y >= 0 && tile.y < scale, "y in range");
  assert.ok(tile.px >= 0 && tile.px < 256, "px in range");
  assert.ok(tile.py >= 0 && tile.py < 256, "py in range");
  assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.px));
});

test("tileForLngLat: higher latitude tiles sit nearer the top (smaller y)", () => {
  const north = tileForLngLat(60, 10, 10, 256);
  const south = tileForLngLat(20, 10, 10, 256);
  assert.ok(north.y < south.y, "more northern point has a smaller tile y");
});

test("tileForLngLat clamps extreme latitudes to a valid tile", () => {
  const scale = 2 ** 8;
  const northPole = tileForLngLat(89.9, 0, 8, 256);
  const southPole = tileForLngLat(-89.9, 0, 8, 256);
  assert.ok(northPole.y >= 0 && northPole.y < scale);
  assert.ok(southPole.y >= 0 && southPole.y < scale);
});

test("tileForLngLat wraps longitude past the antimeridian", () => {
  const scale = 2 ** 5;
  const tile = tileForLngLat(0, 181, 5, 256);
  assert.ok(tile.x >= 0 && tile.x < scale, "wrapped x stays in range");
});
