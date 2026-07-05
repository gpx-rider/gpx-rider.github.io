// Cinematic overview camera motion — the animated alternatives to the static
// route overview. Two independent things live here:
//
//   * orbitCamera()  — a turntable: spin the static overview's heading around
//     the route, one revolution per configurable period.
//   * createFlyover() — a physics-driven vehicle (helicopter or airplane) that
//     flies a smoothed loop over the route: along the path start→end, then the
//     closing edge carries it straight back to the start, repeating forever.
//
// Everything is pure/self-contained and driven by an explicit config object
// (no imports from tuning.mjs) so it is unit-testable and the same engine
// serves both the helicopter and airplane presets. app.js owns the map and
// feeds tuning values in.
//
// The flyover works in a local east/north/up meter frame around the route's
// first point (an equirectangular projection — plenty accurate for framing a
// single route), converting back to lat/lng/altitude only when it emits a
// camera. The pipeline:
//
//   1. project the route to local meters
//   2. Douglas–Peucker simplify — drops the tiny GPS wiggles a real aircraft
//      would never chase
//   3. resample to a uniform spacing
//   4. Laplacian smoothing, iterated until every corner's radius clears the
//      vehicle's minimum turn radius (this is what gives an airplane its wide,
//      lazy turns and rounds a helicopter's sharper ones)
//   5. treat the result as a closed loop — the edge from the last point back to
//      the first is the "fly directly back to the start" return leg
//   6. a curvature- and acceleration-limited speed profile over the loop:
//      slow through bends (max lateral acceleration), fast on the straights
//      (up to max speed), never changing speed faster than max tangential
//      acceleration — braking into corners and accelerating out of them.

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE = EARTH_RADIUS_METERS * Math.PI / 180;

// --- Orbit (turntable) ----------------------------------------------------------

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

// --- Flyover (helicopter / airplane) --------------------------------------------

// Build a flyover driver for a route, or null if the route is too small to fly.
// `config` fields (all required, supplied from tuning.mjs presets):
//   simplifyToleranceMeters, resampleSpacingMeters, smoothingStrength,
//   smoothingMaxIterations, minTurnRadiusMeters, maxSpeedMps, minSpeedMps,
//   maxAccelMps2, maxLateralAccelMps2, flyHeightMeters, lookAheadMeters
export function createFlyover(route, config) {
  if (!Array.isArray(route) || route.length < 2) return null;

  const origin = route[0];
  const cosLat = Math.cos(toRad(origin.lat)) || 1e-6;
  const toLocal = (point) => [
    (point.lng - origin.lng) * METERS_PER_DEGREE * cosLat,
    (point.lat - origin.lat) * METERS_PER_DEGREE,
    Number(point.ele) || 0,
  ];
  const toGeo = ([east, north, up]) => ({
    lat: origin.lat + north / METERS_PER_DEGREE,
    lng: origin.lng + east / (METERS_PER_DEGREE * cosLat),
    altitude: up,
  });

  const local = route.map(toLocal);
  const simplified = douglasPeucker(local, Math.max(0, Number(config.simplifyToleranceMeters) || 0));
  const spacing = Math.max(1, Number(config.resampleSpacingMeters) || 20);
  let samples = resampleClosed(simplified, spacing);
  if (!samples) return null;

  samples = smoothToTurnRadius(samples, {
    strength: clamp(Number(config.smoothingStrength) || 0.5, 0.01, 0.9),
    maxIterations: Math.max(0, Number(config.smoothingMaxIterations) || 0),
    minTurnRadiusMeters: Math.max(0, Number(config.minTurnRadiusMeters) || 0),
  });

  const geometry = computeArcAndCurvature(samples);
  if (!(geometry.loopLength > spacing)) return null;

  const speeds = buildSpeedProfile(geometry, {
    maxSpeedMps: Math.max(0.1, Number(config.maxSpeedMps) || 1),
    minSpeedMps: Math.max(0, Number(config.minSpeedMps) || 0),
    maxAccelMps2: Math.max(0.01, Number(config.maxAccelMps2) || 1),
    maxLateralAccelMps2: Math.max(0.01, Number(config.maxLateralAccelMps2) || 1),
  });

  const { samples: pts, cumulative, loopLength } = geometry;
  const flyHeight = Math.max(0, Number(config.flyHeightMeters) || 0);
  const viewDistance = Math.max(1, Number(config.viewDistanceMeters) || Number(config.lookAheadMeters) || 1);
  const mountPitch = toRad(Number(config.mountPitchDegrees) || 0); // camera nose-down from the airframe
  const tangentSample = Math.max(1, Number(config.tangentSampleMeters) || 5);

  // Position [e,n,up] at arc-length `s` (wrapped into the loop).
  const positionAt = (s) => interpolateAlong(pts, cumulative, loopLength, s);
  const speedAt = (s) => interpolateScalar(speeds, cumulative, loopLength, s);

  return {
    loopLength,
    // Total time for one lap, for callers that want it (e.g. logging/UI).
    lapSeconds: estimateLapSeconds(geometry, speeds),
    speedAt,
    positionAt,
    // Advance arc-length by dt using the local speed (explicit Euler; dt is a
    // frame, so the step is tiny). Returns the new wrapped arc-length.
    advance(s, dtSeconds) {
      const dt = clamp(Number(dtSeconds) || 0, 0, 0.5);
      return wrap(s + speedAt(s) * dt, loopLength);
    },
    // Camera eye + look-at at arc-length `s`. The eye rides the vehicle at
    // fly-height. The camera is *rigidly mounted* on the airframe: it looks
    // straight along the aircraft's velocity (the path tangent), pitched down
    // by a fixed mount angle — it does not pan around to aim at the route. So
    // the view heading follows the direction of travel and the view tilt rises
    // and falls with the climb/descent angle, exactly as a bolted-on camera
    // would (roll/banking isn't representable in the Map3D camera, so it's the
    // one airframe axis we can't mirror). Pass `lookAtOverride`
    // ({lat,lng,altitude}) to instead aim at a fixed point — e.g. the rider.
    frameAt(s, lookAtOverride = null) {
      const here = positionAt(s);
      const eyeUp = here[2] + flyHeight;
      const eye = toGeo([here[0], here[1], eyeUp]);

      if (lookAtOverride) {
        return {
          eye,
          lookAt: {
            lat: lookAtOverride.lat,
            lng: lookAtOverride.lng,
            altitude: Number(lookAtOverride.altitude) || here[2],
          },
          speedMps: speedAt(s),
        };
      }

      // Velocity direction (path tangent) as a unit 3-vector.
      const ahead = positionAt(s + tangentSample);
      let tx = ahead[0] - here[0];
      let ty = ahead[1] - here[1];
      let tz = ahead[2] - here[2];
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len; ty /= len; tz /= len;

      // Climb angle of the flight path, then drop the view by the fixed mount
      // pitch: elevation = climb − mountPitch (negative = looking down).
      const climb = Math.asin(clamp(tz, -1, 1));
      const elevation = climb - mountPitch;
      const horiz = Math.hypot(tx, ty) || 1e-9;
      const hx = tx / horiz;
      const hy = ty / horiz;
      const cosE = Math.cos(elevation);
      const sinE = Math.sin(elevation);
      const lookAt = toGeo([
        here[0] + hx * cosE * viewDistance,
        here[1] + hy * cosE * viewDistance,
        eyeUp + sinE * viewDistance,
      ]);
      return { eye, lookAt, speedMps: speedAt(s) };
    },
  };
}

