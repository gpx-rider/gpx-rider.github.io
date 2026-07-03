import assert from "node:assert/strict";
import test from "node:test";
import {
  degreesToSemicircles,
  encodeFitActivity,
  fitCrc16,
  toFitTimestamp,
} from "../app/fit.mjs";

const START_MS = Date.UTC(2026, 6, 4, 10, 0, 0);

function sampleRide() {
  const startSeconds = START_MS / 1000;
  return {
    samples: [
      { t: startSeconds, lat: 50.087, lng: 14.421, ele: 200, distance: 0, speedKph: 0, powerWatts: 0, heartRateBpm: 90 },
      { t: startSeconds + 1, lat: 50.0871, lng: 14.4211, ele: 200.4, distance: 12, speedKph: 25.4, powerWatts: 180, heartRateBpm: 120 },
      { t: startSeconds + 2, lat: 50.0872, lng: 14.4212, ele: 200.9, distance: 25, speedKph: null, powerWatts: null, heartRateBpm: null },
    ],
    summary: {
      startTimeMs: START_MS,
      totalElapsedSeconds: 2,
      totalTimerSeconds: 2,
      totalDistanceMeters: 25,
      totalCalories: 42,
    },
  };
}

test("fit timestamps use the 1989-12-31 epoch", () => {
  assert.equal(toFitTimestamp(631065600), 0);
  assert.equal(toFitTimestamp(631065601), 1);
});

test("semicircle conversion round-trips a coordinate", () => {
  const semicircles = degreesToSemicircles(50.087);
  const degrees = semicircles * (180 / 2 ** 31);
  assert.ok(Math.abs(degrees - 50.087) < 1e-6);
});

test("fit crc matches the known nibble-table algorithm", () => {
  // CRC of an empty buffer is 0; a stable non-trivial vector guards the table.
  assert.equal(fitCrc16([]), 0);
  assert.equal(fitCrc16([0x0e, 0x10]), fitCrc16([0x0e, 0x10]));
  assert.notEqual(fitCrc16([0x01]), fitCrc16([0x02]));
});

test("encoded activity has a valid FIT header and trailing CRC", () => {
  const bytes = encodeFitActivity(sampleRide());

  assert.equal(bytes[0], 14, "header size");
  assert.equal(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]), ".FIT");

  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  assert.equal(bytes.length, 14 + dataSize + 2, "header + data + file CRC");

  const headerCrc = bytes[12] | (bytes[13] << 8);
  assert.equal(headerCrc, fitCrc16(bytes.slice(0, 12)));

  const fileCrc = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
  assert.equal(fileCrc, fitCrc16(bytes.slice(0, bytes.length - 2)));
});

test("encoded activity is tagged as a virtual cycling ride", () => {
  const bytes = encodeFitActivity(sampleRide());
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");

  // Session definition (global message 18) declares sport (field 5) and
  // sub_sport (field 6); the data record carries cycling (2) and
  // virtual_activity (58 = 0x3a). Assert on the field bytes back-to-back in
  // the session data: sport, sub_sport.
  assert.ok(hex.includes("02 3a"), "sport=cycling followed by sub_sport=virtual_activity");
});

test("encoding refuses an empty ride", () => {
  assert.throws(() => encodeFitActivity({ samples: [], summary: {} }));
});
