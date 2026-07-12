// Follow-camera driver: computes the camera target behind the rider (or the
// first-person eye), chases every camera move with bounded acceleration
// (pure math in camera.mjs), lifts the camera over terrain, and captures
// manual drags back into the follow-camera settings.

import {
  applyCameraLift,
  cameraEyePosition,
  cameraFromEyeAndCenter,
  chaseStep,
  chaseTuning,
  computeFollowCamera,
  measureCameraOffset,
  normalizeHeading,
  pickVisibilityNudge,
  rangeForBehind,
  signedHeadingDelta,
} from "./camera.mjs";
import {
  isFirstPersonCameraView,
  syncCameraControls,
  syncOverviewControls,
  updateCameraSettingsLabels,
} from "./camera-ui.mjs";
import { updateGalleryMetadataExport } from "../gallery-ui/gallery-export.mjs";
import { bearing, clamp, destinationPoint, haversine, lerp, toRad } from "../core/geo.mjs";
import { clearOverviewAnimation } from "./overview-camera.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import {
  interpolateRoutePoint,
  maxElevationNear,
  routeTotalDistance,
} from "../route/route.mjs";
import { updateRiderDot } from "../map/route-render.mjs";
import { terrainElevationAt } from "../map/terrain-tiles.mjs";
import { state } from "../core/state.mjs";
import {
  CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
  CAMERA_PAN_LIMIT_METERS,
  CAMERA_TILT_MAX,
  CAMERA_TILT_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  DEFAULT_MAP_FOV_DEGREES,
  FIRST_PERSON_LOOK_AHEAD_METERS,
  HEADING_SAMPLE_METERS,
  INTERACTION_SETTLE_MS,
  RIDER_VISIBILITY_FALL_TAU_SECONDS,
  RIDER_VISIBILITY_MAX_NUDGE_DEGREES,
  RIDER_VISIBILITY_RAY_SAMPLES,
  RIDER_VISIBILITY_RECOMPUTE_MS,
  RIDER_VISIBILITY_RISE_TAU_SECONDS,
  RIDER_VISIBILITY_STEP_DEGREES,
  TERRAIN_LIFT_FALL_TAU_SECONDS,
  TERRAIN_LIFT_RECOMPUTE_MS,
  TERRAIN_LIFT_RISE_TAU_SECONDS,
  TERRAIN_SAMPLE_RADIUS_METERS,
} from "../core/tuning.mjs";

export function updateMapCamera() {
  if (state.mapProvider !== "google3d" || !state.route.length || !state.map) return;
  if (state.userInteracting || state.cameraMode === "manual") return;
  // An animated overview (orbit / fly-by / fly-over) or a transition-arc
  // flight writes the camera directly every frame from its own loop; the
  // chase flight must yield or the two fight. This matters when the overview
  // is kept up while riding — the movement loop would otherwise call
  // stepCameraFlight here every tick.
  if (state.overviewAnim || state.cameraTransition) return;

  const settled = stepCameraFlight(performance.now());
  // While the rider moves, the movement loop calls this every frame; when
  // nothing else ticks, the flight loop keeps an unfinished move animating.
  if (!settled && !state.movementLoopActive) ensureCameraFlightLoop();
}

// The camera the flight is heading for: the whole-route overview after a
// load, otherwise the configured follow camera behind the rider.
function cameraFlightTarget() {
  if (state.cameraMode === "overview") {
    const overview = state.overviewCamera;
    if (!overview) return null;
    const eye = cameraEyePosition(overview);
    return eye ? { eye, center: overview.center, heading: overview.heading } : null;
  }
  return followCameraTarget();
}

function followCameraTarget() {
  return followCameraTargetAt(state.progressMeters);
}

