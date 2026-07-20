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

// Camera defaults & bounds
export const DEFAULT_CAMERA_ZOOM = req("camera", "follow_defaults", "zoom");
export const DEFAULT_CAMERA_ANGLE_DEGREES = req("camera", "follow_defaults", "angle_degrees");
export const DEFAULT_CAMERA_BEHIND_METERS = req("camera", "follow_defaults", "behind_meters");
export const DEFAULT_FIRST_PERSON_CAMERA_HEIGHT_METERS = req("camera", "first_person", "default_height_meters");
export const FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS = req("camera", "first_person", "min_height_meters");
export const FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS = req("camera", "first_person", "max_height_meters");
export const FIRST_PERSON_LOOK_AHEAD_METERS = req("camera", "first_person", "look_ahead_meters");
export const FIRST_PERSON_CAMERA_TILT_DEGREES = req("camera", "first_person", "tilt_degrees");
export const OVERVIEW_TILT_DEGREES = req("overview", "tilt_degrees");
export const OVERVIEW_HEADING_OFFSET_DEGREES = req("overview", "heading_offset_degrees");
export const OVERVIEW_MARGIN_FACTOR = req("overview", "margin_factor");
export const OVERVIEW_RANGE_FACTOR = req("overview", "range_factor");
export const OVERVIEW_MIN_RANGE_METERS = req("overview", "min_range_meters");
export const OVERVIEW_MAX_RANGE_METERS = req("overview", "max_range_meters");

// Overview motion
export const DEFAULT_OVERVIEW_MODE = req("overview_motion", "default_mode");
export const DEFAULT_CLIMB_FOCUS_MODE = req("overview_motion", "default_climb_focus_mode");
export const OVERVIEW_ORBIT_SECONDS_PER_REV = req("overview_motion", "orbit", "seconds_per_rev");
export const OVERVIEW_ORBIT_DIRECTION = req("overview_motion", "orbit", "direction");
export const DEFAULT_CLIMB_ORBIT_SECONDS_PER_REV = req("overview_motion", "climb_orbit", "default_seconds_per_rev");
export const CLIMB_ORBIT_SECONDS_PER_REV_MIN = req("overview_motion", "climb_orbit", "min_seconds_per_rev");
export const CLIMB_ORBIT_SECONDS_PER_REV_MAX = req("overview_motion", "climb_orbit", "max_seconds_per_rev");

// Camera transition arcs (overview ↔ chase handoffs); the whole config object
// is passed to camera/transition-arc.mjs, like ELLIPSE_FLYBY.
export const CAMERA_TRANSITION = req("camera_transition");

// Finish-line orbit
export const DEFAULT_FINISH_ORBIT_ENABLED = req("finish_orbit", "enabled");
export const FINISH_ORBIT_RANGE_METERS = req("finish_orbit", "range_meters");
export const FINISH_ORBIT_TILT_DEGREES = req("finish_orbit", "tilt_degrees");
export const FINISH_ORBIT_SECONDS_PER_REV = req("finish_orbit", "seconds_per_rev");
export const FINISH_ORBIT_DIRECTION = req("finish_orbit", "direction");
export const FINISH_ORBIT_LOOKAT_HEIGHT_METERS = req("finish_orbit", "lookat_height_meters");

// Profile segment selection
export const PROFILE_SEGMENT_SELECTION_DRAG_PIXELS = req("profile_segment_selection", "drag_pixels");
export const PROFILE_SEGMENT_SELECTION_MIN_METERS = req("profile_segment_selection", "min_meters");
export const PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION = req("profile_segment_selection", "min_route_fraction");

// Overview debug line
export const OVERVIEW_DEBUG_LINE_COLOR = req("overview_debug_line", "color");
export const OVERVIEW_DEBUG_LINE_WIDTH = req("overview_debug_line", "width");
export const OVERVIEW_DEBUG_LINE_ALTITUDE_METERS = req("overview_debug_line", "altitude_meters");
export const OVERVIEW_DEBUG_LINE_SAMPLE_COUNT = req("overview_debug_line", "sample_count");

