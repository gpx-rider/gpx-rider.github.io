// One-click JPG screenshots of the map viewport, HUD and Google attribution
// included. The 3D map's WebGL canvas lives in a closed shadow root, so it
// cannot be read directly; instead the browser's own tab capture
// (getDisplayMedia with preferCurrentTab) streams the rendered tab and a
// single frame is cropped to the viewport. Because the frame is what the
// browser composited, the Google logo and legal notices are always part of
// the shot — never draw over or crop them out.

const JPEG_QUALITY = 0.92;

export function screenshotSupported() {
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// "16:9" → 16/9. Returns null for "viewport" (no cropping) or anything
// unparseable, so corrupted saved settings degrade to an uncropped shot.
export function parseAspectRatio(value) {
  if (!value || value === "viewport") return null;
  const match = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

// Largest centered rectangle with the target aspect that fits inside the
// frame. A null aspect returns the frame untouched.
export function centerCropForAspect({ width, height }, aspect) {
  if (!aspect) return { x: 0, y: 0, width, height };
  let cropWidth = width;
  let cropHeight = width / aspect;
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = height * aspect;
  }
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: Math.round(cropWidth),
    height: Math.round(cropHeight),
  };
}

// Captures `viewport` (a DOM element) into a JPG download. `onMessage` gets
// short status strings for the progress label. Elements that should not
// appear in the shot (our own buttons) are hidden by the caller via the
// `capturing` class before this resolves.
//
// `aspectRatio` (e.g. 16/9) center-crops the viewport and `outputWidth`
// scales the result, so every shot with the same settings has the same
// pixel dimensions regardless of the window size.
export async function captureViewportJpeg(viewport, onMessage, { aspectRatio = null, outputWidth = null } = {}) {
  let stream = null;
  const video = document.createElement("video");
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { preferCurrentTab: true },
      audio: false,
      // Chrome-only hints; unknown members are ignored elsewhere.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });

    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await nextVideoFrame(video);

    // Map the viewport's CSS rectangle onto the captured frame. When the
    // user shares the current tab the frame covers exactly the page
    // viewport, so the ratio of frame size to window size is the capture
    // scale (device pixel ratio included).
    const rect = viewport.getBoundingClientRect();
    const scaleX = video.videoWidth / window.innerWidth;
    const scaleY = video.videoHeight / window.innerHeight;
    const crop = {
      x: Math.max(0, Math.round(rect.left * scaleX)),
      y: Math.max(0, Math.round(rect.top * scaleY)),
      width: Math.min(video.videoWidth, Math.round(rect.width * scaleX)),
      height: Math.min(video.videoHeight, Math.round(rect.height * scaleY)),
    };
    if (crop.width < 2 || crop.height < 2) throw new Error("Empty capture area.");

    const sub = centerCropForAspect(crop, aspectRatio);
    const targetWidth = Number(outputWidth) > 0 ? Math.round(outputWidth) : sub.width;
    // Derive the height from the aspect (not the rounded crop) so a given
    // setting always yields exact dimensions, e.g. 16:9 @ 1920 → 1920×1080.
    const targetHeight = aspectRatio
      ? Math.round(targetWidth / aspectRatio)
      : Math.round(targetWidth * (sub.height / sub.width));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      video,
      crop.x + sub.x, crop.y + sub.y, sub.width, sub.height,
      0, 0, targetWidth, targetHeight,
    );

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("Could not encode the screenshot.");
    downloadBlob(blob, screenshotFileName());
    onMessage?.("Screenshot saved.");
    return true;
  } catch (error) {
    // The user closing the share picker is a normal outcome, not an error.
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") {
      onMessage?.("Screenshot cancelled.");
    } else {
      console.error("Screenshot capture failed.", error);
      onMessage?.("Screenshot failed — choose “This Tab” in the share dialog.");
    }
    return false;
  } finally {
    video.srcObject = null;
    stream?.getTracks().forEach((track) => track.stop());
  }
}

// The share picker overlays the tab while the user chooses; wait for a fresh
// frame after playback starts so the picker is not baked into the shot.
function nextVideoFrame(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => video.requestVideoFrameCallback(() => resolve()));
    } else {
      setTimeout(resolve, 300);
    }
  });
}

function screenshotFileName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `gpx-rider-${stamp}.jpg`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
