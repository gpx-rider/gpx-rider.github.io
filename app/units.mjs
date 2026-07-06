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

export function activeCaloriesFromPower(powerWatts, seconds, grossEfficiency) {
  if (!Number.isFinite(powerWatts) || !Number.isFinite(seconds) || !Number.isFinite(grossEfficiency)) return 0;
  if (powerWatts <= 0 || seconds <= 0 || grossEfficiency <= 0) return 0;
  const mechanicalKilojoules = powerWatts * seconds / 1000;
  return mechanicalKilojoules / (KJ_PER_KCAL * grossEfficiency);
}

export function formatDuration(totalSeconds, style = "clock") {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (style === "compact") {
    if (h > 0) return `${h}h${m > 0 ? `${m}m` : ""}`;
    return `${m}:${pad(s)}`;
  }
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatLocalTime(date, timeFormat = "24") {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  if (timeFormat === "12") {
    const period = hours < 12 ? "AM" : "PM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes}:${seconds} ${period}`;
  }

  return `${String(hours).padStart(2, "0")}:${minutes}:${seconds}`;
}
