// GPX Rider tuning — every adjustable app parameter in one documented place.
//
// Change a value here, reload the page, done: there is no build step. Each
// constant says what it does, what unit it is in, and what happens when you
// move it. Settings the user can change in the ⚙ dialog only get their
// *defaults* from here — a value already saved in the browser (see
// app/storage.mjs) wins until the user resets it (or clears site data).
//
// Two things deliberately do NOT live here:
// - app/config.mjs — the deploy-time Maps API key slot. It is rewritten by
//   scripts/inject_maps_api_key.py during deployment, so it must stay as-is.
// - BLE write-queue internals in trainer.mjs — timing of GATT operations is
//   a hardware-safety concern, tuned against real trainers; read the
//   comments there before touching them.

// --- Movement & pedaling -----------------------------------------------------

// Pedaling detection with hysteresis: the rider counts as "pedaling" once the
// trainer reports at least START km/h, and stops counting only after speed
// falls to STOP km/h. The gap keeps a spinning-down flywheel from flapping
// the movement source on/off around a single threshold.
export const PEDALING_START_KPH = 3;
export const PEDALING_STOP_KPH = 1;

// Simulation speed slider: the artificial speed used to auto-ride a route
// with no trainer. DEFAULT is where the slider starts; MIN/MAX bound both
// the slider and any saved value. These drive the range input's attributes
// at startup, so this is the single source of truth for the slider's range.
export const SIMULATION_SPEED_MIN_KPH = 8;
export const SIMULATION_SPEED_MAX_KPH = 100;
export const DEFAULT_SIMULATION_SPEED_KPH = 24;

// A backgrounded tab stops requestAnimationFrame; without this cap the first
// frame after returning would teleport the rider minutes down the road.
// Raising it makes background riding smoother-looking on return but risks a
// visible jump after long pauses.
export const MAX_TICK_SECONDS = 5;

// How often the slow parts of the ride UI (DOM stats, elevation profile,
// minimap marker) refresh while moving. The map camera still updates every
// frame; this only throttles text/canvas work.
export const SLOW_UI_INTERVAL_MS = 250;

// How often the ride (route + progress) is persisted to browser storage
// while moving. Lower = less progress lost on a crash, more storage churn.
export const RIDE_SAVE_THROTTLE_MS = 1500;

// --- Trainer grade updates -----------------------------------------------------

// How often the averaged route grade is written to the trainer, in seconds.
// The default is what the settings slider starts at; MIN/MAX bound both the
// slider and any saved value. Faster updates track terrain more closely but
// make the trainer hunt on noisy GPX elevation.
export const DEFAULT_GRADE_INTERVAL_SECONDS = 2;
export const GRADE_INTERVAL_MIN_SECONDS = 1;
export const GRADE_INTERVAL_MAX_SECONDS = 5;

// --- Route math (grade, ascent/descent) ----------------------------------------

// The live grade is measured over a window this many meters behind and ahead
// of the rider. Longer = smoother grade that lags hill starts; shorter =
// snappier but noisier with imperfect GPX elevation.
export const GRADE_LOOKAROUND_METERS = 18;

// The grade sent to the trainer and shown in the stats is clamped to this
// range (in percent) so one bad elevation point can't slam the trainer.
export const GRADE_MIN_PERCENT = -15;
export const GRADE_MAX_PERCENT = 20;

// Total ascent/descent noise filter: an elevation change only counts toward
// the cumulative ascent/descent once it exceeds this many meters in one
// direction. GPX elevation jitters by a meter or so point-to-point; summing
// it raw would badly overestimate climbing. Bigger values under-count short
// rollers, smaller values over-count noise. 2 m matches what most route
// planners report.
export const CLIMB_NOISE_THRESHOLD_METERS = 2;

// --- Smart ETA -----------------------------------------------------------------
//
// The ETA converts the route into "flat-equivalent meters": every meter of
// climbing still ahead counts as extra flat distance, every meter of descent
// gives a little back. Your pace in flat-equivalent meters per second is
// measured over the ride so far, then applied to what's left — so a slow
// pass over the top of a climb doesn't project a slow descent.

// How many flat meters one vertical meter of climbing costs. ~25 matches a
// recreational rider around 150 W (1 km at 8% ≈ 1 km + 80 m × 25 = 3 km
// flat-equivalent). Strong riders effectively "pay" less — lower it if the
// ETA overshoots on climbs for you.
export const ETA_CLIMB_EQUIVALENT_FACTOR = 25;

// How many flat meters one vertical meter of descent gives back. Descending
// is faster than flat riding but not free (braking, corners). Must stay well
// below 1/max-descent-grade (~6.7 at the -15% clamp) or a steep descent
// could count as negative distance.
export const ETA_DESCENT_CREDIT_FACTOR = 5;

