// Loop-based overview flights fitted to the route footprint.
//
// Two closed curves share one camera-flight driver:
//   • createEllipseFlyby    — the camera flies a PCA-aligned ellipse ("fly-by")
//   • createFigureEightFlyover — the camera flies a figure-eight ("fly-over")
// Both fit the same footprint frame (fitFootprint) and are configured by the
// same tunable object (ELLIPSE_FLYBY in tuning.mjs) — only the resulting path
// differs. The route does not have to fit inside the curve: ellipseScale
// intentionally lets the flight path cut inside the route bounds, while
// altitude/pitch/FOV determine what remains visible from the air.
//
// Map3DElement supports roll, so the driver returns a bank angle for app.js to
// apply directly to the camera while flying.

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE = EARTH_RADIUS_METERS * Math.PI / 180;
const TWO_PI = Math.PI * 2;

// Entry candidates (entrySForView) whose bearing is within this band of the
// least-head-turn one count as equally "in view" — it absorbs the sampling
// noise around a sight-line crossing so the natural-climb preference can
// choose among them, without letting a meaningfully different bearing win.
const ENTRY_BEARING_BAND_RADIANS = 2 * Math.PI / 180;

export function createEllipseFlyby(route, config = {}, opts = {}) {
  return buildLoopFlight(fitFlybyEllipse(route, config), config, opts);
}

export function createFigureEightFlyover(route, config = {}, opts = {}) {
  return buildLoopFlight(fitFlyoverFigureEight(route, config), config, opts);
}

