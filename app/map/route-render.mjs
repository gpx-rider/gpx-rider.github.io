// Map geometry for the loaded route: the elevated 3D route lines (grade
// colours + focused-segment highlight), the rider dot (a Model3DElement mesh —
// see the CLAUDE.md notes on why not a polygon or a pin), the opt-in rider
// beacon, and the 2D minimap route + marker.

import { isFirstPersonCameraView } from "../camera/camera-ui.mjs";
import { clearOverviewDebugLine, updateOverviewDebugLine } from "../camera/camera-debug.mjs";
import { focusedRouteRange } from "../route/climbs-ui.mjs";
import { updateMapCamera } from "../camera/follow-camera.mjs";
import { destinationPoint, haversine } from "../core/geo.mjs";
import { gradeColor } from "../route/profile.mjs";
import {
  densifyRoute,
  interpolateRoutePoint,
  routeTotalDistance,
} from "../route/route.mjs";
import { gradeColoredRouteSegments, styledRouteSegments } from "./route-style.mjs";
import { state, updateProgressLabel } from "../core/state.mjs";
import {
  DEFAULT_BEACON_COLOR,
  RIDER_DOT_ALTITUDE_METERS,
  RIDER_DOT_DIAMETER_METERS,
  RIDER_DOT_MODEL_PATH,
  RIDER_DOT_ORIENTATION,
  RIDER_DOT_OVERVIEW_SCALE_FACTOR,
  RIDER_DOT_SCALE,
  ROUTE_FOCUS_LINE_WIDTH,
  ROUTE_FOCUS_OUTER_COLOR,
  ROUTE_FOCUS_OUTER_WIDTH,
  ROUTE_LINE_ALTITUDE_METERS,
  ROUTE_LINE_COLOR,
  ROUTE_LINE_MAX_POINTS,
  ROUTE_LINE_OUTER_COLOR,
  ROUTE_LINE_OUTER_WIDTH,
  ROUTE_LINE_SPACING_METERS,
  ROUTE_LINE_WIDTH,
} from "../core/tuning.mjs";

export const BEACON_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// The rider's ground marker mirrors the brand "GPX Rider" dot: a solid amber
// center with a paler amber ring. The 3D marker is an actual mesh (path in
// RIDER_DOT_MODEL_PATH, tuning.mjs) with those colors baked into its
// materials — RIDER_DOT_COLOR here only feeds the minimap's 2D marker icon
// and the Polyline3DElement fallback for browsers without Model3DElement.
const RIDER_DOT_COLOR = "#f6a52c";
const RIDER_DOT_RING_WIDTH_PIXELS = 8;
// Resolved against the app/ root (one level up from this module), not a path
// relative to the page, so the model loads correctly regardless of what path
// GPX Rider is served from (a local checkout, a fork's Pages URL with a
// repo-name prefix, etc). RIDER_DOT_MODEL_PATH is app/-relative.
const RIDER_DOT_MODEL_URL = new URL(RIDER_DOT_MODEL_PATH, new URL("../", import.meta.url));

export function renderRoute() {
  renderMinimapRoute();

  if (!state.map) {
    updateProgressLabel("Photorealistic 3D Maps are not available, so the route cannot be displayed.");
    return;
  }

  clearRouteFromMap();
  const currentPoint = interpolateRoutePoint(state.route, state.progressMeters);
  renderGoogle3DRoute(currentPoint);
}

export function renderMinimapRoute() {
  if (!state.minimapMap || !state.route.length) return;

  state.minimapPaths.forEach((line) => line.setMap(null));
  state.minimapPaths = [];

  const path = state.route.map((point) => ({ lat: point.lat, lng: point.lng }));
  const styledSegments = styledMapRouteSegments(state.route);
  state.minimapPaths = styledSegments.map((segment) => new google.maps.Polyline({
    path: segment.path.map((point) => ({ lat: point.lat, lng: point.lng })),
    map: state.minimapMap,
    strokeColor: segment.color,
    strokeOpacity: segment.focused ? 1 : 0.95,
    strokeWeight: segment.focused ? 6 : 3,
  }));

  const bounds = new google.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  state.minimapMap.fitBounds(bounds, 18);

  if (!state.minimapMarker) {
    state.minimapMarker = new google.maps.Marker({
      map: state.minimapMap,
      clickable: false,
      zIndex: 10,
      // Amber brand dot with a translucent amber ring, matching the 3D
      // rider marker and the "GPX Rider" logo dot.
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: RIDER_DOT_COLOR,
        fillOpacity: 1,
        strokeColor: RIDER_DOT_COLOR,
        strokeOpacity: 0.35,
        strokeWeight: 6,
      },
    });
  }

  updateMinimapPosition(state.route[0]);
}

export function updateMinimapPosition(point) {
  if (!state.minimapMarker) return;
  state.minimapMarker.setPosition({ lat: point.lat, lng: point.lng });
}

