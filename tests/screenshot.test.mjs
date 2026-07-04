import assert from "node:assert/strict";
import test from "node:test";
import {
  centerCropForAspect,
  parseAspectRatio,
} from "../app/screenshot.mjs";

test("aspect ratios parse from the settings strings", () => {
  assert.equal(parseAspectRatio("16:9"), 16 / 9);
  assert.equal(parseAspectRatio("4:3"), 4 / 3);
  assert.equal(parseAspectRatio("1:1"), 1);
  assert.equal(parseAspectRatio("21x9"), 21 / 9);

  // "viewport" and garbage mean "no cropping".
  assert.equal(parseAspectRatio("viewport"), null);
  assert.equal(parseAspectRatio(""), null);
  assert.equal(parseAspectRatio(null), null);
  assert.equal(parseAspectRatio("banana"), null);
  assert.equal(parseAspectRatio("16:0"), null);
});

test("center crop pulls a 16:9 window out of a taller frame", () => {
  const crop = centerCropForAspect({ width: 1600, height: 1200 }, 16 / 9);
  assert.equal(crop.width, 1600);
  assert.equal(crop.height, 900);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 150);
});

test("center crop narrows a wider-than-target frame", () => {
  const crop = centerCropForAspect({ width: 3440, height: 1440 }, 16 / 9);
  assert.equal(crop.height, 1440);
  assert.equal(crop.width, 2560);
  assert.equal(crop.x, 440);
  assert.equal(crop.y, 0);
});

test("center crop without an aspect returns the frame untouched", () => {
  assert.deepEqual(
    centerCropForAspect({ width: 1234, height: 567 }, null),
    { x: 0, y: 0, width: 1234, height: 567 },
  );
});