// --- Path geometry --------------------------------------------------------------

// Douglas–Peucker line simplification on the horizontal (x,y) plane; the z
// (altitude) of kept points rides along. Removes points that sit within
// `tolerance` meters of the line between their retained neighbours.
export function douglasPeucker(points, tolerance) {
  if (points.length < 3 || tolerance <= 0) return points.map((p) => [...p]);
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxDist = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpendicularDistance(points[i], points[lo], points[hi]);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tolerance && idx > lo) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => [...p]);
}

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Resample a closed polygon (the final edge wraps last→first) to roughly
// uniform spacing. Returns null when the perimeter is too short to sample.
export function resampleClosed(points, spacing) {
  const n = points.length;
  if (n < 2) return null;
  const cumulative = [0];
  for (let i = 0; i < n; i++) {
    cumulative.push(cumulative[i] + distance3(points[i], points[(i + 1) % n]));
  }
  const total = cumulative[n];
  if (!(total > spacing)) return null;

  const count = Math.max(12, Math.round(total / spacing));
  const step = total / count;
  const out = [];
  let edge = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (edge < n - 1 && cumulative[edge + 1] <= target) edge++;
    const segLen = cumulative[edge + 1] - cumulative[edge] || 1e-9;
    const f = (target - cumulative[edge]) / segLen;
    const a = points[edge];
    const b = points[(edge + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}

// One pass of closed Laplacian smoothing: nudge each point toward the midpoint
// of its neighbours. Smooths position and altitude together.
function smoothClosedOnce(points, strength) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    return [
      p[0] + strength * ((a[0] + b[0]) / 2 - p[0]),
      p[1] + strength * ((a[1] + b[1]) / 2 - p[1]),
      p[2] + strength * ((a[2] + b[2]) / 2 - p[2]),
    ];
  });
}

// Smooth the closed loop until the tightest corner's radius clears
// minTurnRadiusMeters, or we run out of the iteration budget. This is what
// enforces a vehicle's minimum turn radius geometrically — an airplane's wide
// arcs versus a helicopter's tighter ones — so the speed profile never has to
// crawl through a corner tighter than the aircraft can physically fly.
export function smoothToTurnRadius(points, { strength, maxIterations, minTurnRadiusMeters }) {
  let current = points.map((p) => [...p]);
  const maxCurvature = minTurnRadiusMeters > 0 ? 1 / minTurnRadiusMeters : Infinity;
  for (let i = 0; i < maxIterations; i++) {
    if (peakCurvature(current) <= maxCurvature) break;
    current = smoothClosedOnce(current, strength);
  }
  return current;
}

