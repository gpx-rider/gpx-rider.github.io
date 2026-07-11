// Map HUD & fullscreen surface: the fullscreen clock chip, HUD tile
// order/visibility (drag-to-reorder controls in Settings › HUD), metric tile
// layout, the data dock collapse, fullscreen enter/exit, and the map
// screenshot action. The HUD is the same surface windowed and fullscreen —
// entering fullscreen only resizes the container (see CLAUDE.md).

import { clamp } from "../core/geo.mjs";
import { registerHudComponent } from "./screen-manager.mjs";
import { applyDisplaySettings } from "../settings/settings-ui.mjs";
import { saveSettings } from "../storage/persistence.mjs";
import { renderProfile } from "../route/profile-ui.mjs";
import { updateRideUi } from "../ride/ride-ui.mjs";
import { gradeAt } from "../route/route.mjs";
import { captureViewportJpeg, parseAspectRatio } from "../map/screenshot.mjs";
import { els, state, updateProgressLabel } from "../core/state.mjs";
import { currentRideTimerSeconds } from "../ride/telemetry-ui.mjs";
import { exitTheaterMode } from "./theater-mode.mjs";
import { updateTrainingMeters } from "../ride/training-zones.mjs";
import {
  DEFAULT_HUD_FIELD_ORDER,
  FULLSCREEN_CLOCK_REFRESH_MS,
} from "../core/tuning.mjs";
import { formatDuration, formatLocalTime } from "../core/units.mjs";

// --- Fullscreen HUD clock ------------------------------------------------------

// Top-left chip ride stats. The local wall clock has its own timer below so
// seconds keep advancing while the rider is stationary.
export function updateFullscreenClock(riddenText, ascentText = "--") {
  els.fsClockElapsed.textContent = formatDuration(currentRideTimerSeconds(), state.durationFormat);
  els.fsClockDistance.textContent = riddenText;
  els.fsClockAscent.textContent = ascentText;
}

export function updateFullscreenLocalTime() {
  els.fsClockLocal.textContent = formatLocalTime(new Date(), state.timeFormat);
}

function startFullscreenClock() {
  clearTimeout(state.fullscreenClockTimer);
  updateFullscreenLocalTime();
  state.fullscreenClockTimer = setTimeout(startFullscreenClock, FULLSCREEN_CLOCK_REFRESH_MS);
}

// --- HUD tile order & visibility -------------------------------------------------

export function applyHudFieldOrder() {
  state.hudFieldOrder = normalizeHudOrder(state.hudFieldOrder);
  state.hudVisibleCount = clamp(Math.round(state.hudVisibleCount), 1, state.hudFieldOrder.length);
  const visibleKeys = new Set(state.hudFieldOrder.slice(0, state.hudVisibleCount));
  const tileByKey = new Map([...els.hudTiles].map((tile) => [tile.dataset.hud, tile]));
  state.hudFieldOrder.forEach((key) => {
    const tile = tileByKey.get(key);
    if (tile) {
      tile.dataset.hudFieldKey = key;
      tile.draggable = true;
      bindHudDragTarget(tile);
      els.fullscreenHud.append(tile);
    }
  });
  els.hudTiles.forEach((tile) => {
    tile.hidden = !visibleKeys.has(tile.dataset.hud);
  });
  syncHudVisibleControls();
}

export function normalizeHudOrder(order) {
  const known = new Set(DEFAULT_HUD_FIELD_ORDER);
  const unique = [];
  for (const key of Array.isArray(order) ? order : []) {
    if (known.has(key) && !unique.includes(key)) unique.push(key);
  }
  for (const key of DEFAULT_HUD_FIELD_ORDER) {
    if (!unique.includes(key)) unique.push(key);
  }
  return unique;
}

export function renderHudOrderControls() {
  if (!els.hudOrderList) return;
  state.hudFieldOrder = normalizeHudOrder(state.hudFieldOrder);
  els.hudOrderList.replaceChildren(
    ...state.hudFieldOrder.map((key) => {
      const row = document.createElement("div");
      row.className = "hud-order-row";
      row.draggable = true;
      row.dataset.hudFieldKey = key;

      const handle = document.createElement("span");
      handle.className = "hud-order-handle";
      handle.textContent = "Drag";
      handle.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.textContent = hudFieldLabel(key);

      const unit = document.createElement("i");
      unit.textContent = hudFieldUnit(key);

      const text = document.createElement("div");
      text.className = "hud-order-text";
      text.append(label, unit);

      bindHudDragTarget(row);
      row.append(handle, text);
      return row;
    }),
  );
  syncHudVisibleControls();
}

