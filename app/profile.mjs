// Elevation profile canvas: gradient-colored grade bars, elevation line,
// unit-aware axes, ride-position marker, and hover inspection.

import { clamp } from "./geo.mjs";
import { gradeAt, interpolateRoutePoint, routeTotalDistance } from "./route.mjs";
import { FEET_PER_METER, KM_PER_MILE, distanceUnitLabel, kmToDisplay } from "./units.mjs";

const PROFILE_CHART_EDGE_PADDING = 14;
const PROFILE_Y_AXIS_GUTTER = 60;
const PROFILE_Y_LABEL_GAP = 8;
const PROFILE_PADDING_LEFT = PROFILE_Y_AXIS_GUTTER;
const PROFILE_PADDING_RIGHT = PROFILE_CHART_EDGE_PADDING;
const PROFILE_PADDING_TOP = 10;
const PROFILE_PADDING_BOTTOM = 22;
const PROFILE_GRADE_STEEP_PERCENT = 12;
const PROFILE_BAR_SAMPLE_PX = 4;
const HISTORY_COLORS = {
  speed: "#5aa9ff",
  power: "#f6a52c",
  heartRate: "#e4574c",
};
const ELEVATION_STEP_CANDIDATES = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const DISTANCE_STEP_METERS_CANDIDATES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const DISTANCE_STEP_KM_CANDIDATES = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

// The canvas sits on a dark card in the control panel (transparent
// background — the card paints the surface); the fullscreen HUD variant
// (`dark`) adds its own translucent scrim behind the chart.
const PROFILE_THEME_PANEL = {
  background: null,
  gridline: "rgba(255, 255, 255, 0.08)",
  label: "rgba(255, 255, 255, 0.45)",
  line: "rgba(232, 234, 239, 0.85)",
  axisLine: "rgba(255, 255, 255, 0.2)",
  marker: "#f6a52c",
  hoverGuide: "rgba(255, 255, 255, 0.55)",
  focusFill: "rgba(255, 255, 255, 0.08)",
  focusMarker: "rgba(246, 165, 44, 0.9)",
};
const PROFILE_THEME_DARK = {
  ...PROFILE_THEME_PANEL,
  background: "rgba(13, 16, 21, 0.55)",
  label: "rgba(255, 255, 255, 0.6)",
};

export function drawEmptyProfile(canvas, { dark = false } = {}) {
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = dark ? PROFILE_THEME_DARK : PROFILE_THEME_PANEL;
  fillProfileBackground(ctx, theme, width, height, dark);
}