// Shared camera-flight driver for any closed loop curve fitted to the route
// footprint. `curve` exposes its geometry in a parameter u ∈ [0, 2π) plus an
// arc-length map (uAt), so the driver only handles pacing, camera framing and
// banking. `opts.terrainSampler(lat, lng) => meters|null` (optional) supplies
// real ground elevation along the flight path — see the fly-height planner
// below. Returns null when the curve could not be fitted (route too small).
function buildLoopFlight(curve, config = {}, opts = {}) {
  if (!curve) return null;

  const terrainSampler = typeof opts.terrainSampler === "function" ? opts.terrainSampler : null;
  const maxSpeedMps = Math.max(0.1, Number(config.max_speed_mps) || 70);
  const targetLapSeconds = Math.max(1, Number(config.seconds_per_lap) || 60);
  const speedMps = Math.min(maxSpeedMps, curve.loopLength / targetLapSeconds);
  const flyHeightMin = Math.max(1, Number(config.fly_height_meters_min) || 1000);
  const terrainClearanceMin = Math.max(0, Number(config.fly_height_meters_above_terrain_min) || 0);

  // Elevation profile of the whole flight path. The footprint fit only knows
  // the *route's* own elevation points inside the ellipse, so a hill the route
  // detours around is invisible to it and the camera would fly straight through
  // it. When a terrain sampler is supplied (online elevation tiles), walk the
  // eye's ground track around the entire loop and lift the flight to clear the
  // highest terrain found. Degrades to the route-based footprint estimate when
  // no sampler is given, or per-point when a tile has not loaded yet (the
  // sampler returns a non-finite value for that point).
  let pathTerrainSampledMeters = null;
  let pathTerrainSampleCount = 0;
  if (terrainSampler) {
    const pathSamples = Math.max(24, Math.round(Number(config.sample_count) || 240));
    let highest = -Infinity;
    for (const point of curve.pathAt(0, pathSamples)) {
      const raw = terrainSampler(point.lat, point.lng);
      // null/undefined means "no data here" (tile not loaded / disabled) — skip
      // it; a real 0 (sea level) is valid and must NOT be coerced away.
      if (raw == null) continue;
      const ele = Number(raw);
      if (Number.isFinite(ele)) {
        highest = Math.max(highest, ele);
        pathTerrainSampleCount += 1;
      }
    }
    if (Number.isFinite(highest)) pathTerrainSampledMeters = highest;
  }
  const highestTerrainAltitudeMeters = pathTerrainSampledMeters === null
    ? curve.highestTerrainAltitudeMeters
    : Math.max(curve.highestTerrainAltitudeMeters, pathTerrainSampledMeters);

  const flyHeight = Math.max(
    flyHeightMin,
    highestTerrainAltitudeMeters + terrainClearanceMin - curve.centerAltitude,
  );
  const viewDistance = Math.max(1, Number(config.view_distance_meters) || 2500);
  const cameraFovDegrees = clamp(Number(config.camera_fov_degrees) || 35, 5, 80);
  const mountPitch = toRad(clamp(Number(config.mount_pitch_degrees) || 28, 1, 89));
  const inwardLook = toRad(clamp(Number(config.inward_look_degrees) || 0, 0, 89));
  const maxBankDegrees = Math.max(0, Number(config.max_bank_degrees) || 0);
  const minTurnRadius = Math.max(0, Number(config.min_turn_radius_meters) || 0);
  const direction = Number(config.direction) < 0 ? -1 : 1;
  const startAngle = toRad(Number(config.start_angle_degrees) || 0);

  const travelSign = direction > 0 ? -1 : 1;
  const lapSeconds = curve.loopLength / speedMps;
  const terrainClearanceMeters = flyHeight + curve.centerAltitude - highestTerrainAltitudeMeters;

  function angleAt(s) {
    return startAngle + travelSign * curve.uAt(s);
  }

  function localAt(s) {
    return curve.pointAt(angleAt(s));
  }

  function tangentAt(s) {
    const d = curve.derivativeAt(angleAt(s));
    const east = d[0] * travelSign;
    const north = d[1] * travelSign;
    const len = Math.hypot(east, north) || 1;
    return [east / len, north / len];
  }

  function radiusAt(s) {
    return curve.radiusAt(angleAt(s));
  }

  // How far into a turn we are, 0 (straight) → 1 (tightest allowed radius).
  function turnMagnitudeAt(s) {
    return clamp(minTurnRadius > 0 ? minTurnRadius / Math.max(radiusAt(s), 1) : 1, 0, 1);
  }

  // Which way the flight is turning right now: +1 = turning right (interior on
  // the right), -1 = turning left, 0 at an inflection. A fixed-handedness curve
  // (the ellipse) turns the same way the whole lap, so it keeps its configured
  // `direction`; a turn-changing curve (the figure-eight) reads the sign from
  // its local curvature, so the eight banks and looks into whichever turn it is
  // actually in — right on one lobe, left on the other, straight at the crossing.
  function turnSignAt(s) {
    if (!curve.tracksTurnDirection) return direction;
    // Signed curvature relative to the travel direction; a right turn is
    // clockwise, which is negative in the east-north (CCW-positive) frame.
    const kTravel = travelSign * curve.signedCurvatureAt(angleAt(s));
    return kTravel < 0 ? 1 : (kTravel > 0 ? -1 : 0);
  }

  // Horizontal rotation applied to the look direction (positive = toward the
  // right of travel). The ellipse uses a constant inward offset; the figure-
  // eight eases the offset to zero through the straight crossing and flips its
  // side per lobe, so it always looks into the inside of the current turn.
  function inwardRotationAt(s) {
    if (!curve.tracksTurnDirection) return inwardLook * direction;
    return inwardLook * turnSignAt(s) * turnMagnitudeAt(s);
  }

  function bankAt(s) {
    if (!(minTurnRadius > 0) || maxBankDegrees <= 0) return 0;
    return turnSignAt(s) * maxBankDegrees * turnMagnitudeAt(s);
  }

  function frameAt(s) {
    const here = localAt(s);
    const inwardDegrees = toDeg(inwardRotationAt(s));
    const tangent = rotateHorizontalRight(tangentAt(s), inwardRotationAt(s));
    const eyeAltitude = curve.centerAltitude + flyHeight;
    const eye = curve.toGeo([here[0], here[1], eyeAltitude]);

    const cosE = Math.cos(-mountPitch);
    const sinE = Math.sin(-mountPitch);
    const lookAt = curve.toGeo([
      here[0] + tangent[0] * cosE * viewDistance,
      here[1] + tangent[1] * cosE * viewDistance,
      eyeAltitude + sinE * viewDistance,
    ]);
    return {
      eye,
      lookAt,
      speedMps,
      maxSpeedMps,
      targetLapSeconds,
      lapSeconds,
      flyHeightMeters: flyHeight,
      terrainClearanceMeters,
      highestTerrainAltitudeMeters,
      // Highest ground the online sampler found under the flight path (null =
      // no sampler or no tiles loaded), and how many path points it covered —
      // surfaced on the camera debug overlay.
      pathTerrainSampledMeters,
      pathTerrainSampleCount,
      cameraFovDegrees,
      inwardLookDegrees: toDeg(inwardLook),
      // The inward look actually applied at this point (signed: + right, -
      // left). Constant for the ellipse; varies over the figure-eight lap.
      currentInwardLookDegrees: inwardDegrees,
      turnRadiusMeters: radiusAt(s),
      bankDegrees: bankAt(s),
    };
  }

  // Arc-length of the point on the flight path whose camera eye is closest to
  // `target` (a { lat, lng } geo point). Lets the flight enter the pattern at
  // the nearest point instead of always flying to its start.
  function nearestSTo(target) {
    const lat = Number(target?.lat);
    const lng = Number(target?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
    // Longitude degrees shrink with latitude — weight them so the comparison
    // is metric, not skewed toward north-south separation.
    const cosLat = Math.cos(toRad(lat)) || 1e-6;
    const count = 180;
    let bestS = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < count; i++) {
      const s = (i / count) * curve.loopLength;
      const eye = frameAt(s).eye;
      const d = (eye.lat - lat) ** 2 + ((eye.lng - lng) * cosLat) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        bestS = s;
      }
    }
    return bestS;
  }

  // Arc-length of the dock point for a flight joining the pattern from a
  // viewer at `eye` looking toward `lookAt`. A candidate entry must be
  // joinable without drama: no steeper than `climbDegrees` up from the
  // horizon (in the extreme the loop edge is straight overhead — the exact
  // entry this function exists to avoid), and with the pattern's travel
  // direction not opposed to the approach (the pattern is a directed flight;
  // docking where it heads back at the viewer would whip the camera around).
  // Among those, the entry needing the least head-turn from the current line
  // of sight wins — a crossing dead ahead when the viewer faces the pattern,
  // else the first qualifying point that comes into view turning toward it —
  // and within that bearing, the point whose distance best matches raising
  // the view by `climbDegrees` to the pattern's flight altitude. Falls back
  // to the point nearest that raised aim when nothing qualifies, and to
  // nearestSTo(eye) when the geometry is degenerate (no horizontal view
  // direction, or the viewer is already at the pattern's altitude).
  function entrySForView(eye, lookAt, climbDegrees) {
    const lat = Number(eye?.lat);
    const lng = Number(eye?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
    const cosLat = Math.cos(toRad(lat)) || 1e-6;
    const east = (Number(lookAt?.lng) - lng) * METERS_PER_DEGREE * cosLat;
    const north = (Number(lookAt?.lat) - lat) * METERS_PER_DEGREE;
    const horizontal = Math.hypot(east, north);
    const climb = Math.tan(toRad(clamp(Number(climbDegrees) || 45, 5, 85)));
    const patternAltitude = curve.centerAltitude + flyHeight;
    const forward = Math.abs(patternAltitude - (Number(eye.altitude) || 0)) / climb;
    if (!(horizontal > 1e-6) || !(forward > 1)) return nearestSTo(eye);
    const dirEast = east / horizontal;
    const dirNorth = north / horizontal;

    const count = 360;
    const candidates = [];
    for (let i = 0; i < count; i++) {
      const s = (i / count) * curve.loopLength;
      const point = frameAt(s).eye;
      const de = (point.lng - lng) * METERS_PER_DEGREE * cosLat;
      const dn = (point.lat - lat) * METERS_PER_DEGREE;
      const distance = Math.hypot(de, dn);
      if (distance < forward) continue; // steeper than the natural climb
      const [tangentEast, tangentNorth] = tangentAt(s);
      if (tangentEast * de + tangentNorth * dn <= 0) continue; // pattern heads back at the viewer
      const deviation = Math.acos(clamp((de * dirEast + dn * dirNorth) / distance, -1, 1));
      candidates.push({ s, deviation, distance });
    }
    if (!candidates.length) {
      return nearestSTo({
        lat: lat + (dirNorth * forward) / METERS_PER_DEGREE,
        lng: lng + (dirEast * forward) / (METERS_PER_DEGREE * cosLat),
      });
    }
    // Least head-turn wins; within one bearing band of it (sampling noise
    // around a crossing), the distance closest to the natural climb point.
    let minDeviation = Infinity;
    for (const candidate of candidates) minDeviation = Math.min(minDeviation, candidate.deviation);
    let best = null;
    for (const candidate of candidates) {
      if (candidate.deviation > minDeviation + ENTRY_BEARING_BAND_RADIANS) continue;
      if (!best || Math.abs(candidate.distance - forward) < Math.abs(best.distance - forward)) {
        best = candidate;
      }
    }
    return best.s;
  }

  return {
    curve,
    loopLength: curve.loopLength,
    lapSeconds,
    targetLapSeconds,
    maxSpeedMps,
    speedAt() {
      return speedMps;
    },
    radiusAt,
    bankAt,
    flyHeightMeters: flyHeight,
    terrainClearanceMeters,
    highestTerrainAltitudeMeters,
    pathTerrainSampledMeters,
    pathTerrainSampleCount,
    cameraFovDegrees,
    inwardLookDegrees: toDeg(inwardLook),
    pathAtAltitude(altitudeMeters = 0, sampleCount = 240) {
      return curve.pathAt(altitudeMeters, sampleCount);
    },
    positionAt: localAt,
    advance(s, dtSeconds) {
      const dt = clamp(Number(dtSeconds) || 0, 0, 0.5);
      return wrap((Number(s) || 0) + speedMps * dt, curve.loopLength);
    },
    nearestSTo,
    entrySForView,
    frameAt,
  };
}

