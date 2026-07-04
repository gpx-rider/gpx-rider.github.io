import assert from "node:assert/strict";
import test from "node:test";
import { classifyRoute } from "../app/difficulty.mjs";

test("returns null for a routeless/zero-distance state", () => {
  assert.equal(classifyRoute(0, 0), null);
  assert.equal(classifyRoute(0, 500), null);
});

test("classifies a flat short route", () => {
  const result = classifyRoute(10_000, 20);
  assert.equal(result.distanceClass, "XS");
  assert.equal(result.terrainClass, "Flat");
  assert.equal(result.difficulty, "Very Easy");
});

test("classifies a hilly medium route", () => {
  // 42.3 km, 512 m gain -> 12.1 m/km (Rolling), 47.42 equivalent km (Easy).
  const result = classifyRoute(42_300, 512);
  assert.equal(result.distanceClass, "M");
  assert.equal(result.terrainClass, "Rolling");
  assert.equal(result.difficulty, "Easy");
  assert.ok(Math.abs(result.elevationPerKm - 12.104) < 0.01);
  assert.ok(Math.abs(result.equivalentKm - 47.42) < 0.01);
});

test("classifies a mountainous epic route", () => {
  const result = classifyRoute(180_000, 8000);
  assert.equal(result.distanceClass, "XXL");
  assert.equal(result.terrainClass, "Mountainous");
  assert.equal(result.difficulty, "Epic");
});

test("class boundaries are inclusive on the lower edge", () => {
  assert.equal(classifyRoute(20_000, 0).distanceClass, "S");
  assert.equal(classifyRoute(19_999, 0).distanceClass, "XS");
  assert.equal(classifyRoute(1000, 5).terrainClass, "Gentle");
  assert.equal(classifyRoute(1000, 4.9).terrainClass, "Flat");
  assert.equal(classifyRoute(25_000, 0).difficulty, "Easy");
  assert.equal(classifyRoute(24_900, 0).difficulty, "Very Easy");
});
