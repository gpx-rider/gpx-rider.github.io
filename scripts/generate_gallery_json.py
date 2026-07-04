#!/usr/bin/env python3
"""Generate app/gallery.json for the in-app ride gallery.

For every route in gallery/*/ this parses the GPX and precomputes everything
the gallery cards render — distance, noise-filtered ascent/descent, the
distance/terrain/difficulty classification, and the ready-to-draw bars of the
mini elevation profile — so the browser only has to lay them out. The numbers
mirror app/route.mjs and app/difficulty.mjs; the thresholds below are kept in
sync with app/tuning.mjs by hand (no build step to import them).
"""
import json
import math
import pathlib
import shutil
import xml.etree.ElementTree as ET

GALLERY_DIR = pathlib.Path("gallery")
APP_DIR = pathlib.Path("app")
OUTPUT_JSON = APP_DIR / "gallery.json"
APP_GALLERY_DIR = APP_DIR / "gallery"

# Mirrors CLIMB_NOISE_THRESHOLD_METERS in app/tuning.mjs (enrichRoute's
# noise-filtered ascent/descent counter), so gallery cards report the same
# totals the app shows once the route is loaded.
CLIMB_NOISE_THRESHOLD_METERS = 2
# Bars drawn in each card's mini elevation profile strip.
PROFILE_BARS = 44

# Classification thresholds — mirror app/tuning.mjs / app/difficulty.mjs.
EQUIVALENT_KM_CLIMB_METERS = 100
DISTANCE_CLASS_THRESHOLDS_KM = [
    (0, "XS"), (20, "S"), (40, "M"), (70, "L"), (110, "XL"), (160, "XXL"),
]
TERRAIN_CLASS_THRESHOLDS_M_PER_KM = [
    (0, "Flat"), (5, "Gentle"), (10, "Rolling"), (20, "Hilly"), (35, "Mountainous"),
]
DIFFICULTY_THRESHOLDS_EQUIVALENT_KM = [
    (0, "Very Easy"), (25, "Easy"), (50, "Moderate"),
    (85, "Hard"), (130, "Very Hard"), (190, "Epic"),
]

# Grade palette for the mini profile — mirrors gradeColor in app/profile.mjs
# and the gallery mini-bar buckets.
FLAT_BAR_COLOR = "rgba(200, 206, 214, 0.55)"

EARTH_RADIUS_M = 6371000


def haversine(a, b):
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def classify(value, thresholds):
    label = thresholds[0][1]
    for minimum, name in thresholds:
        if value >= minimum:
            label = name
    return label


def classify_route(distance_m, ascent_m):
    distance_km = distance_m / 1000
    if distance_km <= 0:
        return None
    ascent_m = max(0, ascent_m)
    per_km = ascent_m / distance_km
    equivalent_km = distance_km + ascent_m / EQUIVALENT_KM_CLIMB_METERS
    return {
        "distanceClass": classify(distance_km, DISTANCE_CLASS_THRESHOLDS_KM),
        "terrainClass": classify(per_km, TERRAIN_CLASS_THRESHOLDS_M_PER_KM),
        "difficulty": classify(equivalent_km, DIFFICULTY_THRESHOLDS_EQUIVALENT_KM),
    }


def mini_bar_color(grade_percent):
    if grade_percent <= -0.6:
        return "#57b877"
    if grade_percent < 0.8:
        return FLAT_BAR_COLOR
    if grade_percent < 3.5:
        return "#e8b74e"
    if grade_percent < 7:
        return "#e8823c"
    return "#d9542f"


def parse_gpx(path):
    """All track/route points as (lat, lng, ele) tuples, namespace-agnostic."""
    root = ET.parse(path).getroot()
    points = []
    for el in root.iter():
        if el.tag.rpartition("}")[2] not in ("trkpt", "rtept"):
            continue
        try:
            lat = float(el.get("lat"))
            lng = float(el.get("lon"))
        except (TypeError, ValueError):
            continue
        ele = 0.0
        for child in el:
            if child.tag.rpartition("}")[2] == "ele":
                try:
                    ele = float(child.text)
                except (TypeError, ValueError):
                    ele = 0.0
                break
        points.append((lat, lng, ele))
    return points