// The configured follow camera (or first-person eye) at an arbitrary route
// progress — the transition arc asks for the pose where the rider *will* be.
// Terrain lift is stateful time-based smoothing, so predicted targets skip it
// (the chase re-applies it once it takes over from a docked transition).
export function followCameraTargetAt(progressMeters, { terrainLift = true } = {}) {
  const position = interpolateRoutePoint(state.route, progressMeters);
  const heading = currentRouteHeading(progressMeters);
  if (isFirstPersonCameraView()) {
    return firstPersonCameraTarget(position, heading);
  }

  const camera = computeFollowCamera({
    riderPosition: position,
    heading,
    headingOffsetDegrees: state.cameraHeadingOffsetDegrees,
    cameraOffsetForwardMeters: state.cameraOffsetForwardMeters,
    cameraOffsetRightMeters: state.cameraOffsetRightMeters,
    cameraZoom: state.cameraZoom,
    cameraBehindMeters: state.cameraBehindMeters,
    cameraAngleDegrees: state.cameraAngleDegrees,
  });

  // The look-at point must sit on the actual terrain: Map3D altitudes are
  // absolute, so a fixed value ends up underground in the mountains and every
  // range/tilt Google reports back is measured against that buried point.
  const groundAltitude = Number(position.ele) || 0;
  const centerAltitude = Math.max(0, groundAltitude + state.cameraCenterAltitudeOffsetMeters);

  let tilt = camera.tilt;
  let liftedCenterAltitude = centerAltitude;
  const liftMeters = terrainLift ? currentTerrainLift(camera, centerAltitude) : 0;
  if (liftMeters > 0) {
    const lifted = applyCameraLift({
      tiltDegrees: camera.tilt,
      rangeMeters: camera.range,
      liftMeters,
    });
    tilt = lifted.tilt;
    liftedCenterAltitude = centerAltitude + lifted.extraCenterAltitude;
  }

  // Even above terrain, a hill between the (lifted) eye and the rider hides the
  // rider; swing the camera the least distance around the rider to see past it.
  // Skipped for predicted targets (terrainLift off), which must be free of the
  // stateful smoothing the live chase re-applies once it takes over.
  const nudgeDegrees = terrainLift ? currentVisibilityNudge(camera, liftedCenterAltitude, tilt) : 0;
  const nudgedHeading = normalizeHeading(camera.heading + nudgeDegrees);

  const center = { lat: camera.center.lat, lng: camera.center.lng, altitude: liftedCenterAltitude };
  const eye = cameraEyePosition({ center, range: camera.range, tilt, heading: nudgedHeading });
  return eye ? { eye, center, heading: nudgedHeading } : null;
}

function firstPersonCameraTarget(position, heading) {
  const eyeAltitude = Math.max(0, (Number(position.ele) || 0) + state.firstPersonCameraHeightMeters);
  const centerGround = destinationPoint(position, heading, FIRST_PERSON_LOOK_AHEAD_METERS);
  return {
    eye: { lat: position.lat, lng: position.lng, altitude: eyeAltitude },
    center: { ...centerGround, altitude: eyeAltitude },
    heading: normalizeHeading(heading),
  };
}

// Advance the camera flight one step: chase the target's eye and look-at
// points with bounded acceleration (chaseStep), then write the map camera
// re-derived from the chased pair. Returns true once the flight has settled
// on its target.
function stepCameraFlight(now) {
  const target = cameraFlightTarget();
  if (!target) return true;

  if (!state.cameraFlight) {
    const pose = currentMapCameraPose();
    state.cameraFlight = {
      eye: pose?.eye ?? { ...target.eye },
      center: pose?.center ?? { ...target.center },
      eyeVelocity: [0, 0, 0],
      centerVelocity: [0, 0, 0],
      lastStepMs: now,
    };
  }

  const flight = state.cameraFlight;
  const dt = clamp((now - flight.lastStepMs) / 1000, 0, 0.5);
  flight.lastStepMs = now;

  let settled = false;
  if (dt > 0) {
    const eyeStep = chaseGeoPoint(flight.eye, flight.eyeVelocity, target.eye, dt);
    const centerStep = chaseGeoPoint(flight.center, flight.centerVelocity, target.center, dt);
    flight.eye = eyeStep.point;
    flight.eyeVelocity = eyeStep.velocity;
    flight.center = centerStep.point;
    flight.centerVelocity = centerStep.velocity;
    settled = eyeStep.settled && centerStep.settled;
  }

  const camera = cameraFromEyeAndCenter(flight.eye, flight.center, target.heading);
  state.map.center = { ...flight.center };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
  state.map.roll = 0;
  state.map.fov = DEFAULT_MAP_FOV_DEGREES;
  updateGalleryMetadataExport();
  return settled;
}

