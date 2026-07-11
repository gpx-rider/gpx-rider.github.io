// Route overview cameras: the static/satellite whole-route framing, the
// animated modes (orbit / fly-by / fly-over) with their own direct-write
// animation loop, the finish-line orbit, and the return to the rider camera.
// The pure fit/orbit/flight math lives in camera.mjs, flyover.mjs and
// flyby.mjs; this module owns the app-side state machine around it.

import {
  cameraEyePosition,
  cameraFromEyeAndCenter,
  computeRouteOverviewCamera,
} from "./camera.mjs";
import { closeOverviewModeMenu, isFirstPersonCameraView, syncOverviewControls } from "./camera-ui.mjs";
import { clearOverviewDebugLine, updateOverviewDebugLine } from "./camera-debug.mjs";
import { focusedRouteRange, syncFocusedClimbList } from "../route/climbs-ui.mjs";
import {
  applyCameraNow,
  currentMapCameraPose,
  ensureCameraFlightLoop,
  updateMapCamera,
} from "./follow-camera.mjs";
import { createEllipseFlyby, createFigureEightFlyover } from "./flyby.mjs";
import { orbitCamera } from "./flyover.mjs";
import { updateGalleryMetadataExport } from "../gallery-ui/gallery-export.mjs";
import { bearing, clamp, lerp } from "../core/geo.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { interpolateRoutePoint } from "../route/route.mjs";
import {
  rebuildRouteStyle,
  removeRiderMarker,
  renderRiderDot,
  updateRiderDot,
} from "../map/route-render.mjs";
import { els, state } from "../core/state.mjs";
import {
  DEFAULT_FINISH_ORBIT_ENABLED,
  DEFAULT_MAP_FOV_DEGREES,
  ELLIPSE_FLYBY,
  FINISH_ORBIT_DIRECTION,
  FINISH_ORBIT_LOOKAT_HEIGHT_METERS,
  FINISH_ORBIT_RANGE_METERS,
  FINISH_ORBIT_SECONDS_PER_REV,
  FINISH_ORBIT_TILT_DEGREES,
  HEADING_SAMPLE_METERS,
  OVERVIEW_ANIM_INTRO_SECONDS,
  OVERVIEW_HEADING_OFFSET_DEGREES,
  OVERVIEW_MARGIN_FACTOR,
  OVERVIEW_MAX_RANGE_METERS,
  OVERVIEW_MIN_RANGE_METERS,
  OVERVIEW_ORBIT_DIRECTION,
  OVERVIEW_ORBIT_SECONDS_PER_REV,
  OVERVIEW_RANGE_FACTOR,
  OVERVIEW_TILT_DEGREES,
  SATELLITE_MARGIN_FACTOR,
  SATELLITE_TILT_DEGREES,
} from "../core/tuning.mjs";

