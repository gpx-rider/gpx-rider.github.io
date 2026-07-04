// Ride recorder — the "bucket" of collected ride data. While the rider is
// moving (pedaling or simulating) the app feeds it ticks; roughly once a
// second it appends a track sample, and every few seconds it persists the
// whole log to localStorage so a reload or crash never loses a ride.

import { roundCoordinate } from "./geo.mjs";
import { readJson, removeStored } from "./storage.mjs";
import { RIDE_PERSIST_INTERVAL_MS, RIDE_SAMPLE_INTERVAL_MS } from "./tuning.mjs";

const RIDE_LOG_STORAGE_KEY = "gpx-rider:ride-log";

// Samples are stored as compact arrays to stretch the localStorage quota:
// [unixSeconds, lat, lng, ele, distanceMeters, speedKph, powerWatts, heartRateBpm, caloriesKcal]
const log = emptyLog();

function emptyLog() {
  return {
    startedAtMs: null,
    timerSeconds: 0,
    distanceMeters: 0,
    samples: [],
    lastSampleAtMs: 0,
    lastPersistAtMs: 0,
    persistBroken: false,
  };
}

export function restoreRideLog() {
  const saved = readJson(RIDE_LOG_STORAGE_KEY);
  if (!saved?.samples?.length) return;

  log.startedAtMs = Number(saved.startedAtMs) || saved.samples[0][0] * 1000;
  log.timerSeconds = Number(saved.timerSeconds) || 0;
  log.distanceMeters = Number(saved.distanceMeters) || 0;
  log.samples = saved.samples.filter(Array.isArray);
}

export function recordRideTick({ elapsedSeconds, metersAdvanced, point, speedKph, powerWatts, heartRateBpm, caloriesKcal }) {
  const now = Date.now();
  if (log.startedAtMs === null) log.startedAtMs = now;
  log.timerSeconds += Math.max(0, elapsedSeconds);
  log.distanceMeters += Math.max(0, metersAdvanced);

  if (now - log.lastSampleAtMs < RIDE_SAMPLE_INTERVAL_MS) return;
  log.lastSampleAtMs = now;

  log.samples.push([
    Math.round(now / 1000),
    roundCoordinate(point.lat),
    roundCoordinate(point.lng),
    Math.round((point.ele ?? 0) * 10) / 10,
    Math.round(log.distanceMeters * 10) / 10,
    Number.isFinite(speedKph) ? Math.round(speedKph * 10) / 10 : null,
    Number.isFinite(powerWatts) ? Math.round(powerWatts) : null,
    Number.isFinite(heartRateBpm) ? Math.round(heartRateBpm) : null,
    Number.isFinite(caloriesKcal) ? Math.round(caloriesKcal) : null,
  ]);

  if (now - log.lastPersistAtMs >= RIDE_PERSIST_INTERVAL_MS) persistRideLog();
}

export function persistRideLog() {
  log.lastPersistAtMs = Date.now();
  if (!log.samples.length) {
    removeStored(RIDE_LOG_STORAGE_KEY);
    return;
  }

  try {
    localStorage.setItem(RIDE_LOG_STORAGE_KEY, JSON.stringify({
      startedAtMs: log.startedAtMs,
      timerSeconds: Math.round(log.timerSeconds),
      distanceMeters: Math.round(log.distanceMeters),
      samples: log.samples,
    }));
    log.persistBroken = false;
  } catch (error) {
    // Quota exceeded on a very long ride: the in-memory log keeps recording
    // and the FIT download still works, only crash recovery is lost.
    if (!log.persistBroken) {
      log.persistBroken = true;
      console.warn("Ride log no longer fits in localStorage; recording continues in memory only.", error);
    }
  }
}

export function rideLogSummary() {
  const lastSample = log.samples.at(-1);
  const caloriesKcal = findLastCalories();
  return {
    sampleCount: log.samples.length,
    distanceMeters: log.distanceMeters,
    timerSeconds: log.timerSeconds,
    startedAtMs: log.startedAtMs,
    elapsedSeconds: lastSample && log.startedAtMs
      ? Math.max(log.timerSeconds, lastSample[0] - log.startedAtMs / 1000)
      : log.timerSeconds,
    heartRateSampleCount: log.samples.reduce((count, sample) => count + (sample[7] !== null ? 1 : 0), 0),
    caloriesKcal,
    persistBroken: log.persistBroken,
  };
}

function findLastCalories() {
  for (let i = log.samples.length - 1; i >= 0; i -= 1) {
    if (log.samples[i][8] !== null) return log.samples[i][8];
  }
  return null;
}

export function rideLogSamples() {
  return log.samples.map(([t, lat, lng, ele, distance, speedKph, powerWatts, heartRateBpm, caloriesKcal]) => ({
    t, lat, lng, ele, distance, speedKph, powerWatts, heartRateBpm, caloriesKcal,
  }));
}

export function hasRideData() {
  return log.samples.length > 0;
}

export function clearRideLog() {
  Object.assign(log, emptyLog());
  removeStored(RIDE_LOG_STORAGE_KEY);
}
