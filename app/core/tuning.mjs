// GPX Rider tuning loader. THE VALUES AND THEIR DOCUMENTATION LIVE IN
// tuning.yaml (same folder) — edit that file, reload the page, done. This
// module only loads and re-exports them under their historical names so the
// rest of the app keeps importing plain constants, and so the Python
// generators (scripts/tuning_config.py) can read the exact same file instead
// of mirroring values by hand.
//
// Top-level await: importers simply wait until the config is loaded — no
// init call needed anywhere. In the browser the file is fetched relative to
// this module; under Node (tests, tooling) it is read from disk.

import { parseYaml } from "./yaml.mjs";

const CONFIG_URL = new URL("./tuning.yaml", import.meta.url);

async function loadConfigText() {
  // Node (tests, link checks, tooling) has no fetch for file: URLs.
  if (globalThis.process?.versions?.node) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return readFile(fileURLToPath(CONFIG_URL), "utf8");
  }
  const response = await fetch(CONFIG_URL);
  if (!response.ok) throw new Error(`Could not load tuning.yaml (${response.status}).`);
  return response.text();
}

const config = parseYaml(await loadConfigText());

// Every export navigates a nested snake_case path in tuning.yaml and is
// looked up strictly: a typo or a missing key fails loudly at startup with
// the full path, instead of silently becoming undefined somewhere deep in the
// app. The UPPER_SNAKE export names are the historical constant names the rest
// of the app imports; only the mapping below knows the yaml layout.
function req(...path) {
  let node = config;
  const trail = [];
  for (const key of path) {
    trail.push(key);
    if (node == null || typeof node !== "object" || !(key in node)) {
      throw new Error(`tuning.yaml is missing "${trail.join(".")}".`);
    }
    node = node[key];
  }
  return node;
}

export const APP_NAME = req("app", "name");

// Movement & pedaling
export const PEDALING_START_KPH = req("movement", "pedaling", "start_kph");
export const PEDALING_STOP_KPH = req("movement", "pedaling", "stop_kph");
export const SIMULATION_SPEED_MIN_KPH = req("movement", "simulation_speed", "min_kph");
export const SIMULATION_SPEED_MAX_KPH = req("movement", "simulation_speed", "max_kph");
export const DEFAULT_SIMULATION_SPEED_KPH = req("movement", "simulation_speed", "default_kph");
export const MAX_TICK_SECONDS = req("movement", "max_tick_seconds");
export const SLOW_UI_INTERVAL_MS = req("movement", "slow_ui_interval_ms");
export const RIDE_SAVE_THROTTLE_MS = req("movement", "ride_save_throttle_ms");

// Trainer grade updates
export const DEFAULT_GRADE_INTERVAL_SECONDS = req("trainer", "grade_interval", "default_seconds");
export const GRADE_INTERVAL_MIN_SECONDS = req("trainer", "grade_interval", "min_seconds");
export const GRADE_INTERVAL_MAX_SECONDS = req("trainer", "grade_interval", "max_seconds");
export const TACX_FEC_DEFAULT_CRR = req("trainer", "fec_default_crr");

// Route math
export const GRADE_LOOKAROUND_METERS = req("route_math", "grade_lookaround_meters");
export const GRADE_MIN_PERCENT = req("route_math", "grade", "min_percent");
export const GRADE_MAX_PERCENT = req("route_math", "grade", "max_percent");
export const GRADE_METER_MIN_PERCENT = req("route_math", "grade", "meter_min_percent");
export const GRADE_METER_MAX_PERCENT = req("route_math", "grade", "meter_max_percent");
export const CLIMB_NOISE_THRESHOLD_METERS = req("route_math", "climb_noise_threshold_meters");

// Grade color palette (shared with the Python gallery generator)
export const GRADE_PROFILE_THRESHOLDS = req("grade_palette", "thresholds");
export const GRADE_PROFILE_COLORS = req("grade_palette", "colors");

// Smart ETA
export const ETA_CLIMB_EQUIVALENT_FACTOR = req("eta", "climb_equivalent_factor");
export const ETA_DESCENT_CREDIT_FACTOR = req("eta", "descent_credit_factor");
export const ETA_MIN_HISTORY_SECONDS = req("eta", "min_history_seconds");
export const ETA_MIN_HISTORY_METERS = req("eta", "min_history_meters");

// Map (Leaflet + OpenStreetMap top-down view)
export const MAP_TILE_URL = req("map", "tile_url");
export const MAP_TILE_SUBDOMAINS = req("map", "tile_subdomains");
export const MAP_ATTRIBUTION = req("map", "attribution");
export const MAP_MAX_ZOOM = req("map", "max_zoom");
export const MAP_DEFAULT_CENTER_LAT = req("map", "default_center_lat");
export const MAP_DEFAULT_CENTER_LNG = req("map", "default_center_lng");
export const MAP_DEFAULT_ZOOM = req("map", "default_zoom");
export const MAP_FOLLOW_ZOOM = req("map", "follow_zoom");
export const MAP_OVERVIEW_PADDING_PIXELS = req("map", "overview_padding_pixels");
export const HEADING_SAMPLE_METERS = req("map", "heading_sample_meters");
export const INTERACTION_SETTLE_MS = req("map", "interaction_settle_ms");
export const RIDER_MARKER_SIZE_PIXELS = req("map", "marker_size_pixels");
export const RIDER_MARKER_COLOR = req("map", "marker_color");
export const RIDER_MARKER_RING_COLOR = req("map", "marker_ring_color");

