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

// The product name shown in the UI and written into exported files.
export const APP_NAME = "GPX Rider";

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

// The HUD grade meter caps its visual scale more tightly than the underlying
// trainer/stat clamp above. Values beyond these endpoints pin to the edge,
// keeping the outer green/red bands comparable in width to the middle bands.
export const GRADE_METER_MIN_PERCENT = -6;
export const GRADE_METER_MAX_PERCENT = 10;

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

// First-person camera preset: eye height above the rider/route surface. The
// default approximates a seated rider's eye line; the Settings slider lets the
// user tune it for their position.
export const DEFAULT_FIRST_PERSON_CAMERA_HEIGHT_METERS = 1.7;

// Bounds for the configurable first-person eye height.
export const FIRST_PERSON_CAMERA_HEIGHT_MIN_METERS = 0.8;
export const FIRST_PERSON_CAMERA_HEIGHT_MAX_METERS = 2.2;

// First-person preset geometry. The camera eye is placed at the rider and looks
// at a point this far ahead on the route. The tilt value keeps the ordinary
// Camera angle slider near the horizon while the preset is selected.
export const FIRST_PERSON_LOOK_AHEAD_METERS = 20;
export const FIRST_PERSON_CAMERA_TILT_DEGREES = 88;

// Route overview shown when a route loads: whole route framed from this tilt.
// Tilt is degrees from straight-down — 0 is top-down, ~89 is nearly at the
// horizon (a low, terrain-revealing angle). NOTE: Google's 3D map limits how
// far it will tilt toward the horizon when the camera is far out, so at the
// large range needed to frame a long route a high tilt may be pulled back
// toward top-down. Use the range knobs below to bring the camera closer if a
// steeper tilt isn't taking effect (watch the Debug camera overlay).
export const OVERVIEW_TILT_DEGREES = 70;

// Which side the overview looks from, as a rotation (degrees) on top of the
// side the algorithm auto-picks (which puts the route's bulk away from the
// viewer, start-left/end-right). 0 = the auto choice; 180 = the exact opposite
// side, still with the route's long axis horizontal — this is how you flip a
// route to see it "from the other side". Other values swing the view to any
// azimuth (the route then reads diagonally, but it's still fully framed).
export const OVERVIEW_HEADING_OFFSET_DEGREES = 0;

// Slack around the route when fitting it to the viewport. 1.0 hugs the route
// to the screen edges; higher leaves more empty margin (camera further out).
export const OVERVIEW_MARGIN_FACTOR = 0.9;

// Multiplier on the fitted overview range. 1 frames the whole route; below 1
// pulls the camera in closer (route edges crop off, but terrain relief reads
// much better at a low tilt); above 1 pushes it further out. This is the main
// knob for trading "see the whole route" against "see the 3D terrain".
export const OVERVIEW_RANGE_FACTOR = 0.75;

// Hard bounds (meters) on the overview range, applied after the factor. The
// max cap is the other way to force a closer, more terrain-rich view on long
// routes (at the cost of not framing the whole thing); leave it at Infinity to
// always frame the entire route. Min keeps tiny routes from zooming in absurdly.
export const OVERVIEW_MIN_RANGE_METERS = 250;
export const OVERVIEW_MAX_RANGE_METERS = Infinity;

// --- Overview motion (static / orbit / ellipse flyby) -----------------------------
//
// How the whole-route overview behaves when a route loads. This is a user
// setting (Settings › Camera & view); the value here is only the default.
//   "static"           — the framed still shot (the classic overview)
//   "orbit"            — turntable: the static shot slowly rotates around the route
//   "flyby"            — a camera flies a PCA-aligned ellipse around the route
//   "flyover"          — a camera flies a figure-eight over the route (shares ELLIPSE_FLYBY)
//   "satellite"        — straight-down, north-up view with the route framed as big as fits
export const DEFAULT_OVERVIEW_MODE = "orbit";
// Camera behavior after selecting a detected climb: "static" holds the
// fitted climb view; "orbit" circles it; "satellite" shows it north-up.
export const DEFAULT_CLIMB_FOCUS_MODE = "static";

