// Map bootstrap: creates the Leaflet map and its OpenStreetMap tile layer.
// No API key is needed — OpenStreetMap raster tiles are free and anonymous —
// so this is just wiring up a plain top-down slippy map.

import { bindManualMapCapture } from "./map-view.mjs";
import { els, state } from "../core/state.mjs";
import {
  MAP_ATTRIBUTION,
  MAP_DEFAULT_CENTER_LAT,
  MAP_DEFAULT_CENTER_LNG,
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  MAP_TILE_SUBDOMAINS,
  MAP_TILE_URL,
} from "../core/tuning.mjs";

export async function initMap() {
  state.map = L.map(els.map, {
    center: [MAP_DEFAULT_CENTER_LAT, MAP_DEFAULT_CENTER_LNG],
    zoom: MAP_DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });
  L.tileLayer(MAP_TILE_URL, {
    subdomains: MAP_TILE_SUBDOMAINS,
    maxZoom: MAP_MAX_ZOOM,
    attribution: MAP_ATTRIBUTION,
  }).addTo(state.map);
  bindManualMapCapture();
}