export function drawProfile(
  canvas,
  {
    route,
    progress = 0,
    hoverMeters = null,
    focusRange = null,
    selectionStats = null,
    dark = false,
    distanceUnits = "metric",
    historySamples = [],
    visibleSeries = {},
  },
) {
  const ctx = configureCanvas(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const theme = dark ? PROFILE_THEME_DARK : PROFILE_THEME_PANEL;

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
  drawProfileFocus(ctx, { focusRange, totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, theme });
  drawGradeBars(ctx, { route, totalDistance, chartLeft, chartRight, chartBottom, xFor, yFor });
  drawElevationLine(ctx, { route, xFor, yFor, theme });
  drawHistorySeries(ctx, {
    samples: historySamples,
    visibleSeries,
    totalDistance,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
    xFor,
  });
  drawDistanceAxis(ctx, { totalDistance, chartLeft, chartRight, chartBottom, xFor, theme, distanceUnits });

  const markerX = chartLeft + progress * chartWidth;
  ctx.beginPath();
  ctx.moveTo(markerX, chartTop);
  ctx.lineTo(markerX, chartBottom);
  ctx.strokeStyle = theme.marker;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (selectionStats) {
    drawProfileSelectionStats(ctx, {
      selectionStats,
      totalDistance,
      chartLeft,
      chartRight,
      chartTop,
      chartBottom,
      xFor,
      theme,
      distanceUnits,
    });
  } else if (hoverMeters !== null) {
    drawProfileHover(ctx, {
      route,
      hoverMeters,
      totalDistance,
      chartLeft,
      chartRight,
      chartTop,
      chartBottom,
      xFor,
      yFor,
      theme,
      distanceUnits,
      historySamples,
      visibleSeries,
    });
  }
}

function drawProfileSelectionStats(
  ctx,
  {
    selectionStats,
    totalDistance,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
    xFor,
    theme,
    distanceUnits,
  },
) {
  const start = clamp(Number(selectionStats.startDistanceMeters), 0, totalDistance);
  const end = clamp(Number(selectionStats.endDistanceMeters), start, totalDistance);
  if (end <= start) return;

  const startX = clamp(xFor(start), chartLeft, chartRight);
  const endX = clamp(xFor(end), chartLeft, chartRight);
  const centerX = (startX + endX) / 2;

  const metrics = [
    { label: "Start", value: formatProfileDistance(start, distanceUnits) },
    { label: "Stop", value: formatProfileDistance(end, distanceUnits) },
    { label: "Length", value: formatProfileDistance(selectionStats.lengthMeters, distanceUnits) },
    { label: "Ascent", value: formatProfileAltitude(selectionStats.ascentMeters, distanceUnits), color: theme.focusMarker },
    { label: "Descent", value: formatProfileAltitude(selectionStats.descentMeters, distanceUnits) },
  ];

  drawProfileMetricReadout(ctx, {
    metrics,
    anchorX: centerX,
    preferTop: true,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  });
}

function drawProfileFocus(
  ctx,
  { focusRange, totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor, theme },
) {
  if (!focusRange) return;
  const start = clamp(Number(focusRange.startMeters), 0, totalDistance);
  const end = clamp(Number(focusRange.endMeters), start, totalDistance);
  if (end <= start) return;

  const startX = clamp(xFor(start), chartLeft, chartRight);
  const endX = clamp(xFor(end), chartLeft, chartRight);
  ctx.fillStyle = theme.focusFill;
  ctx.fillRect(startX, chartTop, Math.max(1, endX - startX), chartBottom - chartTop);

  ctx.strokeStyle = theme.focusMarker;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  for (const x of [startX, endX]) {
    ctx.beginPath();
    ctx.moveTo(x, chartTop);
    ctx.lineTo(x, chartBottom);
    ctx.stroke();
  }
  ctx.setLineDash([]);
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
  if (!theme.background) return;
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
  ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";

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
    ctx.fillText(`${Math.round(value)} ${unit}`, chartLeft - PROFILE_Y_LABEL_GAP, y);
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

function drawHistorySeries(ctx, { samples, visibleSeries, totalDistance, chartLeft, chartRight, chartTop, chartBottom, xFor }) {
  const chartHeight = Math.max(1, chartBottom - chartTop);
  const series = [
    { key: "speed", value: "speedKph", max: 80 },
    { key: "power", value: "powerWatts", max: 500 },
    { key: "heartRate", value: "heartRateBpm", max: 210 },
  ];
  const validSamples = samples
    .map((sample) => ({
      ...sample,
      routeProgressMeters: Number.isFinite(sample.routeProgressMeters) ? sample.routeProgressMeters : sample.distance,
    }))
    .filter((sample) => Number.isFinite(sample.routeProgressMeters));

  for (const { key, value, max } of series) {
    if (visibleSeries[key] === false) continue;
    const points = validSamples
      .filter((sample) => Number.isFinite(sample[value]))
      .map((sample) => ({
        x: clamp(xFor(sample.routeProgressMeters), chartLeft, chartRight),
        y: chartBottom - clamp(sample[value] / max, 0, 1) * chartHeight,
      }));
    if (points.length < 2) continue;

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = HISTORY_COLORS[key];
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
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
  ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
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

function drawProfileHover(
  ctx,
  {
    route,
    hoverMeters,
    totalDistance,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
    xFor,
    yFor,
    theme,
    distanceUnits,
    historySamples,
    visibleSeries,
  },
) {
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

  // Route properties at the hovered point: distance from start, distance to
  // the end, elevation and grade — all in the user's units. Present them as a
  // segmented glass readout so each value remains scannable over the bars.
  const unit = distanceUnitLabel(distanceUnits);
  const fromStart = kmToDisplay(distance / 1000, distanceUnits).toFixed(2);
  const toEnd = kmToDisplay((totalDistance - distance) / 1000, distanceUnits).toFixed(2);
  const elevation = distanceUnits === "imperial"
    ? `${Math.round(point.ele * FEET_PER_METER)} ft`
    : `${Math.round(point.ele)} m`;
  const metrics = [
    { label: "From start", value: `${fromStart} ${unit}` },
    { label: "To end", value: `${toEnd} ${unit}` },
    { label: "Elev", value: elevation },
    {
      label: "Grade",
      value: `${grade >= 0 ? "+" : ""}${grade.toFixed(1)}%`,
      color: gradeColor(grade),
    },
  ];
  const history = historyAtDistance(historySamples, distance);
  if (visibleSeries.speed !== false && Number.isFinite(history?.speedKph)) {
    metrics.push({ label: "Speed", value: `${history.speedKph.toFixed(1)} km/h` });
  }
  if (visibleSeries.power !== false && Number.isFinite(history?.powerWatts)) {
    metrics.push({ label: "Power", value: `${Math.round(history.powerWatts)} W` });
  }
  if (visibleSeries.heartRate !== false && Number.isFinite(history?.heartRateBpm)) {
    metrics.push({ label: "HR", value: `${Math.round(history.heartRateBpm)} bpm` });
  }

  drawProfileMetricReadout(ctx, {
    metrics,
    anchorX: x,
    preferTop: y > (chartTop + chartBottom) / 2,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  });
}

function drawProfileMetricReadout(
  ctx,
  {
    metrics,
    anchorX,
    preferTop,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  },
) {
  if (!metrics.length) return;
  const availableWidth = chartRight - chartLeft;
  ctx.font = "600 9px 'Space Grotesk', system-ui, sans-serif";
  const labelWidths = metrics.map((metric) => ctx.measureText(metric.label.toUpperCase()).width);
  ctx.font = "600 15px 'IBM Plex Mono', ui-monospace, monospace";
  const valueWidths = metrics.map((metric) => ctx.measureText(metric.value).width);
  const baseWidths = metrics.map((_, index) => Math.max(labelWidths[index], valueWidths[index]) + 16);
  const baseWidth = baseWidths.reduce((sum, width) => sum + width, 0);
  const scale = Math.min(1, availableWidth / baseWidth);
  const widths = baseWidths.map((width) => width * scale);
  const boxWidth = Math.min(availableWidth, baseWidth);
  const boxHeight = Math.max(40, 50 * scale);
  let boxX = anchorX - boxWidth / 2;
  boxX = clamp(boxX, chartLeft, chartRight - boxWidth);
  const boxY = preferTop
    ? chartTop + 2
    : chartBottom - boxHeight - 2;

  ctx.fillStyle = "rgba(13, 16, 21, 0.78)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1, 11.5);
  ctx.stroke();

  let metricX = boxX;
  metrics.forEach((metric, index) => {
    const metricWidth = widths[index];
    const centerX = metricX + metricWidth / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.max(7.5, 9 * scale)}px 'Space Grotesk', system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fillText(metric.label.toUpperCase(), centerX, boxY + boxHeight * 0.34);
    ctx.font = `600 ${Math.max(11, 15 * scale)}px 'IBM Plex Mono', ui-monospace, monospace`;
    ctx.fillStyle = metric.color || "rgba(255, 255, 255, 0.96)";
    ctx.fillText(metric.value, centerX, boxY + boxHeight * 0.68);
    metricX += metricWidth;
  });
}

function formatProfileDistance(meters, distanceUnits) {
  const unit = distanceUnitLabel(distanceUnits);
  const value = kmToDisplay((Number(meters) || 0) / 1000, distanceUnits);
  return `${value.toFixed(2)} ${unit}`;
}

function formatProfileAltitude(meters, distanceUnits) {
  const value = Number(meters) || 0;
  return distanceUnits === "imperial"
    ? `${Math.round(value * FEET_PER_METER)} ft`
    : `${Math.round(value)} m`;
}

function historyAtDistance(samples, distance) {
  let nearest = null;
  let nearestDelta = Infinity;
  for (const sample of samples) {
    const sampleDistance = Number.isFinite(sample.routeProgressMeters) ? sample.routeProgressMeters : sample.distance;
    if (!Number.isFinite(sampleDistance)) continue;
    const delta = Math.abs(sampleDistance - distance);
    if (delta < nearestDelta) {
      nearest = sample;
      nearestDelta = delta;
    }
  }
  return nearestDelta <= 200 ? nearest : null;
}

function niceStep(range, candidates) {
  for (const candidate of candidates) {
    if (range / candidate <= 6) return candidate;
  }
  return candidates.at(-1);
}

// Stepped grade palette shared with the panel legend and the gallery's mini
// profiles: green for descents, gray for flat, amber -> orange -> red as the
// climb steepens. Exported so the map HUD and fullscreen climb banner color
// from the same palette instead of copying it again.
export const GRADE_PROFILE_COLORS = [
  "#3fae6a",
  "#57b877",
  "rgba(125, 138, 134, 0.55)",
  "#e8b74e",
  "#e8823c",
  "#d9542f",
];
export const GRADE_PROFILE_THRESHOLDS = [-3, -0.6, 0.8, 3.5, 7];

export function gradeColor(grade) {
  if (grade <= GRADE_PROFILE_THRESHOLDS[0]) return GRADE_PROFILE_COLORS[0];
  if (grade <= GRADE_PROFILE_THRESHOLDS[1]) return GRADE_PROFILE_COLORS[1];
  if (grade < GRADE_PROFILE_THRESHOLDS[2]) return GRADE_PROFILE_COLORS[2];
  if (grade < GRADE_PROFILE_THRESHOLDS[3]) return GRADE_PROFILE_COLORS[3];
  if (grade < GRADE_PROFILE_THRESHOLDS[4]) return GRADE_PROFILE_COLORS[4];
  return GRADE_PROFILE_COLORS[5];
}

// The same buckets expressed as continuous meter zones. This keeps HUD
// gradients aligned with gradeColor instead of evenly dividing the full
// display scale (which made gray incorrectly span 0–10%).
export function gradeColorZones(min, max) {
  return GRADE_PROFILE_COLORS.map((color, index) => ({
    min: index === 0 ? min : GRADE_PROFILE_THRESHOLDS[index - 1],
    max: index === GRADE_PROFILE_COLORS.length - 1 ? max : GRADE_PROFILE_THRESHOLDS[index],
    color,
  }));
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