// Orbit mode: seconds for one full revolution, and spin direction (1 =
// clockwise seen from above, -1 = counter-clockwise). Longer = statelier.
export const OVERVIEW_ORBIT_SECONDS_PER_REV = 75;
export const OVERVIEW_ORBIT_DIRECTION = 1;

// Selected climbs are much smaller than whole routes, so their orbit gets its
// own faster, user-adjustable revolution time.
export const DEFAULT_CLIMB_ORBIT_SECONDS_PER_REV = 30;
export const CLIMB_ORBIT_SECONDS_PER_REV_MIN = 10;
export const CLIMB_ORBIT_SECONDS_PER_REV_MAX = 90;

// Horizontal pointer movement before a profile interaction becomes a segment
// selection instead of a normal click-to-seek.
export const PROFILE_SEGMENT_SELECTION_DRAG_PIXELS = 8;

// The smallest elevation-profile drag interval accepted as a selected segment.
// Very short routes scale this down by PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION.
export const PROFILE_SEGMENT_SELECTION_MIN_METERS = 50;
export const PROFILE_SEGMENT_SELECTION_MIN_ROUTE_FRACTION = 0.01;

// Red overview travel line drawn while the camera debug overlay is enabled.
// Orbit draws the orbit eye ground track; Fly-by draws its fitted ellipse.
export const OVERVIEW_DEBUG_LINE_COLOR = "#ff2d2d";

// Pixel width of the red overview debug line.
export const OVERVIEW_DEBUG_LINE_WIDTH = 8;

// Height above terrain for the red overview debug line.
export const OVERVIEW_DEBUG_LINE_ALTITUDE_METERS = 8;

// Number of samples used for the red overview debug line.
export const OVERVIEW_DEBUG_LINE_SAMPLE_COUNT = 240;

// Map3DElement's documented default field of view, in degrees. Used to reset
// camera modes that do not deliberately tune FOV.
export const DEFAULT_MAP_FOV_DEGREES = 35;

// When an animated overview (orbit/flyby) starts from a different
// camera pose, ease into the motion over this many seconds instead of jumping.
export const OVERVIEW_ANIM_INTRO_SECONDS = 1.5;

// Satellite overview: a straight-down (near-vertical), north-up still framing
// the whole route as large as it fits. SATELLITE_TILT_DEGREES is how far from
// vertical the camera leans — 1 is the closest to true top-down Map3D allows (0
// breaks the framing math). SATELLITE_MARGIN_FACTOR is the fit margin: 1 fills
// the viewport edge-to-edge, higher leaves more breathing room.
export const SATELLITE_TILT_DEGREES = 1;
export const SATELLITE_MARGIN_FACTOR = 1.12;

// Ellipse flyby (also drives the figure-eight "flyover" — same settings, only
// the path shape differs): a camera flies along an ellipse aligned to the
// route's principal axis and looks along its direction of travel. ellipseScale below
// 1 lets the flight path cut inside the route footprint; higher altitude,
// viewDistance, and a flatter mountPitch keep more of the route in view.
// secondsPerLap controls the target time for one complete ellipse circuit, like
// orbit's revolution duration. maxSpeedMps caps the resulting speed; if the cap
// is hit, the actual lap takes longer than secondsPerLap.
// flyHeightMetersMin is the baseline height above the route's center altitude;
// flyHeightMetersAboveTerrainMin keeps the camera at least that far above the
// highest route terrain point under the ellipse. The actual fly height uses
// whichever minimum requires the higher camera.
// cameraFovDegrees is passed to Map3D's `fov` property while the fly-by runs;
// 5 is telephoto, 80 is wide-angle, 35 matches the normal Map3D default.
// inwardLookDegrees rotates the fly-by camera horizontally toward the inside
// of the ellipse: clockwise flights look right, counter-clockwise flights left.
// The fly-over (figure-eight) reuses this value but, since it changes turn
// direction each lobe, looks into whichever turn it is currently in and eases
// back to straight-ahead through the center crossings — so the same degrees
// read as "slightly left, then straight, then slightly right" over one lap.
// direction is 1 for clockwise seen from above, -1 for counter-clockwise.
// minTurnRadiusMeters is a radius: 2500 m means the tightest possible circle
// would be 5 km across. maxBankDegrees is the roll applied at that tightest
// turn; broader turns roll proportionally less.
export const ELLIPSE_FLYBY = {
  ellipseScale: 0.78,
  minSemiMajorMeters: 1200,
  minSemiMinorMeters: 700,
  minTurnRadiusMeters: 750,
  direction: 1,
  secondsPerLap: 40,
  maxSpeedMps: 10000,
  flyHeightMetersMin: 1400,
  flyHeightMetersAboveTerrainMin: 300,
  cameraFovDegrees: 60,
  inwardLookDegrees: 20,
  mountPitchDegrees: 15,
  viewDistanceMeters: 3200,
  maxBankDegrees: 60,
  sampleCount: 360,
  startAngleDegrees: 0,
};

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

