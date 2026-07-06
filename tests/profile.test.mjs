import assert from "node:assert/strict";
import test from "node:test";

import {
  GRADE_PROFILE_COLORS,
  gradeColor,
  gradeColorZones,
} from "../app/profile.mjs";
import {
  GRADE_METER_MAX_PERCENT,
  GRADE_METER_MIN_PERCENT,
} from "../app/tuning.mjs";

test("grade meter zones use the same thresholds as profile grade colors", () => {
  const zones = gradeColorZones(-30, 30);
  assert.deepEqual(
    zones.map(({ min, max }) => [min, max]),
    [
      [-30, -3],
      [-3, -0.6],
      [-0.6, 0.8],
      [0.8, 3.5],
      [3.5, 7],
      [7, 30],
    ],
  );
  assert.equal(gradeColor(4.1), GRADE_PROFILE_COLORS[4]);
});

test("grade meter caps keep the outer color bands compact", () => {
  const zones = gradeColorZones(GRADE_METER_MIN_PERCENT, GRADE_METER_MAX_PERCENT);
  assert.deepEqual(zones[0], {
    min: -6,
    max: -3,
    color: GRADE_PROFILE_COLORS[0],
  });
  assert.deepEqual(zones.at(-1), {
    min: 7,
    max: 10,
    color: GRADE_PROFILE_COLORS.at(-1),
  });
});