function rotateHorizontalRight([east, north], radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    east * cos + north * sin,
    north * cos - east * sin,
  ];
}

// Fit the shared footprint frame: a PCA-aligned local ellipse (center, major /
// minor unit axes, semi-axes) plus the geo transform and terrain data every
// loop curve needs. Everything downstream is expressed in this frame.
function fitFootprint(route, config = {}) {
  const points = Array.isArray(route)
    ? route.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    : [];
  if (points.length < 2) return null;

  const origin = points[0];
  const cosLat = Math.cos(toRad(origin.lat)) || 1e-6;
  const toLocal = (point) => [
    (point.lng - origin.lng) * METERS_PER_DEGREE * cosLat,
    (point.lat - origin.lat) * METERS_PER_DEGREE,
  ];
  const toGeo = ([east, north, altitude]) => ({
    lat: origin.lat + north / METERS_PER_DEGREE,
    lng: origin.lng + east / (METERS_PER_DEGREE * cosLat),
    altitude,
  });

  const local = points.map(toLocal);
  const footprint = routeFootprint(local);
  if (!footprint) return null;

  const scale = Math.max(0.05, Number(config.ellipse_scale) || 0.8);
  const minSemiMajor = Math.max(1, Number(config.min_semi_major_meters) || 1000);
  const minSemiMinor = Math.max(1, Number(config.min_semi_minor_meters) || 500);
  const minTurnRadius = Math.max(0, Number(config.min_turn_radius_meters) || 0);

  let semiMajor = Math.max(footprint.halfMajor * scale, minSemiMajor);
  let semiMinor = Math.max(footprint.halfMinor * scale, minSemiMinor);
  if (semiMinor > semiMajor) [semiMajor, semiMinor] = [semiMinor, semiMajor];

  if (minTurnRadius > 0) {
    semiMajor = Math.max(semiMajor, minTurnRadius);
    semiMinor = Math.max(semiMinor, Math.sqrt(minTurnRadius * semiMajor));
    if (semiMinor > semiMajor) semiMajor = semiMinor;
  }

  const elevations = points.map((point) => Number(point.ele)).filter(Number.isFinite);
  const centerAltitude = elevations.length
    ? (Math.min(...elevations) + Math.max(...elevations)) / 2
    : 0;
  const highestTerrainAltitudeMeters = highestTerrainUnderEllipse(points, local, footprint, semiMajor, semiMinor);

  return { toGeo, footprint, semiMajor, semiMinor, minTurnRadius, centerAltitude, highestTerrainAltitudeMeters };
}