// The ground marker showing the rider's position is a Model3DElement (see
// renderRiderDot in app.js), not a filled Polygon3DElement. Polygon3DElement
// is meant for static terrain-draped areas; re-tessellating one every frame
// as the rider moves produced two separate failures confirmed in a real
// browser (not just reasoned about): the fill rendering solid black at
// ordinary follow-camera distances — independent of polygon winding,
// altitude/z-fighting with terrain (tried 1m through 20m up), and
// `extruded: true` (a short cylinder instead of a flat disc), none of which
// changed it — and a faceted/streaky look from the constant re-triangulation.
// A real mesh sidesteps both.

// A path, not a full URL — app.js resolves it against its own module URL
// (not the page's), so it loads correctly regardless of what path GPX Rider
// is served from. Swap this to experiment with other models — a couple of
// things to expect when trying a new one, both confirmed by testing, neither
// documented anywhere we could find:
//   - A model's local "up" axis does not necessarily map to world-up; if a
//     new model stands on its edge instead of lying flat, adjust
//     RIDER_DOT_ORIENTATION below (the shipped puck needed tilt: 90).
//   - An ordinary lit PBR material can render solid black on this renderer
//     regardless of normals/winding/texturing — if a replacement model
//     renders black, look for (or add) a KHR_materials_unlit extension on
//     its materials, the same fix the shipped puck needed.
export const RIDER_DOT_MODEL_PATH = "assets/rider-dot.glb";

// heading/tilt/roll passed straight to Model3DElement's `orientation`. Not
// meaningful in isolation — it corrects for the specific model at
// RIDER_DOT_MODEL_PATH's own local axes, so re-tune this whenever that model
// changes (see the note above).
export const RIDER_DOT_ORIENTATION = { heading: 0, tilt: 90, roll: 0 };

// The model at RIDER_DOT_MODEL_PATH is baked to a true 1 meter diameter, so
// this is a plain real-world size multiplier, not a unitless fudge factor —
// unlike a screen-space billboard (Marker3DElement + PinElement, tried and
// rejected: doesn't grow/shrink with camera distance the way a real ground
// object should, and a map-pin shape doesn't read as a location dot anyway).
// A different model baked to a different base size will need this retuned.
export const RIDER_DOT_SCALE = 5;
// Extra size multiplier while the whole-route overview is active. The camera
// is much farther away there, so the normal ride-scale dot can become hard to
// spot.
export const RIDER_DOT_OVERVIEW_SCALE_FACTOR = 2.4;

// Only used by the Polyline3DElement fallback for browsers without
// Model3DElement (see renderRiderDot) — an outlined ring instead of a filled
// dot, since Polyline3DElement has no fill. Diameter in meters.
export const RIDER_DOT_DIAMETER_METERS = 5;

