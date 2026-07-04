import { clamp, haversine, lerp } from "./geo.mjs";

const GRADE_LOOKAROUND_METERS = 18;
const GRADE_MIN_PERCENT = -15;
const GRADE_MAX_PERCENT = 20;

// Elevation profile resampling: raw GPX elevation is noisy (GPS/barometric
// jitter), so summing every point-to-point delta wildly overstates total
// ascent/descent. Resampling at a fixed spacing and summing deltas of the
// resampled (already-interpolated) series filters out sub-spacing noise —
// the same idea most ride computers use for "elevation gain".
const ELEVATION_SAMPLE_SPACING_METERS = 25;
// A resampled step is only classed as climbing/descending once its grade
// clears this threshold; gentler undulation counts as flat for the terrain
// breakdown that feeds the ETA estimate (see app.js computeEtaSeconds).
export const TERRAIN_GRADE_THRESHOLD_PERCENT = 2;

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

// Highest route elevation within `radiusMeters` of a location, or null when
// no track point is that close. Used as a free, offline terrain estimate for
// camera terrain avoidance: on switchback climbs — where the follow camera is
// most likely to clip into a hillside — the road itself covers the hill, so
// nearby track points approximate the ground elevation off the route line.
export function maxElevationNear(route, location, radiusMeters) {
  let maxEle = null;
  for (const point of route) {
    if (haversine(point, location) > radiusMeters) continue;
    if (maxEle === null || point.ele > maxEle) maxEle = point.ele;
  }
  return maxEle;
}

// Resamples the route's elevation at a fixed spacing and returns a table of
// cumulative ascent/descent and cumulative climb/descent/flat distance &
// vertical, one entry per sample. Query it with elevationAt() rather than
// recomputing per call — building it is the only part that's O(samples).
export function buildElevationProfile(route) {
  const total = routeTotalDistance(route);
  const first = { distance: 0, gain: 0, loss: 0, climbDistance: 0, climbVertical: 0, descentDistance: 0, flatDistance: 0 };
  if (total <= 0 || route.length < 2) return [first];

  const steps = Math.max(1, Math.round(total / ELEVATION_SAMPLE_SPACING_METERS));
  const stepLength = total / steps;
  const profile = [first];
  let previousEle = route[0].ele;
  let gain = 0;
  let loss = 0;
  let climbDistance = 0;
  let climbVertical = 0;
  let descentDistance = 0;
  let flatDistance = 0;

  for (let i = 1; i <= steps; i += 1) {
    const distance = stepLength * i;
    const ele = interpolateRoutePoint(route, distance).ele;
    const delta = ele - previousEle;
    if (delta > 0) gain += delta;
    else loss -= delta;

    const gradePercent = (delta / stepLength) * 100;
    if (gradePercent >= TERRAIN_GRADE_THRESHOLD_PERCENT) {
      climbDistance += stepLength;
      climbVertical += delta;
    } else if (gradePercent <= -TERRAIN_GRADE_THRESHOLD_PERCENT) {
      descentDistance += stepLength;
    } else {
      flatDistance += stepLength;
    }

    previousEle = ele;
    profile.push({ distance, gain, loss, climbDistance, climbVertical, descentDistance, flatDistance });
  }
  return profile;
}

// Cumulative gain/loss/climb/descent/flat values at `distance`, linearly
// interpolated between the two bracketing samples — mirrors
// interpolateRoutePoint's binary search and clamping behavior.
export function elevationAt(profile, distance) {
  const first = profile[0];
  const last = profile.at(-1);
  if (distance <= first.distance) return first;
  if (distance >= last.distance) return last;

  let low = 0;
  let high = profile.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (profile[mid].distance < distance) low = mid;
    else high = mid;
  }

  const a = profile[low];
  const b = profile[high];
  const span = b.distance - a.distance || 1;
  const ratio = (distance - a.distance) / span;
  return {
    distance,
    gain: lerp(a.gain, b.gain, ratio),
    loss: lerp(a.loss, b.loss, ratio),
    climbDistance: lerp(a.climbDistance, b.climbDistance, ratio),
    climbVertical: lerp(a.climbVertical, b.climbVertical, ratio),
    descentDistance: lerp(a.descentDistance, b.descentDistance, ratio),
    flatDistance: lerp(a.flatDistance, b.flatDistance, ratio),
  };
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
