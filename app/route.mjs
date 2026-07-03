import { clamp, haversine, lerp } from "./geo.mjs";

const GRADE_LOOKAROUND_METERS = 18;
const GRADE_MIN_PERCENT = -15;
const GRADE_MAX_PERCENT = 20;

export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) return [];

  return [...doc.querySelectorAll("trkpt, rtept")].map((point) => ({
    lat: Number(point.getAttribute("lat")),
    lng: Number(point.getAttribute("lon")),
    ele: Number(point.querySelector("ele")?.textContent ?? 0),
  })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export function enrichRoute(points) {
  let distance = 0;
  return points.map((point, index) => {
    if (index > 0) distance += haversine(points[index - 1], point);
    return { ...point, distance };
  });
}

export function routeTotalDistance(route) {
  return route.length ? route.at(-1).distance : 0;
}

export function interpolateRoutePoint(route, distance) {
  if (distance <= route[0].distance) return route[0];
  if (distance >= route.at(-1).distance) return route.at(-1);

  let low = 0;
  let high = route.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (route[mid].distance < distance) low = mid;
    else high = mid;
  }

  const previous = route[low];
  const next = route[high];
  const span = next.distance - previous.distance || 1;
  const ratio = (distance - previous.distance) / span;

  return {
    lat: lerp(previous.lat, next.lat, ratio),
    lng: lerp(previous.lng, next.lng, ratio),
    ele: lerp(previous.ele, next.ele, ratio),
  };
}

// Subdivide long segments so no two consecutive points are further apart
// than maxSpacingMeters. Original points are always kept, so sharp corners
// survive; only sparse straights gain interpolated points.
export function densifyRoute(route, maxSpacingMeters) {
  const points = [];
  for (let i = 0; i < route.length; i += 1) {
    if (i > 0) {
      const gap = route[i].distance - route[i - 1].distance;
      const extra = Math.min(200, Math.ceil(gap / maxSpacingMeters) - 1);
      for (let s = 1; s <= extra; s += 1) {
        points.push(interpolateRoutePoint(route, route[i - 1].distance + (gap * s) / (extra + 1)));
      }
    }
    points.push(route[i]);
  }
  return points;
}

export function gradeAt(route, distance) {
  const lookBehind = Math.max(0, distance - GRADE_LOOKAROUND_METERS);
  const lookAhead = Math.min(routeTotalDistance(route), distance + GRADE_LOOKAROUND_METERS);
  const from = interpolateRoutePoint(route, lookBehind);
  const to = interpolateRoutePoint(route, lookAhead);
  const horizontal = Math.max(1, lookAhead - lookBehind);
  const rawGrade = ((to.ele - from.ele) / horizontal) * 100;
  return clamp(rawGrade, GRADE_MIN_PERCENT, GRADE_MAX_PERCENT);
}
