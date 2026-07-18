// Top-down map view: the follow/overview/manual mode state machine that used
// to live across camera-ui.mjs, overview-camera.mjs and follow-camera.mjs.
// There is no 3D camera anymore — "the view" is just what Leaflet's own
// panTo/fitBounds/zoom give a plain top-down slippy map, so this module is a
// thin state machine on top of that instead of a physics-based chase.
//
// Three map modes (state.mapMode):
//   "follow"  — the map recenters on the rider each ride-UI tick (if
//               state.followRider is on).
//   "overview" — the map is fitted to the whole route, or a focused climb/
//               segment, and ride ticks leave it alone.
//   "manual"  — the user dragged or zoomed the map by hand; nothing
//               recenters it until they toggle overview or press recenter.

import { focusedRouteRange } from "../route/climbs-ui.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { interpolateRoutePoint } from "../route/route.mjs";
import { els, state } from "../core/state.mjs";
import { MAP_FOLLOW_ZOOM, MAP_OVERVIEW_PADDING_PIXELS } from "../core/tuning.mjs";

// Wraps a Leaflet call we make ourselves so the drag/zoom listeners below
// (which detect a *manual* map grab) don't mistake our own programmatic
// panTo/fitBounds/setZoom for one — Leaflet fires the same movestart/
// zoomstart events either way, synchronously within the call.
function withProgrammaticMove(fn) {
  state.programmaticMapMove = true;
  try {
    fn();
  } finally {
    state.programmaticMapMove = false;
  }
}

export function bindManualMapCapture() {
  state.map.on("dragstart", enterManualModeIfUserDriven);
  state.map.on("zoomstart", enterManualModeIfUserDriven);
}

function enterManualModeIfUserDriven() {
  if (state.programmaticMapMove || state.mapMode === "manual") return;
  state.mapMode = "manual";
  state.overviewActive = false;
  syncOverviewControls();
}

// Frame the whole loaded route (or a focused climb/segment when `route` is
// passed). A fresh load snaps there instantly (a new route can be on the
// other side of the world); anything else eases with Leaflet's own pan/zoom
// animation.
export function enterOverviewMode({ route = state.route, instant = false } = {}) {
  if (!route.length || !state.map) return;
  state.overviewActive = true;
  state.overviewRoute = route;
  state.mapMode = "overview";
  syncOverviewControls();

  const bounds = L.latLngBounds(route.map((point) => [point.lat, point.lng]));
  withProgrammaticMove(() => {
    state.map.fitBounds(bounds, {
      padding: [MAP_OVERVIEW_PADDING_PIXELS, MAP_OVERVIEW_PADDING_PIXELS],
      animate: !instant,
    });
  });
}

export function returnFromClimbOverview() {
  if (state.route.length) enterOverviewMode();
}

// Leaves the overview and returns the map to following the rider.
export function returnToFollow({ instant = false } = {}) {
  state.overviewActive = false;
  state.mapMode = "follow";
  state.overviewRoute = state.route;
  syncOverviewControls();
  if (!state.route.length) return;
  panToRider(interpolateRoutePoint(state.route, state.progressMeters), { instant });
}

export function toggleRouteOverview() {
  if (!state.route.length) {
    syncOverviewControls();
    return;
  }
  // A climb/segment-focused overview is one level deeper than the
  // whole-route overview: the button returns to that overview first, then
  // (pressed again) leaves overview entirely.
  const rangeFocused = state.overviewActive && focusedRouteRange() && state.overviewRoute !== state.route;
  if (rangeFocused) enterOverviewMode();
  else if (state.overviewActive) returnToFollow();
  else enterOverviewMode();
}

export function updateCenterRiderFromControl() {
  state.followRider = els.centerRiderInput.checked;
  syncCenterRiderButton();
  saveSettings();
}

export function syncCenterRiderButton() {
  els.centerRiderInput.checked = state.followRider;
  els.centerRiderBtn.setAttribute("aria-pressed", String(state.followRider));
}

export function syncOverviewControls() {
  const hasRoute = state.route.length > 1;
  const active = hasRoute && state.overviewActive;
  const rangeFocused = active && focusedRouteRange() && state.overviewRoute !== state.route;
  const wholeRouteActive = active && !rangeFocused;

  els.mapOverviewControl.classList.toggle("active", wholeRouteActive);
  els.overviewToggleBtn.disabled = !hasRoute;
  els.overviewToggleBtn.setAttribute("aria-pressed", String(wholeRouteActive));
  const label = wholeRouteActive ? "Return to rider view" : "Show route overview";
  els.overviewToggleBtn.title = label;
  els.overviewToggleBtn.setAttribute("aria-label", label);

  els.climbOverviewControl.hidden = !rangeFocused;
  els.climbOverviewControl.classList.toggle("active", rangeFocused);
  els.climbOverviewToggleBtn.setAttribute("aria-pressed", String(rangeFocused));
}

// Called on the slow ride-UI cadence (not every frame — panTo's own glide
// animation reads better at a few updates a second than restarted every
// frame) to keep the rider under the map center while following.
export function updateMapFollow(point) {
  if (!state.map || !state.route.length) return;
  if (state.mapMode !== "follow" || !state.followRider) return;
  panToRider(point);
}

function panToRider(point, { instant = false } = {}) {
  withProgrammaticMove(() => {
    if (instant) state.map.setView([point.lat, point.lng], Math.max(state.map.getZoom(), MAP_FOLLOW_ZOOM), { animate: false });
    else state.map.panTo([point.lat, point.lng], { animate: true, duration: 0.3 });
  });
}