// The measured pace is trusted only after this much riding; before that the
// ETA falls back to the current speed (rough, but better than nothing).
export const ETA_MIN_HISTORY_SECONDS = 45;
export const ETA_MIN_HISTORY_METERS = 150;

// --- Camera defaults & bounds ----------------------------------------------------

// Follow-camera defaults (the settings sliders start here; "Reset camera"
// returns here). Zoom is a multiplier on the base viewing distance, angle is
// the tilt from straight-down in degrees, behind is how many meters the
// camera trails the rider.
export const DEFAULT_CAMERA_ZOOM = 2.5;
export const DEFAULT_CAMERA_ANGLE_DEGREES = 75;
export const DEFAULT_CAMERA_BEHIND_METERS = 800;

// Route overview shown when a route loads: whole route framed from this tilt.
export const OVERVIEW_TILT_DEGREES = 45;

// The rider's heading is sampled this many meters behind/ahead of the rider,
// so the camera points the way the rider moves rather than at a distant spot.
export const HEADING_SAMPLE_METERS = 4;

// After the user stops touching the map, the app waits this long before
// capturing the manual camera and resuming automatic control.
export const INTERACTION_SETTLE_MS = 600;

// Deliberately huge bounds: they exist only to keep corrupted saved settings
// from wedging the camera, not to restrict framing — wide shots for
// screenshots need extreme zoom-outs and pans.
export const CAMERA_ZOOM_MIN = 0.001;
export const CAMERA_ZOOM_MAX = 1000;
export const CAMERA_PAN_LIMIT_METERS = 100000;
export const CAMERA_CENTER_ALTITUDE_LIMIT_METERS = 20000;
export const CAMERA_TILT_MIN = 1;
export const CAMERA_TILT_MAX = 89;

// --- Camera terrain avoidance ----------------------------------------------------

// Lift the camera when its view ray would sink into a hillside, easing back
// down once the terrain allows. The terrain estimate comes from the route's
// own elevation points — deliberately NOT the Google Elevation API, which
// would cost real money at follow-camera query rates.
export const DEFAULT_TERRAIN_AVOID_ENABLED = true;
export const DEFAULT_TERRAIN_CLEARANCE_METERS = 20;

// Switchback roads (e.g. the Amalfi Coast) fold back on themselves, so a
// hairpin's higher hillside can sit a couple of hundred meters away in
// straight-line terms while being far along the route path — a narrow radius
// only ever sees the (lower) stretch of road right at the sample point and
// misses that the ground behind it keeps climbing. Cast a wide net; slightly
// overestimating nearby terrain just holds the camera a bit higher; missing
// it puts the eye inside the hillside.
export const TERRAIN_SAMPLE_RADIUS_METERS = 400;

// How often the (relatively expensive) terrain scan reruns.
export const TERRAIN_LIFT_RECOMPUTE_MS = 150;

// Rise fast enough to clear an approaching hill, settle back slowly so the
// camera does not pump up and down on rolling terrain. Time constants in
// seconds of exponential smoothing.
export const TERRAIN_LIFT_RISE_TAU_SECONDS = 0.3;
export const TERRAIN_LIFT_FALL_TAU_SECONDS = 4;

// --- Rider beacon (defaults for the Rendering settings) ---------------------------

// A translucent extruded cylinder standing on the rider so the position
// stays visible when trees or buildings hide the ground dot. Off by default
// — it's visually heavy; opt in from the Rendering settings.
export const DEFAULT_BEACON_ENABLED = false;
export const DEFAULT_BEACON_DIAMETER_METERS = 5;
export const DEFAULT_BEACON_HEIGHT_METERS = 20;
export const DEFAULT_BEACON_OPACITY = 0.35;
export const DEFAULT_BEACON_COLOR = "#ffffff";

// --- Rider dot ---------------------------------------------------------------------

// The ground marker showing the rider's position: a single flat circle at a
// fixed real-world size. It deliberately does NOT scale with camera distance
// — that used to be simulated by stacking several circles at slightly
// different altitudes, which z-fought into rendering glitches and muddy
// colors on steep terrain. Diameter in meters.
export const RIDER_DOT_DIAMETER_METERS = 5;

// --- Route line rendering -----------------------------------------------------------

// The route line floats this high above the terrain instead of being draped
// onto it (draped strokes smear down steep slopes into wide blobs).
export const ROUTE_LINE_ALTITUDE_METERS = 2.5;

// The path is densified so elevated segments follow the ground between GPX
// points; spacing grows on very long routes to cap the vertex count the map
// engine has to handle.
export const ROUTE_LINE_SPACING_METERS = 15;
export const ROUTE_LINE_MAX_POINTS = 5000;

// --- Screenshots ---------------------------------------------------------------------