// How high the dot's origin sits above the terrain, in meters. Independent
// of ROUTE_LINE_ALTITUDE_METERS on purpose: the route line has to float well
// clear of the terrain because a thin drawn line clamped to the ground
// smears down slopes, but a real mesh (Model3DElement) doesn't have that
// problem, so there's no reason to lift it off the ground the way the line
// is. Not 0 though (confirmed by testing, not just assumed): the shipped
// puck's origin is at its vertical center (0.15m tall, see
// scripts/generate_rider_dot_model.py), so at 0 its bottom half was buried
// in the terrain — and the model needed clearing by more than just its own
// half-height (0.075m) to fully stop clipping on steep terrain, most likely
// because the terrain mesh itself isn't perfectly smooth/precise at close
// range. 0.5 was the smallest value that cleared cleanly on a steep
// switchback in testing. Retune per model at RIDER_DOT_MODEL_PATH — start
// from that model's own half-height above 0 and increase from there if it
// still clips, especially on steep terrain.
export const RIDER_DOT_ALTITUDE_METERS = 0.5;

// --- Route line rendering -----------------------------------------------------------

// Color the map route by the same grade buckets as the elevation profile.
// Turning this off restores the single blue route trace.
export const DEFAULT_ROUTE_GRADE_COLORS_ENABLED = true;

// The route line floats this high above the terrain instead of being draped
// onto it (draped strokes smear down steep slopes into wide blobs).
export const ROUTE_LINE_ALTITUDE_METERS = 2.5;
export const ROUTE_LINE_COLOR = "#0a84ff";
export const ROUTE_LINE_WIDTH = 14;
export const ROUTE_LINE_OUTER_COLOR = "rgba(255, 255, 255, 0.72)";
export const ROUTE_LINE_OUTER_WIDTH = 0.35;
// Selected climbs replace their normal route segments with this wider,
// brighter-cased treatment. No second stacked line is used, avoiding z-fight.
export const ROUTE_FOCUS_LINE_WIDTH = 19;
export const ROUTE_FOCUS_OUTER_COLOR = "rgba(255, 255, 255, 0.96)";
export const ROUTE_FOCUS_OUTER_WIDTH = 0.8;

// The path is densified so elevated segments follow the ground between GPX
// points; spacing grows on very long routes to cap the vertex count the map
// engine has to handle.
export const ROUTE_LINE_SPACING_METERS = 15;
export const ROUTE_LINE_MAX_POINTS = 5000;

// Gallery cards start with lightweight classic satellite maps. Padding keeps
// each route clear of the thumbnail edges after fitting its bounds.
export const GALLERY_PREVIEW_MAP_TYPE = "satellite";
export const GALLERY_PREVIEW_FIT_PADDING_PIXELS = 20;

// Route styling shared by the gallery's classic and opt-in 3D previews.
export const GALLERY_PREVIEW_ROUTE_COLOR = "#0a84ff";
export const GALLERY_PREVIEW_2D_ROUTE_WIDTH = 5;
export const GALLERY_PREVIEW_3D_ROUTE_WIDTH = 14;
export const GALLERY_PREVIEW_3D_ROUTE_OUTER_COLOR = "rgba(255, 255, 255, 0.72)";
export const GALLERY_PREVIEW_3D_ROUTE_OUTER_WIDTH = 0.35;

// --- Screenshots ---------------------------------------------------------------------

// Ride screenshots come out at a constant size so gallery shots line up.
// The button is opt-in — most riders never need it on the map.
export const DEFAULT_SHOW_SCREENSHOT_BUTTON = false;
export const DEFAULT_SCREENSHOT_ASPECT = "16:9";
export const DEFAULT_SCREENSHOT_WIDTH = 1920;
export const SCREENSHOT_WIDTH_MIN = 640;
export const SCREENSHOT_WIDTH_MAX = 3840;

// --- Display & HUD defaults ------------------------------------------------------------

// Satellite minimap overlay above the fullscreen data dock.
export const DEFAULT_SHOW_MINIMAP = false;

// Place labels (roads, towns, POIs) on the main 3D map. Off = clean
// satellite imagery, on = Google's hybrid mode with labels.
export const DEFAULT_MAP_LABELS_ENABLED = false;

