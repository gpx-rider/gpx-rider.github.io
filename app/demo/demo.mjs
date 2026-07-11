import { clamp, roundCoordinate } from "../core/geo.mjs";
import { gradeAt, interpolateRoutePoint } from "../route/route.mjs";
import { CYCLING_GROSS_EFFICIENCY, DEMO_RIDE } from "../core/tuning.mjs";
import { activeCaloriesFromPower } from "../core/units.mjs";

const GRAVITY = 9.80665;
const KPH_PER_MPS = 3.6;

export function createDemoRideModel(config = DEMO_RIDE) {
  return {
    elapsedSeconds: 0,
    speedKph: 0,
    powerWatts: config.flatPowerWatts,
    heartRateCoreBpm: config.restingHeartRateBpm,
    heartRateBpm: config.restingHeartRateBpm,
    lastHeartRateUpdateSeconds: -Infinity,
    heartRateNoiseBpm: 0,
    fallDelaySeconds: 0,
    lowEffortSeconds: 0,
    caloriesKcal: 0,
    historySamples: [],
  };
}

export function demoTargetPowerWatts(gradePercent, config = DEMO_RIDE) {
  const grade = Number.isFinite(gradePercent) ? gradePercent : 0;
  const watts = grade >= 0
    ? config.flatPowerWatts + grade * config.climbWattsPerGradePercent
    : config.flatPowerWatts + grade * config.descentWattsPerGradePercent;
  return clamp(watts, config.minPowerWatts, config.maxPowerWatts);
}

export function demoSpeedForPower(powerWatts, gradePercent, config = DEMO_RIDE) {
  const usefulPower = Math.max(0, powerWatts) * config.drivetrainEfficiency;
  const low = config.minSpeedKph / KPH_PER_MPS;
  const high = config.maxSpeedKph / KPH_PER_MPS;
  let lo = low;
  let hi = high;

  for (let i = 0; i < 34; i += 1) {
    const mid = (lo + hi) / 2;
    if (requiredPowerWatts(mid, gradePercent, config) > usefulPower) hi = mid;
    else lo = mid;
  }

  return clamp(((lo + hi) / 2) * KPH_PER_MPS, config.minSpeedKph, config.maxSpeedKph);
}

export function advanceDemoRide(model, {
  elapsedSeconds,
  gradePercent,
  point,
  routeProgressMeters,
  metersAdvanced,
  caloriesFromPower,
  recordHistory = true,
  nowSeconds = Date.now() / 1000,
  config = DEMO_RIDE,
}) {
  const dt = Math.max(0, elapsedSeconds);
  model.elapsedSeconds += dt;

  const targetPower = demoTargetPowerWatts(gradePercent, config);
  model.powerWatts = smoothToward(model.powerWatts, targetPower, dt, config.powerSmoothingTauSeconds);

  const targetSpeedKph = demoSpeedForPower(model.powerWatts, gradePercent, config);
  model.speedKph = smoothToward(model.speedKph || targetSpeedKph, targetSpeedKph, dt, config.speedSmoothingTauSeconds);

  if (Number.isFinite(caloriesFromPower)) {
    model.caloriesKcal += Math.max(0, caloriesFromPower);
  }

  updateDemoHeartRate(model, dt, config);
  if (recordHistory) {
    pushDemoHistorySample(model, { point, routeProgressMeters, metersAdvanced, nowSeconds });
  }

  return {
    speedKph: Math.round(model.speedKph * 10) / 10,
    powerWatts: Math.round(model.powerWatts),
    heartRateBpm: Math.round(model.heartRateBpm),
    caloriesKcal: Math.round(model.caloriesKcal),
  };
}

export function seedDemoHistory(model, {
  route,
  progressMeters,
  config = DEMO_RIDE,
  sampleSeconds = 1,
  nowSeconds = Date.now() / 1000,
}) {
  if (!Array.isArray(route) || route.length < 2 || !Number.isFinite(progressMeters) || progressMeters <= 0) {
    return;
  }

  const targetMeters = clamp(progressMeters, 0, route.at(-1).distance ?? 0);
  const startSeconds = nowSeconds - Math.max(1, Math.ceil(targetMeters / Math.max(1, config.minSpeedKph / 3.6)));
  let distanceMeters = 0;

  while (distanceMeters < targetMeters) {
    const grade = gradeAt(route, distanceMeters);
    const caloriesFromPower = activeCaloriesFromPower(
      model.powerWatts,
      sampleSeconds,
      CYCLING_GROSS_EFFICIENCY,
    );
    advanceDemoRide(model, {
      elapsedSeconds: sampleSeconds,
      gradePercent: grade,
      point: interpolateRoutePoint(route, distanceMeters),
      routeProgressMeters: distanceMeters,
      metersAdvanced: 0,
      caloriesFromPower,
      recordHistory: false,
      config,
    });

    const metersAdvanced = Math.min(
      targetMeters - distanceMeters,
      (model.speedKph / 3.6) * sampleSeconds,
    );
    distanceMeters += metersAdvanced;
    advanceDemoRide(model, {
      elapsedSeconds: 0,
      gradePercent: gradeAt(route, distanceMeters),
      point: interpolateRoutePoint(route, distanceMeters),
      routeProgressMeters: distanceMeters,
      metersAdvanced,
      caloriesFromPower: 0,
      recordHistory: true,
      nowSeconds: startSeconds + model.elapsedSeconds,
      config,
    });
  }

  model.historySamples = thinHistorySamples(model.historySamples, config.maxHistorySamples);
}