export const DEFAULT_MAP_FOV_DEGREES = req("camera", "default_map_fov_degrees");
export const OVERVIEW_ANIM_INTRO_SECONDS = req("overview_motion", "anim_intro_seconds");
export const SATELLITE_TILT_DEGREES = req("overview_motion", "satellite", "tilt_degrees");
export const SATELLITE_MARGIN_FACTOR = req("overview_motion", "satellite", "margin_factor");
export const ELLIPSE_FLYBY = req("overview_motion", "ellipse_flyby");
export const HEADING_SAMPLE_METERS = req("camera", "heading_sample_meters");
export const INTERACTION_SETTLE_MS = req("camera", "interaction_settle_ms");
export const CAMERA_ZOOM_MIN = req("camera", "bounds", "zoom_min");
export const CAMERA_ZOOM_MAX = req("camera", "bounds", "zoom_max");
export const CAMERA_PAN_LIMIT_METERS = req("camera", "bounds", "pan_limit_meters");
export const CAMERA_CENTER_ALTITUDE_LIMIT_METERS = req("camera", "bounds", "center_altitude_limit_meters");
export const CAMERA_TILT_MIN = req("camera", "bounds", "tilt_min");
export const CAMERA_TILT_MAX = req("camera", "bounds", "tilt_max");

// Camera terrain avoidance
export const DEFAULT_TERRAIN_AVOID_ENABLED = req("terrain_avoidance", "enabled");
export const DEFAULT_TERRAIN_CLEARANCE_METERS = req("terrain_avoidance", "clearance_meters");
export const TERRAIN_SAMPLE_RADIUS_METERS = req("terrain_avoidance", "sample_radius_meters");
export const TERRAIN_LIFT_RECOMPUTE_MS = req("terrain_avoidance", "lift_recompute_ms");
export const TERRAIN_LIFT_RISE_TAU_SECONDS = req("terrain_avoidance", "lift_rise_tau_seconds");
export const TERRAIN_LIFT_FALL_TAU_SECONDS = req("terrain_avoidance", "lift_fall_tau_seconds");

// Follow-camera rider visibility (swing around a blocking hill)
export const DEFAULT_RIDER_VISIBILITY_ENABLED = req("rider_visibility", "enabled");
export const RIDER_VISIBILITY_MAX_NUDGE_DEGREES = req("rider_visibility", "max_nudge_degrees");
export const RIDER_VISIBILITY_STEP_DEGREES = req("rider_visibility", "step_degrees");
export const RIDER_VISIBILITY_RAY_SAMPLES = req("rider_visibility", "ray_samples");
export const RIDER_VISIBILITY_RECOMPUTE_MS = req("rider_visibility", "recompute_ms");
export const RIDER_VISIBILITY_RISE_TAU_SECONDS = req("rider_visibility", "rise_tau_seconds");
export const RIDER_VISIBILITY_FALL_TAU_SECONDS = req("rider_visibility", "fall_tau_seconds");

// Online terrain elevation (Mapzen Terrarium tiles on AWS Open Data)
export const DEFAULT_TERRAIN_TILES_ENABLED = req("terrain_tiles", "enabled");
export const TERRAIN_TILE_BASE_URL = req("terrain_tiles", "base_url");
export const TERRAIN_TILE_ZOOM = req("terrain_tiles", "zoom");
export const TERRAIN_TILE_SIZE = req("terrain_tiles", "tile_size");
export const TERRAIN_TILE_MAX_CACHE = req("terrain_tiles", "max_cache_tiles");
export const TERRAIN_TILE_ATTRIBUTION = req("terrain_tiles", "attribution");

