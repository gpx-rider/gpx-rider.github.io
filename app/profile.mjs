// Elevation profile canvas: gradient-colored grade bars, elevation line,
// unit-aware axes, ride-position marker, and hover inspection.

import { clamp } from "./geo.mjs";
import { gradeAt, interpolateRoutePoint, routeTotalDistance } from "./route.mjs";
import { FEET_PER_METER, KM_PER_MILE, distanceUnitLabel, kmToDisplay } from "./units.mjs";

const PROFILE_PADDING_LEFT = 44;
const PROFILE_PADDING_RIGHT = 14;
const PROFILE_PADDING_TOP = 10;
const PROFILE_PADDING_BOTTOM = 22;
const PROFILE_GRADE_STEEP_PERCENT = 12;
const PROFILE_BAR_SAMPLE_PX = 4;
const ELEVATION_STEP_CANDIDATES = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const DISTANCE_STEP_METERS_CANDIDATES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const DISTANCE_STEP_KM_CANDIDATES = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

const PROFILE_THEME_LIGHT = {
  background: "#f9faf8",
  gridline: "rgba(23, 33, 31, 0.12)",
  label: "#66716d",
  line: "#24312e",
  axisLine: "rgba(23, 33, 31, 0.25)",
  marker: "#24312e",
  hoverGuide: "rgba(23, 33, 31, 0.45)",
};
const PROFILE_THEME_DARK = {
  background: "rgba(23, 33, 31, 0.55)",
  gridline: "rgba(255, 255, 255, 0.16)",
  label: "rgba(255, 255, 255, 0.8)",
  line: "#ffffff",
  axisLine: "rgba(255, 255, 255, 0.35)",
  marker: "#ffffff",
  hoverGuide: "rgba(255, 255, 255, 0.55)",
};

export function drawEmptyProfile(canvas, { dark = false } = {}) {
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = dark ? PROFILE_THEME_DARK : PROFILE_THEME_LIGHT;
  fillProfileBackground(ctx, theme, width, height, dark);
}

export function drawProfile(canvas, { route, progress = 0, hoverMeters = null, dark = false, distanceUnits = "metric" }) {
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = dark ? PROFILE_THEME_DARK : PROFILE_THEME_LIGHT;

  fillProfileBackground(ctx, theme, width, height, dark);

  if (!route || route.length < 2) return;

  const chartLeft = PROFILE_PADDING_LEFT;
  const chartRight = width - PROFILE_PADDING_RIGHT;
  const chartTop = PROFILE_PADDING_TOP;
  const chartBottom = height - PROFILE_PADDING_BOTTOM;
  const chartWidth = Math.max(1, chartRight - chartLeft);
  const totalDistance = routeTotalDistance(route) || 1;

  const elevations = route.map((point) => point.ele);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);
  const paddedMin = min - span * 0.08;
  const paddedMax = max + span * 0.08;
  const paddedSpan = Math.max(1, paddedMax - paddedMin);

  const xFor = (distance) => chartLeft + (distance / totalDistance) * chartWidth;
  const yFor = (ele) => chartBottom - ((ele - paddedMin) / paddedSpan) * (chartBottom - chartTop);

  drawElevationGridlines(ctx, { min, max, chartLeft, chartRight, chartTop, yFor, theme, distanceUnits });
  drawGradeBars(ctx, { route, totalDistance, chartLeft, chartRight, chartBottom, xFor, yFor });
  drawElevationLine(ctx, { route, xFor, yFor, theme });
  drawDistanceAxis(ctx, { totalDistance, chartLeft, chartRight, chartBottom, xFor, theme, distanceUnits });

  const markerX = chartLeft + progress * chartWidth;
  ctx.beginPath();
  ctx.moveTo(markerX, chartTop);
  ctx.lineTo(markerX, chartBottom);
  ctx.strokeStyle = theme.marker;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (hoverMeters !== null) {
    drawProfileHover(ctx, { route, hoverMeters, totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, yFor, theme, distanceUnits });
  }
}

export function distanceAtProfileX(canvas, clientX, route) {
  if (!route?.length) return null;

  const rect = canvas.getBoundingClientRect();
  const chartLeft = PROFILE_PADDING_LEFT;
  const chartRight = rect.width - PROFILE_PADDING_RIGHT;
  const chartWidth = Math.max(1, chartRight - chartLeft);
  const x = clamp(clientX - rect.left, chartLeft, chartRight);
  return ((x - chartLeft) / chartWidth) * routeTotalDistance(route);
}

function fillProfileBackground(ctx, theme, width, height, dark) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  if (dark) {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 10);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, width, height);
  }
}

function drawElevationGridlines(ctx, { min, max, chartLeft, chartRight, chartTop, yFor, theme, distanceUnits }) {
  const imperial = distanceUnits === "imperial";
  const toDisplay = (meters) => (imperial ? meters * FEET_PER_METER : meters);
  const fromDisplay = (value) => (imperial ? value / FEET_PER_METER : value);
  const unit = imperial ? "ft" : "m";

  const displayMin = toDisplay(min);
  const displayMax = toDisplay(max);
  const step = niceStep(Math.max(1, displayMax - displayMin), ELEVATION_STEP_CANDIDATES);
  const first = Math.ceil(displayMin / step) * step;

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "10px Inter, ui-sans-serif, system-ui, sans-serif";

  for (let value = first; value <= displayMax; value += step) {
    const y = yFor(fromDisplay(value));
    if (y < chartTop - 1) continue;

    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.strokeStyle = theme.gridline;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = theme.label;
    ctx.fillText(`${Math.round(value)} ${unit}`, chartLeft - 6, y);
  }
}

