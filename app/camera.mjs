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

// The camera eye position. Map3DElement only exposes the look-at center plus
// range/tilt/heading, so the eye is reconstructed from those: it sits `range`
// away from the center, pulled back along the opposite heading and lifted by
// the tilt.
export function cameraEyePosition({ center, range, tilt, heading }) {
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
  return {
    ...eyeGround,
    altitude: (Number(center?.altitude) || 0) + safeRange * Math.cos(toRad(safeTilt)),
  };
}

// Lift the camera eye by `liftMeters` while keeping the same range, by tilting
// toward overhead — the view stays locked on the rider, the eye rises and
// tucks in over whatever terrain was in the way. If the tilt limit cannot
// deliver the full lift, the remainder is reported as extra look-at altitude
// (which raises eye and center together when applied).
export function applyCameraLift({ tiltDegrees, rangeMeters, liftMeters, minTiltDegrees = 5 }) {
  const tilt = clamp(Number(tiltDegrees) || 0, MIN_3D_CAMERA_TILT_DEGREES, MAX_3D_CAMERA_TILT_DEGREES);
  const range = Math.max(1, Number(rangeMeters) || 0);
  const lift = Math.max(0, Number(liftMeters) || 0);
  if (lift === 0) return { tilt, extraCenterAltitude: 0 };

  const minTilt = clamp(Number(minTiltDegrees) || MIN_3D_CAMERA_TILT_DEGREES, MIN_3D_CAMERA_TILT_DEGREES, tilt);
  const desiredEyeHeight = range * Math.cos(toRad(tilt)) + lift;
  const liftedCos = Math.min(desiredEyeHeight / range, Math.cos(toRad(minTilt)));
  return {
    tilt: clamp(Math.acos(liftedCos) * 180 / Math.PI, minTilt, tilt),
    extraCenterAltitude: Math.max(0, desiredEyeHeight - range * liftedCos),
  };
}

