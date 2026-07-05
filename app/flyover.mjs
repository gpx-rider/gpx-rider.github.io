// Cinematic overview camera motion that is independent of route geometry.

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

function normalizeHeading(angle) {
  return ((angle % 360) + 360) % 360;
}
