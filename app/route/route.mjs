import { clamp, haversine, lerp } from "../core/geo.mjs";
import {
  CLIMB_NOISE_THRESHOLD_METERS,
  GRADE_LOOKAROUND_METERS,
  GRADE_MAX_PERCENT,
  GRADE_MIN_PERCENT,
} from "../core/tuning.mjs";

// Returns `{ points, name }`: track/route points plus the GPX's own name
// (from <metadata><name>, <trk><name>, or <rte><name>, in that preference
// order), or a null name when the file doesn't carry one.
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) return { points: [], name: null };

  const points = [...doc.querySelectorAll("trkpt, rtept")].map((point) => {
    const text = point.querySelector("ele")?.textContent.trim();
    const ele = text ? Number(text) : NaN;
    return {
      lat: Number(point.getAttribute("lat")),
      lng: Number(point.getAttribute("lon")),
      ele: Number.isFinite(ele) ? ele : 0,
      ...(Number.isFinite(ele) ? {} : { elevationMissing: true }),
    };
  }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  const name = doc.querySelector("metadata > name, trk > name, rte > name")?.textContent.trim() || null;

  return { points, name };
}

// Adds cumulative horizontal `distance` and `roadDistance` to each point, plus
// `ascent`/`descent` climbed and dropped so far. Ascent and descent are
// noise-filtered: an elevation trend only counts once it exceeds
// CLIMB_NOISE_THRESHOLD_METERS in one direction, so meter-level GPX jitter
// does not inflate the totals.
// All thresholds are explicit parameters (tests pass fixed values so tuning
// changes can never break them); the tuning constants are only the defaults
// the app runs with.
export function enrichRoute(points, {
  noiseThresholdMeters = CLIMB_NOISE_THRESHOLD_METERS,
} = {}) {
  let distance = 0;
  let roadDistance = 0;
  let missingElevations = 0;
  let ascent = 0;
  let descent = 0;
  let anchorEle = null;
  return points.map((point, index) => {
    const knownElevation = hasElevation(point);
    if (!knownElevation) missingElevations += 1;
    if (index > 0) {
      const previous = points[index - 1];
      const horizontal = haversine(previous, point);
      distance += horizontal;
      roadDistance += horizontal > 0 && knownElevation && hasElevation(previous)
        ? Math.hypot(horizontal, point.ele - previous.ele)
        : horizontal;
    }
    if (knownElevation) {
      if (anchorEle === null) anchorEle = point.ele;
      const delta = point.ele - anchorEle;
      if (delta >= noiseThresholdMeters) {
        ascent += delta;
        anchorEle = point.ele;
      } else if (delta <= -noiseThresholdMeters) {
        descent -= delta;
        anchorEle = point.ele;
      }
    } else {
      anchorEle = null;
    }
    return { ...point, distance, roadDistance, ascent, descent, missingElevations };
  });
}

export function routeTotalDistance(route) {
  return route.length ? route.at(-1).distance : 0;
}

function hasElevation(point) {
  return !point.elevationMissing && Number.isFinite(point.ele);
}

// Route positions stay on the horizontal axis. Convert only at boundaries
// where a caller needs meters traveled along the road.
export function roadDistanceAt(route, progress) {
  return cumulativeFieldAt(route, progress, "roadDistance");
}

export function advanceAlongRoad(route, progress, meters, targetProgress = routeTotalDistance(route)) {
  const start = roadDistanceAt(route, progress);
  const limit = roadDistanceAt(route, targetProgress);
  const end = Math.min(limit, start + Math.max(0, meters));
  return {
    progress: end === limit ? targetProgress : cumulativeFieldAt(route, end, "distance", "roadDistance"),
    metersAdvanced: end - start,
  };
}

export function routeTotalAscent(route) {
  return route.length ? route.at(-1).ascent : 0;
}

export function routeTotalDescent(route) {
  return route.length ? route.at(-1).descent : 0;
}

// Cumulative ascent/descent completed at `distance` meters along the route,
// interpolated between the enriched track points.
export function ascentAt(route, distance) {
  return cumulativeFieldAt(route, distance, "ascent");
}

export function descentAt(route, distance) {
  return cumulativeFieldAt(route, distance, "descent");
}

function firstPointAtOrAfter(route, value, axis = "distance") {
  let low = 0;
  let high = route.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (route[mid][axis] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function cumulativeFieldAt(route, value, field, axis = "distance") {
  if (!route.length) return 0;
  if (value <= route[0][axis]) return route[0][field];
  if (value >= route.at(-1)[axis]) return route.at(-1)[field];

  const index = firstPointAtOrAfter(route, value, axis);
  const previous = route[index - 1];
  const next = route[index];
  return lerp(previous[field], next[field], (value - previous[axis]) / (next[axis] - previous[axis]));
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
    distance,
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

// Extract a route interval and rebase its cumulative distance to zero. The
// exact requested endpoints are interpolated, so camera framing can treat a
// climb as a complete standalone route without duplicating overview math.
export function sliceRoute(route, startDistance, endDistance) {
  if (!route?.length) return [];
  const total = routeTotalDistance(route);
  const start = clamp(Number(startDistance) || 0, 0, total);
  const end = clamp(Number(endDistance) || 0, start, total);
  if (end <= start) return [];

  const points = [
    interpolateRoutePoint(route, start),
    ...route.filter((point) => point.distance > start && point.distance < end),
    interpolateRoutePoint(route, end),
  ].map(({ lat, lng, ele }) => ({ lat, lng, ele }));
  return enrichRoute(points);
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

export function gradeAt(route, distance, {
  lookaroundMeters = GRADE_LOOKAROUND_METERS,
  minPercent = GRADE_MIN_PERCENT,
  maxPercent = GRADE_MAX_PERCENT,
} = {}) {
  const lookBehind = Math.max(0, distance - lookaroundMeters);
  const lookAhead = Math.min(routeTotalDistance(route), distance + lookaroundMeters);
  if (route.at(-1)?.missingElevations) {
    const left = firstPointAtOrAfter(route, lookBehind);
    const start = route[left].distance > lookBehind ? left - 1 : left;
    // Interpolation uses the final point at the finish, even when coordinates repeat.
    const end = lookAhead >= routeTotalDistance(route)
      ? route.length - 1
      : firstPointAtOrAfter(route, lookAhead);
    if (route[end].missingElevations > (route[start - 1]?.missingElevations ?? 0)) return 0;
  }
  const from = interpolateRoutePoint(route, lookBehind);
  const to = interpolateRoutePoint(route, lookAhead);
  const horizontal = Math.max(1, lookAhead - lookBehind);
  const rawGrade = ((to.ele - from.ele) / horizontal) * 100;
  return clamp(rawGrade, minPercent, maxPercent);
}
