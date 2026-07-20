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
    powerWatts: config.flat_power_watts,
    cadenceRpm: config.flat_cadence_rpm,
    cadenceNoiseRpm: 0,
    heartRateCoreBpm: config.resting_heart_rate_bpm,
    heartRateBpm: config.resting_heart_rate_bpm,
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
    ? config.flat_power_watts + grade * config.climb_watts_per_grade_percent
    : config.flat_power_watts + grade * config.descent_watts_per_grade_percent;
  return clamp(watts, config.min_power_watts, config.max_power_watts);
}

export function demoTargetCadenceRpm(gradePercent, config = DEMO_RIDE) {
  const grade = Number.isFinite(gradePercent) ? gradePercent : 0;
  const rpm = config.flat_cadence_rpm + grade * config.cadence_rpm_per_grade_percent;
  return clamp(rpm, config.min_cadence_rpm, config.max_cadence_rpm);
}

export function demoSpeedForPower(powerWatts, gradePercent, config = DEMO_RIDE) {
  const usefulPower = Math.max(0, powerWatts) * config.drivetrain_efficiency;
  const low = config.min_speed_kph / KPH_PER_MPS;
  const high = config.max_speed_kph / KPH_PER_MPS;
  let lo = low;
  let hi = high;

  for (let i = 0; i < 34; i += 1) {
    const mid = (lo + hi) / 2;
    if (requiredPowerWatts(mid, gradePercent, config) > usefulPower) hi = mid;
    else lo = mid;
  }

  return clamp(((lo + hi) / 2) * KPH_PER_MPS, config.min_speed_kph, config.max_speed_kph);
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
  model.powerWatts = smoothToward(model.powerWatts, targetPower, dt, config.power_smoothing_tau_seconds);

  const targetSpeedKph = demoSpeedForPower(model.powerWatts, gradePercent, config);
  model.speedKph = smoothToward(model.speedKph || targetSpeedKph, targetSpeedKph, dt, config.speed_smoothing_tau_seconds);

  const targetCadenceRpm = demoTargetCadenceRpm(gradePercent, config);
  model.cadenceRpm = smoothToward(model.cadenceRpm, targetCadenceRpm, dt, config.cadence_smoothing_tau_seconds);
  model.cadenceNoiseRpm = (Math.random() * 2 - 1) * config.cadence_noise_rpm;

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
    cadenceRpm: Math.round(clamp(model.cadenceRpm + model.cadenceNoiseRpm, config.min_cadence_rpm, config.max_cadence_rpm)),
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
  const startSeconds = nowSeconds - Math.max(1, Math.ceil(targetMeters / Math.max(1, config.min_speed_kph / 3.6)));
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

  model.historySamples = thinHistorySamples(model.historySamples, config.max_history_samples);
}

function requiredPowerWatts(speedMps, gradePercent, config) {
  const massKg = config.rider_weight_kg + config.bike_weight_kg;
  const grade = clamp((Number.isFinite(gradePercent) ? gradePercent : 0) / 100, -0.3, 0.3);
  const slopeCos = 1 / Math.sqrt(1 + grade * grade);
  const gravityForce = massKg * GRAVITY * grade;
  const rollingForce = massKg * GRAVITY * config.rolling_resistance_coefficient * slopeCos;
  const aeroForce = 0.5 * config.air_density_kg_per_cubic_meter * config.drag_area_square_meters * speedMps * speedMps;
  return Math.max(0, (gravityForce + rollingForce + aeroForce) * speedMps);
}

function updateDemoHeartRate(model, elapsedSeconds, config) {
  const effortRatio = clamp(model.powerWatts / config.ftp_watts, 0, 1.45);
  const thresholdReserve = config.threshold_heart_rate_bpm - config.resting_heart_rate_bpm;
  const targetAtEffort = effortRatio <= 1
    ? config.resting_heart_rate_bpm + thresholdReserve * Math.pow(effortRatio, 0.86)
    : config.threshold_heart_rate_bpm + (config.max_heart_rate_bpm - config.threshold_heart_rate_bpm) * clamp((effortRatio - 1) / 0.45, 0, 1);
  const lowEffortTarget = config.resting_heart_rate_bpm + 7;

  model.lowEffortSeconds = model.powerWatts <= config.min_power_watts + 25
    ? model.lowEffortSeconds + elapsedSeconds
    : 0;
  const target = model.lowEffortSeconds >= config.low_effort_return_delay_seconds
    ? config.resting_heart_rate_bpm
    : targetAtEffort;

  if (target >= model.heartRateCoreBpm) {
    model.fallDelaySeconds = 0;
    model.heartRateCoreBpm = smoothToward(model.heartRateCoreBpm, target, elapsedSeconds, config.heart_rate_rise_tau_seconds);
  } else {
    model.fallDelaySeconds += elapsedSeconds;
    if (model.fallDelaySeconds >= config.heart_rate_fall_delay_seconds || target <= lowEffortTarget) {
      model.heartRateCoreBpm = smoothToward(model.heartRateCoreBpm, target, elapsedSeconds, config.heart_rate_fall_tau_seconds);
    }
  }

  if (model.elapsedSeconds - model.lastHeartRateUpdateSeconds >= config.heart_rate_update_interval_seconds) {
    model.lastHeartRateUpdateSeconds = model.elapsedSeconds;
    model.heartRateNoiseBpm = (Math.random() * 2 - 1) * config.heart_rate_noise_bpm;
    model.heartRateBpm = clamp(
      model.heartRateCoreBpm + model.heartRateNoiseBpm,
      config.resting_heart_rate_bpm,
      config.max_heart_rate_bpm,
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
    cadenceRpm: Math.round(model.cadenceRpm),
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