// Profile segment selection
export const PROFILE_SEGMENT_SELECTION_DRAG_PIXELS = req("profile_segment_selection", "drag_pixels");
export const PROFILE_SEGMENT_SELECTION_MIN_METERS = req("profile_segment_selection", "min_meters");
export const PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION = req("profile_segment_selection", "min_route_fraction");

// Route line rendering
export const DEFAULT_ROUTE_GRADE_COLORS_ENABLED = req("route_line", "grade_colors_enabled");
export const ROUTE_LINE_COLOR = req("route_line", "color");
export const ROUTE_LINE_WIDTH = req("route_line", "width");
export const ROUTE_FOCUS_LINE_WIDTH = req("route_line", "focus_width");

// Gallery previews & mini profiles
export const GALLERY_PREVIEW_FIT_PADDING_PIXELS = req("gallery", "preview", "fit_padding_pixels");
export const GALLERY_PREVIEW_ROUTE_COLOR = req("gallery", "preview", "route_color");
export const GALLERY_PREVIEW_ROUTE_WIDTH = req("gallery", "preview", "route_width");
export const GALLERY_MINI_PROFILE_BAR_COUNT = req("gallery", "mini_profile", "bar_count");
export const GALLERY_MINI_PROFILE_FLAT_COLOR = req("gallery", "mini_profile", "flat_color");

// Screenshots & theater mode
export const DEFAULT_SHOW_SCREENSHOT_BUTTON = req("screenshots", "show_button");
export const DEFAULT_SCREENSHOT_ASPECT = req("screenshots", "aspect");
export const DEFAULT_SCREENSHOT_WIDTH = req("screenshots", "default_width");
export const SCREENSHOT_WIDTH_MIN = req("screenshots", "width_min");
export const SCREENSHOT_WIDTH_MAX = req("screenshots", "width_max");
export const RECORDING_MAP_VIEWPORT_WIDTH_PIXELS = req("recording", "map_viewport", "width_pixels");
export const RECORDING_MAP_VIEWPORT_HEIGHT_PIXELS = req("recording", "map_viewport", "height_pixels");
export const RECORDING_MAP_VIEWPORT_TOLERANCE_PIXELS = req("recording", "map_viewport", "tolerance_pixels");
export const DEFAULT_THEATER_HIDE_CLOCK = req("recording", "theater_hide", "clock");
export const DEFAULT_THEATER_HIDE_METERS = req("recording", "theater_hide", "meters");
export const DEFAULT_THEATER_HIDE_DOCK = req("recording", "theater_hide", "dock");
export const DEFAULT_THEATER_HIDE_CLIMB_BANNER = req("recording", "theater_hide", "climb_banner");
export const DEFAULT_THEATER_HIDE_DEMO_CHIP = req("recording", "theater_hide", "demo_chip");
export const DEFAULT_THEATER_HIDE_CONTROLS = req("recording", "theater_hide", "controls");

// Display & HUD defaults
export const DEFAULT_TIME_FORMAT = req("display_hud", "time_format");
export const DEFAULT_DURATION_FORMAT = req("display_hud", "duration_format");
export const FULLSCREEN_CLOCK_REFRESH_MS = req("display_hud", "fullscreen_clock_refresh_ms");
export const HEART_RATE_REFRESH_MS = req("display_hud", "heart_rate_refresh_ms");
export const DEFAULT_HUD_FIELD_ORDER = req("display_hud", "field_order");
export const DEFAULT_HUD_VISIBLE_COUNT = req("display_hud", "visible_count");
export const DEFAULT_HUD_DOCK_COLLAPSED = req("display_hud", "dock_collapsed");

// Training zones & calories
export const DEFAULT_RESTING_HEART_RATE_BPM = req("training_zones", "resting_heart_rate_bpm");
export const DEFAULT_MAX_HEART_RATE_BPM = req("training_zones", "max_heart_rate_bpm");
export const POWER_ZONE_DEFINITIONS = req("training_zones", "power_zone_definitions");
export const HEART_RATE_ZONE_DEFINITIONS = req("training_zones", "heart_rate_zone_definitions");
export const HEART_RATE_MAX_AGE_FORMULA_BASE = req("training_zones", "heart_rate_max_age_formula_base");
export const PROFILE_HISTORY_SAMPLE_LIMIT = req("training_zones", "profile_history_sample_limit");
export const CYCLING_GROSS_EFFICIENCY = req("training_zones", "cycling_gross_efficiency");
export const CADENCE_METER_MIN_RPM = req("training_zones", "cadence_meter_min_rpm");
export const CADENCE_METER_MAX_RPM = req("training_zones", "cadence_meter_max_rpm");
export const CADENCE_ZONE_GREEN_MIN_RPM = req("training_zones", "cadence_zone_green_min_rpm");
export const CADENCE_ZONE_GREEN_MAX_RPM = req("training_zones", "cadence_zone_green_max_rpm");
export const CADENCE_ZONE_YELLOW_MIN_RPM = req("training_zones", "cadence_zone_yellow_min_rpm");
export const CADENCE_ZONE_YELLOW_MAX_RPM = req("training_zones", "cadence_zone_yellow_max_rpm");
export const CADENCE_ZONE_COLORS = req("training_zones", "cadence_zone_colors");