// Frame the whole loaded route: start→end reads left-to-right, the side of
// the route bulging furthest from that axis faces away, seen from 45° with
// margin. The camera stays there until movement starts. A fresh load snaps
// there instantly (a new route can be on the other side of the world — no
// flight); a reset flies back smoothly.
export function enterOverviewMode({
  instant = false,
  route = state.route,
  mode = state.overviewMode,
} = {}) {
  // Overview can be shown whenever a route is loaded — while parked or, as a
  // deliberate user choice, while riding. The automatic transitions are
  // "route loaded → overview on" (loadRoute / restore), "movement started →
  // overview off" (ensureMovementLoop), and "ride just finished → finish-line
  // orbit on" (enterFinishOrbit, below); everything else here is user-driven.
  if (!route.length || !state.map) return;
  // Any call here (user toggle, a new climb/segment focus, a fresh route)
  // supersedes a running finish-line orbit.
  state.finishOrbitActive = false;
  const focusingWholeRoute = route === state.route;
  if (focusingWholeRoute && (state.focusedClimbIndex !== null || state.selectedProfileSegment)) {
    state.focusedClimbIndex = null;
    state.selectedProfileSegment = null;
    state.climbOverviewMenuOpen = false;
    syncFocusedClimbList();
    renderProfile();
    rebuildRouteStyle();
  }
  state.overviewActive = true;
  state.overviewRoute = route;
  state.activeOverviewMode = mode;
  syncOverviewControls();
  // Only the fly modes deliberately tune FOV; everything else uses the default.
  if (!isFlyOverviewMode(mode)) state.map.fov = DEFAULT_MAP_FOV_DEGREES;
  const width = els.mapViewport?.clientWidth;
  const height = els.mapViewport?.clientHeight;
  state.overviewCamera = computeRouteOverviewCamera(route, {
    ...overviewCameraParams(mode),
    viewportAspect: width && height ? width / height : undefined,
    // Newer Maps versions expose the actual field of view; older ones fall
    // back to the module's default (Google's documented 35° default).
    fovDegrees: Number(state.map.fov) || undefined,
  });
  if (!state.overviewCamera) return;
  state.cameraMode = "overview";

  // Animated modes (orbit / fly-by / fly-over) drive the map themselves. If one
  // can't be set up (e.g. a fly path on a route too small to fly), fall through
  // to the static framing below.
  if (isAnimatedOverviewMode(mode) && startOverviewAnimation({ instant })) return;

  clearOverviewAnimation();
  if (instant) {
    applyCameraNow(state.overviewCamera);
    return;
  }
  ensureCameraFlightLoop();
}

// Fired once, right as a ride (pedaled, simulated, or demo) reaches the end of
// the route (see the finish check in the movement tick). Unlike
// enterOverviewMode, this doesn't fit the camera to a route shape — the
// "route" at the finish line is a single point with no spread to frame — so it
// builds the orbit's base camera directly around that point and drives it
// through the same animated orbit loop as the other overview modes
// (stepOverviewAnimation picks the finish-orbit's own speed/direction via
// state.finishOrbitActive).
export function enterFinishOrbit() {
  if (!DEFAULT_FINISH_ORBIT_ENABLED || !state.route.length || !state.map) return;

  const finishPoint = interpolateRoutePoint(state.route, state.progressMeters);
  if (!finishPoint) return;
  const previousPoint = interpolateRoutePoint(state.route, Math.max(0, state.progressMeters - HEADING_SAMPLE_METERS));
  const heading = bearing(previousPoint, finishPoint);

  state.overviewActive = true;
  state.finishOrbitActive = true;
  state.overviewRoute = state.route;
  state.activeOverviewMode = "orbit";
  syncOverviewControls();
  state.map.fov = DEFAULT_MAP_FOV_DEGREES;
  state.overviewCamera = {
    center: {
      lat: finishPoint.lat,
      lng: finishPoint.lng,
      altitude: (Number(finishPoint.ele) || 0) + FINISH_ORBIT_LOOKAT_HEIGHT_METERS,
    },
    heading,
    tilt: FINISH_ORBIT_TILT_DEGREES,
    range: FINISH_ORBIT_RANGE_METERS,
  };
  state.cameraMode = "overview";
  startOverviewAnimation();
}

// Camera fit parameters per overview mode. The satellite modes look nearly
// straight down and frame the route as large as it fits (north-up forces a due
// north heading); every other mode uses the angled whole-route framing —
// static holds it, orbit spins it, and the fly modes use it as their
// fallback/intro pose before their own path driver takes over.
function overviewCameraParams(mode) {
  if (mode === "satellite") {
    return {
      // Straight-down, north up. (An axis-oriented variant was tried and looked
      // unnatural — the map appeared randomly rotated — so satellite is north-up.)
      tiltDegrees: SATELLITE_TILT_DEGREES,
      headingDegrees: 0,
      marginFactor: SATELLITE_MARGIN_FACTOR,
      rangeFactor: 1,
      minRangeMeters: OVERVIEW_MIN_RANGE_METERS,
      maxRangeMeters: OVERVIEW_MAX_RANGE_METERS,
    };
  }
  return {
    tiltDegrees: OVERVIEW_TILT_DEGREES,
    headingOffsetDegrees: OVERVIEW_HEADING_OFFSET_DEGREES,
    marginFactor: OVERVIEW_MARGIN_FACTOR,
    rangeFactor: OVERVIEW_RANGE_FACTOR,
    minRangeMeters: OVERVIEW_MIN_RANGE_METERS,
    maxRangeMeters: OVERVIEW_MAX_RANGE_METERS,
  };
}