// Chase one geo point toward its target in a local north/east/up meter
// frame; the velocity array persists across frames in that same frame.
function chaseGeoPoint(current, velocity, target, dt) {
  const horizontal = haversine(current, target);
  const towardTarget = toRad(bearing(current, target));
  const up = (Number(target.altitude) || 0) - (Number(current.altitude) || 0);
  const tuning = chaseTuning(Math.hypot(horizontal, up));
  const step = chaseStep({
    position: [0, 0, 0],
    velocity,
    target: [
      horizontal * Math.cos(towardTarget),
      horizontal * Math.sin(towardTarget),
      up,
    ],
    maxAcceleration: tuning.acceleration,
    maxSpeed: tuning.maxSpeed,
    dt,
  });

  const [north, east, lifted] = step.position;
  const moved = Math.hypot(north, east);
  const ground = moved > 0.001
    ? destinationPoint(current, Math.atan2(east, north) * 180 / Math.PI, moved)
    : { lat: current.lat, lng: current.lng };
  return {
    point: { ...ground, altitude: (Number(current.altitude) || 0) + lifted },
    velocity: step.velocity,
    settled: step.settled,
  };
}

export function currentMapCameraPose() {
  const center = state.map?.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const range = Number(state.map?.range);
  const tilt = Number(state.map?.tilt);
  const heading = Number(state.map?.heading);
  const roll = Number(state.map?.roll);
  const fov = Number(state.map?.fov);
  if (![lat, lng, range, tilt, heading].every(Number.isFinite)) return null;

  const centerPoint = { lat, lng, altitude: Number(center?.altitude) || 0 };
  const eye = cameraEyePosition({ center: centerPoint, range, tilt, heading });
  return eye ? {
    eye,
    center: centerPoint,
    roll: Number.isFinite(roll) ? roll : 0,
    fov: Number.isFinite(fov) ? fov : DEFAULT_MAP_FOV_DEGREES,
  } : null;
}