// Local clock format used by the fullscreen top-left stats chip. The user's
// choice is persisted with the other display settings.
export const DEFAULT_TIME_FORMAT = "24";
// Duration readouts default to explicit hour/minute labels (1h30m) so ETAs
// cannot be mistaken for minute/second clocks. "clock" keeps the old 1:30:00
// style for users who prefer stopwatch formatting.
export const DEFAULT_DURATION_FORMAT = "compact";
// Wall-clock refresh cadence while the fullscreen HUD is visible.
export const FULLSCREEN_CLOCK_REFRESH_MS = 1000;
// Heart-rate UI refresh cadence while a dedicated strap is connected. Strap
// notifications remain the data source; this loop republishes the current
// strap truth to every display even while the ride/map UI is otherwise idle.
export const HEART_RATE_REFRESH_MS = 1000;

// Developer overlay: a small translucent box on the map showing the live
// camera values the 3D map actually applies (tilt/range/heading/center),
// plus ride progress. Off by default — it's a diagnostics aid, e.g. for
// reading what tilt Google honours after a manual drag versus what we ask
// for. The overlay refreshes on this interval while it's visible.
export const DEFAULT_CAMERA_DEBUG_ENABLED = false;
export const CAMERA_DEBUG_REFRESH_MS = 100;
// Keep the gallery metadata camera readout live during animated overviews
// without rebuilding its formatted JSON on every animation frame.
export const GALLERY_METADATA_CAMERA_REFRESH_MS = 100;

// Ordered fullscreen bottom-dock data fields. Keys must match the
// data-hud="…" attributes in index.html. The visible count controls how many
// fields are shown from the front of the order; users can still put every
// field on-screen if they want a denser dock.
export const DEFAULT_HUD_FIELD_ORDER = [
  "speed",
  "ascentLeft",
  "calories",
  "remaining",
  "power",
  "heartRate",
  "grade",
  "ridden",
  "eta",
  "altitude",
  "ascent",
  "elapsed",
];
export const DEFAULT_HUD_VISIBLE_COUNT = 4;

// The fullscreen ride HUD's bottom data dock can be collapsed to a compact
// strip (key metrics + the two progress bars) or expanded to the full dock
// (metric tiles + the road-ahead elevation profile). This is its initial
// state; the user's choice is persisted with the other display settings.
export const DEFAULT_HUD_DOCK_COLLAPSED = false;

// Training zones for the fullscreen left-side meters. Heart rate uses
// Heart Rate Reserve (Karvonen) from resting/max HR; power uses FTP.
export const DEFAULT_RESTING_HEART_RATE_BPM = 60;
export const DEFAULT_MAX_HEART_RATE_BPM = 180;
export const POWER_ZONE_DEFINITIONS = [
  { name: "Active Recovery", color: "#8b949e" },
  { name: "Endurance", color: "#4f9bff" },
  { name: "Tempo", color: "#57b877" },
  { name: "Threshold", color: "#e8b74e" },
  { name: "VO2 Max", color: "#e8823c" },
  { name: "Anaerobic", color: "#d96a3f" },
  { name: "Neuromuscular", color: "#d9542f" },
];
export const HEART_RATE_ZONE_DEFINITIONS = [
  { name: "Recovery", color: "#8b949e" },
  { name: "Endurance", color: "#4f9bff" },
  { name: "Tempo", color: "#57b877" },
  { name: "Threshold", color: "#e8823c" },
  { name: "Max", color: "#d9542f" },
];
export const HEART_RATE_MAX_AGE_FORMULA_BASE = 220;
export const PROFILE_HISTORY_SAMPLE_LIMIT = 1800;

// Gross metabolic efficiency for converting measured cycling work into active
// human calories. Power meters report mechanical work at the pedals; humans
// spend more chemical energy than that to produce it. 0.24 means 24% of the
// rider's active energy becomes measured mechanical work.
export const CYCLING_GROSS_EFFICIENCY = 0.24;

// Fullscreen climb banner (top-center of the ride HUD). It appears while the
// rider is on a detected climb, or while approaching the next one within this
// distance; it is hidden otherwise.
export const CLIMB_BANNER_APPROACH_METERS = 1000;

