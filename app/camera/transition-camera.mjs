// App-side driver for the transition arc that flies the camera onto a
// continuously-moving target: captures the current camera pose and the velocity
// of whatever currently drives it (static pose, chase flight, orbit,
// fly-by/fly-over), predicts the dock state, and flies the pure arc from
// camera/transition-arc.mjs frame by frame. The pure math lives there; this
// module owns the state.cameraTransition lifecycle, the animation loop, and the
// handoff at the dock. Two targets get the arc (gated by
// `camera_transition.arc_into_modes` in tuning.yaml): the follow (rider) camera
// — for the overview-off / movement-start handoff and the elevation-profile
// teleport — docking where the rider *will* be; and the fly-by / fly-over
// patterns, docking onto the pattern point nearest the camera. Static / orbit /
// satellite overviews are never arced into — they snap or ease through their
// own driver. Each entry point returns false when no physically-valid arc
// exists (or the target isn't an arc mode), and the caller keeps its
// pre-existing chase / eased-entry behavior — the arc is an upgrade, never a
// requirement.

import { createCameraTransition } from "./transition-arc.mjs";
import { cameraFromEyeAndCenter } from "./camera.mjs";
import {
  currentMapCameraPose,
  currentRouteHeading,
  ensureCameraFlightLoop,
  followCameraTargetAt,
} from "./follow-camera.mjs";
import { clearOverviewAnimation, orbitSpin, startOverviewAnimation } from "./overview-camera.mjs";
import { createEllipseFlyby, createFigureEightFlyover } from "./flyby.mjs";
import { orbitCamera } from "./flyover.mjs";
import { updateGalleryMetadataExport } from "../gallery-ui/gallery-export.mjs";
import { bearing, clamp, haversine, toRad } from "../core/geo.mjs";
import { gradeAt, interpolateRoutePoint, routeTotalDistance } from "../route/route.mjs";
import { updateRiderDot } from "../map/route-render.mjs";
import { els, state } from "../core/state.mjs";
import { CAMERA_TRANSITION, DEFAULT_MAP_FOV_DEGREES, ELLIPSE_FLYBY } from "../core/tuning.mjs";

// Which camera targets are flown into with the physical arc (vs. snapped or
// eased by their own driver). The declarative policy lives in tuning.yaml's
// `camera_transition.arc_into_modes`; see that key for the rationale. Each arc
// entry point gates on its own target mode, so removing a mode there falls that
// mode's transitions back to the plain chase / eased pattern entry.
export function arcsIntoMode(mode) {
  const modes = CAMERA_TRANSITION.arc_into_modes;
  return Array.isArray(modes) && modes.includes(mode);
}

// Fly from wherever the camera is to the follow camera behind the rider —
// the overview-off handoff (user toggle, movement starting) and the
// elevation-profile teleport. The rider keeps moving during the flight, so the
// dock state is a function of the candidate duration: the arc intercepts the
// chase camera where it will be.
export function startCameraTransitionToFollow(startState = null) {
  if (!canTransition() || !arcsIntoMode("follow")) return false;
  const start = startState ?? captureCameraTransitionStart();
  if (!start) return false;

  const arc = createCameraTransition({ start, end: followDockStateAt }, CAMERA_TRANSITION);
  if (!arc) return false;
  beginTransition(arc, (finishedArc) => {
    // Seamless handoff to follow tracking: park the chase flight on the
    // docked pose *with the arc's terminal velocity*, so the follow camera
    // continues the motion instead of restarting from rest.
    const pose = finishedArc.poseAt(finishedArc.durationSeconds);
    const velocity = finishedArc.velocityAt(finishedArc.durationSeconds);
    state.cameraFlight = {
      eye: { ...pose.eye },
      center: { ...pose.lookAt },
      eyeVelocity: enuToChaseFrame(velocity.eye),
      centerVelocity: enuToChaseFrame(velocity.lookAt),
      lastStepMs: performance.now(),
    };
    if (!state.movementLoopActive) ensureCameraFlightLoop();
  });
  return true;
}

