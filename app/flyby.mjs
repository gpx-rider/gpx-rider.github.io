// Ellipse-based overview flyby.
//
// The camera flies a configurable ellipse around the route footprint and looks
// along its direction of travel. The route does not have to fit inside the
// ellipse: ellipseScale intentionally lets the flight path cut inside the route
// bounds, while altitude/pitch/FOV determine what remains visible from the air.
//
// Map3DElement supports roll, so the driver returns a bank angle for app.js to
// apply directly to the camera while flying.

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE = EARTH_RADIUS_METERS * Math.PI / 180;
const TWO_PI = Math.PI * 2;

export function createEllipseFlyby(route, config = {}) {
  const ellipse = fitFlybyEllipse(route, config);
  if (!ellipse) return null;

  const maxSpeedMps = Math.max(0.1, Number(config.maxSpeedMps ?? config.speedMps) || 70);
  const targetLapSeconds = Math.max(1, Number(config.secondsPerLap) || 60);
  const speedMps = Math.min(maxSpeedMps, ellipse.loopLength / targetLapSeconds);
  const flyHeightMin = Math.max(1, Number(config.flyHeightMetersMin ?? config.flyHeightMeters) || 1000);
  const terrainClearanceMin = Math.max(0, Number(config.flyHeightMetersAboveTerrainMin) || 0);
  const flyHeight = Math.max(
    flyHeightMin,
    ellipse.highestTerrainAltitudeMeters + terrainClearanceMin - ellipse.centerAltitude,
  );
  const viewDistance = Math.max(1, Number(config.viewDistanceMeters) || 2500);
  const cameraFovDegrees = clamp(Number(config.cameraFovDegrees) || 35, 5, 80);
  const mountPitch = toRad(clamp(Number(config.mountPitchDegrees) || 28, 1, 89));
  const inwardLook = toRad(clamp(Number(config.inwardLookDegrees) || 0, 0, 89));
  const maxBankDegrees = Math.max(0, Number(config.maxBankDegrees) || 0);
  const minTurnRadius = Math.max(0, Number(config.minTurnRadiusMeters) || 0);
  const direction = Number(config.direction) < 0 ? -1 : 1;
  const startAngle = toRad(Number(config.startAngleDegrees) || 0);

  const travelSign = direction > 0 ? -1 : 1;
  const lapSeconds = ellipse.loopLength / speedMps;

  function angleAt(s) {
    return startAngle + travelSign * ellipse.uAt(s);
  }

  function localAt(s) {
    const theta = angleAt(s);
    return ellipse.pointAtAngle(theta);
  }

  function tangentAt(s) {
    const theta = angleAt(s);
    const tangent = ellipse.tangentAtAngle(theta, travelSign);
    const len = Math.hypot(tangent[0], tangent[1]) || 1;
    return [tangent[0] / len, tangent[1] / len];
  }

  function radiusAt(s) {
    return ellipse.radiusAtAngle(angleAt(s));
  }

  function bankAt(s) {
    if (!(minTurnRadius > 0) || maxBankDegrees <= 0) return 0;
    const magnitude = maxBankDegrees * clamp(minTurnRadius / Math.max(radiusAt(s), 1), 0, 1);
    return direction * magnitude;
  }

  return {
    ellipse,
    loopLength: ellipse.loopLength,
    lapSeconds,
    targetLapSeconds,
    maxSpeedMps,
    speedAt() {
      return speedMps;
    },
    radiusAt,
    bankAt,
    flyHeightMeters: flyHeight,
    terrainClearanceMeters: flyHeight + ellipse.centerAltitude - ellipse.highestTerrainAltitudeMeters,
    cameraFovDegrees,
    inwardLookDegrees: toDeg(inwardLook),
    pathAtAltitude(altitudeMeters = 0, sampleCount = 240) {
      return ellipsePath(ellipse, altitudeMeters, sampleCount);
    },
    positionAt: localAt,
    advance(s, dtSeconds) {
      const dt = clamp(Number(dtSeconds) || 0, 0, 0.5);
      return wrap((Number(s) || 0) + speedMps * dt, ellipse.loopLength);
    },
    frameAt(s) {
      const here = localAt(s);
      const tangent = rotateHorizontalRight(tangentAt(s), inwardLook * direction);
      const eyeAltitude = ellipse.centerAltitude + flyHeight;
      const eye = ellipse.toGeo([here[0], here[1], eyeAltitude]);

      const cosE = Math.cos(-mountPitch);
      const sinE = Math.sin(-mountPitch);
      const lookAt = ellipse.toGeo([
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
        terrainClearanceMeters: flyHeight + ellipse.centerAltitude - ellipse.highestTerrainAltitudeMeters,
        highestTerrainAltitudeMeters: ellipse.highestTerrainAltitudeMeters,
        cameraFovDegrees,
        inwardLookDegrees: toDeg(inwardLook),
        turnRadiusMeters: radiusAt(s),
        bankDegrees: bankAt(s),
      };
    },
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

export function fitFlybyEllipse(route, config = {}) {
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

  const scale = Math.max(0.05, Number(config.ellipseScale) || 0.8);
  const minSemiMajor = Math.max(1, Number(config.minSemiMajorMeters) || 1000);
  const minSemiMinor = Math.max(1, Number(config.minSemiMinorMeters) || 500);
  const minTurnRadius = Math.max(0, Number(config.minTurnRadiusMeters) || 0);

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

  const sampleCount = Math.max(64, Math.round(Number(config.sampleCount) || 360));
  const cumulative = [0];
  let previous = ellipsePoint(0, footprint.center, footprint.major, footprint.minor, semiMajor, semiMinor);
  for (let i = 1; i <= sampleCount; i++) {
    const u = (i / sampleCount) * TWO_PI;
    const current = ellipsePoint(u, footprint.center, footprint.major, footprint.minor, semiMajor, semiMinor);
    cumulative.push(cumulative[i - 1] + distance2(previous, current));
    previous = current;
  }
  const loopLength = cumulative[sampleCount];
  if (!(loopLength > 1)) return null;

  const uAt = (s) => {
    const target = wrap(s, loopLength);
    let lo = 0;
    let hi = sampleCount;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    const idx = Math.max(0, lo - 1);
    const seg = cumulative[idx + 1] - cumulative[idx] || 1e-9;
    return ((idx + (target - cumulative[idx]) / seg) / sampleCount) * TWO_PI;
  };

  return {
    center: footprint.center,
    centerAltitude,
    highestTerrainAltitudeMeters,
    major: footprint.major,
    minor: footprint.minor,
    routeHalfMajor: footprint.halfMajor,
    routeHalfMinor: footprint.halfMinor,
    semiMajor,
    semiMinor,
    minTurnRadiusMeters: minTurnRadius,
    actualMinTurnRadiusMeters: semiMinor * semiMinor / semiMajor,
    loopLength,
    toGeo,
    uAt,
    pointAtAngle(theta) {
      return ellipsePoint(theta, footprint.center, footprint.major, footprint.minor, semiMajor, semiMinor);
    },
    tangentAtAngle(theta, travelSign = 1) {
      const dMajor = -semiMajor * Math.sin(theta) * travelSign;
      const dMinor = semiMinor * Math.cos(theta) * travelSign;
      return [
        footprint.major[0] * dMajor + footprint.minor[0] * dMinor,
        footprint.major[1] * dMajor + footprint.minor[1] * dMinor,
      ];
    },
    radiusAtAngle(theta) {
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      return ((semiMajor * semiMajor * s * s + semiMinor * semiMinor * c * c) ** 1.5) / (semiMajor * semiMinor);
    },
  };
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

function ellipsePath(ellipse, altitudeMeters, sampleCount) {
  const count = Math.max(12, Math.round(Number(sampleCount) || 240));
  const altitude = Number(altitudeMeters) || 0;
  const path = [];
  for (let i = 0; i <= count; i++) {
    const theta = (i / count) * TWO_PI;
    const [east, north] = ellipse.pointAtAngle(theta);
    path.push(ellipse.toGeo([east, north, altitude]));
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
