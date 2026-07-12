// Online terrain elevation from the public Mapzen Terrarium terrain-RGB tiles
// on the AWS Open Data bucket — no API key, no cost, anonymous requests. The
// lightweight PNG tiles are fetched on demand, decoded into an elevation grid
// through an offscreen canvas, and cached (LRU) so terrainElevationAt() is a
// cheap synchronous lookup the follow camera can call every frame: a miss
// kicks off the async fetch and returns null, so the caller falls back to its
// own estimate until the tile arrives. This module owns only its tile cache;
// callers gate on the user setting (state.terrainTilesEnabled) before calling.

import { decodeTerrarium, tileForLngLat } from "./terrain-tiles-math.mjs";
import {
  TERRAIN_TILE_BASE_URL,
  TERRAIN_TILE_MAX_CACHE,
  TERRAIN_TILE_SIZE,
  TERRAIN_TILE_ZOOM,
} from "../core/tuning.mjs";

// key "z/x/y" -> { status: "loading" | "ready" | "error", grid: Float32Array }.
// Map insertion order doubles as the LRU order; a ready lookup re-inserts its
// tile at the end so it is evicted last.
const tiles = new Map();
let canvas = null;
let ctx = null;

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function drawContext() {
  if (ctx) return ctx;
  if (typeof document === "undefined") return null;
  canvas = document.createElement("canvas");
  canvas.width = TERRAIN_TILE_SIZE;
  canvas.height = TERRAIN_TILE_SIZE;
  // willReadFrequently: getImageData is called once per tile, right after draw.
  ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx;
}

function loadTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (tiles.has(key)) return;
  if (typeof Image === "undefined") return;
  tiles.set(key, { status: "loading", grid: null });

  const image = new Image();
  // Anonymous CORS keeps the canvas untainted so getImageData works; the AWS
  // Open Data bucket serves the tiles with Access-Control-Allow-Origin: *.
  image.crossOrigin = "anonymous";
  image.addEventListener("load", () => {
    const context = drawContext();
    const record = tiles.get(key);
    if (!context || !record) return;
    try {
      context.clearRect(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      context.drawImage(image, 0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      const { data } = context.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      const grid = new Float32Array(TERRAIN_TILE_SIZE * TERRAIN_TILE_SIZE);
      for (let i = 0; i < grid.length; i += 1) {
        const o = i * 4;
        grid[i] = decodeTerrarium(data[o], data[o + 1], data[o + 2]);
      }
      record.grid = grid;
      record.status = "ready";
    } catch (error) {
      // A tainted canvas or decode failure just disables tiles for this cell;
      // the caller keeps using its offline route-based estimate.
      record.status = "error";
      console.debug("[terrain] tile decode failed", key, error);
    }
    evictOverflow();
  });
  image.addEventListener("error", () => {
    const record = tiles.get(key);
    if (record) record.status = "error";
  });
  image.src = `${TERRAIN_TILE_BASE_URL}${z}/${x}/${y}.png`;
}

// Drop the least-recently-used resolved tiles once the cache exceeds the cap.
// In-flight ("loading") tiles are kept — a fetch is still outstanding.
function evictOverflow() {
  while (tiles.size > TERRAIN_TILE_MAX_CACHE) {
    let removed = false;
    for (const [key, record] of tiles) {
      if (record.status === "loading") continue;
      tiles.delete(key);
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

// Ground elevation (meters) at a point from the cached terrain tile, or null
// when the tile is not loaded yet (a fetch is kicked off) or unavailable. A
// tile spans several km at the configured zoom, so repeated calls along a ride
// keep hitting the same cached tile — the "only re-fetch on crossing into a
// new tile block" the issue asks for falls out of the cache for free.
export function terrainElevationAt(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { z, x, y, px, py } = tileForLngLat(lat, lng, TERRAIN_TILE_ZOOM, TERRAIN_TILE_SIZE);
  const key = tileKey(z, x, y);
  const record = tiles.get(key);
  if (!record) {
    loadTile(z, x, y);
    return null;
  }
  if (record.status !== "ready" || !record.grid) return null;
  // Mark most-recently-used.
  tiles.delete(key);
  tiles.set(key, record);
  return record.grid[py * TERRAIN_TILE_SIZE + px];
}

// Warm the cache around a point — the containing tile and its eight neighbors —
// so terrain is ready before the camera needs it. Called once when a route
// loads. Cheap: a handful of ~40 KB PNGs, then cached by the browser too.
export function prefetchTerrainAround(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const { z, x, y } = tileForLngLat(lat, lng, TERRAIN_TILE_ZOOM, TERRAIN_TILE_SIZE);
  const scale = 2 ** z;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= scale) continue;
      const nx = (((x + dx) % scale) + scale) % scale;
      loadTile(z, nx, ny);
    }
  }
}
