// Export to gallery: builds the metadata.json snippet (curated title +
// description) shown on the setup page's Export to gallery card, and copies
// it to the clipboard. Used by the gallery workflow described in CLAUDE.md
// (paste into gallery/*/metadata.json, then run `make gallery-data`). The
// gallery card preview auto-frames the route on a plain top-down map, so
// there is no camera pose to capture here anymore.

import { els, state } from "../core/state.mjs";

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
      ? "The map is not available."
      : "Load a route, then copy metadata.json.";
  } else {
    updateGalleryMetadataExport();
  }
}

export function updateGalleryMetadataExport() {
  if (!els.galleryMetadataOutput || !state.route.length || !state.map) return;
  const title = els.galleryTitleInput.value.trim() || state.routeName || "Untitled route";
  const description = els.galleryDescriptionInput.value.trim();
  const metadata = { ...(state.galleryMetadata ?? {}), title, description };
  els.galleryMetadataOutput.value = JSON.stringify(metadata, null, 2) + "\n";
}

export async function copyGalleryMetadata() {
  updateGalleryMetadataExport();
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