// Frame the whole route from a 45-degree side view. The framing axis is the
// route's *principal axis of horizontal spread* (PCA over every point), not
// the straight start→end line: that keeps loops, lollipops, out-and-backs and
// any route whose endpoints sit close together framed along their real long
// dimension instead of collapsing onto a near-zero, arbitrary start→end axis
// (the old fallback — aim at the point furthest from the start — could face
// the camera almost anywhere for a loop). The long axis becomes the
// screen-horizontal, and the camera looks at the route from whichever side
// leaves the point furthest from that axis away from the viewer. A straight
// (or symmetric) route defaults to looking from the south side of the axis
// direction — start on the left, end on the right.
export function computeRouteOverviewCamera(route, {
  tiltDegrees = 45,
  // Rotates the whole overview around the route. 0 uses the auto-picked side
  // (far side away, start-left/end-right); 180 views from the exact opposite
  // side with the long axis still horizontal; any other value swings the
  // azimuth freely (the route reads diagonally, but the range fit below still
  // frames every point). Added on top of the auto side choice, so 180 always
  // means "the other side" regardless of which side the algorithm picked.
  headingOffsetDegrees = 0,
  viewportAspect = 16 / 9,
  // Map3DElement renders with a 35° field of view by default (its `fov`
  // property). The docs don't say which axis that measures, so the fit
  // conservatively applies it to the larger viewport dimension — the route
  // stays whole under either reading, at worst slightly smaller.
  fovDegrees = 35,
  marginFactor = 1.3,
  // Multiplier applied to the fitted range. 1 frames the whole route exactly;
  // below 1 pulls the camera closer (route edges crop, but terrain relief
  // reads much better at a low tilt); above 1 pushes it further out.
  rangeFactor = 1,
  minRangeMeters = 250,
  // Upper bound on the range. The whole-route fit can be many km out on a long
  // route, which flattens terrain and makes a low tilt pointless; capping the
  // range keeps the view closer at the cost of not framing the whole route.
  maxRangeMeters = Infinity,
} = {}) {
  if (!Array.isArray(route) || route.length < 2) return null;

  const start = route[0];
  const end = route[route.length - 1];

  // Principal axis of the route's ground footprint. Working in local
  // equirectangular units around `start` (longitude scaled by cos(lat) so east
  // and north share a scale — the axis angle is scale-invariant), the
  // covariance of the points about their centroid gives the direction of
  // greatest spread. Unlike start→end, this is stable wherever the endpoints
  // fall on the route, which is what lets loops frame along their real extent.
  const cosLat = Math.cos(toRad(start.lat)) || 1e-6;
  const local = route.map((point) => [(point.lng - start.lng) * cosLat, point.lat - start.lat]);
  let meanEast = 0;
  let meanNorth = 0;
  for (const [e, n] of local) { meanEast += e; meanNorth += n; }
  meanEast /= local.length;
  meanNorth /= local.length;
  let covEE = 0;
  let covNN = 0;
  let covEN = 0;
  for (const [e, n] of local) {
    const de = e - meanEast;
    const dn = n - meanNorth;
    covEE += de * de;
    covNN += dn * dn;
    covEN += de * dn;
  }
  const principalAngle = 0.5 * Math.atan2(2 * covEN, covEE - covNN);
  let majorEast = Math.cos(principalAngle);
  let majorNorth = Math.sin(principalAngle);

  // Orient the axis so the route generally progresses start→end along it,
  // which reads start-on-the-left, end-on-the-right for open routes. When the
  // endpoints coincide (a loop or out-and-back has no progression direction)
  // fall back to pointing the axis eastward, so a symmetric route still
  // defaults to a north-up view. (The axis *direction* only decides this
  // reading; the far-side-away side choice below is independent of it.)
  const progEast = (end.lng - start.lng) * cosLat;
  const progNorth = end.lat - start.lat;
  const progAlongAxis = progEast * majorEast + progNorth * majorNorth;
  const flip = Math.abs(progAlongAxis) > 1e-9 ? progAlongAxis < 0 : majorEast < 0;
  if (flip) { majorEast = -majorEast; majorNorth = -majorNorth; }
  const axisBearing = normalizeHeading(Math.atan2(majorEast, majorNorth) * 180 / Math.PI);

  let minAlong = 0;
  let maxAlong = 0;
  let minCross = 0;
  let maxCross = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const point of route) {
    const distance = haversine(start, point);
    const angle = toRad(bearing(start, point) - axisBearing);
    const along = distance * Math.cos(angle);
    const cross = distance * Math.sin(angle);
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minCross = Math.min(minCross, cross);
    maxCross = Math.max(maxCross, cross);
    const ele = Number(point.ele) || 0;
    minEle = Math.min(minEle, ele);
    maxEle = Math.max(maxEle, ele);
  }

  // No usable footprint — every point sits on essentially the same spot, so
  // there is nothing to frame.
  if ((maxAlong - minAlong) < 10 && (maxCross - minCross) < 10) return null;

  // Positive cross is to the right of the axis. Looking toward the side that
  // reaches further puts that side away from the viewer. The deadband keeps
  // near-straight and near-symmetric routes on the default left side — which
  // reads start-on-the-left, end-on-the-right — instead of flipping the whole
  // view over a few meters of bulge.
  const sideDeadband = Math.max(20, (maxAlong - minAlong) * 0.02);
  const sideSign = maxCross > -minCross + sideDeadband ? 1 : -1;
  const heading = normalizeHeading(axisBearing + 90 * sideSign + (Number(headingOffsetDegrees) || 0));

  const centerOnAxis = destinationPoint(start, axisBearing, (minAlong + maxAlong) / 2);
  const center = destinationPoint(centerOnAxis, normalizeHeading(axisBearing + 90), (minCross + maxCross) / 2);

  const tilt = clamp(Number(tiltDegrees) || 45, MIN_3D_CAMERA_TILT_DEGREES, MAX_3D_CAMERA_TILT_DEGREES);
  const centerAltitude = (minEle + maxEle) / 2;

  // Fit the range exactly: project every route point through the actual
  // camera frustum and binary-search the smallest range where they all land
  // inside it, shrunk by the margin. The straightforward extent/FOV formula
  // undershoots because the route's near edge sits closer to the eye than
  // the look-at center and so subtends a wider angle.
  const tanLarge = Math.tan(toRad(clamp(Number(fovDegrees) || 35, 5, 80) / 2));
  const aspect = Math.max(0.1, Number(viewportAspect) || 16 / 9);
  const margin = Math.max(1, Number(marginFactor) || 1);
  const limitX = (aspect >= 1 ? tanLarge : tanLarge * aspect) / margin;
  const limitY = (aspect >= 1 ? tanLarge / aspect : tanLarge) / margin;

  // Everything below works in flat [east, north, up] meters around the
  // look-at center — plenty accurate for framing. The eye moves along a
  // fixed unit direction as the range grows, so the camera basis vectors
  // are computed once.
  const points = route.map((point) => {
    const distance = haversine(center, point);
    const pointBearing = toRad(bearing(center, point));
    return [
      distance * Math.sin(pointBearing),
      distance * Math.cos(pointBearing),
      (Number(point.ele) || 0) - centerAltitude,
    ];
  });
  const backBearing = toRad(heading + 180);
  const sinTilt = Math.sin(toRad(tilt));
  const eyeDirection = [Math.sin(backBearing) * sinTilt, Math.cos(backBearing) * sinTilt, Math.cos(toRad(tilt))];
  const forward = eyeDirection.map((c) => -c);
  const flat = Math.hypot(forward[0], forward[1]);
  const rightAxis = [forward[1] / flat, -forward[0] / flat, 0];
  const upAxis = [
    rightAxis[1] * forward[2] - rightAxis[2] * forward[1],
    rightAxis[2] * forward[0] - rightAxis[0] * forward[2],
    rightAxis[0] * forward[1] - rightAxis[1] * forward[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const fitsAtRange = (range) => points.every((point) => {
    const v = [
      point[0] - eyeDirection[0] * range,
      point[1] - eyeDirection[1] * range,
      point[2] - eyeDirection[2] * range,
    ];
    const depth = dot(v, forward);
    if (depth <= 1) return false;
    return Math.abs(dot(v, rightAxis)) <= depth * limitX && Math.abs(dot(v, upAxis)) <= depth * limitY;
  });

  let high = Math.max(minRangeMeters, 1);
  while (!fitsAtRange(high) && high < 2e7) high *= 2;
  let low = high / 2;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (fitsAtRange(middle)) high = middle;
    else low = middle;
  }

  // The fitted range frames the whole route; the factor then zooms in/out and
  // the bounds cap the result. minRangeMeters wins over maxRangeMeters if they
  // cross (a bad config shouldn't invert the range).
  const fittedRange = Math.max(minRangeMeters, high);
  const scaledRange = fittedRange * Math.max(0.01, Number(rangeFactor) || 1);
  const upperBound = Math.max(minRangeMeters, Number(maxRangeMeters) || Infinity);
  return {
    center: { lat: center.lat, lng: center.lng, altitude: centerAltitude },
    heading,
    tilt,
    range: clamp(scaledRange, minRangeMeters, upperBound),
  };
}

