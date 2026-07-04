import { clamp, haversine, lerp } from "./geo.mjs";
import {
  CLIMB_NOISE_THRESHOLD_METERS,
  GRADE_LOOKAROUND_METERS,
  GRADE_MAX_PERCENT,
  GRADE_MIN_PERCENT,
} from "./tuning.mjs";

// Returns `{ points, name }`: track/route points plus the GPX's own name
// (from <metadata><name>, <trk><name>, or <rte><name>, in that preference
// order), or a null name when the file doesn't carry one.
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) return { points: [], name: null };

  const points = [...doc.querySelectorAll("trkpt, rtept")].map((point) => ({
    lat: Number(point.getAttribute("lat")),
    lng: Number(point.getAttribute("lon")),
    ele: Number(point.querySelector("ele")?.textContent ?? 0),
  })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  const name = doc.querySelector("metadata > name, trk > name, rte > name")?.textContent.trim() || null;

  return { points, name };
}

// Adds cumulative track fields to each point: `distance` ridden so far plus
// `ascent`/`descent` climbed and dropped so far. Ascent and descent are
// noise-filtered: an elevation trend only counts once it exceeds
// CLIMB_NOISE_THRESHOLD_METERS in one direction, so meter-level GPX jitter
// does not inflate the totals.
export function enrichRoute(points) {
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let anchorEle = null;
  return points.map((point, index) => {
    if (index > 0) distance += haversine(points[index - 1], point);
    if (Number.isFinite(point.ele)) {
      if (anchorEle === null) anchorEle = point.ele;
      const delta = point.ele - anchorEle;
      if (delta >= CLIMB_NOISE_THRESHOLD_METERS) {
        ascent += delta;
        anchorEle = point.ele;
      } else if (delta <= -CLIMB_NOISE_THRESHOLD_METERS) {
        descent -= delta;
        anchorEle = point.ele;
      }
    }
    return { ...point, distance, ascent, descent };
  });
}

export function routeTotalDistance(route) {
  return route.length ? route.at(-1).distance : 0;
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

function cumulativeFieldAt(route, distance, field) {
  if (!route.length) return 0;
  if (distance <= route[0].distance) return route[0][field];
  if (distance >= route.at(-1).distance) return route.at(-1)[field];

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
  return lerp(previous[field], next[field], (distance - previous.distance) / span);
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

export function gradeAt(route, distance) {
  const lookBehind = Math.max(0, distance - GRADE_LOOKAROUND_METERS);
  const lookAhead = Math.min(routeTotalDistance(route), distance + GRADE_LOOKAROUND_METERS);
  const from = interpolateRoutePoint(route, lookBehind);
  const to = interpolateRoutePoint(route, lookAhead);
  const horizontal = Math.max(1, lookAhead - lookBehind);
  const rawGrade = ((to.ele - from.ele) / horizontal) * 100;
  return clamp(rawGrade, GRADE_MIN_PERCENT, GRADE_MAX_PERCENT);
}
