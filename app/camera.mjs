const MIN_3D_CAMERA_RANGE_METERS = 35;
const MIN_3D_CAMERA_TILT_DEGREES = 1;
const MAX_3D_CAMERA_TILT_DEGREES = 89;
const EARTH_RADIUS_METERS = 6371000;

export function computeFollowCamera({
  riderPosition,
  heading,
  headingOffsetDegrees = 0,
  cameraOffsetForwardMeters = 0,
  cameraOffsetRightMeters = 0,
  cameraZoom,
  cameraBehindMeters,
  cameraAngleDegrees,
}) {
  const safeZoom = Math.max(0.1, Number(cameraZoom) || 1);
  const safeBehind = Math.max(0, Number(cameraBehindMeters) || 0);
  const tilt = clamp(Number(cameraAngleDegrees) || 0, MIN_3D_CAMERA_TILT_DEGREES, MAX_3D_CAMERA_TILT_DEGREES);

  return {
    center: applyCameraOffset(riderPosition, heading, cameraOffsetForwardMeters, cameraOffsetRightMeters),
    heading: normalizeHeading(heading + headingOffsetDegrees),
    range: Math.max(MIN_3D_CAMERA_RANGE_METERS, rangeForBehind(safeBehind, tilt) / safeZoom),
    tilt,
  };
}

export function rangeForBehind(behindMeters, tiltDegrees) {
  if (behindMeters <= 0) return MIN_3D_CAMERA_RANGE_METERS;
  const sinTilt = Math.sin(toRad(clamp(tiltDegrees, MIN_3D_CAMERA_TILT_DEGREES, MAX_3D_CAMERA_TILT_DEGREES)));
  return behindMeters / Math.max(0.01, sinTilt);
}

export function normalizeHeading(angle) {
  return ((angle % 360) + 360) % 360;
}

export function signedHeadingDelta(fromHeading, toHeading) {
  return ((normalizeHeading(toHeading) - normalizeHeading(fromHeading) + 540) % 360) - 180;
}

export function applyCameraOffset(position, routeHeading, forwardMeters, rightMeters) {
  const forward = Number(forwardMeters) || 0;
  const right = Number(rightMeters) || 0;
  const distance = Math.hypot(forward, right);
  if (distance < 0.01) return position;

  const offsetAngle = Math.atan2(right, forward) * 180 / Math.PI;
  return destinationPoint(position, normalizeHeading(routeHeading + offsetAngle), distance);
}

// Distance from the camera eye to a point on the ground. Map3DElement only
// exposes the look-at center plus range/tilt/heading, so the eye position is
// reconstructed from those: it sits `range` away from the center, pulled back
// along the opposite heading and lifted by the tilt.
export function cameraDistanceToPoint({ center, range, tilt, heading }, point) {
  const safeRange = Number(range);
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(safeRange) || safeRange <= 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const safeTilt = clamp(Number(tilt) || 0, 0, MAX_3D_CAMERA_TILT_DEGREES);
  const horizontalStandoff = safeRange * Math.sin(toRad(safeTilt));
  const eyeGround = destinationPoint(
    { lat, lng },
    normalizeHeading((Number(heading) || 0) + 180),
    horizontalStandoff,
  );
  const eyeAltitude = (Number(center?.altitude) || 0) + safeRange * Math.cos(toRad(safeTilt));

  const horizontalDistance = haversine(eyeGround, point);
  const verticalDistance = eyeAltitude - (Number(point.ele) || 0);
  return Math.hypot(horizontalDistance, verticalDistance);
}

export function measureCameraOffset(riderPosition, centerPosition, routeHeading) {
  const distance = haversine(riderPosition, centerPosition);
  if (distance < 0.01) return { forwardMeters: 0, rightMeters: 0 };

  const delta = signedHeadingDelta(routeHeading, bearing(riderPosition, centerPosition));
  return {
    forwardMeters: Math.cos(toRad(delta)) * distance,
    rightMeters: Math.sin(toRad(delta)) * distance,
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function destinationPoint(position, bearingDegrees, distanceMeters) {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRadians = toRad(bearingDegrees);
  const lat1 = toRad(position.lat);
  const lng1 = toRad(position.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: ((lng2 * 180 / Math.PI + 540) % 360) - 180,
  };
}

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x) * 180 / Math.PI;
}

function toRad(value) {
  return value * Math.PI / 180;
}