function bindHudDragTarget(element) {
  if (element.dataset.hudDragBound === "true") return;
  element.dataset.hudDragBound = "true";
  element.addEventListener("dragstart", handleHudDragStart);
  element.addEventListener("dragover", handleHudDragOver);
  element.addEventListener("dragleave", handleHudDragLeave);
  element.addEventListener("drop", handleHudDrop);
  element.addEventListener("dragend", handleHudDragEnd);
}

function handleHudDragStart(event) {
  state.draggedHudField = event.currentTarget.dataset.hudFieldKey;
  event.currentTarget.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggedHudField);
  }
}

function handleHudDragOver(event) {
  event.preventDefault();
  if (!state.draggedHudField || event.currentTarget.dataset.hudFieldKey === state.draggedHudField) return;
  event.currentTarget.classList.add("drag-over");
}

function handleHudDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

function handleHudDrop(event) {
  event.preventDefault();
  const from = state.draggedHudField;
  const to = event.currentTarget.dataset.hudFieldKey;
  if (!from || !to || from === to) return;
  const next = state.hudFieldOrder.filter((key) => key !== from);
  const toIndex = next.indexOf(to);
  if (toIndex === -1) return;
  next.splice(toIndex, 0, from);
  state.hudFieldOrder = normalizeHudOrder(next);
  state.draggedHudField = null;
  renderHudOrderControls();
  applyDisplaySettings();
  saveSettings();
}

function handleHudDragEnd() {
  state.draggedHudField = null;
  document.querySelectorAll(".dragging, .drag-over").forEach((row) => {
    row.classList.remove("dragging", "drag-over");
  });
}

export function adjustHudVisibleCount(delta) {
  state.hudVisibleCount = clamp(state.hudVisibleCount + delta, 1, state.hudFieldOrder.length);
  applyDisplaySettings();
  saveSettings();
}

function syncHudVisibleControls() {
  if (!els.hudVisibleCountOutput) return;
  const count = clamp(state.hudVisibleCount, 1, state.hudFieldOrder.length);
  els.hudVisibleCountOutput.value = `${count} / ${state.hudFieldOrder.length}`;
  for (const button of [els.hudLessBtn, els.hudVisibleLessBtn]) {
    button.disabled = count <= 1;
  }
  for (const button of [els.hudMoreBtn, els.hudVisibleMoreBtn]) {
    button.disabled = count >= state.hudFieldOrder.length;
  }
}

function hudFieldLabel(key) {
  return ({
    power: "Power",
    speed: "Speed",
    heartRate: "Heart rate",
    grade: "Grade",
    ridden: "Ridden",
    remaining: "Remaining",
    ascentLeft: "Ascent left",
    eta: "ETA",
    calories: "Calories",
    altitude: "Altitude",
    ascent: "Ascent",
    elapsed: "Elapsed",
  })[key] ?? key;
}

function hudFieldUnit(key) {
  return ({
    power: "W",
    speed: state.distanceUnits === "imperial" ? "mph" : "km/h",
    heartRate: "bpm",
    grade: "%",
    ridden: state.distanceUnits === "imperial" ? "mi" : "km",
    remaining: state.distanceUnits === "imperial" ? "mi" : "km",
    ascentLeft: state.distanceUnits === "imperial" ? "ft" : "m",
    eta: "time",
    calories: state.energyUnits === "kj" ? "kJ" : "kcal",
    altitude: state.distanceUnits === "imperial" ? "ft" : "m",
    ascent: state.distanceUnits === "imperial" ? "ft" : "m",
    elapsed: "time",
  })[key] ?? "";
}