// Bars drawn in the climb banner's mini elevation profile of the upcoming
// climb.
export const CLIMB_BANNER_MINI_BAR_COUNT = 30;

// Names and accent colors for the climb banner's category chip, chosen by the
// climb's average grade: the first entry whose `maxAverageGradePercent` the
// climb does not exceed wins, and the last (Infinity) is the catch-all for
// anything steeper. Colors track the shared grade palette (gentle → green,
// brutal → red; see profile.mjs#gradeColor). This is only a plain-language
// label derived from average grade — no HC/Cat-1-style road categorization is
// attempted, matching how difficulty.mjs classifies from geometry alone.
export const CLIMB_CATEGORIES = [
  { maxAverageGradePercent: 4, name: "GENTLE", color: "#57b877" },
  { maxAverageGradePercent: 7, name: "MODERATE", color: "#e8b74e" },
  { maxAverageGradePercent: 10, name: "STEEP", color: "#e8823c" },
  { maxAverageGradePercent: Infinity, name: "BRUTAL", color: "#d9542f" },
];

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

// Climb detection relies on a "Leaky Bucket" (fatigue integrator) algorithm 
// to emulate human effort. Rather than purely looking at point-to-point geometry,
// it calculates a running "fatigue" score. 
//
// - Sustained grades above a resting threshold fill the bucket.
// - Shallow flats and descents drain the bucket.
// - A segment is officially recognized as an active climb once the bucket hits 
//   a specific fatigue threshold. 
// - The climb closes once the route descends enough to completely empty the bucket.
// 
// This model prevents a long climb from being fractured into multiple pieces by 
// brief dips or false flats, while correctly ignoring small, insignificant rollers.

/**
 * The "bucket size" required to officially declare a segment an active climb.
 * Lowering this makes the algorithm more sensitive to shorter, punchy hills.
 */
export const CLIMB_FATIGUE_THRESHOLD = 300;

/**
 * The absolute maximum fatigue the bucket can hold. This acts as a "lid," ensuring 
 * that massive alpine climbs don't accumulate infinite fatigue. Without this lid, 
 * a long mountain descent would not be enough to drain the bucket and close the climb.
 */
export const CLIMB_MAX_FATIGUE = 900;

/**
 * The gradient threshold (in percent) where a rider starts accumulating fatigue.
 * Gradients above this add to the bucket; gradients below this trigger recovery.
 */
export const CLIMB_RESTING_GRADIENT_PERCENT = 0.5;

/**
 * The leak rate when resting or descending. A multiplier of 0.2 means the bucket 
 * drains at 20% of the speed it fills. This forgiving drain rate allows climbs to 
 * "hold their breath" through false-flats and brief downhill dips.
 */
export const CLIMB_RECOVERY_MULTIPLIER = 0.4;

/**
 * The number of data points used in the moving average pre-filter. Raw GPS 
 * elevation data is inherently noisy. A 5-point window effectively flattens 
 * micro-jitter without destroying the macro-geometry of the terrain.
 */
export const CLIMB_SMOOTHING_WINDOW_SIZE = 5;

/**
 * Sanity Check: Minimum accumulated gain (in meters) from the true base to the true peak.
 * Using accumulated gain ensures that rocky, rolling trails that net little elevation 
 * but require significant upward pedaling are still recognized.
 */
export const CLIMB_MIN_GAIN_METERS = 20;

/**
 * Sanity Check: Minimum average net grade (in percent) from the true base to the true peak.
 * Prevents extremely long, nearly flat false-drags from being classified as categorizable climbs.
 */
export const CLIMB_MIN_AVERAGE_GRADE_PERCENT = 1.5;

// --- Ride recording -----------------------------------------------------------------

// While moving, a track sample is appended roughly every SAMPLE interval and
// the whole log is persisted to browser storage every PERSIST interval so a
// reload or crash never loses a ride. Denser samples = bigger FIT files and
// more storage churn.
export const RIDE_SAMPLE_INTERVAL_MS = 1000;
export const RIDE_PERSIST_INTERVAL_MS = 5000;