// Climb banner
export const CLIMB_BANNER_APPROACH_METERS = req("climb_banner", "approach_meters");
export const CLIMB_BANNER_MINI_BAR_COUNT = req("climb_banner", "mini_bar_count");
export const CLIMB_CATEGORIES = req("climb_banner", "categories");

// Route difficulty classification (shared with the Python gallery generator)
export const EQUIVALENT_KM_CLIMB_METERS = req("route_difficulty", "equivalent_km_climb_meters");
export const DISTANCE_CLASS_THRESHOLDS_KM = req("route_difficulty", "distance_class_thresholds_km");
export const TERRAIN_CLASS_THRESHOLDS_M_PER_KM = req("route_difficulty", "terrain_class_thresholds_m_per_km");
export const DIFFICULTY_THRESHOLDS_EQUIVALENT_KM = req("route_difficulty", "difficulty_thresholds_equivalent_km");

// Climb detection (resampled fatigue-pressure integrator — see tuning.yaml)
export const CLIMB_RESAMPLE_STEP_METERS = req("climb_detection", "resample_step_meters");
export const CLIMB_ELEVATION_MEDIAN_WINDOW_METERS = req("climb_detection", "elevation_median_window_meters");
export const CLIMB_ELEVATION_SMOOTH_WINDOW_METERS = req("climb_detection", "elevation_smooth_window_meters");
export const CLIMB_SHORT_GRADE_WINDOW_METERS = req("climb_detection", "short_grade_window_meters");
export const CLIMB_LONG_GRADE_WINDOW_METERS = req("climb_detection", "long_grade_window_meters");
export const CLIMB_LONG_GRADE_WEIGHT = req("climb_detection", "long_grade_weight");
export const CLIMB_START_FATIGUE = req("climb_detection", "start_fatigue");
export const CLIMB_END_FATIGUE = req("climb_detection", "end_fatigue");
export const CLIMB_END_FATIGUE_MIN_DISTANCE_METERS = req("climb_detection", "end_fatigue_min_distance_meters");
export const CLIMB_MAX_FATIGUE = req("climb_detection", "max_fatigue");
export const CLIMB_PRESSURE_START_GRADE_PERCENT = req("climb_detection", "pressure_start_grade_percent");
export const CLIMB_PRESSURE_EXPONENT = req("climb_detection", "pressure_exponent");
export const CLIMB_RECOVERY_UPHILL_THRESHOLD_PERCENT = req("climb_detection", "recovery_uphill_threshold_percent");
export const CLIMB_RECOVERY_FLAT_THRESHOLD_PERCENT = req("climb_detection", "recovery_flat_threshold_percent");
export const CLIMB_RECOVERY_FLAT_PRESSURE = req("climb_detection", "recovery_flat_pressure");
export const CLIMB_RECOVERY_DOWNHILL_BASE = req("climb_detection", "recovery_downhill_base");
export const CLIMB_RECOVERY_DOWNHILL_SCALE = req("climb_detection", "recovery_downhill_scale");
export const CLIMB_RECOVERY_MAX = req("climb_detection", "recovery_max");
export const CLIMB_MIN_GAIN_METERS = req("climb_detection", "min_gain_meters");
export const CLIMB_MIN_DISTANCE_METERS = req("climb_detection", "min_distance_meters");
export const CLIMB_START_LOOKBACK_METERS = req("climb_detection", "start_lookback_meters");
export const CLIMB_END_DROP_METERS = req("climb_detection", "end_drop_meters");
export const CLIMB_END_DROP_DISTANCE_METERS = req("climb_detection", "end_drop_distance_meters");
export const CLIMB_MAX_EASY_AFTER_PEAK_METERS = req("climb_detection", "max_easy_after_peak_meters");
export const CLIMB_MERGE_GAP_METERS = req("climb_detection", "merge_gap_meters");
export const CLIMB_MERGE_MAX_DROP_METERS = req("climb_detection", "merge_max_drop_meters");
export const CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH = req("climb_detection", "min_average_grade_for_length");

// Demo mode
export const DEMO_RIDE = req("demo_ride");

// Ride recording
export const RIDE_SAMPLE_INTERVAL_MS = req("ride_recording", "sample_interval_ms");
export const RIDE_PERSIST_INTERVAL_MS = req("ride_recording", "persist_interval_ms");

// Landing page hero replay
export const LANDING_HERO = req("landing_hero");