export function fitFlybyEllipse(route, config = {}) {
  const fit = fitFootprint(route, config);
  if (!fit) return null;
  const { footprint, semiMajor, semiMinor, toGeo } = fit;
  const { center, major, minor } = footprint;

  const pointAt = (theta) => ellipsePoint(theta, center, major, minor, semiMajor, semiMinor);
  const derivativeAt = (theta) => {
    const dMajor = -semiMajor * Math.sin(theta);
    const dMinor = semiMinor * Math.cos(theta);
    return [
      major[0] * dMajor + minor[0] * dMinor,
      major[1] * dMajor + minor[1] * dMinor,
    ];
  };
  const radiusAt = (theta) => {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    return ((semiMajor * semiMajor * s * s + semiMinor * semiMinor * c * c) ** 1.5) / (semiMajor * semiMinor);
  };

  const arc = buildArcLength(pointAt, config.sample_count);
  if (!arc) return null;

  return {
    center,
    centerAltitude: fit.centerAltitude,
    highestTerrainAltitudeMeters: fit.highestTerrainAltitudeMeters,
    major,
    minor,
    routeHalfMajor: footprint.halfMajor,
    routeHalfMinor: footprint.halfMinor,
    semiMajor,
    semiMinor,
    minTurnRadiusMeters: fit.minTurnRadius,
    actualMinTurnRadiusMeters: semiMinor * semiMinor / semiMajor,
    loopLength: arc.loopLength,
    toGeo,
    uAt: arc.uAt,
    pointAt,
    derivativeAt,
    radiusAt,
    pathAt: (altitude, sampleCount) => buildLoopPath(pointAt, toGeo, altitude, sampleCount),
  };
}