// "Arrive" steering for the camera: accelerate toward the target, then brake
// along the sqrt(2·a·d) curve so the motion ends on the target, never
// exceeding maxAcceleration. Close targets are approached slowly, distant
// ones at speed — the camera moves like a physical object flying to its
// goal. position/velocity/target are [x, y, z] in meters of any local frame.
export function chaseStep({ position, velocity, target, maxAcceleration, maxSpeed = Infinity, dt }) {
  const dtSafe = clamp(Number(dt) || 0, 0.001, 0.5);
  const accel = Math.max(0.01, Number(maxAcceleration) || 0);
  const delta = target.map((value, i) => value - position[i]);
  const distance = Math.hypot(...delta);

  // Approach speed follows the braking curve; the distance/dt term keeps a
  // single frame from stepping past the target.
  const desiredSpeed = Math.min(maxSpeed, Math.sqrt(2 * accel * distance), distance / dtSafe);
  const desired = distance > 1e-9 ? delta.map((value) => (value / distance) * desiredSpeed) : [0, 0, 0];

  const steering = desired.map((value, i) => value - velocity[i]);
  const steeringMagnitude = Math.hypot(...steering);
  const steeringLimit = accel * dtSafe;
  const scale = steeringMagnitude > steeringLimit ? steeringLimit / steeringMagnitude : 1;
  const nextVelocity = velocity.map((value, i) => value + steering[i] * scale);
  const nextPosition = position.map((value, i) => value + nextVelocity[i] * dtSafe);

  const remaining = Math.hypot(...target.map((value, i) => value - nextPosition[i]));
  if (remaining < 0.05 && Math.hypot(...nextVelocity) < steeringLimit) {
    return { position: [...target], velocity: [0, 0, 0], settled: true };
  }
  return { position: nextPosition, velocity: nextVelocity, settled: false };
}

// Distance-scaled tuning for chaseStep: gentle acceleration when the camera
// is near its target (steady follow tracking behind the rider), scaling up
// with distance so transition flights — overview down to the rider, long
// seeks — cross fast instead of dragging. The braking margin keeps the
// speed cap below what the shrinking acceleration allowance can still brake,
// so flights arrive without overshooting.
export function chaseTuning(distanceMeters, {
  minAcceleration = 60,
  accelerationPerMeter = 1.2,
  maxAcceleration = 20000,
  brakingMargin = 0.7,
} = {}) {
  const distance = Math.max(0, Number(distanceMeters) || 0);
  const acceleration = clamp(
    minAcceleration + distance * accelerationPerMeter,
    minAcceleration,
    Math.max(minAcceleration, maxAcceleration),
  );
  return { acceleration, maxSpeed: Math.sqrt(brakingMargin * acceleration * distance) };
}

// Rebuild the map camera parameters from an eye and look-at pair — the
// inverse of cameraEyePosition. Nearly-overhead poses keep the caller's
// fallback heading, since the bearing degenerates there.
export function cameraFromEyeAndCenter(eye, center, fallbackHeading = 0) {
  const standoff = haversine(eye, center);
  const height = (Number(eye.altitude) || 0) - (Number(center.altitude) || 0);
  return {
    heading: standoff < 0.5 ? normalizeHeading(fallbackHeading) : normalizeHeading(bearing(eye, center)),
    range: Math.max(1, Math.hypot(standoff, height)),
    tilt: clamp(
      Math.atan2(standoff, Math.max(height, 1e-6)) * 180 / Math.PI,
      MIN_3D_CAMERA_TILT_DEGREES,
      MAX_3D_CAMERA_TILT_DEGREES,
    ),
  };
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
