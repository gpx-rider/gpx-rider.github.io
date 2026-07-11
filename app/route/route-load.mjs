// Route loading: GPX file/URL intake, applying parsed GPX to the app state,
// and the once-per-load route overview (name chip, difficulty classification,
// climbs list).

import { detectClimbs } from "./climbs.mjs";
import { focusClimb, syncFocusedClimbList } from "./climbs-ui.mjs";
import { clearDemoHistory, stopDemoMode, syncDemoModeUi } from "../demo/demo-mode.mjs";
import { classifyRoute } from "./difficulty.mjs";
import { createRideEstimator } from "../ride/eta.mjs";
import { resetGalleryMetadataExportForRoute } from "../gallery-ui/gallery-export.mjs";
import { updateStartButton } from "../ride/movement.mjs";
import { enterOverviewMode } from "../camera/overview-camera.mjs";
import { saveRide } from "../storage/persistence.mjs";
import { renderProfile } from "./profile-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import {
  enrichRoute,
  parseGpx,
  routeTotalAscent,
  routeTotalDistance,
} from "./route.mjs";
import { renderRoute } from "../map/route-render.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { formatAltitude, formatDistance } from "../core/units.mjs";

export async function loadGpxFile(event) {
  const [file] = event.target.files;
  if (!file) return;

  const text = await file.text();
  applyGpxText(text, { fallbackName: filenameToRouteName(file.name) });
}

// Gallery rides pass their curated title as `overrideName`, which wins over
// whatever technical name the GPX export itself carries (e.g. a
// map-tool-generated "Route from A to B").
export async function loadGpxFromUrl(url, overrideName, galleryMetadata = null) {
  const response = await fetch(url);
  const text = await response.text();
  applyGpxText(text, { overrideName, galleryMetadata });
}

function filenameToRouteName(filename) {
  return filename.replace(/\.[^./\\]+$/, "").trim() || null;
}

export function applyGpxText(text, { overrideName = null, fallbackName = null, galleryMetadata = null } = {}) {
  const { points: route, name: gpxName } = parseGpx(text);

  if (route.length < 2) {
    updateProgressLabel("That GPX file does not contain enough track points.");
    return;
  }

  stopDemoMode({ silent: true });
  clearDemoHistory();
  state.route = enrichRoute(route);
  state.routeName = overrideName || gpxName || fallbackName;
  state.galleryMetadata = galleryMetadata && typeof galleryMetadata === "object"
    ? structuredClone(galleryMetadata)
    : null;
  state.focusedClimbIndex = null;
  state.selectedProfileSegment = null;
  state.lastGalleryMetadataRefreshMs = 0;
  state.progressMeters = 0;
  state.simulating = false;
  state.lastTick = 0;
  state.profileHoverMeters = null;
  // A new route is a new ride: the ETA pace history starts over.
  state.rideEstimator = createRideEstimator();
  state.overviewActive = true;
  resetGalleryMetadataExportForRoute();
  enterOverviewMode({ instant: true });
  updateStartButton();
  renderRoute();
  renderProfile();
  updateRouteOverview();
  updateRideUi({ force: true });
  saveRide();

  els.startBtn.disabled = false;
  els.resetBtn.disabled = false;
  syncDemoModeUi();
}

// Route name (top-bar GPX chip), classification (difficulty stat tile) and
// detected climbs, shown once a GPX loads. All are cheap single passes over
// the whole route and only depend on its fixed distance/elevation totals,
// so this runs once per load rather than on every ride-progress tick like
// updateRideUi.
export function updateRouteOverview() {
  els.gpxChip.hidden = !state.routeName;
  els.gpxChipName.textContent = state.routeName ?? "";

  if (!state.route.length) {
    state.climbs = [];
    els.climbsSection.hidden = true;
    els.difficultyStat.textContent = "--";
    els.difficultyDetail.textContent = "";
    return;
  }

  const totalDistance = routeTotalDistance(state.route);
  const totalAscent = routeTotalAscent(state.route);
  const classification = classifyRoute(totalDistance, totalAscent);
  if (classification) {
    els.difficultyStat.textContent = classification.difficulty;
    els.difficultyDetail.textContent =
      `${classification.distanceClass} · ${classification.terrainClass}`;
  } else {
    els.difficultyStat.textContent = "--";
    els.difficultyDetail.textContent = "";
  }

  state.climbs = detectClimbs(state.route);
  els.climbsSection.hidden = state.climbs.length === 0;
  els.climbsList.replaceChildren(
    ...state.climbs.map((climb, index) => {
      const item = document.createElement("li");
      const index_ = document.createElement("span");
      index_.className = "climb-index";
      index_.textContent = `${index + 1}.`;
      const label = document.createElement("span");
      label.textContent =
        `${formatDistance(climb.startDistanceMeters, state.distanceUnits, 1)} → ` +
        `${formatDistance(climb.endDistanceMeters, state.distanceUnits, 1)} · ` +
        `${formatDistance(climb.lengthMeters, state.distanceUnits, 1)} · ` +
        `${formatAltitude(climb.gainMeters, state.distanceUnits)}`;
      const line = document.createElement("span");
      line.append(index_, document.createTextNode(" "), label);
      const grade = document.createElement("span");
      grade.className = "climb-grade";
      grade.textContent = `${climb.averageGradePercent.toFixed(1)}%`;
      item.append(line, grade);
      // Click (or keyboard-activate) a climb to jump to its foot. From the
      // overview surface this also drills into the configured climb camera and
      // highlights that segment; during a ride it keeps the normal route style.
      item.classList.add("climb-seekable");
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.title = "Jump to this climb";
      item.addEventListener("click", () => focusClimb(index));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusClimb(index);
        }
      });
      return item;
    }),
  );
  syncFocusedClimbList();
}
