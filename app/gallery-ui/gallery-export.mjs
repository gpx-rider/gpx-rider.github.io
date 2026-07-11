// Export to gallery: builds the metadata.json snippet (curated title +
// description + the live map camera as previewCamera) shown on the setup
// page's Export to gallery card, and copies it to the clipboard. Used by the
// gallery workflow described in CLAUDE.md (paste into gallery/*/metadata.json,
// then run `make gallery-data`).

import { roundCoordinate } from "../core/geo.mjs";
import { els, state } from "../core/state.mjs";
import { GALLERY_METADATA_CAMERA_REFRESH_MS } from "../core/tuning.mjs";

export function resetGalleryMetadataExportForRoute() {
  if (els.galleryTitleInput) {
    els.galleryTitleInput.value = state.galleryMetadata?.title || state.routeName || "";
  }
  if (els.galleryDescriptionInput) {
    els.galleryDescriptionInput.value = state.galleryMetadata?.description || "";
  }
  syncGalleryMetadataExportAvailability();
}

export function syncGalleryMetadataExportAvailability() {
  const enabled = Boolean(state.route.length && state.map);
  for (const input of [els.galleryTitleInput, els.galleryDescriptionInput]) {
    if (input) input.disabled = !enabled;
  }
  if (els.copyGalleryMetadataBtn) els.copyGalleryMetadataBtn.disabled = !enabled;
  if (!enabled && els.galleryMetadataOutput) {
    els.galleryMetadataOutput.value = state.route.length
      ? "Photorealistic 3D Maps are not available."
      : "Load a route, frame the map, then copy metadata.json.";
  } else {
    updateGalleryMetadataExport();
  }
}

export function updateGalleryMetadataExport(force = false) {
  if (!els.galleryMetadataOutput || !state.route.length || !state.map) return;
  const now = performance.now();
  if (!force && now - state.lastGalleryMetadataRefreshMs < GALLERY_METADATA_CAMERA_REFRESH_MS) return;
  state.lastGalleryMetadataRefreshMs = now;
  const title = els.galleryTitleInput.value.trim() || state.routeName || "Untitled route";
  const description = els.galleryDescriptionInput.value.trim();
  const metadata = {
    ...(state.galleryMetadata ?? {}),
    title,
    description,
    previewCamera: currentGalleryPreviewCamera(),
  };
  els.galleryMetadataOutput.value = JSON.stringify(metadata, null, 2) + "\n";
}

function currentGalleryPreviewCamera() {
  const center = state.map?.center;
  const camera = {
    center: {
      lat: roundCoordinate(Number(center?.lat)),
      lng: roundCoordinate(Number(center?.lng)),
      altitude: roundCameraNumber(Number(center?.altitude), 1),
    },
    heading: roundCameraNumber(Number(state.map?.heading), 2),
    range: roundCameraNumber(Number(state.map?.range), 1),
    tilt: roundCameraNumber(Number(state.map?.tilt), 2),
    roll: roundCameraNumber(Number(state.map?.roll), 2),
    fov: roundCameraNumber(Number(state.map?.fov), 2),
  };
  return camera;
}

function roundCameraNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export async function copyGalleryMetadata() {
  updateGalleryMetadataExport(true);
  const text = els.galleryMetadataOutput.value;
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.galleryMetadataOutput.focus();
    els.galleryMetadataOutput.select();
    document.execCommand?.("copy");
  }
  const previous = els.copyGalleryMetadataBtn.textContent;
  els.copyGalleryMetadataBtn.textContent = "Copied";
  window.setTimeout(() => {
    els.copyGalleryMetadataBtn.textContent = previous;
  }, 1200);
}
