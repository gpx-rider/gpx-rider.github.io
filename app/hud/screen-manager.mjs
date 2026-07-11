// Central screen manager for the map/HUD surface. It owns four layout
// regions inside the map viewport — left column, center column, right
// column, and a full-width bottom stack — and lays registered components out
// as flex stacks with consistent gaps, so features never position HUD
// elements with their own absolute offsets (the old way: hardcoded
// "top: 92px to clear the clock" stacking and JS measuring one banner to
// push another below it).
//
// The manager does LAYOUT ONLY. It never owns feature state or behavior:
// each feature creates, updates, shows/hides, and event-handles its own
// element, and registers/unregisters it here. Hiding a component (the
// `hidden` attribute) collapses its slot automatically — flex flow removes
// the empty space, no reflow call needed. Responsive insets live on the
// region containers in styles.css (one phone media block instead of one per
// component), and the bottom region's measured height is published as
// --fs-dock-height on the viewport so the side columns never overlap it.
//
// This applies to the dynamic map/HUD surface only — the setup panel and
// dialogs are rigid screens and stay out of it.

import { els } from "../core/state.mjs";

const REGIONS = ["left", "center", "right", "bottom"];

const regionEls = {};
const registrations = new Map();
let registrationSequence = 0;
let initialized = false;

// Create the four region containers inside the viewport (siblings of #map)
// and start publishing the bottom region's height for overlap avoidance.
// Must run once at boot, before any feature registers.
export function initScreenManager(viewport = els.mapViewport) {
  if (initialized) return;
  initialized = true;
  for (const region of REGIONS) {
    const el = document.createElement("div");
    el.className = `hud-region hud-region-${region}`;
    el.dataset.hudRegion = region;
    viewport.append(el);
    regionEls[region] = el;
  }
  // The side columns end above the bottom stack (see --fs-dock-height uses
  // in styles.css); publish its live height so that clearance tracks the
  // dock collapsing/expanding and phone-layout height changes. The observer
  // covers component-driven height changes (e.g. the dock collapse toggling
  // a class); reflows and window resizes also publish, belt-and-braces.
  hudViewport = viewport;
  if (window.ResizeObserver) {
    new ResizeObserver(publishBottomRegionHeight).observe(regionEls.bottom);
  }
  window.addEventListener("resize", publishBottomRegionHeight);
}

let hudViewport = null;

function publishBottomRegionHeight() {
  if (!hudViewport || !regionEls.bottom) return;
  const height = regionEls.bottom.getBoundingClientRect().height;
  if (Number.isFinite(height) && height > 0) {
    hudViewport.style.setProperty("--fs-dock-height", `${Math.ceil(height)}px`);
  }
}

// Register a feature's HUD component.
//   id      – stable identity; re-registering the same id replaces the entry
//   region  – "left" | "center" | "right" | "bottom"
//   weight  – numeric ordering within the region (smaller = earlier/higher);
//             equal weights keep registration order (deterministic)
//   element – the feature-owned DOM node to place (adopted, never cloned)
//   align   – optional "end" pins the component to the far end of its column
//             (e.g. the minimap sitting at the bottom of the right column)
// Returns a handle with unregister().
export function registerHudComponent({ id, region, weight = 0, element, align = "start" }) {
  if (!initialized) throw new Error("initScreenManager must run before registering HUD components.");
  if (!REGIONS.includes(region)) throw new Error(`Unknown HUD region "${region}".`);
  if (!element) throw new Error(`HUD component "${id}" has no element.`);
  if (registrations.has(id)) unregisterHudComponent(id);
  element.classList.toggle("hud-align-end", align === "end");
  registrations.set(id, { id, region, weight, element, order: registrationSequence++ });
  reflowRegion(region);
  return { unregister: () => unregisterHudComponent(id) };
}

// Detach a component from its region (the element itself is not destroyed —
// it belongs to the feature) and close the gap it occupied.
export function unregisterHudComponent(id) {
  const entry = registrations.get(id);
  if (!entry) return;
  registrations.delete(id);
  entry.element.remove();
  reflowRegion(entry.region);
}

// Re-place a region's components sorted by weight, ties broken by
// registration order. replaceChildren both inserts new arrivals and closes
// the space of departures; everything else (hide, resize) reflows through
// normal flex flow without JS.
function reflowRegion(region) {
  const items = [...registrations.values()]
    .filter((entry) => entry.region === region)
    .sort((a, b) => a.weight - b.weight || a.order - b.order);
  regionEls[region].replaceChildren(...items.map((entry) => entry.element));
  if (region === "bottom") publishBottomRegionHeight();
}
