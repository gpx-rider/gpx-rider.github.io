// Training zones & meters: heart-rate / power zone calculation from the rider
// profile (demo mode substitutes its own profile), the fullscreen zone meters
// (power / HR / grade), the settings-panel zone summaries, and the zone help
// popovers.

import { clamp } from "../core/geo.mjs";
import { gradeColor, gradeColorZones } from "../route/profile.mjs";
import { registerHudComponent } from "../hud/screen-manager.mjs";
import { els, state } from "../core/state.mjs";
import { currentHeartRate } from "./telemetry-ui.mjs";
import {
  CADENCE_METER_MAX_RPM,
  CADENCE_METER_MIN_RPM,
  CADENCE_ZONE_COLORS,
  CADENCE_ZONE_GREEN_MAX_RPM,
  CADENCE_ZONE_GREEN_MIN_RPM,
  CADENCE_ZONE_YELLOW_MAX_RPM,
  CADENCE_ZONE_YELLOW_MIN_RPM,
  DEFAULT_RESTING_HEART_RATE_BPM,
  DEMO_RIDE,
  GRADE_METER_MAX_PERCENT,
  GRADE_METER_MIN_PERCENT,
  HEART_RATE_ZONE_DEFINITIONS,
  POWER_ZONE_DEFINITIONS,
} from "../core/tuning.mjs";

// The zone meters stack in the left column, under the clock chip.
export function registerTrainingMetersHud() {
  registerHudComponent({ id: "training-meters", region: "left", weight: 20, element: els.fullscreenTrainingMeters });
}

export function updateTrainingMeters(grade) {
  const power = state.trainerPowerWatts;
  const heartRate = currentHeartRate();
  const cadence = state.trainerCadenceRpm;
  const ftpWatts = effectiveFtpWatts();
  const maxHeartRateBpm = effectiveMaxHeartRateBpm();
  const gradeValue = Number.isFinite(grade) ? grade : null;
  const showPowerMeter = Number.isFinite(power);
  const showHeartRateMeter = Number.isFinite(heartRate);
  const showGradeMeter = state.route.length > 1 && Number.isFinite(gradeValue);
  const showCadenceMeter = Number.isFinite(cadence);

  els.powerMeter.hidden = !showPowerMeter;
  els.heartRateMeter.hidden = !showHeartRateMeter;
  els.gradeMeter.hidden = !showGradeMeter;
  els.cadenceMeter.hidden = !showCadenceMeter;
  els.fullscreenTrainingMeters.hidden = !(showPowerMeter || showHeartRateMeter || showGradeMeter || showCadenceMeter);

  const powerZones = currentPowerZones();
  const heartRateZones = currentHeartRateZones();
  const powerScale = zoneDisplayBounds(powerZones, 0, ftpWatts ? ftpWatts * 1.6 : 500);
  const heartRateScale = zoneDisplayBounds(heartRateZones, 0, maxHeartRateBpm);

  updateZoneMeter({
    meter: els.powerMeter,
    valueEl: els.zonePowerValue,
    metaEl: els.zonePowerMeta,
    fillEl: els.zonePowerFill,
    value: power,
    min: powerScale.min,
    max: powerScale.max,
    zones: powerZones,
    definitions: POWER_ZONE_DEFINITIONS,
    text: Number.isFinite(power) ? `${Math.round(power)} W` : "--",
    fallbackMeta: ftpWatts ? `FTP ${ftpWatts} W` : "Zones not set",
  });

  updateZoneMeter({
    meter: els.heartRateMeter,
    valueEl: els.zoneHeartRateValue,
    metaEl: els.zoneHeartRateMeta,
    fillEl: els.zoneHeartRateFill,
    value: heartRate,
    min: heartRateScale.min,
    max: heartRateScale.max,
    zones: heartRateZones,
    definitions: HEART_RATE_ZONE_DEFINITIONS,
    text: Number.isFinite(heartRate) ? `${Math.round(heartRate)} bpm` : "--",
    fallbackMeta: `Max ${maxHeartRateBpm} bpm`,
  });

  const gradeZones = gradeMeterZones();
  updateZoneMeter({
    meter: els.gradeMeter,
    valueEl: els.zoneGradeValue,
    metaEl: els.zoneGradeMeta,
    fillEl: els.zoneGradeFill,
    value: gradeValue,
    min: GRADE_METER_MIN_PERCENT,
    max: GRADE_METER_MAX_PERCENT,
    zones: gradeZones,
    text: Number.isFinite(gradeValue) ? `${gradeValue.toFixed(1)}%` : "--",
    fallbackMeta: "Live road",
    zone: gradeZones.findIndex((zone) => zone.color === gradeColor(gradeValue)),
    color: Number.isFinite(gradeValue) ? gradeColor(gradeValue) : null,
  });

  const cadenceZones = cadenceMeterZones();
  updateZoneMeter({
    meter: els.cadenceMeter,
    valueEl: els.zoneCadenceValue,
    metaEl: els.zoneCadenceMeta,
    fillEl: els.zoneCadenceFill,
    value: cadence,
    min: CADENCE_METER_MIN_RPM,
    max: CADENCE_METER_MAX_RPM,
    zones: cadenceZones,
    text: Number.isFinite(cadence) ? `${Math.round(cadence)} rpm` : "--",
    fallbackMeta: "Cadence",
    zone: cadenceZones.findIndex((zone) => zone.color === cadenceColor(cadence)),
    color: Number.isFinite(cadence) ? cadenceColor(cadence) : null,
  });
}