// The movement loop drives the camera while the rider moves; this loop keeps
// an in-progress flight animating when nothing else ticks — route just
// loaded, movement stopped mid-flight, or a seek/settings change while
// paused.
export function ensureCameraFlightLoop() {
  if (state.cameraFlightLoopActive) return;
  state.cameraFlightLoopActive = true;
  const step = () => {
    if (
      !state.route.length || !state.map || state.userInteracting ||
      state.movementLoopActive || state.cameraMode === "manual" ||
      // An animated overview (orbit/flyby) or a transition-arc flight owns
      // the camera directly; the chase flight must yield or the two loops
      // fight — the flight would re-init from the old pose and fly to the
      // new route instead of the animation snapping to it.
      state.overviewAnim || state.cameraTransition
    ) {
      state.cameraFlightLoopActive = false;
      return;
    }
    const settled = stepCameraFlight(performance.now());
    // Keep the ground dot's apparent size steady while the camera flies.
    if (state.riderDot) updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    if (settled) {
      state.cameraFlightLoopActive = false;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Jump the map straight to `camera` with no flight, and park the chase state
// there (zero velocity) so the next target change starts a fresh smooth move.
// A snap supersedes any transition-arc flight still in progress.
export function applyCameraNow(camera) {
  state.cameraTransition = null;
  state.map.center = { ...camera.center };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
  state.map.roll = 0;
  state.map.fov = DEFAULT_MAP_FOV_DEGREES;

  const eye = cameraEyePosition(camera);
  state.cameraFlight = eye
    ? {
      eye,
      center: { ...camera.center },
      eyeVelocity: [0, 0, 0],
      centerVelocity: [0, 0, 0],
      lastStepMs: performance.now(),
    }
    : null;
  updateGalleryMetadataExport();
}

// --- Terrain avoidance ---------------------------------------------------------
//
// The follow camera can end up inside a hillside when the rider turns in
// front of rising terrain. Check the ground at several points along the view
// ray (eye through to the rider) against nearby route elevations, and when the
// ray would dip below terrain + clearance anywhere along it, lift the camera;
// the lift eases back to zero once the terrain allows. The lift is always
// computed from the configured (unlifted) camera, so it never feeds back on
// itself.

function currentTerrainLift(camera, centerAltitude) {
  if (!state.terrainAvoidEnabled) {
    state.cameraLiftMeters = 0;
    state.cameraLiftTargetMeters = 0;
    return 0;
  }

  const now = performance.now();
  if (now - state.lastLiftComputeMs >= TERRAIN_LIFT_RECOMPUTE_MS) {
    state.lastLiftComputeMs = now;
    state.cameraLiftTargetMeters = computeTerrainLiftTarget(camera, centerAltitude);
  }

  // Time-based smoothing, since frames tick at 60 fps in front and ~2 fps in
  // a hidden tab.
  const dt = clamp((now - state.lastLiftSmoothMs) / 1000, 0, 1);
  state.lastLiftSmoothMs = now;
  const tau = state.cameraLiftTargetMeters > state.cameraLiftMeters
    ? TERRAIN_LIFT_RISE_TAU_SECONDS
    : TERRAIN_LIFT_FALL_TAU_SECONDS;
  state.cameraLiftMeters += (state.cameraLiftTargetMeters - state.cameraLiftMeters) * (1 - Math.exp(-dt / tau));
  if (state.cameraLiftMeters < 0.5 && state.cameraLiftTargetMeters === 0) state.cameraLiftMeters = 0;
  return state.cameraLiftMeters;
}

function computeTerrainLiftTarget(camera, centerAltitude) {
  const eye = cameraEyePosition({
    center: { lat: camera.center.lat, lng: camera.center.lng, altitude: centerAltitude },
    range: camera.range,
    tilt: camera.tilt,
    heading: camera.heading,
  });
  if (!eye) return 0;

  // Sample the view ray at several points between the eye and the rider (a
  // ridge anywhere along it hides the rider just as badly as terrain at the
  // eye itself, and hairpin turns can hide a rise close to either end). The
  // required clearance tapers toward the rider, who genuinely is on the ground.
  let target = 0;
  for (const fraction of [0, 0.25, 0.5, 0.75]) {
    const samplePoint = {
      lat: lerp(eye.lat, camera.center.lat, fraction),
      lng: lerp(eye.lng, camera.center.lng, fraction),
    };
    const terrainEle = terrainElevationForSample(samplePoint);
    if (terrainEle === null) continue;
    const rayAltitude = lerp(eye.altitude, centerAltitude, fraction);
    const clearance = state.terrainClearanceMeters * (1 - fraction);
    target = Math.max(target, terrainEle + clearance - rayAltitude);
  }
  return target;
}

// The terrain height under a view-ray sample point. The route's own elevation
// points are a free, always-available estimate (the road covers the hillside
// on switchbacks); when online terrain is enabled, the real ground elevation
// from the Terrarium tile is blended in as the higher of the two — so the
// camera also clears hills the GPX track never climbs, while degrading to the
// route-only estimate whenever a tile has not loaded yet or is disabled.
function terrainElevationForSample(samplePoint) {
  const routeEle = maxElevationNear(state.route, samplePoint, TERRAIN_SAMPLE_RADIUS_METERS);
  if (!state.terrainTilesEnabled) return routeEle;
  const tileEle = terrainElevationAt(samplePoint.lat, samplePoint.lng);
  if (tileEle === null) return routeEle;
  return routeEle === null ? tileEle : Math.max(routeEle, tileEle);
}

// Real ground elevation at a point from the online terrain tiles, for the
// fly-by / fly-over height planner (flyby.mjs). Out on the flight path the
// route-based estimate is useless — the path leaves the road entirely — so
// this is tiles-only: null when online terrain is off or a tile has not loaded
// yet, and the planner falls back to its route-based footprint estimate.
export function onlineTerrainElevationAt(lat, lng) {
  if (!state.terrainTilesEnabled) return null;
  return terrainElevationAt(lat, lng);
}

// --- Rider visibility (swing around a blocking hill) ---------------------------
//
// Terrain lift raises the camera when its view ray sinks into a hillside, but
// some hills sit squarely between the eye and the rider even with the eye well
// above ground — lifting further would tip the view uselessly overhead. Instead
// swing the camera horizontally around the rider (the rider stays centered,
// only the viewing side changes), taking the least rotation left or right that
// clears the hill. Eased over time so it never snaps, exactly like the lift.

function currentVisibilityNudge(camera, centerAltitude, tilt) {
  if (!state.riderVisibilityNudgeEnabled) {
    state.cameraVisNudgeDegrees = 0;
    state.cameraVisNudgeTargetDegrees = 0;
    return 0;
  }

  const now = performance.now();
  if (now - state.lastVisNudgeComputeMs >= RIDER_VISIBILITY_RECOMPUTE_MS) {
    state.lastVisNudgeComputeMs = now;
    state.cameraVisNudgeTargetDegrees = computeVisibilityNudgeTarget(camera, centerAltitude, tilt);
  }

  const dt = clamp((now - state.lastVisNudgeSmoothMs) / 1000, 0, 1);
  state.lastVisNudgeSmoothMs = now;
  const tau = Math.abs(state.cameraVisNudgeTargetDegrees) > Math.abs(state.cameraVisNudgeDegrees)
    ? RIDER_VISIBILITY_RISE_TAU_SECONDS
    : RIDER_VISIBILITY_FALL_TAU_SECONDS;
  state.cameraVisNudgeDegrees += (state.cameraVisNudgeTargetDegrees - state.cameraVisNudgeDegrees) * (1 - Math.exp(-dt / tau));
  if (Math.abs(state.cameraVisNudgeDegrees) < 0.05 && state.cameraVisNudgeTargetDegrees === 0) {
    state.cameraVisNudgeDegrees = 0;
  }
  return state.cameraVisNudgeDegrees;
}

// Scan swings out to the configured max each way (only if the straight-behind
// view is actually blocked) and let the pure picker choose the least rotation
// that clears the rider.
function computeVisibilityNudgeTarget(camera, centerAltitude, tilt) {
  const basePenetration = sightlinePenetration(camera, centerAltitude, tilt, 0);
  if (basePenetration <= 0) return 0;

  const candidates = [{ degrees: 0, penetration: basePenetration }];
  const step = Math.max(1, RIDER_VISIBILITY_STEP_DEGREES);
  const max = Math.max(step, RIDER_VISIBILITY_MAX_NUDGE_DEGREES);
  for (let degrees = step; degrees <= max; degrees += step) {
    candidates.push({ degrees, penetration: sightlinePenetration(camera, centerAltitude, tilt, degrees) });
    candidates.push({ degrees: -degrees, penetration: sightlinePenetration(camera, centerAltitude, tilt, -degrees) });
  }
  return pickVisibilityNudge(candidates);
}

// Meters the terrain rises above the eye→rider sightline (>0 = rider occluded)
// with the eye swung `nudgeDegrees` around the rider. Same ray-sampling shape
// as the lift: the required clearance tapers to zero at the rider, who sits on
// the ground, so the samples near the rider don't count the road itself.
function sightlinePenetration(camera, centerAltitude, tilt, nudgeDegrees) {
  const heading = normalizeHeading(camera.heading + nudgeDegrees);
  const eye = cameraEyePosition({
    center: { lat: camera.center.lat, lng: camera.center.lng, altitude: centerAltitude },
    range: camera.range,
    tilt,
    heading,
  });
  if (!eye) return 0;

  const samples = Math.max(2, RIDER_VISIBILITY_RAY_SAMPLES);
  let worst = 0;
  for (let i = 0; i < samples; i++) {
    const fraction = i / samples; // 0 at the eye, stops short of the rider (1)
    const terrainEle = terrainElevationForSample({
      lat: lerp(eye.lat, camera.center.lat, fraction),
      lng: lerp(eye.lng, camera.center.lng, fraction),
    });
    if (terrainEle === null) continue;
    const rayAltitude = lerp(eye.altitude, centerAltitude, fraction);
    const clearance = state.terrainClearanceMeters * (1 - fraction);
    worst = Math.max(worst, terrainEle + clearance - rayAltitude);
  }
  return worst;
}

// --- Manual camera capture -------------------------------------------------------

export function bindManualCameraCapture() {
  // Only genuine input events mark a manual interaction. The gmp-* camera
  // change events also fire for programmatic follow-camera writes, so they
  // cannot distinguish the user from the app.
  const begin = () => beginUserInteraction();
  state.map.addEventListener("pointerdown", begin);
  state.map.addEventListener("keydown", begin);
  state.map.addEventListener("wheel", () => {
    beginUserInteraction();
    scheduleInteractionEnd();
  }, { passive: true });

  const end = () => scheduleInteractionEnd();
  state.map.addEventListener("pointerup", end);
  state.map.addEventListener("pointercancel", end);
  state.map.addEventListener("keyup", end);
}

function beginUserInteraction() {
  state.userInteracting = true;
  window.clearTimeout(state.interactionSettleTimer);
  startInteractionDotResizeLoop();
}

// While the user zooms or pans, the follow camera is suspended and nothing
// else recomputes the dot radius, so a paused rider's dot would balloon or
// vanish mid-gesture. Track the camera every frame until the gesture settles;
// the change threshold inside updateRiderDot keeps re-tessellation cheap.
function startInteractionDotResizeLoop() {
  if (state.interactionDotLoopActive) return;
  state.interactionDotLoopActive = true;
  const step = () => {
    if (!state.userInteracting) {
      state.interactionDotLoopActive = false;
      return;
    }
    if (state.route.length && state.riderDot) {
      updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function scheduleInteractionEnd() {
  if (!state.userInteracting) return;
  window.clearTimeout(state.interactionSettleTimer);
  state.interactionSettleTimer = window.setTimeout(endUserInteraction, INTERACTION_SETTLE_MS);
}

function endUserInteraction() {
  if (state.cameraMode === "follow") {
    captureManualCameraSettings();
  } else if (state.cameraMode === "overview") {
    // Grabbing the overview turns it OFF entirely: the overview button
    // deactivates and the camera is left where the user put it, in manual mode
    // (no fly-back, and the follow settings are not overwritten). Re-enabling
    // the overview is then an explicit action via the overview control.
    clearOverviewAnimation();
    state.overviewActive = false;
    state.finishOrbitActive = false;
    state.climbOverviewMenuOpen = false;
    state.cameraMode = "manual";
  }
  state.userInteracting = false;
  syncOverviewControls();
  // The next flight step restarts from wherever the gesture left the camera.
  state.cameraFlight = null;

  // The capture bakes whatever the user sees — including any active terrain
  // lift — into the camera settings, so the lift restarts from zero against
  // that new baseline instead of stacking on top of it.
  state.cameraLiftMeters = 0;
  state.cameraLiftTargetMeters = 0;

  updateRideUi();
  updateGalleryMetadataExport(true);
}

function captureManualCameraSettings() {
  if (!state.map) return;
  state.cameraViewPreset = null;

  const tilt = Number(state.map.tilt);
  const range = Number(state.map.range);
  const heading = Number(state.map.heading);
  const centerAltitude = Number(state.map.center?.altitude);
  const rider = state.route.length ? interpolateRoutePoint(state.route, state.progressMeters) : null;

  let capturedTilt = Number.isFinite(tilt) ? clamp(tilt, CAMERA_TILT_MIN, CAMERA_TILT_MAX) : state.cameraAngleDegrees;
  let capturedRange = Number.isFinite(range) && range > 0
    ? range
    : rangeForBehind(state.cameraBehindMeters, capturedTilt) / state.cameraZoom;

  // Gestures move several camera parameters at once: a pan re-casts the map
  // center onto the terrain (changing its altitude and therefore range), and
  // a tilt pivots around the point under the cursor (sliding the center).
  // Raw tilt/range are measured against wherever the center landed, so when
  // the look-at point snaps back to the rider they must be re-solved from
  // the camera eye's actual height and horizontal standoff.
  if (rider && state.centerRider && Number.isFinite(centerAltitude)) {
    const eyeBehindMeters = capturedRange * Math.sin(toRad(capturedTilt));
    const eyeHeightMeters = centerAltitude + capturedRange * Math.cos(toRad(capturedTilt)) - rider.ele;
    if (eyeHeightMeters > 1) {
      capturedTilt = clamp(Math.atan2(eyeBehindMeters, eyeHeightMeters) * 180 / Math.PI, CAMERA_TILT_MIN, CAMERA_TILT_MAX);
      capturedRange = Math.hypot(eyeBehindMeters, eyeHeightMeters);
    }
  }

  state.cameraAngleDegrees = capturedTilt;
  const baseRange = rangeForBehind(state.cameraBehindMeters, capturedTilt);
  state.cameraZoom = clamp(baseRange / capturedRange, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);

  if (Number.isFinite(heading) && rider) {
    const routeHeading = currentRouteHeading();
    state.cameraHeadingOffsetDegrees = signedHeadingDelta(routeHeading, heading);
  }

  if (rider && state.centerRider) {
    state.cameraCenterAltitudeOffsetMeters = 0;
  } else if (rider) {
    const center = mapCenter();
    if (center) {
      const routeHeading = currentRouteHeading();
      const offset = measureCameraOffset({ lat: rider.lat, lng: rider.lng }, center, routeHeading);
      state.cameraOffsetForwardMeters = clamp(offset.forwardMeters, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
      state.cameraOffsetRightMeters = clamp(offset.rightMeters, -CAMERA_PAN_LIMIT_METERS, CAMERA_PAN_LIMIT_METERS);
    }
    if (Number.isFinite(centerAltitude)) {
      state.cameraCenterAltitudeOffsetMeters = clamp(
        centerAltitude - rider.ele,
        -CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
        CAMERA_CENTER_ALTITUDE_LIMIT_METERS,
      );
    }
  }

  syncCameraControls();
  saveSettings();
  updateCameraSettingsLabels();
}

export function currentRouteHeading(progressMeters = state.progressMeters) {
  if (state.route.length < 2) return 0;
  // Sample a short window around the rider so the camera points exactly the
  // way the rider is moving, rather than at a spot far up the road.
  const total = routeTotalDistance(state.route);
  const from = interpolateRoutePoint(state.route, clamp(progressMeters - HEADING_SAMPLE_METERS, 0, total));
  const to = interpolateRoutePoint(state.route, clamp(progressMeters + HEADING_SAMPLE_METERS, 0, total));
  return normalizeHeading(bearing(from, to));
}

function mapCenter() {
  const center = state.map?.center;
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
