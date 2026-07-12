// Pure Web Mercator tile math + Mapzen Terrarium elevation decoding for the
// online terrain-elevation feature (see map/terrain-tiles.mjs). No DOM, no app
// state, no network — just the coordinate and pixel arithmetic, unit-tested.

// Longitude/latitude → the integer slippy-map tile {z,x,y} that contains the
// point, plus the integer pixel {px,py} within that tileSize×tileSize tile.
// Standard Web Mercator (EPSG:3857), which is the tiling the AWS Open Data
// terrarium set uses. Latitude is clamped to the Web Mercator limit
// (±85.0511°) so points near the poles still resolve to a real tile, and the
// x index wraps so a longitude just past ±180 lands on a valid tile.
export function tileForLngLat(lat, lng, zoom, tileSize) {
  const scale = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const xWorld = ((lng + 180) / 360) * scale;
  const yWorld =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;

  const xTile = Math.floor(xWorld);
  const yTile = Math.floor(yWorld);
  const x = ((xTile % scale) + scale) % scale;
  const y = Math.max(0, Math.min(scale - 1, yTile));
  const px = clampPixel((xWorld - xTile) * tileSize, tileSize);
  const py = clampPixel((yWorld - yTile) * tileSize, tileSize);
  return { z: zoom, x, y, px, py };
}

function clampPixel(value, tileSize) {
  return Math.max(0, Math.min(tileSize - 1, Math.floor(value)));
}

// Mapzen Terrarium packs elevation (meters) into a pixel's RGB channels as a
// base-256 value offset by 32768: elevation = R*256 + G + B/256 − 32768. So
// sea level is (128, 0, 0) and the channels give ~1/256 m vertical resolution.
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}