// A Gerono-style figure-eight (lemniscate) in the footprint frame: it sweeps
// the major axis with `cos(u)` and crosses the center twice per lap, its two
// lobes reaching the semi-minor extent via `sin(2u)`. Fitted to the exact same
// footprint frame as the ellipse so fly-by and fly-over share every setting.
export function fitFlyoverFigureEight(route, config = {}) {
  const fit = fitFootprint(route, config);
  if (!fit) return null;
  const { footprint, semiMajor: a, semiMinor: b, toGeo } = fit;
  const { center, major, minor } = footprint;

  const pointAt = (u) => {
    const along = a * Math.cos(u);
    const cross = b * Math.sin(2 * u);
    return [
      center[0] + major[0] * along + minor[0] * cross,
      center[1] + major[1] * along + minor[1] * cross,
    ];
  };
  const derivativeAt = (u) => {
    const dAlong = -a * Math.sin(u);
    const dCross = 2 * b * Math.cos(2 * u);
    return [
      major[0] * dAlong + minor[0] * dCross,
      major[1] * dAlong + minor[1] * dCross,
    ];
  };
  // First and second derivatives of the planar (along, cross) curve, shared by
  // the radius-of-curvature and signed-curvature helpers below.
  const planarDerivatives = (u) => ({
    x1: -a * Math.sin(u),
    y1: 2 * b * Math.cos(2 * u),
    x2: -a * Math.cos(u),
    y2: -4 * b * Math.sin(2 * u),
  });
  const radiusAt = (u) => {
    const { x1, y1, x2, y2 } = planarDerivatives(u);
    const numerator = (x1 * x1 + y1 * y1) ** 1.5;
    const denominator = Math.abs(x1 * y2 - y1 * x2);
    return denominator > 1e-9 ? numerator / denominator : Infinity;
  };
  // Signed curvature (CCW-positive), so the driver can tell which way the eight
  // is turning at each point — it flips sign between the two lobes and passes
  // through zero at the center crossings, where the path is momentarily straight.
  const signedCurvatureAt = (u) => {
    const { x1, y1, x2, y2 } = planarDerivatives(u);
    const denominator = (x1 * x1 + y1 * y1) ** 1.5;
    return denominator > 1e-9 ? (x1 * y2 - y1 * x2) / denominator : 0;
  };

  const arc = buildArcLength(pointAt, config.sample_count);
  if (!arc) return null;

  let minRadius = Infinity;
  for (let i = 0; i < 64; i++) minRadius = Math.min(minRadius, radiusAt((i / 64) * TWO_PI));

  return {
    center,
    centerAltitude: fit.centerAltitude,
    highestTerrainAltitudeMeters: fit.highestTerrainAltitudeMeters,
    major,
    minor,
    routeHalfMajor: footprint.halfMajor,
    routeHalfMinor: footprint.halfMinor,
    semiMajor: a,
    semiMinor: b,
    minTurnRadiusMeters: fit.minTurnRadius,
    actualMinTurnRadiusMeters: minRadius,
    loopLength: arc.loopLength,
    toGeo,
    uAt: arc.uAt,
    pointAt,
    derivativeAt,
    radiusAt,
    signedCurvatureAt,
    // The eight reverses its turn direction each lobe, so the flight tracks the
    // local turn for its bank and inward look instead of a fixed handedness.
    tracksTurnDirection: true,
    pathAt: (altitude, sampleCount) => buildLoopPath(pointAt, toGeo, altitude, sampleCount),
  };
}

