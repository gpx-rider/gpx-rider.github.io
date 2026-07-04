import {
  DIFFICULTY_THRESHOLDS_EQUIVALENT_KM,
  DISTANCE_CLASS_THRESHOLDS_KM,
  EQUIVALENT_KM_CLIMB_METERS,
  TERRAIN_CLASS_THRESHOLDS_M_PER_KM,
} from "./tuning.mjs";

// Highest-`min` threshold the value reaches or exceeds. Thresholds must be
// sorted ascending by `min`; the first entry's min is normally 0 so every
// non-negative value matches something.
function classify(value, thresholds) {
  let label = thresholds[0].label;
  for (const threshold of thresholds) {
    if (value >= threshold.min) label = threshold.label;
  }
  return label;
}

// Classifies a route from distance and total elevation gain alone — no
// power, speed, rider weight, weather, surface, or post-ride effort data.
// Returns null for a routeless/zero-distance state (nothing to classify).
export function classifyRoute(distanceMeters, elevationGainMeters) {
  const distanceKm = distanceMeters / 1000;
  if (!(distanceKm > 0)) return null;

  const elevationGainM = Math.max(0, elevationGainMeters);
  const elevationPerKm = elevationGainM / distanceKm;
  const equivalentKm = distanceKm + elevationGainM / EQUIVALENT_KM_CLIMB_METERS;

  return {
    distanceKm,
    elevationGainM,
    elevationPerKm,
    equivalentKm,
    distanceClass: classify(distanceKm, DISTANCE_CLASS_THRESHOLDS_KM),
    terrainClass: classify(elevationPerKm, TERRAIN_CLASS_THRESHOLDS_M_PER_KM),
    difficulty: classify(equivalentKm, DIFFICULTY_THRESHOLDS_EQUIVALENT_KM),
  };
}