function renderGoogle3DRoute(currentPoint) {
  // CLAMP_TO_GROUND drapes the stroke onto the terrain mesh like a decal, so
  // on steep slopes the line smears down the hillside into wide blobs. A line
  // held a couple of meters above the ground renders with a constant
  // screen-pixel width instead. Densify the path so the elevated segments
  // stay short enough to follow the terrain between GPX points.
  renderRouteLines(currentRouteLinePoints());

  renderRiderDot(currentPoint);
  updateMapCamera();
  updateOverviewDebugLine();
}

export function renderRouteLines(linePoints) {
  const { AltitudeMode, Polyline3DElement } = state.maps3d;
  if (!Polyline3DElement) return;
  state.routeLines.forEach((line) => line.remove());
  state.routeLines = [];

  const styledSegments = styledMapRouteSegments(linePoints);

  // Use each polyline's built-in casing, never a second stacked line for the
  // outline: stacked geometries z-fight at overview distances.
  state.routeLines = styledSegments.map((segment) => {
    const line = new Polyline3DElement({
      altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
      path: segment.path.map((point) => ({
        lat: point.lat,
        lng: point.lng,
        altitude: ROUTE_LINE_ALTITUDE_METERS,
      })),
      strokeColor: segment.color,
      strokeWidth: segment.focused ? ROUTE_FOCUS_LINE_WIDTH : ROUTE_LINE_WIDTH,
      outerColor: segment.focused ? ROUTE_FOCUS_OUTER_COLOR : ROUTE_LINE_OUTER_COLOR,
      outerWidth: segment.focused ? ROUTE_FOCUS_OUTER_WIDTH : ROUTE_LINE_OUTER_WIDTH,
    });
    state.map.append(line);
    return line;
  });
}

function styledMapRouteSegments(path) {
  const focusedRange = focusedRouteRange();
  if (!focusedRange && state.routeGradeColorsEnabled) {
    return gradeColoredRouteSegments(state.route, path, gradeColor);
  }
  return styledRouteSegments(state.route, path, ({ distance, grade }) => {
    const color = state.routeGradeColorsEnabled ? gradeColor(grade) : ROUTE_LINE_COLOR;
    const focused = Boolean(
      focusedRange &&
      distance >= focusedRange.startDistanceMeters &&
      distance <= focusedRange.endDistanceMeters
    );
    return {
      key: `${color}|${focused ? "focus" : "normal"}`,
      color,
      focused,
    };
  });
}

export function currentRouteLinePoints() {
  const spacing = Math.max(
    ROUTE_LINE_SPACING_METERS,
    routeTotalDistance(state.route) / ROUTE_LINE_MAX_POINTS,
  );
  const points = densifyRoute(state.route, spacing);
  const focusedRange = focusedRouteRange();
  if (!focusedRange) return points;

  // Add exact style boundaries so the highlighted replacement starts and ends
  // at the focused range boundaries rather than the nearest densified vertex.
  return [
    ...points,
    interpolateRoutePoint(state.route, focusedRange.startDistanceMeters),
    interpolateRoutePoint(state.route, focusedRange.endDistanceMeters),
  ]
    .sort((a, b) => a.distance - b.distance)
    .filter((point, index, all) => index === 0 || point.distance !== all[index - 1].distance);
}

export function renderRiderDot(point) {
  const { AltitudeMode, Model3DElement, Polyline3DElement } = state.maps3d;

  if (isFirstPersonCameraView()) {
    removeRiderMarker();
    return;
  }

  renderRiderBeacon();

  // A Model3DElement (an actual mesh, RIDER_DOT_MODEL_PATH in tuning.mjs),
  // not a Polygon3DElement: a filled ground polygon is meant for static
  // terrain-draped areas, and re-tessellating one every frame as the rider
  // moves produced two separate failures confirmed in a real browser — the
  // fill rendering solid black at ordinary follow-camera distances
  // (independent of winding, altitude, and extrusion, all tried), and a
  // faceted/streaky look from the constant re-triangulation.
  // RIDER_DOT_ORIENTATION and RIDER_DOT_SCALE are tuned for the specific
  // model at RIDER_DOT_MODEL_PATH — see the comments there before swapping
  // in a different model.
  if (Model3DElement) {
    state.riderDot = new Model3DElement({
      src: RIDER_DOT_MODEL_URL,
      altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
      orientation: RIDER_DOT_ORIENTATION,
      scale: riderDotScale(),
    });
    state.map.append(state.riderDot);
    updateRiderDot(point);
    return;
  }

  if (!Polyline3DElement) return;
  state.riderDot = new Polyline3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    strokeColor: RIDER_DOT_COLOR,
    strokeWidth: RIDER_DOT_RING_WIDTH_PIXELS,
  });
  state.map.append(state.riderDot);
  updateRiderDot(point);
}

