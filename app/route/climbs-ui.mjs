// Climbs & custom profile segments: focusing a detected climb or a
// drag-selected segment (seek + highlight + focused camera), the live
// current/next-climb status in the side panel, and the map HUD's top-center
// climb/segment banner.

import { syncOverviewControls } from "../camera/camera-ui.mjs";
import { clamp } from "../core/geo.mjs";
import { isMoving, seekToMeters } from "../ride/movement.mjs";
import { enterOverviewMode } from "../camera/overview-camera.mjs";
import { gradeColor } from "./profile.mjs";
import { renderProfile } from "./profile-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import {
  ascentAt,
  descentAt,
  gradeAt,
  interpolateRoutePoint,
  routeTotalDistance,
  sliceRoute,
} from "./route.mjs";
import { rebuildRouteStyle } from "../map/route-render.mjs";
import { registerHudComponent } from "../hud/screen-manager.mjs";
import { els, state } from "../core/state.mjs";
import {
  CLIMB_BANNER_APPROACH_METERS,
  CLIMB_BANNER_MINI_BAR_COUNT,
  CLIMB_CATEGORIES,
  PROFILE_SEGMENT_SELECTION_MIN_METERS,
  PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION,
} from "../core/tuning.mjs";
import { formatAltitude, formatDistance } from "../core/units.mjs";

// The climb/segment banner heads the center column; anything else showing
// there (the demo chip) stacks below it automatically.
export function registerClimbBannerHud() {
  registerHudComponent({ id: "climb-banner", region: "center", weight: 10, element: els.climbBanner });
}

export function focusClimb(index) {
  const climb = state.climbs[index];
  if (!climb) return;
  const shouldEnterClimbOverview = state.overviewActive && !isMoving();
  const climbRoute = sliceRoute(
    state.route,
    climb.startDistanceMeters,
    climb.endDistanceMeters,
  );
  if (climbRoute.length < 2) return;

  seekToMeters(climb.startDistanceMeters);
  state.selectedProfileSegment = null;
  state.focusedClimbIndex = shouldEnterClimbOverview ? index : null;
  syncFocusedClimbList();
  renderProfile();
  rebuildRouteStyle();
  if (shouldEnterClimbOverview) {
    enterOverviewMode({
      route: climbRoute,
      mode: state.climbFocusMode,
    });
  }
}

export function focusProfileSegment(startDistance, endDistance) {
  const segment = buildProfileSegment(startDistance, endDistance);
  if (!segment) return;

  const shouldEnterSegmentOverview = state.overviewActive && !isMoving();
  const segmentRoute = sliceRoute(
    state.route,
    segment.startDistanceMeters,
    segment.endDistanceMeters,
  );
  if (segmentRoute.length < 2) return;

  seekToMeters(segment.startDistanceMeters);
  state.selectedProfileSegment = segment;
  state.focusedClimbIndex = null;
  syncFocusedClimbList();
  renderProfile();
  rebuildRouteStyle();
  if (shouldEnterSegmentOverview) {
    enterOverviewMode({
      route: segmentRoute,
      mode: state.climbFocusMode,
    });
  } else {
    updateRideUi({ force: true });
  }
  syncOverviewControls();
}

export function buildProfileSegment(startDistance, endDistance) {
  if (!state.route.length) return null;
  const total = routeTotalDistance(state.route);
  const start = clamp(Math.min(startDistance, endDistance), 0, total);
  const end = clamp(Math.max(startDistance, endDistance), 0, total);
  const minLength = Math.min(
    PROFILE_SEGMENT_SELECTION_MIN_METERS,
    total * PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION,
  );
  if (end - start < minLength) return null;

  const startPoint = interpolateRoutePoint(state.route, start);
  const endPoint = interpolateRoutePoint(state.route, end);
  const ascent = Math.max(0, ascentAt(state.route, end) - ascentAt(state.route, start));
  const descent = Math.max(0, descentAt(state.route, end) - descentAt(state.route, start));
  return {
    startDistanceMeters: start,
    endDistanceMeters: end,
    lengthMeters: end - start,
    ascentMeters: ascent,
    descentMeters: descent,
    startElevationMeters: startPoint.ele,
    endElevationMeters: endPoint.ele,
  };
}

export function focusedRouteRange() {
  if (state.selectedProfileSegment) return state.selectedProfileSegment;
  return state.climbs[state.focusedClimbIndex] ?? null;
}

export function clearSelectedProfileSegment() {
  if (!state.selectedProfileSegment) return;
  state.selectedProfileSegment = null;
  state.profileHoverMeters = null;
  renderProfile();
  rebuildRouteStyle();
  if (state.overviewActive && state.overviewRoute !== state.route && state.focusedClimbIndex === null) {
    enterOverviewMode();
  } else {
    syncOverviewControls();
    updateRideUi({ force: true });
  }
}

export function syncFocusedClimbList() {
  [...els.climbsList.children].forEach((item, index) => {
    item.classList.toggle("focused", index === state.focusedClimbIndex);
  });
}

