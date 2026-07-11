// Cinematic overview camera motion that is independent of route geometry.

import { clamp, destinationPoint, toRad } from "../core/geo.mjs";

// Spin a static overview camera around its look-at point. `direction` is +1 for
// clockwise, -1 for counter-clockwise; `secondsPerRevolution` sets the pace.
export function orbitCamera(base, elapsedSeconds, { secondsPerRevolution = 60, direction = 1 } = {}) {
  if (!base) return null;
  const period = Math.max(1, Number(secondsPerRevolution) || 60);
  const revolutions = (Number(elapsedSeconds) || 0) / period;
  const spin = 360 * revolutions * (direction < 0 ? -1 : 1);
  return {
    center: { ...base.center },
    heading: normalizeHeading(base.heading + spin),
    tilt: base.tilt,
    range: base.range,
  };
}

// Approximate the ground track followed by the orbit camera eye, for debug
// overlays. Map3D's range is the eye-to-center distance, so the horizontal
// radius is the range projected by the camera tilt.
export function orbitPath(base, { altitudeMeters = 0, sampleCount = 240 } = {}) {
  if (!base?.center) return [];
  const count = Math.max(12, Math.round(Number(sampleCount) || 240));
  const range = Math.max(0, Number(base.range) || 0);
  const tilt = clamp(Number(base.tilt) || 0, 0, 89.9);
  const radiusMeters = range * Math.sin(toRad(tilt));
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return [];

  const path = [];
  for (let i = 0; i <= count; i += 1) {
    const bearing = 360 * (i / count);
    const point = destinationPoint(base.center, bearing, radiusMeters);
    path.push({ lat: point.lat, lng: point.lng, altitude: altitudeMeters });
  }
  return path;
}

function normalizeHeading(angle) {
  return ((angle % 360) + 360) % 360;
}