function peakCurvature(points) {
  let peak = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const k = curvatureAt(points[(i - 1 + n) % n], points[i], points[(i + 1) % n]);
    if (k > peak) peak = k;
  }
  return peak;
}

// Discrete curvature at the middle point: turn angle divided by the mean of the
// two adjoining segment lengths (horizontal only — turning is a horizontal
// concern, and the vertical component of a fly path is small).
function curvatureAt(a, b, c) {
  const inHeading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const outHeading = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let turn = Math.abs(outHeading - inHeading);
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  const segLen = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) / 2;
  return segLen > 1e-6 ? turn / segLen : 0;
}

// Per-sample arc length (cumulative, 3D), curvature, and the total loop length.
export function computeArcAndCurvature(samples) {
  const n = samples.length;
  const cumulative = [0];
  for (let i = 0; i < n; i++) {
    cumulative.push(cumulative[i] + distance3(samples[i], samples[(i + 1) % n]));
  }
  const curvature = samples.map((_, i) =>
    curvatureAt(samples[(i - 1 + n) % n], samples[i], samples[(i + 1) % n]));
  return { samples, cumulative, curvature, loopLength: cumulative[n] };
}

// --- Speed profile --------------------------------------------------------------

// A physically plausible speed for every sample around the closed loop:
//   * curvature cap:  v ≤ √(a_lat / κ)   — bends limited by lateral accel
//   * global cap:     v ≤ maxSpeed
//   * floor:          v ≥ minSpeed       — aircraft can't drop below stall/hover
//   * accel cap:      |d(v²)/ds| ≤ 2·a_tan — can't speed up or slow down faster
//     than tangential acceleration allows (forward pass = accelerating out of a
//     corner, backward pass = braking into one)
// Both passes are periodic (repeated) because the loop has no start or end.
export function buildSpeedProfile(geometry, { maxSpeedMps, minSpeedMps, maxAccelMps2, maxLateralAccelMps2 }) {
  const { curvature, cumulative } = geometry;
  const n = curvature.length;
  const segTo = (i) => cumulative[i + 1] - cumulative[i]; // length of edge i→i+1

  const v = curvature.map((k) => {
    const curveLimit = k > 1e-9 ? Math.sqrt(maxLateralAccelMps2 / k) : Infinity;
    return clamp(Math.min(curveLimit, maxSpeedMps), minSpeedMps, maxSpeedMps);
  });

  // Two laps each direction let the cyclic accel limits settle.
  for (let pass = 0; pass < 2; pass++) {
    for (let step = 0; step < n; step++) {
      const i = step;
      const prev = (i - 1 + n) % n;
      const ds = segTo(prev);
      v[i] = Math.min(v[i], Math.sqrt(v[prev] * v[prev] + 2 * maxAccelMps2 * ds));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let step = 0; step < n; step++) {
      const i = (n - 1 - step + n) % n;
      const next = (i + 1) % n;
      const ds = segTo(i);
      v[i] = Math.min(v[i], Math.sqrt(v[next] * v[next] + 2 * maxAccelMps2 * ds));
    }
  }

  return v.map((x) => clamp(x, minSpeedMps, maxSpeedMps));
}

function estimateLapSeconds(geometry, speeds) {
  const { cumulative } = geometry;
  const n = speeds.length;
  let seconds = 0;
  for (let i = 0; i < n; i++) {
    const ds = cumulative[i + 1] - cumulative[i];
    const vAvg = Math.max(0.1, (speeds[i] + speeds[(i + 1) % n]) / 2);
    seconds += ds / vAvg;
  }
  return seconds;
}

// --- Small helpers --------------------------------------------------------------

function interpolateAlong(samples, cumulative, loopLength, s) {
  const n = samples.length;
  const t = wrap(s, loopLength);
  let edge = 0;
  while (edge < n && cumulative[edge + 1] <= t) edge++;
  if (edge >= n) edge = n - 1;
  const segLen = cumulative[edge + 1] - cumulative[edge] || 1e-9;
  const f = (t - cumulative[edge]) / segLen;
  const a = samples[edge];
  const b = samples[(edge + 1) % n];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function interpolateScalar(values, cumulative, loopLength, s) {
  const n = values.length;
  const t = wrap(s, loopLength);
  let edge = 0;
  while (edge < n && cumulative[edge + 1] <= t) edge++;
  if (edge >= n) edge = n - 1;
  const segLen = cumulative[edge + 1] - cumulative[edge] || 1e-9;
  const f = (t - cumulative[edge]) / segLen;
  return values[edge] + (values[(edge + 1) % n] - values[edge]) * f;
}

function wrap(value, span) {
  if (!(span > 0)) return 0;
  return ((value % span) + span) % span;
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalizeHeading(angle) {
  return ((angle % 360) + 360) % 360;
}

function toRad(value) {
  return value * Math.PI / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