function requiredPowerWatts(speedMps, gradePercent, config) {
  const massKg = config.riderWeightKg + config.bikeWeightKg;
  const grade = clamp((Number.isFinite(gradePercent) ? gradePercent : 0) / 100, -0.3, 0.3);
  const slopeCos = 1 / Math.sqrt(1 + grade * grade);
  const gravityForce = massKg * GRAVITY * grade;
  const rollingForce = massKg * GRAVITY * config.rollingResistanceCoefficient * slopeCos;
  const aeroForce = 0.5 * config.airDensityKgPerCubicMeter * config.dragAreaSquareMeters * speedMps * speedMps;
  return Math.max(0, (gravityForce + rollingForce + aeroForce) * speedMps);
}

function updateDemoHeartRate(model, elapsedSeconds, config) {
  const effortRatio = clamp(model.powerWatts / config.ftpWatts, 0, 1.45);
  const thresholdReserve = config.thresholdHeartRateBpm - config.restingHeartRateBpm;
  const targetAtEffort = effortRatio <= 1
    ? config.restingHeartRateBpm + thresholdReserve * Math.pow(effortRatio, 0.86)
    : config.thresholdHeartRateBpm + (config.maxHeartRateBpm - config.thresholdHeartRateBpm) * clamp((effortRatio - 1) / 0.45, 0, 1);
  const lowEffortTarget = config.restingHeartRateBpm + 7;

  model.lowEffortSeconds = model.powerWatts <= config.minPowerWatts + 25
    ? model.lowEffortSeconds + elapsedSeconds
    : 0;
  const target = model.lowEffortSeconds >= config.lowEffortReturnDelaySeconds
    ? config.restingHeartRateBpm
    : targetAtEffort;

  if (target >= model.heartRateCoreBpm) {
    model.fallDelaySeconds = 0;
    model.heartRateCoreBpm = smoothToward(model.heartRateCoreBpm, target, elapsedSeconds, config.heartRateRiseTauSeconds);
  } else {
    model.fallDelaySeconds += elapsedSeconds;
    if (model.fallDelaySeconds >= config.heartRateFallDelaySeconds || target <= lowEffortTarget) {
      model.heartRateCoreBpm = smoothToward(model.heartRateCoreBpm, target, elapsedSeconds, config.heartRateFallTauSeconds);
    }
  }

  if (model.elapsedSeconds - model.lastHeartRateUpdateSeconds >= config.heartRateUpdateIntervalSeconds) {
    model.lastHeartRateUpdateSeconds = model.elapsedSeconds;
    model.heartRateNoiseBpm = (Math.random() * 2 - 1) * config.heartRateNoiseBpm;
    model.heartRateBpm = clamp(
      model.heartRateCoreBpm + model.heartRateNoiseBpm,
      config.restingHeartRateBpm,
      config.maxHeartRateBpm,
    );
  }
}

function pushDemoHistorySample(model, { point, routeProgressMeters, metersAdvanced, nowSeconds }) {
  if (!point || model.historySamples.at(-1)?.t === Math.round(nowSeconds)) return;
  model.historySamples.push({
    t: Math.round(nowSeconds),
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
    ele: Math.round((point.ele ?? 0) * 10) / 10,
    distance: Math.round(Math.max(0, (model.historySamples.at(-1)?.distance ?? 0) + Math.max(0, metersAdvanced)) * 10) / 10,
    speedKph: Math.round(model.speedKph * 10) / 10,
    powerWatts: Math.round(model.powerWatts),
    heartRateBpm: Math.round(model.heartRateBpm),
    caloriesKcal: Math.round(model.caloriesKcal),
    routeProgressMeters: Math.round(routeProgressMeters * 10) / 10,
  });
}

function thinHistorySamples(samples, maxCount) {
  if (!Number.isFinite(maxCount) || maxCount <= 0 || samples.length <= maxCount) return samples;
  const thinned = [];
  const lastIndex = samples.length - 1;
  for (let i = 0; i < maxCount; i += 1) {
    thinned.push(samples[Math.round((i / (maxCount - 1)) * lastIndex)]);
  }
  return thinned;
}

function smoothToward(current, target, elapsedSeconds, tauSeconds) {
  if (!Number.isFinite(current) || tauSeconds <= 0) return target;
  if (elapsedSeconds <= 0) return current;
  const alpha = 1 - Math.exp(-elapsedSeconds / tauSeconds);
  return current + (target - current) * alpha;
}
