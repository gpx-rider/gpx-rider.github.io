"""Standalone CLI diagnostic tool for exploring climb-detection behavior
against a GPX file with verbose step-by-step logging. Reads the exact same
climb_detection tunables as the shipped app (app/route/climbs.mjs, via
app/core/tuning.mjs) from app/core/tuning.yaml — through tuning_config.py —
so nothing is mirrored here by hand and this script never drifts from the
real algorithm.
"""

import math
import sys
import xml.etree.ElementTree as ET

from tuning_config import load_tuning

TUNING = load_tuning()


def tuning(*path):
    """Walk a nested snake_case path in tuning.yaml, failing loudly on a
    missing key (see scripts/generate_gallery_json.py for the same idea)."""
    node = TUNING
    trail = []
    for key in path:
        trail.append(key)
        if not isinstance(node, dict) or key not in node:
            raise KeyError(f'tuning.yaml is missing "{".".join(trail)}".')
        node = node[key]
    return node


# --- CLIMB DETECTION CONSTANTS (climb_detection in tuning.yaml) ---

CLIMB_RESAMPLE_STEP_METERS = tuning("climb_detection", "resample_step_meters")
CLIMB_ELEVATION_MEDIAN_WINDOW_METERS = tuning("climb_detection", "elevation_median_window_meters")
CLIMB_ELEVATION_SMOOTH_WINDOW_METERS = tuning("climb_detection", "elevation_smooth_window_meters")
CLIMB_SHORT_GRADE_WINDOW_METERS = tuning("climb_detection", "short_grade_window_meters")
CLIMB_LONG_GRADE_WINDOW_METERS = tuning("climb_detection", "long_grade_window_meters")
CLIMB_LONG_GRADE_WEIGHT = tuning("climb_detection", "long_grade_weight")
CLIMB_START_FATIGUE = tuning("climb_detection", "start_fatigue")
CLIMB_END_FATIGUE = tuning("climb_detection", "end_fatigue")
CLIMB_END_FATIGUE_MIN_DISTANCE_METERS = tuning("climb_detection", "end_fatigue_min_distance_meters")
CLIMB_MAX_FATIGUE = tuning("climb_detection", "max_fatigue")
CLIMB_PRESSURE_START_GRADE_PERCENT = tuning("climb_detection", "pressure_start_grade_percent")
CLIMB_PRESSURE_EXPONENT = tuning("climb_detection", "pressure_exponent")
CLIMB_RECOVERY_UPHILL_THRESHOLD_PERCENT = tuning("climb_detection", "recovery_uphill_threshold_percent")
CLIMB_RECOVERY_FLAT_THRESHOLD_PERCENT = tuning("climb_detection", "recovery_flat_threshold_percent")
CLIMB_RECOVERY_FLAT_PRESSURE = tuning("climb_detection", "recovery_flat_pressure")
CLIMB_RECOVERY_DOWNHILL_BASE = tuning("climb_detection", "recovery_downhill_base")
CLIMB_RECOVERY_DOWNHILL_SCALE = tuning("climb_detection", "recovery_downhill_scale")
CLIMB_RECOVERY_MAX = tuning("climb_detection", "recovery_max")
CLIMB_MIN_GAIN_METERS = tuning("climb_detection", "min_gain_meters")
CLIMB_MIN_DISTANCE_METERS = tuning("climb_detection", "min_distance_meters")
CLIMB_START_LOOKBACK_METERS = tuning("climb_detection", "start_lookback_meters")
CLIMB_END_DROP_METERS = tuning("climb_detection", "end_drop_meters")
CLIMB_END_DROP_DISTANCE_METERS = tuning("climb_detection", "end_drop_distance_meters")
CLIMB_MAX_EASY_AFTER_PEAK_METERS = tuning("climb_detection", "max_easy_after_peak_meters")
CLIMB_MERGE_GAP_METERS = tuning("climb_detection", "merge_gap_meters")
CLIMB_MERGE_MAX_DROP_METERS = tuning("climb_detection", "merge_max_drop_meters")
CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH = tuning("climb_detection", "min_average_grade_for_length")


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def parse_gpx(file_path):
    tree = ET.parse(file_path)
    root = tree.getroot()
    ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
    route = []
    total_dist = 0.0

    trkpts = root.findall(".//gpx:trkpt", ns)
    for i, pt in enumerate(trkpts):
        lat = float(pt.attrib["lat"])
        lon = float(pt.attrib["lon"])
        ele_elem = pt.find("gpx:ele", ns)
        ele = float(ele_elem.text) if ele_elem is not None else 0.0

        if i > 0:
            prev = route[-1]
            dist = haversine(prev["lat"], prev["lon"], lat, lon)
            total_dist += dist

        route.append({"distance": total_dist, "ele": ele, "lat": lat, "lon": lon})
    return route