// Fly from wherever the camera is onto a fly-by / fly-over pattern — a natural
// continuous flight, so an arc into it reads as one motion. It docks at the
// pattern point nearest the current camera, matching that point's velocity,
// bank and FOV, then hands off to the pattern animation entering exactly there
// (no intro ease — the arc already delivered that frame). Returns false (caller
// keeps the eased pattern entry) when the route is too small to fly, this mode
// isn't an arc target, or no physically-valid arc fits.
export function startCameraTransitionToFlyPattern(startState, mode) {
  if (!canTransition() || !arcsIntoMode(mode)) return false;
  const route = state.overviewRoute ?? state.route;
  const pattern = mode === "flyover"
    ? createFigureEightFlyover(route, ELLIPSE_FLYBY)
    : createEllipseFlyby(route, ELLIPSE_FLYBY);
  if (!pattern) return false;
  const start = startState ?? captureCameraTransitionStart();
  if (!start) return false;

  const enterS = pattern.nearestSTo(start.eye);
  const dock = flyPatternDockState(pattern, enterS);
  if (!dock) return false;

  const arc = createCameraTransition({ start, end: dock }, CAMERA_TRANSITION);
  if (!arc) return false;
  beginTransition(arc, () => startOverviewAnimation({ atS: enterS }));
  return true;
}

// The current map pose plus the velocity of whichever driver owns the camera,
// as a transition-arc start state. Callers that are about to tear the current
// driver down (returnToRiderCamera clears the overview animation) capture this
// FIRST and pass it in.
export function captureCameraTransitionStart() {
  const pose = currentMapCameraPose();
  if (!pose) return null;
  const velocity = currentCameraVelocity();
  return {
    eye: pose.eye,
    lookAt: pose.center,
    velocity: velocity.eye,
    lookAtVelocity: velocity.lookAt,
    rollDegrees: pose.roll,
    fovDegrees: pose.fov,
  };
}

export function cancelCameraTransition() {
  state.cameraTransition = null;
}

function canTransition() {
  return Boolean(
    CAMERA_TRANSITION.enabled &&
    state.mapProvider === "google3d" &&
    state.route.length >= 2 &&
    state.map,
  );
}

function beginTransition(arc, onComplete) {
  // The transition is the sole camera driver now: stop any animated overview
  // and drop the parked chase state (it is re-seeded at the dock).
  clearOverviewAnimation();
  state.cameraFlight = null;
  state.cameraTransition = { arc, startMs: performance.now(), onComplete };
  ensureCameraTransitionLoop();
}