// The dock's metric tiles flow into two rows; widen them when the user shows
// only a few fields and narrow them when all eight are on, so the row stays
// the same shape either way. (The collapsed strip lays out with flexbox and
// needs no width.) Grid column count follows automatically from the two-row
// auto-flow, so only the tile width is set here.
export function layoutMetricTiles() {
  const visible = [...els.hudTiles].filter((tile) => !tile.hidden).length;
  let width = "136px";
  if (visible >= 11) width = "88px";
  else if (visible >= 9) width = "98px";
  else if (visible >= 7) width = "112px";
  els.fullscreenHud.style.setProperty("--metric-tile-w", width);
}

// --- Screenshots -----------------------------------------------------------------

export async function takeMapScreenshot() {
  if (state.screenshotInProgress) return;
  state.screenshotInProgress = true;
  // Hide our own buttons for the shot; the map's Google attribution stays.
  els.mapViewport.classList.add("capturing");
  updateProgressLabel("Choose “This Tab” in the share dialog to save the screenshot…");
  try {
    await captureViewportJpeg(els.mapViewport, updateProgressLabel, {
      aspectRatio: parseAspectRatio(state.screenshotAspect),
      outputWidth: state.screenshotWidth,
    });
  } finally {
    els.mapViewport.classList.remove("capturing");
    state.screenshotInProgress = false;
  }
}

// --- Fullscreen ----------------------------------------------------------------

export function toggleMapFullscreen() {
  if (state.mapFullscreen) exitMapFullscreen();
  else enterMapFullscreen();
}

export function initializeMapHud() {
  // The HUD surface this module owns: the clock chip (top of the left
  // column), the map action bar (top of the right column), and the data dock
  // (the full-width bottom stack). The screen manager also publishes the
  // bottom region's height (--fs-dock-height), which used to be measured here.
  registerHudComponent({ id: "fullscreen-clock", region: "left", weight: 10, element: els.fullscreenClock });
  registerHudComponent({ id: "map-actions", region: "right", weight: 10, element: els.mapActions });
  registerHudComponent({ id: "fullscreen-dock", region: "bottom", weight: 10, element: els.fullscreenOverlayBottom });
  els.fullscreenOverlayBottom.hidden = false;
  els.fullscreenClock.hidden = false;
  els.fullscreenTrainingMeters.hidden = false;
  els.fsProfileMount.append(els.profile);
  els.profile.classList.add("profile-translucent");
  applyHudDock();
  startFullscreenClock();
  renderProfile();
  updateTrainingMeters(state.route.length ? gradeAt(state.route, state.progressMeters) : NaN);
}

function enterMapFullscreen() {
  if (state.theaterMode) exitTheaterMode();
  state.mapFullscreen = true;
  // The button's enter/exit icons swap on this class (see styles.css).
  els.mapViewport.classList.add("fullscreen-mode");
  els.fullscreenBtn.title = "Exit fullscreen";

  // The Fullscreen API also hides the browser chrome, but it can fail (no
  // user gesture in the event tick, unsupported platform); the CSS class
  // above already delivers the "just the map" view either way.
  els.mapViewport.requestFullscreen?.().catch(() => {});

  updateRideUi({ force: true });
}

export function exitMapFullscreen() {
  state.mapFullscreen = false;
  els.mapViewport.classList.remove("fullscreen-mode");
  els.fullscreenBtn.title = "Enter fullscreen";

  if (document.fullscreenElement === els.mapViewport) document.exitFullscreen?.().catch(() => {});

  updateRideUi({ force: true });
}

// Collapse toggle on the data dock: compact strip (metrics + progress bars)
// vs the full dock (metric tiles + the road-ahead profile). Persisted with
// the other display settings.
export function toggleHudDock() {
  state.hudDockCollapsed = !state.hudDockCollapsed;
  applyHudDock();
  saveSettings();
  // The profile canvas is display:none while collapsed, so re-render it once
  // it becomes visible again (a hidden canvas measures 0×0 and draws nothing).
  if (!state.hudDockCollapsed) renderProfile();
}

function applyHudDock() {
  els.fullscreenOverlayBottom.classList.toggle("collapsed", state.hudDockCollapsed);
  els.dockToggleBtn.setAttribute("aria-expanded", String(!state.hudDockCollapsed));
}

export function handleFullscreenChange() {
  if (!document.fullscreenElement && state.mapFullscreen) exitMapFullscreen();
}