def _is_finite_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def _clean_route(route):
    clean = []
    last_distance = None

    for pt in route:
        distance = pt.get("distance")
        ele = pt.get("ele")

        if not _is_finite_number(distance) or not _is_finite_number(ele):
            continue

        if last_distance is not None and distance <= last_distance:
            continue

        clean.append(pt)
        last_distance = distance

    return clean


def _resample_by_distance(route, step_m):
    route = _clean_route(route)
    if len(route) < 2:
        return route

    result = []
    total_distance = route[-1]["distance"]

    j = 0
    target = route[0]["distance"]

    while target <= total_distance:
        while j < len(route) - 2 and route[j + 1]["distance"] < target:
            j += 1

        a = route[j]
        b = route[j + 1]

        span = b["distance"] - a["distance"]
        if span <= 0:
            target += step_m
            continue

        t = (target - a["distance"]) / span

        result.append({
            "distance": target,
            "ele": a["ele"] + (b["ele"] - a["ele"]) * t,
        })

        target += step_m

    if result and result[-1]["distance"] < total_distance:
        result.append({
            "distance": total_distance,
            "ele": route[-1]["ele"],
        })

    return result


def _radius_for_window(window_m, step_m):
    return max(1, int(round((window_m / step_m) / 2.0)))


def _median_filter(values, radius):
    out = []

    for i in range(len(values)):
        a = max(0, i - radius)
        b = min(len(values), i + radius + 1)
        window = sorted(values[a:b])
        mid = len(window) // 2

        if len(window) % 2 == 1:
            out.append(window[mid])
        else:
            out.append((window[mid - 1] + window[mid]) / 2.0)

    return out


def _mean_filter(values, radius):
    out = []

    for i in range(len(values)):
        a = max(0, i - radius)
        b = min(len(values), i + radius + 1)
        window = values[a:b]
        out.append(sum(window) / len(window))

    return out


def _smooth_elevation(points):
    if len(points) < 3:
        return points

    step_m = CLIMB_RESAMPLE_STEP_METERS

    median_radius = _radius_for_window(CLIMB_ELEVATION_MEDIAN_WINDOW_METERS, step_m)
    smooth_radius = _radius_for_window(CLIMB_ELEVATION_SMOOTH_WINDOW_METERS, step_m)

    raw_ele = [pt["ele"] for pt in points]
    median_ele = _median_filter(raw_ele, median_radius)
    smooth_ele = _mean_filter(median_ele, smooth_radius)

    return [
        {
            "distance": points[i]["distance"],
            "ele": smooth_ele[i],
        }
        for i in range(len(points))
    ]


def _grade_between(points, start_idx, end_idx):
    if start_idx == end_idx:
        return 0.0

    distance = points[end_idx]["distance"] - points[start_idx]["distance"]
    if distance <= 0:
        return 0.0

    gain = points[end_idx]["ele"] - points[start_idx]["ele"]
    return (gain / distance) * 100.0


def _rolling_grade(points, idx, window_m):
    radius = _radius_for_window(window_m, CLIMB_RESAMPLE_STEP_METERS)

    a = max(0, idx - radius)
    b = min(len(points) - 1, idx + radius)

    return _grade_between(points, a, b)


def _climb_pressure(grade_percent):
    """
    Human-ish pressure curve.

    0-1.8%: basically no climb pressure.
    2-3%: mild pressure.
    4-6%: real climb pressure.
    8%+: pressure ramps up hard.

    Nonlinear on purpose. Humans do not perceive grade linearly.
    """
    excess = grade_percent - CLIMB_PRESSURE_START_GRADE_PERCENT

    if excess <= 0:
        return 0.0

    return excess ** CLIMB_PRESSURE_EXPONENT


def _recovery_pressure(grade_percent):
    """
    Recovery is also human-ish.

    Slight uphill: do not recover, but do not necessarily build fatigue.
    Flat: recover slowly.
    Downhill: recover faster.
    """
    if grade_percent >= CLIMB_RECOVERY_UPHILL_THRESHOLD_PERCENT:
        return 0.0

    if grade_percent >= CLIMB_RECOVERY_FLAT_THRESHOLD_PERCENT:
        return CLIMB_RECOVERY_FLAT_PRESSURE

    return min(CLIMB_RECOVERY_MAX, CLIMB_RECOVERY_DOWNHILL_BASE + abs(grade_percent) * CLIMB_RECOVERY_DOWNHILL_SCALE)