// Fly-by (ellipse) and fly-over (figure-eight) both tune FOV and run their own
// path-flight driver; they share the ELLIPSE_FLYBY config.
export function isFlyOverviewMode(mode) {
  return mode === "flyby" || mode === "flyover";
}

// Modes that own the camera every frame through the overview animation loop,
// rather than being framed once as a static pose.
function isAnimatedOverviewMode(mode) {
  return mode === "orbit" || isFlyOverviewMode(mode);
}

export function returnToRiderCamera() {
  state.overviewActive = false;
  state.finishOrbitActive = false;
  state.climbOverviewMenuOpen = false;
  closeOverviewModeMenu();
  clearOverviewAnimation();
  if (!state.route.length || !state.map) {
    syncOverviewControls();
    return;
  }

  state.cameraMode = "follow";
  state.overviewRoute = state.route;
  state.activeOverviewMode = state.overviewMode;
  state.cameraFlight = null;
  state.map.fov = DEFAULT_MAP_FOV_DEGREES;
  syncOverviewControls();
  if (isFirstPersonCameraView()) {
    removeRiderMarker();
  } else if (!state.riderDot) {
    renderRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
  }
  updateMapCamera();
  if (!state.movementLoopActive) ensureCameraFlightLoop();
  updateOverviewDebugLine();
}

// --- Animated overview (orbit / fly-by / fly-over) ------------------------------
//
// These modes own the camera directly (the motion is already smooth, so there's
// no chase). Orbit spins the static overview; fly-by drives an ellipse and
// fly-over a figure-eight around the route. On entry the view eases from the
// current pose into the motion so switching modes or resetting never jumps.

function startOverviewAnimation({ instant = false } = {}) {
  const mode = state.activeOverviewMode;
  const route = state.overviewRoute ?? state.route;
  let flyby = null;
  if (isFlyOverviewMode(mode)) {
    flyby = mode === "flyover"
      ? createFigureEightFlyover(route, ELLIPSE_FLYBY)
      : createEllipseFlyby(route, ELLIPSE_FLYBY);
    if (!flyby) return false; // route too small to fly — caller falls back to static
  }
  const now = performance.now();
  // Ease in from where the camera currently is, unless we're snapping (a fresh
  // load can be on the far side of the world — no sensible lerp).
  const introFrom = instant ? null : currentMapCameraPose();
  // Enter a fly pattern at the point nearest the current camera, so the flight
  // takes the short way in instead of always flying to the pattern's start.
  const startS = flyby && introFrom?.eye ? flyby.nearestSTo(introFrom.eye) : 0;
  state.overviewAnim = {
    mode,
    flyby,
    s: startS,
    lastFrame: null,
    startMs: now,
    lastMs: now,
    introFrom,
    introMs: now,
  };
  // The animation is the sole camera driver now; drop any parked chase state.
  state.cameraFlight = null;
  updateOverviewDebugLine();
  // On an instant (fresh-load) entry, jump straight to the first frame now
  // instead of waiting for the first animation tick — so the map snaps to the
  // route exactly like the static overview, with no flight from wherever the
  // camera was.
  if (instant) stepOverviewAnimation(now);
  ensureOverviewAnimationLoop();
  return true;
}