export function currentHeartRateZones() {
  return calculateHeartRateZones(effectiveMaxHeartRateBpm(), effectiveRestingHeartRateBpm());
}

export function currentPowerZones() {
  const ftpWatts = effectiveFtpWatts();
  return ftpWatts ? calculatePowerZones(ftpWatts) : null;
}

function effectiveFtpWatts() {
  return state.demoModeActive ? DEMO_RIDE.ftp_watts : state.ftpWatts;
}

function effectiveMaxHeartRateBpm() {
  return state.demoModeActive ? DEMO_RIDE.max_heart_rate_bpm : state.maxHeartRateBpm;
}

function effectiveRestingHeartRateBpm() {
  return state.demoModeActive ? DEMO_RIDE.resting_heart_rate_bpm : state.restingHeartRateBpm;
}

function calculateHeartRateZones(maxHr, restingHr = DEFAULT_RESTING_HEART_RATE_BPM) {
  if (!Number.isFinite(maxHr) || !Number.isFinite(restingHr) || maxHr <= restingHr) return null;
  const reserve = maxHr - restingHr;
  const t60 = Math.floor(restingHr + reserve * 0.6);
  const t70 = Math.floor(restingHr + reserve * 0.7);
  const t80 = Math.floor(restingHr + reserve * 0.8);
  const t90 = Math.floor(restingHr + reserve * 0.9);
  return [
    { min: 0, max: t60 - 1, label: `<${t60} bpm` },
    { min: t60, max: t70 - 1, label: `${t60}-${t70 - 1} bpm` },
    { min: t70, max: t80 - 1, label: `${t70}-${t80 - 1} bpm` },
    { min: t80, max: t90 - 1, label: `${t80}-${t90 - 1} bpm` },
    { min: t90, max: null, label: `${t90}+ bpm` },
  ];
}