// Live "current climb" / "next climb" status shown above the climbs list
// while riding. Reuses the climbs detected once at route load (state.climbs)
// rather than re-scanning the route every tick — those boundaries already
// tolerate the flat/downhill noise a naive live-grade check would flicker
// on (see CLIMB_MERGE_GAP_METERS / CLIMB_DESCENT_TOLERANCE_METERS).
export function updateClimbStatus(point) {
  if (!state.climbs.length) return;

  const progress = state.progressMeters;
  const currentIndex = state.climbs.findIndex(
    (climb) => progress >= climb.startDistanceMeters && progress <= climb.endDistanceMeters,
  );

  [...els.climbsList.children].forEach((item, index) => {
    item.classList.toggle("active", index === currentIndex);
  });

  if (currentIndex !== -1) {
    const climb = state.climbs[currentIndex];
    const remainingDistance = Math.max(0, climb.endDistanceMeters - progress);
    const remainingAscent = Math.max(0, climb.endElevationMeters - point.ele);
    const remainingGrade = remainingDistance > 0 ? (remainingAscent / remainingDistance) * 100 : 0;
    els.climbStatusHeadline.textContent = `Climbing — climb ${currentIndex + 1} of ${state.climbs.length}`;
    els.climbStatusDetail.textContent =
      `${formatDistance(remainingDistance, state.distanceUnits, 1)} left · ` +
      `${formatAltitude(remainingAscent, state.distanceUnits)} to climb · ` +
      `${remainingGrade.toFixed(1)}% avg remaining`;
    return;
  }

  const next = state.climbs.find((climb) => climb.startDistanceMeters > progress);
  if (!next) {
    els.climbStatusHeadline.textContent = "No more climbs";
    els.climbStatusDetail.textContent = "";
    return;
  }

  const distanceToClimb = next.startDistanceMeters - progress;
  els.climbStatusHeadline.textContent = `Next climb in ${formatDistance(distanceToClimb, state.distanceUnits, 1)}`;
  els.climbStatusDetail.textContent =
    `${formatDistance(next.lengthMeters, state.distanceUnits, 1)} · ` +
    `${formatAltitude(next.gainMeters, state.distanceUnits)} · ` +
    `${next.averageGradePercent.toFixed(1)}% avg`;
}

// Plain-language climb category from average grade alone (see CLIMB_CATEGORIES).
function climbCategory(averageGradePercent) {
  return (
    CLIMB_CATEGORIES.find((category) => averageGradePercent <= category.max_average_grade_percent) ??
    CLIMB_CATEGORIES.at(-1)
  );
}

// Steepest grade anywhere on the climb, sampled and cached on the climb object
// (climbs are re-detected on every route load, so the cache can't go stale).
function climbMaxGrade(climb) {
  if (climb.maxGradePercent != null) return climb.maxGradePercent;
  let max = climb.averageGradePercent;
  for (let i = 0; i <= CLIMB_BANNER_MINI_BAR_COUNT; i += 1) {
    const distance = climb.startDistanceMeters + (i / CLIMB_BANNER_MINI_BAR_COUNT) * climb.lengthMeters;
    max = Math.max(max, gradeAt(state.route, distance));
  }
  climb.maxGradePercent = max;
  return max;
}

// Grade-coloured mini elevation profile of a climb, as bar elements. Reuses
// profile.mjs#gradeColor so the colours match the main profile and gallery.
function buildClimbMiniBars(climb) {
  const span = Math.max(1, climb.endElevationMeters - climb.startElevationMeters);
  const bars = [];
  for (let i = 0; i < CLIMB_BANNER_MINI_BAR_COUNT; i += 1) {
    const midDistance =
      climb.startDistanceMeters + ((i + 0.5) / CLIMB_BANNER_MINI_BAR_COUNT) * climb.lengthMeters;
    const ele = interpolateRoutePoint(state.route, midDistance).ele;
    const heightFraction = clamp((ele - climb.startElevationMeters) / span, 0, 1);
    const bar = document.createElement("i");
    // Floor the height so even the foot of the climb reads as a bar, not a gap.
    bar.style.height = `${12 + heightFraction * 88}%`;
    bar.style.background = gradeColor(gradeAt(state.route, midDistance));
    bars.push(bar);
  }
  return bars;
}

// Top-center banner: selected segment stats while riding, otherwise a detected
// climb or the next climb within CLIMB_BANNER_APPROACH_METERS; hidden otherwise.
export function updateFullscreenClimbBanner(point) {
  if (state.selectedProfileSegment && isMoving()) {
    showSegmentBanner(state.selectedProfileSegment);
    return;
  }
  els.segmentBanner.hidden = true;

  if (!state.climbs.length) {
    els.climbBanner.hidden = true;
    return;
  }

  const progress = state.progressMeters;
  const total = state.climbs.length;
  const currentIndex = state.climbs.findIndex(
    (climb) => progress >= climb.startDistanceMeters && progress <= climb.endDistanceMeters,
  );
  if (currentIndex !== -1) {
    showOnClimbBanner(state.climbs[currentIndex], point, `Climb ${currentIndex + 1} of ${total}`);
    return;
  }

  const nextIndex = state.climbs.findIndex((climb) => climb.startDistanceMeters > progress);
  const next = nextIndex === -1 ? null : state.climbs[nextIndex];
  if (next && next.startDistanceMeters - progress <= CLIMB_BANNER_APPROACH_METERS) {
    showAheadClimbBanner(next, next.startDistanceMeters - progress, `Climb ${nextIndex + 1} of ${total}`);
    return;
  }

  els.climbBanner.hidden = true;
}