// Cumulative arc-length table over one full parameter sweep, with an inverse
// map (arc-length → parameter u) so the flight advances at a constant ground
// speed regardless of how the parameter bunches along the curve.
function buildArcLength(pointAt, sampleCount) {
  const count = Math.max(64, Math.round(Number(sampleCount) || 360));
  const cumulative = [0];
  let previous = pointAt(0);
  for (let i = 1; i <= count; i++) {
    const u = (i / count) * TWO_PI;
    const current = pointAt(u);
    cumulative.push(cumulative[i - 1] + distance2(previous, current));
    previous = current;
  }
  const loopLength = cumulative[count];
  if (!(loopLength > 1)) return null;

  const uAt = (s) => {
    const target = wrap(s, loopLength);
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    const idx = Math.max(0, lo - 1);
    const seg = cumulative[idx + 1] - cumulative[idx] || 1e-9;
    return ((idx + (target - cumulative[idx]) / seg) / count) * TWO_PI;
  };

  return { loopLength, uAt };
}

function highestTerrainUnderEllipse(points, local, footprint, semiMajor, semiMinor) {
  let highestInside = -Infinity;
  let highestAny = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const ele = Number(points[i].ele);
    if (!Number.isFinite(ele)) continue;
    highestAny = Math.max(highestAny, ele);

    const de = local[i][0] - footprint.center[0];
    const dn = local[i][1] - footprint.center[1];
    const along = de * footprint.major[0] + dn * footprint.major[1];
    const cross = de * footprint.minor[0] + dn * footprint.minor[1];
    const normalized = (along / semiMajor) ** 2 + (cross / semiMinor) ** 2;
    if (normalized <= 1) highestInside = Math.max(highestInside, ele);
  }
  if (Number.isFinite(highestInside)) return highestInside;
  if (Number.isFinite(highestAny)) return highestAny;
  return 0;
}

function buildLoopPath(pointAt, toGeo, altitudeMeters, sampleCount) {
  const count = Math.max(12, Math.round(Number(sampleCount) || 240));
  const altitude = Number(altitudeMeters) || 0;
  const path = [];
  for (let i = 0; i <= count; i++) {
    const u = (i / count) * TWO_PI;
    const [east, north] = pointAt(u);
    path.push(toGeo([east, north, altitude]));
  }
  return path;
}

function routeFootprint(local) {
  let meanEast = 0;
  let meanNorth = 0;
  for (const [east, north] of local) {
    meanEast += east;
    meanNorth += north;
  }
  meanEast /= local.length;
  meanNorth /= local.length;

  let covEE = 0;
  let covNN = 0;
  let covEN = 0;
  for (const [east, north] of local) {
    const de = east - meanEast;
    const dn = north - meanNorth;
    covEE += de * de;
    covNN += dn * dn;
    covEN += de * dn;
  }
  const principalAngle = 0.5 * Math.atan2(2 * covEN, covEE - covNN);
  let major = [Math.cos(principalAngle), Math.sin(principalAngle)];
  if (major[0] < 0 || (Math.abs(major[0]) < 1e-9 && major[1] < 0)) {
    major = [-major[0], -major[1]];
  }
  const minor = [-major[1], major[0]];

  let minMajor = Infinity;
  let maxMajor = -Infinity;
  let minMinor = Infinity;
  let maxMinor = -Infinity;
  for (const [east, north] of local) {
    const along = east * major[0] + north * major[1];
    const cross = east * minor[0] + north * minor[1];
    minMajor = Math.min(minMajor, along);
    maxMajor = Math.max(maxMajor, along);
    minMinor = Math.min(minMinor, cross);
    maxMinor = Math.max(maxMinor, cross);
  }

  const halfMajor = (maxMajor - minMajor) / 2;
  const halfMinor = (maxMinor - minMinor) / 2;
  if (halfMajor < 5 && halfMinor < 5) return null;

  const centerAlong = (minMajor + maxMajor) / 2;
  const centerCross = (minMinor + maxMinor) / 2;
  return {
    center: [
      major[0] * centerAlong + minor[0] * centerCross,
      major[1] * centerAlong + minor[1] * centerCross,
    ],
    major,
    minor,
    halfMajor,
    halfMinor,
  };
}

function ellipsePoint(theta, center, major, minor, semiMajor, semiMinor) {
  return [
    center[0] + major[0] * semiMajor * Math.cos(theta) + minor[0] * semiMinor * Math.sin(theta),
    center[1] + major[1] * semiMajor * Math.cos(theta) + minor[1] * semiMinor * Math.sin(theta),
  ];
}

function distance2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function wrap(value, span) {
  if (!(span > 0)) return 0;
  return ((value % span) + span) % span;
}

function toRad(value) {
  return value * Math.PI / 180;
}

function toDeg(value) {
  return value * 180 / Math.PI;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