function calculatePowerZones(ftp) {
  if (!Number.isFinite(ftp) || ftp <= 0) return null;
  const boundary = (ratio) => Math.floor(ftp * ratio);
  const z1Max = boundary(0.55);
  const z2Max = boundary(0.75);
  const z3Max = boundary(0.9);
  const z4Max = boundary(1.05);
  const z5Max = boundary(1.2);
  const z6Max = boundary(1.5);
  return [
    { min: 0, max: z1Max, label: `≤${z1Max}W` },
    { min: z1Max + 1, max: z2Max, label: `≤${z2Max}W` },
    { min: z2Max + 1, max: z3Max, label: `≤${z3Max}W` },
    { min: z3Max + 1, max: z4Max, label: `≤${z4Max}W` },
    { min: z4Max + 1, max: z5Max, label: `≤${z5Max}W` },
    { min: z5Max + 1, max: z6Max, label: `≤${z6Max}W` },
    { min: z6Max + 1, max: null, label: `>${z6Max}W` },
  ];
}

function gradeMeterZones() {
  return gradeColorZones(GRADE_METER_MIN_PERCENT, GRADE_METER_MAX_PERCENT);
}

// Cadence has no rider profile to derive zones from (unlike power/HR), so the
// green/yellow/red bands are plain rpm constants from tuning.yaml. HUD-only,
// so unlike gradeColor/gradeColorZones this isn't shared with any other module.
function cadenceColor(rpm) {
  if (!Number.isFinite(rpm)) return CADENCE_ZONE_COLORS.red;
  if (rpm < CADENCE_ZONE_YELLOW_MIN_RPM) return CADENCE_ZONE_COLORS.red;
  if (rpm < CADENCE_ZONE_GREEN_MIN_RPM) return CADENCE_ZONE_COLORS.yellow;
  if (rpm <= CADENCE_ZONE_GREEN_MAX_RPM) return CADENCE_ZONE_COLORS.green;
  if (rpm <= CADENCE_ZONE_YELLOW_MAX_RPM) return CADENCE_ZONE_COLORS.yellow;
  return CADENCE_ZONE_COLORS.red;
}

function cadenceMeterZones() {
  return [
    { min: CADENCE_METER_MIN_RPM, max: CADENCE_ZONE_YELLOW_MIN_RPM, color: CADENCE_ZONE_COLORS.red },
    { min: CADENCE_ZONE_YELLOW_MIN_RPM, max: CADENCE_ZONE_GREEN_MIN_RPM, color: CADENCE_ZONE_COLORS.yellow },
    { min: CADENCE_ZONE_GREEN_MIN_RPM, max: CADENCE_ZONE_GREEN_MAX_RPM, color: CADENCE_ZONE_COLORS.green },
    { min: CADENCE_ZONE_GREEN_MAX_RPM, max: CADENCE_ZONE_YELLOW_MAX_RPM, color: CADENCE_ZONE_COLORS.yellow },
    { min: CADENCE_ZONE_YELLOW_MAX_RPM, max: CADENCE_METER_MAX_RPM, color: CADENCE_ZONE_COLORS.red },
  ];
}

function zoneDisplayBounds(zones, fallbackMin, fallbackMax) {
  if (!Array.isArray(zones) || zones.length < 3) {
    return { min: fallbackMin, max: fallbackMax };
  }
  const innerWidths = zones
    .slice(1, -1)
    .map((zone) => Number.isFinite(zone.max) ? zone.max - zone.min + 1 : NaN)
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((a, b) => a - b);
  if (!innerWidths.length || !Number.isFinite(zones[1]?.min) || !Number.isFinite(zones.at(-1)?.min)) {
    return { min: fallbackMin, max: fallbackMax };
  }
  const typicalWidth = innerWidths[Math.floor(innerWidths.length / 2)];
  const min = Math.max(0, zones[1].min - typicalWidth);
  const max = zones.at(-1).min + typicalWidth;
  return max > min ? { min, max } : { min: fallbackMin, max: fallbackMax };
}