function ensureCameraTransitionLoop() {
  if (state.cameraTransitionLoopActive) return;
  state.cameraTransitionLoopActive = true;
  const step = () => {
    const transition = state.cameraTransition;
    // A manual grab cancels the flight outright (endUserInteraction decides
    // what owns the camera next); an animated overview taking over means a
    // newer camera driver superseded this one.
    if (!transition || !state.map || state.userInteracting || state.overviewAnim) {
      if (state.userInteracting) state.cameraTransition = null;
      state.cameraTransitionLoopActive = false;
      return;
    }
    const pose = transition.arc.poseAt((performance.now() - transition.startMs) / 1000);
    applyTransitionPose(pose);
    // Keep the ground dot's apparent size steady while the camera flies.
    if (state.riderDot && state.route.length) {
      updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    }
    if (pose.done) {
      state.cameraTransition = null;
      state.cameraTransitionLoopActive = false;
      transition.onComplete?.(transition.arc);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function applyTransitionPose(pose) {
  const camera = cameraFromEyeAndCenter(pose.eye, pose.lookAt, Number(state.map.heading) || 0);
  state.map.center = { ...pose.lookAt };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
  state.map.roll = pose.rollDegrees;
  state.map.fov = pose.fovDegrees;
  updateGalleryMetadataExport();
}

// --- Dock states ----------------------------------------------------------------

// The follow camera as it will stand `durationSeconds` from now, moving at
// the rider's velocity. Terrain lift is deliberately left out of the dock
// pose — the lift is a stateful smoothing the follow chase re-applies the
// moment it takes over.
function followDockStateAt(durationSeconds) {
  const total = routeTotalDistance(state.route);
  const speed = riderSpeedMps();
  const progress = clamp(state.progressMeters + speed * durationSeconds, 0, total);
  const target = followCameraTargetAt(progress, { terrainLift: false });
  if (!target) return null;

  const dockSpeed = progress >= total - 0.01 ? 0 : speed;
  const heading = toRad(currentRouteHeading(progress));
  const gradeRatio = (Number(gradeAt(state.route, progress)) || 0) / 100;
  const velocity = [
    dockSpeed * Math.sin(heading),
    dockSpeed * Math.cos(heading),
    dockSpeed * gradeRatio,
  ];
  return {
    eye: target.eye,
    lookAt: target.center,
    velocity,
    lookAtVelocity: velocity,
    rollDegrees: 0,
    fovDegrees: DEFAULT_MAP_FOV_DEGREES,
  };
}

// A fly-by / fly-over pattern's entry frame as an arc dock state: its eye and
// look-at, the flight's velocity there, and the pattern's own bank and FOV — so
// the arc arrives already matching the motion it hands off to.
function flyPatternDockState(pattern, s) {
  const frame = pattern.frameAt(s);
  if (!frame?.eye || !frame?.lookAt) return null;
  const velocity = flyPatternVelocityAt(pattern, s);
  return {
    eye: frame.eye,
    lookAt: frame.lookAt,
    velocity: velocity.eye,
    lookAtVelocity: velocity.lookAt,
    rollDegrees: Number(frame.bankDegrees) || 0,
    fovDegrees: Number(frame.cameraFovDegrees) || DEFAULT_MAP_FOV_DEGREES,
  };
}

// --- Current-driver velocity ------------------------------------------------------

// Velocity of whatever currently drives the camera, in [east, north, up] m/s
// for the eye and the look-at point. Unknown drivers (parked, manual) are at
// rest — the Hermite fit treats a zero start velocity as a standing start.
function currentCameraVelocity() {
  const anim = state.overviewAnim;
  if (anim?.mode === "orbit" && state.overviewCamera) {
    const spin = orbitSpin();
    const camera = orbitCamera(state.overviewCamera, (performance.now() - anim.startMs) / 1000, spin);
    return { eye: camera ? orbitEyeVelocity(camera, spin) : [0, 0, 0], lookAt: [0, 0, 0] };
  }
  if (anim?.flyby) return flybyVelocity(anim);
  const flight = state.cameraFlight;
  if (flight?.eyeVelocity) {
    return {
      eye: chaseFrameToEnu(flight.eyeVelocity),
      lookAt: chaseFrameToEnu(flight.centerVelocity),
    };
  }
  return { eye: [0, 0, 0], lookAt: [0, 0, 0] };
}

// The orbit eye circles the look-at center: heading advances 360° per
// revolution, so the eye's tangential speed is the angular rate times its
// horizontal standoff, perpendicular to the center→eye direction.
function orbitEyeVelocity(camera, { secondsPerRevolution = 60, direction = 1 } = {}) {
  const period = Math.max(1, Number(secondsPerRevolution) || 60);
  const standoff = (Number(camera.range) || 0) * Math.sin(toRad(Number(camera.tilt) || 0));
  const speed = (2 * Math.PI / period) * standoff;
  const moveBearing = toRad(camera.heading + 180 + 90 * (direction < 0 ? -1 : 1));
  return [speed * Math.sin(moveBearing), speed * Math.cos(moveBearing), 0];
}

// Fly-by/fly-over eye and look-at velocities from two pattern frames one
// meter of arc apart, scaled by the pattern's constant ground speed — the
// velocity both a running pattern (docking away from it) and a to-be-entered
// pattern (docking onto it) expose at parameter `s`.
function flyPatternVelocityAt(pattern, s) {
  const speed = Math.max(0.1, Number(pattern.speedAt()) || 0.1);
  const here = pattern.frameAt(s);
  const ahead = pattern.frameAt(s + 1);
  const seconds = 1 / speed;
  return {
    eye: geoVelocityBetween(here.eye, ahead.eye, seconds),
    lookAt: geoVelocityBetween(here.lookAt, ahead.lookAt, seconds),
  };
}

function flybyVelocity(anim) {
  return flyPatternVelocityAt(anim.flyby, anim.s);
}

function geoVelocityBetween(from, to, seconds) {
  const distance = haversine(from, to);
  const direction = toRad(bearing(from, to));
  return [
    (distance * Math.sin(direction)) / seconds,
    (distance * Math.cos(direction)) / seconds,
    ((Number(to.altitude) || 0) - (Number(from.altitude) || 0)) / seconds,
  ];
}

// The chase flight (chaseGeoPoint in follow-camera.mjs) keeps its velocities
// as [north, east, up]; the transition arc uses [east, north, up].
function chaseFrameToEnu([north, east, up]) {
  return [east, north, up];
}

function enuToChaseFrame([east, north, up]) {
  return [north, east, up];
}

// The same movement-source rule as the movement loop: trainer speed while
// pedaling wins, else the simulation slider while simulating, else parked.
function riderSpeedMps() {
  if (state.pedaling && Number.isFinite(state.trainerSpeedKph)) {
    return Math.max(0, state.trainerSpeedKph) / 3.6;
  }
  if (state.simulating) return Math.max(0, Number(els.speedInput?.value) || 0) / 3.6;
  return 0;
}
