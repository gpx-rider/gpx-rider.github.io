// Map geometry for the loaded route: the grade-colored top-down route line
// (with the focused-climb/segment highlight) and the rider marker — a small
// circular dot with a directional arrow that rotates to the current heading.

import { focusedRouteRange } from "../route/climbs-ui.mjs";
import { headingAt, interpolateRoutePoint } from "../route/route.mjs";
import { gradeColor } from "../route/profile.mjs";
import { gradeColoredRouteSegments, styledRouteSegments } from "./route-style.mjs";
import { state, updateProgressLabel } from "../core/state.mjs";
import {
  RIDER_MARKER_COLOR,
  RIDER_MARKER_RING_COLOR,
  RIDER_MARKER_SIZE_PIXELS,
  ROUTE_FOCUS_LINE_WIDTH,
  ROUTE_LINE_COLOR,
  ROUTE_LINE_WIDTH,
} from "../core/tuning.mjs";

export function renderRoute() {
  if (!state.map) {
    updateProgressLabel("The map is not available, so the route cannot be displayed.");
    return;
  }

  clearRouteFromMap();
  renderRouteLines(currentRouteLinePoints());
  renderRiderMarker(interpolateRoutePoint(state.route, state.progressMeters));
}

export function renderRouteLines(path) {
  if (!state.map) return;
  state.routeLines.forEach((line) => line.remove());
  state.routeLines = styledMapRouteSegments(path).map((segment) => {
    const line = L.polyline(
      segment.path.map((point) => [point.lat, point.lng]),
      {
        color: segment.color,
        weight: segment.focused ? ROUTE_FOCUS_LINE_WIDTH : ROUTE_LINE_WIDTH,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      },
    );
    line.addTo(state.map);
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
      distance <= focusedRange.endDistanceMeters,
    );
    return {
      key: `${color}|${focused ? "focus" : "normal"}`,
      color,
      focused,
    };
  });
}

// The route's own points, plus exact style boundaries at a focused range so
// the highlighted replacement starts/ends precisely instead of at the
// nearest existing vertex.
export function currentRouteLinePoints() {
  const focusedRange = focusedRouteRange();
  if (!focusedRange) return state.route;

  return [
    ...state.route,
    interpolateRoutePoint(state.route, focusedRange.startDistanceMeters),
    interpolateRoutePoint(state.route, focusedRange.endDistanceMeters),
  ]
    .sort((a, b) => a.distance - b.distance)
    .filter((point, index, all) => index === 0 || point.distance !== all[index - 1].distance);
}

function riderIcon() {
  return L.divIcon({
    className: "rider-marker",
    html:
      `<div class="rider-marker-ring" style="--rider-color:${RIDER_MARKER_COLOR};--rider-ring:${RIDER_MARKER_RING_COLOR}">` +
      `<div class="rider-marker-arrow"></div></div>`,
    iconSize: [RIDER_MARKER_SIZE_PIXELS, RIDER_MARKER_SIZE_PIXELS],
    iconAnchor: [RIDER_MARKER_SIZE_PIXELS / 2, RIDER_MARKER_SIZE_PIXELS / 2],
  });
}

export function renderRiderMarker(point) {
  if (!state.map) return;
  if (state.riderMarker) state.riderMarker.remove();
  state.riderMarker = L.marker([point.lat, point.lng], {
    icon: riderIcon(),
    zIndexOffset: 1000,
    interactive: false,
  }).addTo(state.map);
  updateRiderMarkerHeading();
}

export function updateRiderMarker(point) {
  if (!state.riderMarker) return;
  state.riderMarker.setLatLng([point.lat, point.lng]);
  updateRiderMarkerHeading();
}

function updateRiderMarkerHeading() {
  const arrow = state.riderMarker?.getElement()?.querySelector(".rider-marker-arrow");
  if (!arrow) return;
  arrow.style.transform = `rotate(${headingAt(state.route, state.progressMeters)}deg)`;
}

export function removeRiderMarker() {
  state.riderMarker?.remove();
  state.riderMarker = null;
}

export function clearRouteFromMap() {
  state.routeLines.forEach((line) => line.remove());
  removeRiderMarker();
  state.routeLines = [];
}

export function rebuildRouteStyle() {
  if (!state.route.length || !state.map) return;
  renderRouteLines(currentRouteLinePoints());
}