def route_stats(points):
    """Total distance, noise-filtered ascent/descent (mirrors enrichRoute),
    and the ready-to-draw mini-profile bars."""
    distance = 0.0
    cumulative = [0.0]
    ascent = 0.0
    descent = 0.0
    anchor = points[0][2]
    for prev, cur in zip(points, points[1:]):
        distance += haversine(prev[:2], cur[:2])
        cumulative.append(distance)
        delta = cur[2] - anchor
        if delta >= CLIMB_NOISE_THRESHOLD_METERS:
            ascent += delta
            anchor = cur[2]
        elif delta <= -CLIMB_NOISE_THRESHOLD_METERS:
            descent -= delta
            anchor = cur[2]

    # Evenly-spaced elevation samples across the route.
    elevations = []
    index = 0
    for i in range(PROFILE_BARS):
        target = distance * i / (PROFILE_BARS - 1)
        while index < len(cumulative) - 2 and cumulative[index + 1] < target:
            index += 1
        span = cumulative[index + 1] - cumulative[index]
        t = (target - cumulative[index]) / span if span > 0 else 0.0
        ele = points[index][2] + (points[index + 1][2] - points[index][2]) * t
        elevations.append(ele)

    lo = min(elevations)
    span = max(1.0, max(elevations) - lo)
    sample_m = distance / (PROFILE_BARS - 1) if distance > 0 else 1.0
    bars = []
    for i, ele in enumerate(elevations):
        grade = ((ele - elevations[i - 1]) / sample_m * 100) if i > 0 else 0.0
        height = 8 + (ele - lo) / span * 92
        bars.append({"h": round(height, 1), "c": mini_bar_color(grade)})

    return round(distance), round(ascent), round(descent), bars


def parse_desc(path):
    text = path.read_text().strip()
    lines = text.split("\n")
    title = lines[0].lstrip("#").strip()
    body = "\n".join(lines[1:]).strip()
    return title, body


def main():
    entries = sorted(
        d for d in GALLERY_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")
    )

    routes = []
    for entry in entries:
        desc_file = entry / "desc.md"
        gpx_file = entry / "export.gpx"
        screenshot = next(entry.glob("screenshot.*"), None)

        if not desc_file.exists() or not gpx_file.exists():
            continue

        title, body = parse_desc(desc_file)

        route = {
            "id": entry.name,
            "title": title,
            "description": body,
            "screenshot": f"gallery/{entry.name}/{screenshot.name}" if screenshot else None,
            "gpx": f"gallery/{entry.name}/export.gpx",
        }

        points = parse_gpx(gpx_file)
        if len(points) >= 2:
            distance, ascent, descent, bars = route_stats(points)
            route["distanceMeters"] = distance
            route["ascentMeters"] = ascent
            route["descentMeters"] = descent
            route["bars"] = bars
            classification = classify_route(distance, ascent)
            if classification:
                route["classification"] = classification

        routes.append(route)

    # Copy gallery assets into app/gallery/ so they are served alongside the app
    if APP_GALLERY_DIR.exists():
        shutil.rmtree(APP_GALLERY_DIR)
    for entry in entries:
        gpx_file = entry / "export.gpx"
        if not gpx_file.exists():
            continue
        dest = APP_GALLERY_DIR / entry.name
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(gpx_file, dest / "export.gpx")
        screenshot = next(entry.glob("screenshot.*"), None)
        if screenshot:
            shutil.copy2(screenshot, dest / screenshot.name)

    OUTPUT_JSON.write_text(json.dumps({"routes": routes}, indent=2, ensure_ascii=False) + "\n")
    print(f"Gallery data generated: {len(routes)} route(s) → {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