def _lowest_index(points, start_idx, end_idx):
    best = start_idx

    for i in range(start_idx + 1, end_idx + 1):
        if points[i]["ele"] < points[best]["ele"]:
            best = i

    return best


def _highest_index(points, start_idx, end_idx):
    best = start_idx

    for i in range(start_idx + 1, end_idx + 1):
        if points[i]["ele"] > points[best]["ele"]:
            best = i

    return best


def _accumulated_gain(points, start_idx, end_idx):
    gain = 0.0

    for i in range(start_idx + 1, end_idx + 1):
        diff = points[i]["ele"] - points[i - 1]["ele"]
        if diff > 0:
            gain += diff

    return gain


def _min_average_grade_for_length(length_m):
    """
    Short hills need to be steeper to feel like climbs.
    Long climbs can be gentler and still feel real.
    """
    for row in CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH:
        if length_m < row["max_length_meters"]:
            return row["min_average_grade_percent"]

    return CLIMB_MIN_AVERAGE_GRADE_FOR_LENGTH[-1]["min_average_grade_percent"]


def _make_climb(points, start_idx, peak_idx, max_fatigue, debug=False, reason=""):
    start = points[start_idx]
    peak = points[peak_idx]

    length_m = peak["distance"] - start["distance"]
    if length_m <= 0:
        return None

    net_gain_m = peak["ele"] - start["ele"]
    accumulated_gain_m = _accumulated_gain(points, start_idx, peak_idx)
    avg_grade = (net_gain_m / length_m) * 100.0

    start_km = start["distance"] / 1000.0
    end_km = peak["distance"] / 1000.0

    min_grade = _min_average_grade_for_length(length_m)

    if debug:
        print(
            f"      ↳ Segment Review: {start_km:.2f}km -> {end_km:.2f}km "
            f"| Net Gain: {net_gain_m:.1f}m "
            f"| Acc Gain: {accumulated_gain_m:.1f}m "
            f"| Grade: {avg_grade:.2f}% "
            f"| Max Fatigue: {max_fatigue:.0f} "
            f"| Close: {reason}"
        )

    accepted = (
        length_m >= CLIMB_MIN_DISTANCE_METERS
        and accumulated_gain_m >= CLIMB_MIN_GAIN_METERS
        and avg_grade >= min_grade
        and max_fatigue >= CLIMB_START_FATIGUE
    )

    if not accepted:
        if debug:
            reasons = []

            if length_m < CLIMB_MIN_DISTANCE_METERS:
                reasons.append(f"Distance < {CLIMB_MIN_DISTANCE_METERS:.0f}m")

            if accumulated_gain_m < CLIMB_MIN_GAIN_METERS:
                reasons.append(f"Acc Gain < {CLIMB_MIN_GAIN_METERS:.0f}m")

            if avg_grade < min_grade:
                reasons.append(f"Grade < {min_grade:.1f}% for this length")

            if max_fatigue < CLIMB_START_FATIGUE:
                reasons.append(f"Fatigue < {CLIMB_START_FATIGUE:.0f}")

            print(f"      ❌ STATUS: REJECTED ({', '.join(reasons)})")
            print("-" * 50)

        return None

    if debug:
        print("      ✅ STATUS: ACCEPTED AND LOGGED!")
        print("-" * 50)

    return {
        "start_km": start_km,
        "end_km": end_km,
        "gain": accumulated_gain_m,
        "grade": avg_grade,

        # Extra metrics useful for your app/debugger.
        "startDistanceMeters": start["distance"],
        "endDistanceMeters": peak["distance"],
        "startElevationMeters": start["ele"],
        "endElevationMeters": peak["ele"],
        "lengthMeters": length_m,
        "gainMeters": accumulated_gain_m,
        "netGainMeters": net_gain_m,
        "accumulatedGainMeters": accumulated_gain_m,
        "averageGradePercent": avg_grade,
        "maxFatigue": max_fatigue,
    }


