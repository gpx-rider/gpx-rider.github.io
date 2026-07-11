// Elevation-signal processing shared by climb detection: resamples a route
// to a fixed distance step, smooths elevation (median filter then moving
// average) to remove GPS spikes and jitter, and reads rolling grade over an
// arbitrary window at any resampled point. Pure geometry — no tuning
// defaults, no state machine; see climbs.mjs for how it's used.

function cleanRoute(route) {
  const clean = [];
  let lastDistance = null;
  for (const point of route) {
    const { distance, ele } = point;
    if (!Number.isFinite(distance) || !Number.isFinite(ele)) continue;
    if (lastDistance !== null && distance <= lastDistance) continue;
    clean.push(point);
    lastDistance = distance;
  }
  return clean;
}

function resampleByDistance(route, stepMeters) {
  const clean = cleanRoute(route);
  if (clean.length < 2) return clean;

  const result = [];
  const totalDistance = clean[clean.length - 1].distance;

  let j = 0;
  let target = clean[0].distance;

  while (target <= totalDistance) {
    while (j < clean.length - 2 && clean[j + 1].distance < target) j += 1;

    const a = clean[j];
    const b = clean[j + 1];
    const span = b.distance - a.distance;
    if (span <= 0) {
      target += stepMeters;
      continue;
    }

    const t = (target - a.distance) / span;
    result.push({ distance: target, ele: a.ele + (b.ele - a.ele) * t });
    target += stepMeters;
  }

  if (result.length && result[result.length - 1].distance < totalDistance) {
    result.push({ distance: totalDistance, ele: clean[clean.length - 1].ele });
  }

  return result;
}

function radiusForWindow(windowMeters, stepMeters) {
  return Math.max(1, Math.round(windowMeters / stepMeters / 2));
}

function medianFilter(values, radius) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length, i + radius + 1);
    const window = values.slice(a, b).sort((x, y) => x - y);
    const mid = Math.floor(window.length / 2);
    out.push(window.length % 2 === 1 ? window[mid] : (window[mid - 1] + window[mid]) / 2);
  }
  return out;
}

function meanFilter(values, radius) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length, i + radius + 1);
    const window = values.slice(a, b);
    out.push(window.reduce((sum, v) => sum + v, 0) / window.length);
  }
  return out;
}

/**
 * Resamples `route` (points with `distance`/`ele`) to a fixed step, then
 * applies a median filter followed by a moving average to the elevation.
 */
export function resampleAndSmoothElevation(route, stepMeters, medianWindowMeters, smoothWindowMeters) {
  const points = resampleByDistance(route, stepMeters);
  if (points.length < 3) return points;

  const medianRadius = radiusForWindow(medianWindowMeters, stepMeters);
  const smoothRadius = radiusForWindow(smoothWindowMeters, stepMeters);

  const rawEle = points.map((p) => p.ele);
  const medianEle = medianFilter(rawEle, medianRadius);
  const smoothEle = meanFilter(medianEle, smoothRadius);

  return points.map((p, i) => ({ distance: p.distance, ele: smoothEle[i] }));
}

function gradeBetween(points, startIdx, endIdx) {
  if (startIdx === endIdx) return 0;
  const distance = points[endIdx].distance - points[startIdx].distance;
  if (distance <= 0) return 0;
  const gain = points[endIdx].ele - points[startIdx].ele;
  return (gain / distance) * 100;
}

/** Average grade (percent) over `windowMeters` centered on `points[idx]`. */
export function rollingGrade(points, idx, windowMeters, stepMeters) {
  const radius = radiusForWindow(windowMeters, stepMeters);
  const a = Math.max(0, idx - radius);
  const b = Math.min(points.length - 1, idx + radius);
  return gradeBetween(points, a, b);
}