// Ride screenshots come out at a constant size so gallery shots line up.
// The button is opt-in — most riders never need it on the map.
export const DEFAULT_SHOW_SCREENSHOT_BUTTON = false;
export const DEFAULT_SCREENSHOT_ASPECT = "16:9";
export const DEFAULT_SCREENSHOT_WIDTH = 1920;
export const SCREENSHOT_WIDTH_MIN = 640;
export const SCREENSHOT_WIDTH_MAX = 3840;

// --- Display & HUD defaults ------------------------------------------------------------

// Satellite minimap overlay in the top-left corner of the 3D map.
export const DEFAULT_SHOW_MINIMAP = true;

// Place labels (roads, towns, POIs) on the main 3D map. Off = clean
// satellite imagery, on = Google's hybrid mode with labels.
export const DEFAULT_MAP_LABELS_ENABLED = false;

// Which tiles the fullscreen ride HUD shows. Keys must match the
// data-hud="…" attributes in index.html (HUD tiles) and the
// data-hud-toggle="…" checkboxes in the settings dialog.
export const DEFAULT_HUD_ELEMENTS = {
  power: true,
  speed: true,
  heartRate: true,
  grade: true,
  ridden: true,
  remaining: true,
  ascentLeft: true,
  eta: true,
};

// --- Route difficulty classification --------------------------------------------
//
// Classifies a loaded route from distance and total elevation gain alone —
// no power, speed, weight, weather, surface, or ride-effort data. See
// app/difficulty.mjs. Every threshold below is the inclusive lower bound of
// its class, in ascending order; edit freely to retune the scale.

// One "equivalent kilometer" is this many meters of elevation gain, added to
// the raw distance as a simple overall-effort estimate. Lower = climbing
// counts for more; higher = climbing counts for less.
export const EQUIVALENT_KM_CLIMB_METERS = 100;

// Distance class, by route distance in km.
export const DISTANCE_CLASS_THRESHOLDS_KM = [
  { min: 0, label: "XS" },
  { min: 20, label: "S" },
  { min: 40, label: "M" },
  { min: 70, label: "L" },
  { min: 110, label: "XL" },
  { min: 160, label: "XXL" },
];

// Terrain class, by meters of elevation gain per km of distance.
export const TERRAIN_CLASS_THRESHOLDS_M_PER_KM = [
  { min: 0, label: "Flat" },
  { min: 5, label: "Gentle" },
  { min: 10, label: "Rolling" },
  { min: 20, label: "Hilly" },
  { min: 35, label: "Mountainous" },
];

// Overall difficulty, by equivalent km (distance + elevation gain converted
// via EQUIVALENT_KM_CLIMB_METERS).
export const DIFFICULTY_THRESHOLDS_EQUIVALENT_KM = [
  { min: 0, label: "Very Easy" },
  { min: 25, label: "Easy" },
  { min: 50, label: "Moderate" },
  { min: 85, label: "Hard" },
  { min: 130, label: "Very Hard" },
  { min: 190, label: "Epic" },
];

// --- Climb detection -------------------------------------------------------------

// Detected climbs shown on the route overview when a GPX loads, and used
// during the ride to report the current/next climb (see app/climbs.mjs). A
// candidate climb only ends once elevation has dropped
// CLIMB_DESCENT_TOLERANCE_METERS below its peak *and* the route has moved on
// past the peak by at least CLIMB_MERGE_GAP_METERS — so a short flat stretch
// or a few meters of downhill (a switchback dip, a road dropping briefly
// before kicking back up) doesn't end the climb and start a new one. Both
// are deliberately separate from CLIMB_NOISE_THRESHOLD_METERS (route.mjs's
// ascent/descent total noise filter) so tuning one doesn't move the other.

// How far past a climb's peak the route can travel while still elevated
// (but not climbing) before the climb is considered over. ~100 m covers a
// short flat stretch at the top of a ramp; raise it to merge climbs across
// longer flat/rolling gaps, lower it to split on shorter ones.
export const CLIMB_MERGE_GAP_METERS = 100;

// How far elevation can drop below a climb's peak — a few meters of
// downhill — before that drop, combined with CLIMB_MERGE_GAP_METERS of
// distance, is treated as the climb actually ending.
export const CLIMB_DESCENT_TOLERANCE_METERS = 5;

// A candidate climb is only reported if it gains at least this much
// elevation...
export const CLIMB_MIN_GAIN_METERS = 30;

// ...AND averages at least this grade, in percent. Both must hold, so a
// long gentle drag and a short punchy ramp are each filtered out on their
// own terms rather than by a single combined score.
export const CLIMB_MIN_AVERAGE_GRADE_PERCENT = 3;

// --- Ride recording -----------------------------------------------------------------

// While moving, a track sample is appended roughly every SAMPLE interval and
// the whole log is persisted to browser storage every PERSIST interval so a
// reload or crash never loses a ride. Denser samples = bigger FIT files and
// more storage churn.
export const RIDE_SAMPLE_INTERVAL_MS = 1000;
export const RIDE_PERSIST_INTERVAL_MS = 5000;