def _merge_nearby_climbs(climbs, debug=False):
    if not climbs:
        return []

    merged = [climbs[0]]

    for climb in climbs[1:]:
        prev = merged[-1]

        gap_m = climb["startDistanceMeters"] - prev["endDistanceMeters"]
        drop_m = prev["endElevationMeters"] - climb["startElevationMeters"]

        should_merge = (
            gap_m >= 0
            and gap_m <= CLIMB_MERGE_GAP_METERS
            and drop_m <= CLIMB_MERGE_MAX_DROP_METERS
        )

        if not should_merge:
            merged.append(climb)
            continue

        start_distance = prev["startDistanceMeters"]
        end_distance = climb["endDistanceMeters"]
        length_m = end_distance - start_distance

        start_ele = prev["startElevationMeters"]
        end_ele = climb["endElevationMeters"]
        net_gain_m = end_ele - start_ele

        total_gain = prev["gainMeters"] + climb["gainMeters"]
        avg_grade = (net_gain_m / length_m) * 100.0 if length_m > 0 else 0.0

        if debug:
            print(
                f"      🔗 MERGED: {prev['start_km']:.2f}km -> {prev['end_km']:.2f}km "
                f"+ {climb['start_km']:.2f}km -> {climb['end_km']:.2f}km"
            )

        merged[-1] = {
            **prev,
            "end_km": climb["end_km"],
            "gain": total_gain,
            "grade": avg_grade,

            "endDistanceMeters": end_distance,
            "endElevationMeters": end_ele,
            "lengthMeters": length_m,
            "gainMeters": total_gain,
            "netGainMeters": net_gain_m,
            "accumulatedGainMeters": total_gain,
            "averageGradePercent": avg_grade,
            "maxFatigue": max(prev["maxFatigue"], climb["maxFatigue"]),
        }

    return merged