function updateZoneMeter({
  meter,
  valueEl,
  metaEl,
  fillEl,
  value,
  min = 0,
  max,
  zones = null,
  definitions = null,
  text,
  fallbackMeta,
  zone,
  color = null,
}) {
  valueEl.textContent = text;
  const zoneIndex_ = Array.isArray(zones) && definitions
    ? zoneIndexFromZones(value, zones)
    : zone;
  const zoneDef = Number.isInteger(zoneIndex_) && definitions?.[zoneIndex_] ? definitions[zoneIndex_] : null;
  metaEl.textContent = zoneDef ? `Z${zoneIndex_ + 1} ${zoneDef.name}` : fallbackMeta;
  const zoneMaxes = Array.isArray(zones) ? zones.map((item) => item.max).filter(Number.isFinite) : [];
  const scaleMax = Number.isFinite(max)
    ? max
    : (zoneMaxes.length ? Math.max(...zoneMaxes, 1) * 1.1 : 1);
  const span = Math.max(1, scaleMax - min);
  const fraction = Number.isFinite(value) ? clamp((value - min) / span, 0, 1) : 0;
  const trackEl = fillEl.parentElement;
  if (trackEl) {
    trackEl.style.background = zoneTrackGradient({
      zones,
      definitions,
      min,
      max: scaleMax,
      fallbackColor: color,
    });
  }
  fillEl.style.left = `${fraction * 100}%`;
  fillEl.classList.toggle("is-empty", !Number.isFinite(value));
  meter.dataset.zone = Number.isInteger(zoneIndex_) ? String(zoneIndex_) : "";
}

function zoneTrackGradient({ zones, definitions = null, min, max, fallbackColor = null }) {
  const base = "rgba(255, 255, 255, 0.14)";
  if (!Array.isArray(zones) || !zones.length || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return fallbackColor || base;
  }
  const span = max - min;
  const stops = [];
  zones.forEach((zone, index) => {
    const color = zone.color || definitions?.[index]?.color;
    if (!color) return;
    const start = clamp((zone.min - min) / span, 0, 1) * 100;
    const end = clamp(((zone.max ?? max) - min) / span, 0, 1) * 100;
    if (end < start) return;
    stops.push(`${color} ${start.toFixed(2)}%`, `${color} ${end.toFixed(2)}%`);
  });
  return stops.length ? `linear-gradient(90deg, ${stops.join(", ")})` : (fallbackColor || base);
}

function zoneIndexFromZones(value, zones) {
  if (!Number.isFinite(value) || !Array.isArray(zones) || !zones.length) return null;
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    if (value >= zone.min && (zone.max === null || value <= zone.max)) {
      return index;
    }
  }
  return null;
}

export function renderZoneSummaries() {
  renderZoneSummary(els.heartRateZoneSummary, "Heart-rate zones", currentHeartRateZones());
  renderZoneSummary(els.powerZoneSummary, "Power zones", currentPowerZones());
}

function renderZoneSummary(container, label, zones) {
  if (!container) return;
  if (!Array.isArray(zones) || !zones.length) {
    container.textContent = label === "Power zones" ? "Enter FTP to calculate zones." : "--";
    return;
  }
  container.textContent = `${label}: ${zones.map((zone, index) => `Z${index + 1} ${zone.label}`).join(" · ")}`;
}

export function toggleZoneHelp(event) {
  event.stopPropagation();
  const button = event.currentTarget;
  const popover = document.getElementById(button.getAttribute("aria-controls"));
  if (!popover) return;
  const shouldOpen = popover.hidden;
  closeZoneHelpPopovers();
  popover.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
}

export function closeZoneHelpOnOutsideClick(event) {
  if (event.target.closest("[data-zone-help-trigger], .zone-help-popover")) return;
  closeZoneHelpPopovers();
}

export function closeZoneHelpPopovers() {
  let closedAny = false;
  els.zoneHelpButtons.forEach((button) => {
    const popover = document.getElementById(button.getAttribute("aria-controls"));
    if (popover && !popover.hidden) {
      popover.hidden = true;
      closedAny = true;
    }
    button.setAttribute("aria-expanded", "false");
  });
  return closedAny;
}