export function renderRiderBeacon() {
  if (state.riderBeacon) {
    state.riderBeacon.remove();
    state.riderBeacon = null;
  }

  const { AltitudeMode, Polygon3DElement } = state.maps3d ?? {};
  if (isFirstPersonCameraView() || !state.beaconEnabled || !Polygon3DElement || !state.map) return;

  // Extruded from the ground up to the path altitude, with occluded segments
  // drawn so nearby trees and buildings never hide the rider's position.
  state.riderBeacon = new Polygon3DElement({
    altitudeMode: AltitudeMode?.RELATIVE_TO_GROUND,
    extruded: true,
    drawsOccludedSegments: true,
    fillColor: beaconFillColor(),
    strokeWidth: 0,
  });
  state.map.append(state.riderBeacon);
}

export function removeRiderMarker() {
  if (state.riderDot) state.riderDot.remove();
  if (state.riderBeacon) state.riderBeacon.remove();
  state.riderDot = null;
  state.riderBeacon = null;
  state.lastRiderDot = null;
  state.lastRiderBeacon = null;
}

function beaconFillColor() {
  const hex = BEACON_COLOR_PATTERN.test(state.beaconColor) ? state.beaconColor : DEFAULT_BEACON_COLOR;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${state.beaconOpacity})`;
}

export function clearRouteFromMap() {
  state.routeLines.forEach((line) => line.remove());
  removeRiderMarker();
  clearOverviewDebugLine();

  state.routeLines = [];
}

export function updateRiderDot(position) {
  if (isFirstPersonCameraView()) {
    removeRiderMarker();
    return;
  }

  if (state.riderBeacon) {
    // Real-world-sized geometry, so a coarse circle keeps the extruded
    // cylinder cheap to re-tessellate as it follows the rider. Throttled
    // the same way the polygon fallback below is, since it's still a
    // rebuilt-every-update polygon.
    const last = state.lastRiderBeacon;
    if (!last || haversine(last, position) >= (state.beaconDiameterMeters / 2) * 0.08) {
      state.lastRiderBeacon = { lat: position.lat, lng: position.lng };
      state.riderBeacon.path = riderCircleCoordinates(
        position,
        state.beaconDiameterMeters / 2,
        state.beaconHeightMeters,
        15,
      );
    }
  }

  if (state.riderDot instanceof state.maps3d?.Model3DElement) {
    // Just moving the model's position, not rebuilding a mesh — cheap
    // enough to do every frame, no throttling needed.
    state.riderDot.position = { lat: position.lat, lng: position.lng, altitude: RIDER_DOT_ALTITUDE_METERS };
    state.riderDot.scale = riderDotScale();
    return;
  }

  if (state.riderDot) {
    const radius = (RIDER_DOT_DIAMETER_METERS * riderDotSizeFactor()) / 2;
    // Rebuilding the polygon re-tessellates it in the map engine, which is
    // far too expensive to do per frame. Skip updates smaller than a pixel
    // or two on screen; the camera still follows the rider every frame.
    const last = state.lastRiderDot;
    if (last && haversine(last, position) < radius * 0.08) return;
    state.lastRiderDot = { lat: position.lat, lng: position.lng };
    state.riderDot.path = riderCircleCoordinates(position, radius, RIDER_DOT_ALTITUDE_METERS);
  }
}

function riderDotScale() {
  return RIDER_DOT_SCALE * riderDotSizeFactor();
}

function riderDotSizeFactor() {
  return state.overviewActive || state.cameraMode === "overview" ? RIDER_DOT_OVERVIEW_SCALE_FACTOR : 1;
}

function riderCircleCoordinates(center, radiusMeters, altitude = 0, stepDegrees = 6) {
  // Walking compass bearings upward (N, E, S, W, ...) traces the ring
  // clockwise as seen from above. A filled polygon's normal follows the
  // right-hand rule from its vertex order, so a clockwise-from-above ring
  // faces its front side down into the ground — the lit fill then reads as
  // almost black (no light hits the face pointing away from the sky) even
  // though the stroke, which isn't lit the same way, still shows its true
  // color. Walking bearings downward instead traces the ring
  // counter-clockwise from above so the fill faces up and renders its real
  // color.
  const points = [];
  for (let angle = 360; angle > 0; angle -= stepDegrees) {
    const point = destinationPoint(center, angle, radiusMeters);
    points.push({ ...point, altitude });
  }
  return points;
}

export function rebuildRouteStyle() {
  if (!state.route.length) return;
  renderMinimapRoute();
  if (!state.map || !state.maps3d) return;
  renderRouteLines(currentRouteLinePoints());
}

export function rebuildRiderBeacon() {
  renderRiderBeacon();
  if (!state.route.length || !state.riderBeacon) return;
  state.lastRiderBeacon = null;
  updateRiderDot(interpolateRoutePoint(state.route, state.progressMeters));
}