def detect_climbs(route, debug=True):
    if len(route) < 2:
        return []

    points = _resample_by_distance(route, CLIMB_RESAMPLE_STEP_METERS)
    points = _smooth_elevation(points)

    if len(points) < 2:
        return []

    climbs = []

    fatigue = 0.0
    max_fatigue_this_candidate = 0.0

    active = False
    base_idx = None
    start_idx = None
    peak_idx = None
    last_pressure_idx = None

    def reset_candidate():
        nonlocal fatigue, max_fatigue_this_candidate
        nonlocal active, base_idx, start_idx, peak_idx, last_pressure_idx

        fatigue = 0.0
        max_fatigue_this_candidate = 0.0

        active = False
        base_idx = None
        start_idx = None
        peak_idx = None
        last_pressure_idx = None

    def close_candidate(reason):
        nonlocal climbs

        if active and start_idx is not None and peak_idx is not None:
            climb = _make_climb(
                points,
                start_idx,
                peak_idx,
                max_fatigue_this_candidate,
                debug=debug,
                reason=reason,
            )

            if climb is not None:
                climbs.append(climb)

        reset_candidate()

    for i in range(1, len(points)):
        pt = points[i]
        prev = points[i - 1]

        distance_change = pt["distance"] - prev["distance"]
        if distance_change <= 0:
            continue

        short_grade = _rolling_grade(points, i, CLIMB_SHORT_GRADE_WINDOW_METERS)
        long_grade = _rolling_grade(points, i, CLIMB_LONG_GRADE_WINDOW_METERS)

        # Use whichever window says "this feels more climb-like".
        # Short handles punchy ramps. Long handles sustained drags.
        short_pressure = _climb_pressure(short_grade)
        long_pressure = _climb_pressure(long_grade) * CLIMB_LONG_GRADE_WEIGHT
        climb_pressure = max(short_pressure, long_pressure)

        # For recovery, if either short or long still says uphill, do not recover much.
        recovery_grade = max(short_grade, long_grade)
        recovery_pressure = _recovery_pressure(recovery_grade)

        old_fatigue = fatigue

        fatigue_delta = (climb_pressure - recovery_pressure) * distance_change
        fatigue = max(0.0, min(CLIMB_MAX_FATIGUE, fatigue + fatigue_delta))

        max_fatigue_this_candidate = max(max_fatigue_this_candidate, fatigue)

        pt_km = pt["distance"] / 1000.0

        # Candidate exists while there is either pressure or leftover fatigue.
        if climb_pressure > 0 or fatigue > 0:
            if base_idx is None:
                base_idx = i - 1

            # Before the climb becomes active, keep moving the base to the lowest point.
            # This prevents "first tiny uphill blip" from becoming the start.
            if not active and points[i]["ele"] < points[base_idx]["ele"]:
                base_idx = i

        # Ghost candidate drained before becoming a climb.
        if not active and old_fatigue > 0 and fatigue == 0:
            if debug:
                print(
                    f"[{pt_km:.2f}km] Ghost candidate drained "
                    f"(max fatigue {max_fatigue_this_candidate:.0f})"
                )
                print("-" * 50)

            reset_candidate()
            continue

        # Start climb once breathing pressure has accumulated enough.
        if not active and fatigue >= CLIMB_START_FATIGUE:
            search_start_idx = base_idx if base_idx is not None else i

            # Do not let a very old shallow drag dilute the climb forever.
            min_start_distance = pt["distance"] - CLIMB_START_LOOKBACK_METERS
            while (
                search_start_idx < i
                and points[search_start_idx]["distance"] < min_start_distance
            ):
                search_start_idx += 1

            start_idx = _lowest_index(points, search_start_idx, i)
            peak_idx = _highest_index(points, start_idx, i)
            last_pressure_idx = i
            active = True

            if debug:
                print(
                    f"[{pt_km:.2f}km] THRESHOLD CROSSED "
                    f"(fatigue {fatigue:.0f}, short {short_grade:.1f}%, long {long_grade:.1f}%) "
                    f"| base {points[start_idx]['distance'] / 1000.0:.2f}km"
                )

        if not active:
            continue

        if climb_pressure > 0:
            last_pressure_idx = i

        # The climb's visual end is the highest point before recovery.
        if peak_idx is None or pt["ele"] > points[peak_idx]["ele"]:
            peak_idx = i

        distance_since_peak = pt["distance"] - points[peak_idx]["distance"]
        drop_from_peak = points[peak_idx]["ele"] - pt["ele"]

        distance_since_pressure = 0.0
        if last_pressure_idx is not None:
            distance_since_pressure = pt["distance"] - points[last_pressure_idx]["distance"]

        # Human recovery endings.
        if fatigue <= CLIMB_END_FATIGUE and distance_since_peak >= CLIMB_END_FATIGUE_MIN_DISTANCE_METERS:
            if debug:
                print(
                    f"[{pt_km:.2f}km] RECOVERED "
                    f"(fatigue {fatigue:.0f}, max {max_fatigue_this_candidate:.0f})"
                )

            close_candidate("fatigue recovered")
            continue

        if (
            drop_from_peak >= CLIMB_END_DROP_METERS
            and distance_since_peak >= CLIMB_END_DROP_DISTANCE_METERS
        ):
            if debug:
                print(
                    f"[{pt_km:.2f}km] DESCENT AFTER PEAK "
                    f"(drop {drop_from_peak:.1f}m over {distance_since_peak:.0f}m)"
                )

            close_candidate("meaningful descent after peak")
            continue

        if (
            distance_since_pressure >= CLIMB_MAX_EASY_AFTER_PEAK_METERS
            and distance_since_peak >= CLIMB_MAX_EASY_AFTER_PEAK_METERS
        ):
            if debug:
                print(
                    f"[{pt_km:.2f}km] LONG EASY SECTION AFTER PEAK "
                    f"({distance_since_pressure:.0f}m without climb pressure)"
                )

            close_candidate("long easy section after peak")
            continue

    if active and start_idx is not None and peak_idx is not None:
        if debug:
            print(
                f"[{points[-1]['distance'] / 1000.0:.2f}km] FINISH LINE HIT "
                f"(bucket still has {fatigue:.0f} fatigue)"
            )

        close_candidate("finish line")

    climbs = _merge_nearby_climbs(climbs, debug=debug)

    return climbs


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python climb_tester.py <path_to_gpx_file>")
        sys.exit(1)

    file_path = sys.argv[1]

    try:
        route_data = parse_gpx(file_path)
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
        sys.exit(1)
    except ET.ParseError:
        print(f"Error: The file '{file_path}' could not be parsed as XML.")
        sys.exit(1)

    print(f"\nParsed {len(route_data)} points. Total distance: {route_data[-1]['distance']/1000:.1f} km\n")
    print("=" * 50)
    print(" STARTING LEAKY BUCKET DIAGNOSTICS")
    print("=" * 50)

    valid_climbs = detect_climbs(route_data)

    print("\n" + "=" * 50)
    print(" FINAL ACCEPTED CLIMBS")
    print("=" * 50)
    if not valid_climbs:
        print("None!")
    for c in valid_climbs:
        print(f"▶ Climb: {c['start_km']:.2f}km to {c['end_km']:.2f}km | {c['gain']:.0f}m gain | {c['grade']:.1f}% avg")
    print("\n")