function drawGradeBars(ctx, { route, totalDistance, chartLeft, chartRight, chartBottom, xFor, yFor }) {
  const chartWidth = chartRight - chartLeft;
  const sampleCount = clamp(Math.round(chartWidth / PROFILE_BAR_SAMPLE_PX), 20, 400);
  const samples = [];
  for (let i = 0; i <= sampleCount; i += 1) {
    const distance = (i / sampleCount) * totalDistance;
    samples.push({ distance, ele: interpolateRoutePoint(route, distance).ele });
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    const from = samples[i];
    const to = samples[i + 1];
    const midDistance = (from.distance + to.distance) / 2;
    const grade = gradeAt(route, midDistance);

    const x0 = xFor(from.distance);
    const x1 = xFor(to.distance);
    const y0 = yFor(from.ele);
    const y1 = yFor(to.ele);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, chartBottom);
    ctx.lineTo(x0, chartBottom);
    ctx.closePath();
    ctx.fillStyle = gradeColor(grade);
    ctx.fill();
  }
}

function drawElevationLine(ctx, { route, xFor, yFor, theme }) {
  ctx.beginPath();
  route.forEach((point, index) => {
    const x = xFor(point.distance);
    const y = yFor(point.ele);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDistanceAxis(ctx, { totalDistance, chartLeft, chartRight, chartBottom, xFor, theme, distanceUnits }) {
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth = 1;
  ctx.stroke();

  const imperial = distanceUnits === "imperial";
  const useLargeUnit = totalDistance >= 3000;
  let stepMeters;
  let labelFor;
  if (useLargeUnit) {
    const totalLarge = kmToDisplay(totalDistance / 1000, distanceUnits);
    const stepLarge = niceStep(totalLarge, DISTANCE_STEP_KM_CANDIDATES);
    stepMeters = stepLarge * (imperial ? KM_PER_MILE : 1) * 1000;
    labelFor = (meters) => `${Math.round(kmToDisplay(meters / 1000, distanceUnits))} ${distanceUnitLabel(distanceUnits)}`;
  } else {
    stepMeters = niceStep(totalDistance, DISTANCE_STEP_METERS_CANDIDATES);
    labelFor = imperial
      ? (meters) => `${Math.round(meters * FEET_PER_METER)} ft`
      : (meters) => `${Math.round(meters)} m`;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "10px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = theme.label;
  ctx.strokeStyle = theme.axisLine;

  for (let distance = 0; distance <= totalDistance; distance += stepMeters) {
    const x = xFor(distance);
    ctx.beginPath();
    ctx.moveTo(x, chartBottom);
    ctx.lineTo(x, chartBottom + 4);
    ctx.stroke();

    ctx.fillText(labelFor(distance), clamp(x, chartLeft + 14, chartRight - 14), chartBottom + 6);
  }
}

function drawProfileHover(ctx, { route, hoverMeters, totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, yFor, theme, distanceUnits }) {
  const distance = clamp(hoverMeters, 0, totalDistance);
  const point = interpolateRoutePoint(route, distance);
  const grade = gradeAt(route, distance);
  const x = xFor(distance);
  const y = yFor(point.ele);

  ctx.beginPath();
  ctx.moveTo(x, chartTop);
  ctx.lineTo(x, chartBottom);
  ctx.strokeStyle = theme.hoverGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = theme.marker;
  ctx.fill();

  const displayDistance = kmToDisplay(distance / 1000, distanceUnits);
  const label = `${displayDistance.toFixed(2)} ${distanceUnitLabel(distanceUnits)}  ${grade >= 0 ? "+" : ""}${grade.toFixed(1)}%`;
  ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + 16;
  const boxHeight = 22;
  let boxX = x - boxWidth / 2;
  boxX = clamp(boxX, chartLeft, chartRight - boxWidth);
  const boxY = chartTop + 4;

  ctx.fillStyle = "rgba(36, 49, 46, 0.92)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.5);
}

function niceStep(range, candidates) {
  for (const candidate of candidates) {
    if (range / candidate <= 6) return candidate;
  }
  return candidates.at(-1);
}

function gradeColor(grade) {
  const intensity = clamp(Math.abs(grade) / PROFILE_GRADE_STEEP_PERCENT, 0, 1);
  const lightness = 88 - intensity * 40;
  if (grade > 0.3) return `hsl(4, 72%, ${lightness}%)`;
  if (grade < -0.3) return `hsl(142, 55%, ${lightness}%)`;
  return "hsl(60, 6%, 84%)";
}

function configureCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  // Assigning width/height resets and reallocates the canvas, so only touch
  // them when the element size actually changed.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}
