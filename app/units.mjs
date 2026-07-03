// Display-unit conversions. All internal state stays metric (meters, km/h,
// kcal); these helpers only affect what the user sees.

export const KM_PER_MILE = 1.609344;
export const FEET_PER_METER = 3.28084;
export const KJ_PER_KCAL = 4.184;

export function kmToDisplay(km, distanceUnits) {
  return distanceUnits === "imperial" ? km / KM_PER_MILE : km;
}

export function distanceUnitLabel(distanceUnits) {
  return distanceUnits === "imperial" ? "mi" : "km";
}

export function formatDistance(meters, distanceUnits, decimals = 2) {
  const value = kmToDisplay(meters / 1000, distanceUnits);
  return `${value.toFixed(decimals)} ${distanceUnitLabel(distanceUnits)}`;
}

export function formatSpeed(kph, distanceUnits, decimals = 1) {
  if (!Number.isFinite(kph)) return "--";
  if (distanceUnits === "imperial") return `${(kph / KM_PER_MILE).toFixed(decimals)} mph`;
  return `${kph.toFixed(decimals)} km/h`;
}

export function formatAltitude(meters, distanceUnits) {
  if (!Number.isFinite(meters)) return "--";
  if (distanceUnits === "imperial") return `${Math.round(meters * FEET_PER_METER)} ft`;
  return `${Math.round(meters)} m`;
}

export function formatEnergy(kcal, energyUnits) {
  if (!Number.isFinite(kcal)) return "--";
  if (energyUnits === "kj") return `${Math.round(kcal * KJ_PER_KCAL)} kJ`;
  return `${Math.round(kcal)} kcal`;
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