export function clearOverviewAnimation() {
  clearOverviewDebugLine();
  state.overviewAnim = null;
}

function ensureOverviewAnimationLoop() {
  if (state.overviewAnimLoopActive) return;
  state.overviewAnimLoopActive = true;
  const step = () => {
    // Stays alive as long as an animated overview owns the camera — including
    // while the rider moves, if the user chose to keep the overview up. It
    // yields only when the camera leaves overview (manual drag or the movement
    // loop switching to follow after auto-off).
    if (
      !state.overviewAnim || state.cameraMode !== "overview" ||
      !state.route.length || !state.map || state.userInteracting
    ) {
      updateOverviewDebugLine();
      state.overviewAnimLoopActive = false;
      return;
    }
    stepOverviewAnimation(performance.now());
    // Keep the ground dot's apparent size steady while the camera moves.
    if (state.riderDot) updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function stepOverviewAnimation(now) {
  const anim = state.overviewAnim;
  if (!anim) return;
  const dt = clamp((now - anim.lastMs) / 1000, 0, 0.5);
  anim.lastMs = now;

  let pose = null;
  if (anim.mode === "orbit") {
    const secondsPerRevolution = state.finishOrbitActive
      ? FINISH_ORBIT_SECONDS_PER_REV
      : focusedRouteRange() && state.overviewRoute !== state.route
        ? state.climbOrbitSecondsPerRev
        : OVERVIEW_ORBIT_SECONDS_PER_REV;
    const cam = orbitCamera(state.overviewCamera, (now - anim.startMs) / 1000, {
      secondsPerRevolution,
      direction: state.finishOrbitActive ? FINISH_ORBIT_DIRECTION : OVERVIEW_ORBIT_DIRECTION,
    });
    const eye = cam && cameraEyePosition(cam);
    if (eye) pose = { eye, center: cam.center, heading: cam.heading, roll: 0, fov: DEFAULT_MAP_FOV_DEGREES };
  } else if (anim.flyby) {
    anim.s = anim.flyby.advance(anim.s, dt);
    const frame = anim.flyby.frameAt(anim.s);
    anim.lastFrame = frame;
    pose = {
      eye: frame.eye,
      center: frame.lookAt,
      heading: null,
      roll: frame.bankDegrees,
      fov: frame.cameraFovDegrees,
    };
  }
  if (!pose) return;

  // Ease from the entry pose into the animated pose over the intro window.
  if (anim.introFrom && OVERVIEW_ANIM_INTRO_SECONDS > 0) {
    const t = (now - anim.introMs) / 1000 / OVERVIEW_ANIM_INTRO_SECONDS;
    if (t >= 1) {
      anim.introFrom = null;
    } else {
      const k = smoothstep(clamp(t, 0, 1));
      pose = {
        eye: lerpGeoPoint(anim.introFrom.eye, pose.eye, k),
        center: lerpGeoPoint(anim.introFrom.center, pose.center, k),
        heading: pose.heading,
        roll: lerpAngle(anim.introFrom.roll ?? 0, pose.roll ?? 0, k),
        fov: lerp(anim.introFrom.fov ?? DEFAULT_MAP_FOV_DEGREES, pose.fov ?? DEFAULT_MAP_FOV_DEGREES, k),
      };
    }
  }

  const camera = cameraFromEyeAndCenter(pose.eye, pose.center, pose.heading ?? Number(state.map.heading) ?? 0);
  state.map.center = { ...pose.center };
  state.map.heading = camera.heading;
  state.map.range = camera.range;
  state.map.tilt = camera.tilt;
  state.map.roll = pose.roll ?? 0;
  state.map.fov = pose.fov ?? DEFAULT_MAP_FOV_DEGREES;
  updateGalleryMetadataExport();
}

function lerpGeoPoint(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    altitude: (Number(a.altitude) || 0) + ((Number(b.altitude) || 0) - (Number(a.altitude) || 0)) * t,
  };
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerpAngle(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}