// Rider beacon
export const DEFAULT_BEACON_ENABLED = req("rider_beacon", "enabled");
export const DEFAULT_BEACON_DIAMETER_METERS = req("rider_beacon", "diameter_meters");
export const DEFAULT_BEACON_HEIGHT_METERS = req("rider_beacon", "height_meters");
export const DEFAULT_BEACON_OPACITY = req("rider_beacon", "opacity");
export const DEFAULT_BEACON_COLOR = req("rider_beacon", "color");

// Rider dot
export const RIDER_DOT_MODEL_PATH = req("rider_dot", "model_path");
export const RIDER_DOT_ORIENTATION = req("rider_dot", "orientation");
export const RIDER_DOT_SCALE = req("rider_dot", "scale");
export const RIDER_DOT_OVERVIEW_SCALE_FACTOR = req("rider_dot", "overview_scale_factor");
export const RIDER_DOT_DIAMETER_METERS = req("rider_dot", "diameter_meters");
export const RIDER_DOT_ALTITUDE_METERS = req("rider_dot", "altitude_meters");

// Route line rendering
export const DEFAULT_ROUTE_GRADE_COLORS_ENABLED = req("route_line", "grade_colors_enabled");
export const ROUTE_LINE_ALTITUDE_METERS = req("route_line", "altitude_meters");
export const ROUTE_LINE_COLOR = req("route_line", "color");
export const ROUTE_LINE_WIDTH = req("route_line", "width");
export const ROUTE_LINE_OUTER_COLOR = req("route_line", "outer_color");
export const ROUTE_LINE_OUTER_WIDTH = req("route_line", "outer_width");
export const ROUTE_FOCUS_LINE_WIDTH = req("route_line", "focus_line_width");
export const ROUTE_FOCUS_OUTER_COLOR = req("route_line", "focus_outer_color");
export const ROUTE_FOCUS_OUTER_WIDTH = req("route_line", "focus_outer_width");
export const ROUTE_LINE_SPACING_METERS = req("route_line", "spacing_meters");
export const ROUTE_LINE_MAX_POINTS = req("route_line", "max_points");

// Gallery previews & mini profiles
export const GALLERY_PREVIEW_MAP_TYPE = req("gallery", "preview", "map_type");
export const GALLERY_PREVIEW_FIT_PADDING_PIXELS = req("gallery", "preview", "fit_padding_pixels");
export const GALLERY_PREVIEW_ROUTE_COLOR = req("gallery", "preview", "route_color");
export const GALLERY_PREVIEW_2D_ROUTE_WIDTH = req("gallery", "preview", "route_width_2d");
export const GALLERY_PREVIEW_3D_ROUTE_WIDTH = req("gallery", "preview", "route_width_3d");
export const GALLERY_PREVIEW_3D_ROUTE_OUTER_COLOR = req("gallery", "preview", "route_outer_color_3d");
export const GALLERY_PREVIEW_3D_ROUTE_OUTER_WIDTH = req("gallery", "preview", "route_outer_width_3d");
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
export const DEFAULT_THEATER_HIDE_MINIMAP = req("recording", "theater_hide", "minimap");

// Display & HUD defaults
export const DEFAULT_SHOW_MINIMAP = req("display_hud", "show_minimap");
export const DEFAULT_MAP_LABELS_ENABLED = req("display_hud", "map_labels_enabled");
export const DEFAULT_TIME_FORMAT = req("display_hud", "time_format");
export const DEFAULT_DURATION_FORMAT = req("display_hud", "duration_format");
export const FULLSCREEN_CLOCK_REFRESH_MS = req("display_hud", "fullscreen_clock_refresh_ms");
export const HEART_RATE_REFRESH_MS = req("display_hud", "heart_rate_refresh_ms");
export const DEFAULT_CAMERA_DEBUG_ENABLED = req("display_hud", "camera_debug", "enabled");
export const CAMERA_DEBUG_REFRESH_MS = req("display_hud", "camera_debug", "refresh_ms");
export const GALLERY_METADATA_CAMERA_REFRESH_MS = req("display_hud", "gallery_metadata_camera_refresh_ms");
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