function showAheadClimbBanner(climb, distanceToClimb, orderLabel) {
  els.climbBanner.hidden = false;
  els.climbBannerAhead.hidden = false;
  els.climbBannerOn.hidden = true;
  els.segmentBanner.hidden = true;
  els.cbAheadOrder.textContent = orderLabel;

  const category = climbCategory(climb.averageGradePercent);
  els.cbCategory.textContent = `${category.name} CLIMB`;
  els.cbCategory.style.background = category.color;
  els.cbInDist.style.color = category.color;
  els.cbMax.style.color = category.color;

  const [inValue, inUnit] = formatDistance(distanceToClimb, state.distanceUnits, 1).split(" ");
  els.cbInDist.textContent = inValue;
  els.cbInUnit.textContent = inUnit;

  // The mini profile only changes when the upcoming climb does — rebuild its
  // 30 bars then, not every tick.
  if (state.bannerClimbKey !== climb.startDistanceMeters) {
    state.bannerClimbKey = climb.startDistanceMeters;
    els.cbMini.replaceChildren(...buildClimbMiniBars(climb));
  }
  els.cbBaseAlt.textContent = formatAltitude(climb.startElevationMeters, state.distanceUnits);
  els.cbPeakAltMini.textContent = formatAltitude(climb.endElevationMeters, state.distanceUnits);

  els.cbLen.textContent = formatDistance(climb.lengthMeters, state.distanceUnits, 1);
  els.cbGain.textContent = formatAltitude(climb.gainMeters, state.distanceUnits);
  els.cbAvg.textContent = `${climb.averageGradePercent.toFixed(1)}%`;
  els.cbMax.textContent = `${climbMaxGrade(climb).toFixed(1)}%`;
}

function showOnClimbBanner(climb, point, orderLabel) {
  els.climbBanner.hidden = false;
  els.climbBannerAhead.hidden = true;
  els.climbBannerOn.hidden = false;
  els.segmentBanner.hidden = true;
  els.cbOnOrder.textContent = orderLabel;
  state.bannerClimbKey = null;

  const distanceToTop = Math.max(0, climb.endDistanceMeters - state.progressMeters);
  const ascentToGo = Math.max(0, climb.endElevationMeters - point.ele);
  const gradeLeft = distanceToTop > 0 ? (ascentToGo / distanceToTop) * 100 : 0;

  els.cbToTop.textContent = formatDistance(distanceToTop, state.distanceUnits, 1);
  els.cbToGo.textContent = formatAltitude(ascentToGo, state.distanceUnits);
  els.cbCurAlt.textContent = formatAltitude(point.ele, state.distanceUnits);
  els.cbPeakAlt.textContent = formatAltitude(climb.endElevationMeters, state.distanceUnits);
  els.cbGradeLeft.textContent = `${gradeLeft.toFixed(1)}%`;

  // Two unlabelled bars: blue = distance through the climb, amber = ascent.
  const distanceFraction = climb.lengthMeters > 0
    ? (state.progressMeters - climb.startDistanceMeters) / climb.lengthMeters
    : 0;
  // Cumulative (noise-filtered) ascent so far, not raw current elevation —
  // a raw-elevation fraction dips whenever the rider loses a little altitude
  // mid-climb, even though the climb's total ascent-to-date never decreases.
  const ascentSoFar = Math.max(
    0,
    ascentAt(state.route, state.progressMeters) - ascentAt(state.route, climb.startDistanceMeters),
  );
  const ascentFraction = climb.gainMeters > 0 ? ascentSoFar / climb.gainMeters : 0;
  els.cbDistFill.style.width = `${clamp(distanceFraction, 0, 1) * 100}%`;
  els.cbAscFill.style.width = `${clamp(ascentFraction, 0, 1) * 100}%`;
}

function showSegmentBanner(segment) {
  els.climbBanner.hidden = false;
  els.climbBannerAhead.hidden = true;
  els.climbBannerOn.hidden = true;
  els.segmentBanner.hidden = false;
  state.bannerClimbKey = null;

  els.sbStart.textContent = formatDistance(segment.startDistanceMeters, state.distanceUnits, 1);
  els.sbEnd.textContent = formatDistance(segment.endDistanceMeters, state.distanceUnits, 1);
  els.sbLen.textContent = formatDistance(segment.lengthMeters, state.distanceUnits, 1);
  els.sbAsc.textContent = formatAltitude(segment.ascentMeters, state.distanceUnits);
  els.sbDesc.textContent = formatAltitude(segment.descentMeters, state.distanceUnits);
}
