#!/usr/bin/env python3
"""Generate app/gallery.json for the in-app ride gallery.

For every route in gallery/*/ this reads metadata.json, parses the GPX and
precomputes everything the gallery cards render — distance, noise-filtered
ascent/descent, the distance/terrain/difficulty classification, and the
ready-to-draw bars of the mini elevation profile. The gallery card preview is
a plain top-down Leaflet map auto-framed to the route's bounds, so no preview
camera needs to be hand-authored in metadata.json. All the thresholds and the
grade palette are read from app/core/tuning.yaml (via tuning_config.py) — the
same file the app itself loads — so nothing is mirrored by hand anymore.
"""
import json
import math
import pathlib
import shutil
import xml.etree.ElementTree as ET

from tuning_config import load_tuning

TUNING = load_tuning()


def tuning(*path):
    """Walk a nested snake_case path in tuning.yaml (see app/core/tuning.mjs
    for the same idea on the JS side), failing loudly on a missing key."""
    node = TUNING
    trail = []
    for key in path:
        trail.append(key)
        if not isinstance(node, dict) or key not in node:
            raise KeyError(f'tuning.yaml is missing "{".".join(trail)}".')
        node = node[key]
    return node


GALLERY_DIR = pathlib.Path("gallery")
APP_DIR = pathlib.Path("app")
OUTPUT_JSON = APP_DIR / "gallery.json"
APP_GALLERY_DIR = APP_DIR / "gallery"

# Everything below comes straight from tuning.yaml — the same values the app
# loads — so gallery cards always agree with the running app.
CLIMB_NOISE_THRESHOLD_METERS = tuning("route_math", "climb_noise_threshold_meters")
PROFILE_BARS = tuning("gallery", "mini_profile", "bar_count")

EQUIVALENT_KM_CLIMB_METERS = tuning("route_difficulty", "equivalent_km_climb_meters")
DISTANCE_CLASS_THRESHOLDS_KM = [(row["min"], row["label"]) for row in tuning("route_difficulty", "distance_class_thresholds_km")]
TERRAIN_CLASS_THRESHOLDS_M_PER_KM = [(row["min"], row["label"]) for row in tuning("route_difficulty", "terrain_class_thresholds_m_per_km")]
DIFFICULTY_THRESHOLDS_EQUIVALENT_KM = [(row["min"], row["label"]) for row in tuning("route_difficulty", "difficulty_thresholds_equivalent_km")]

# Shared grade palette (see grade_palette in tuning.yaml). Cards deviate
# from the app's profile in two deliberate ways: both descent buckets use the
# lighter green, and the flat bucket uses a lighter tone that reads better on
# the card background.
GRADE_THRESHOLDS = tuning("grade_palette", "thresholds")
GRADE_COLORS = tuning("grade_palette", "colors")
FLAT_BAR_COLOR = tuning("gallery", "mini_profile", "flat_color")

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
    # Bucket boundaries are GRADE_PROFILE_THRESHOLDS: [steep descent, easy
    # descent, flat, gentle, moderate]; colors are the matching 6-entry
    # palette, with the card-specific overrides described above.
    if grade_percent <= GRADE_THRESHOLDS[1]:
        return GRADE_COLORS[1]  # both descent buckets: the lighter green
    if grade_percent < GRADE_THRESHOLDS[2]:
        return FLAT_BAR_COLOR
    if grade_percent < GRADE_THRESHOLDS[3]:
        return GRADE_COLORS[3]
    if grade_percent < GRADE_THRESHOLDS[4]:
        return GRADE_COLORS[4]
    return GRADE_COLORS[5]


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


def parse_metadata(path):
    data = json.loads(path.read_text())
    title = str(data.get("title") or "").strip()
    description = str(data.get("description") or "").strip()
    return title, description


def main():
    entries = sorted(
        d for d in GALLERY_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")
    )

    routes = []
    for entry in entries:
        metadata_file = entry / "metadata.json"
        gpx_file = entry / "export.gpx"

        if not metadata_file.exists() or not gpx_file.exists():
            continue

        title, body = parse_metadata(metadata_file)

        route = {
            "id": entry.name,
            "title": title,
            "description": body,
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

    # Copy gallery GPX files into app/gallery/ so they are served alongside the app.
    # Gallery cards render a live top-down Leaflet preview, so no preview
    # image needs to be generated or copied.
    if APP_GALLERY_DIR.exists():
        shutil.rmtree(APP_GALLERY_DIR)
    for entry in entries:
        gpx_file = entry / "export.gpx"
        if not gpx_file.exists():
            continue
        dest = APP_GALLERY_DIR / entry.name
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(gpx_file, dest / "export.gpx")

    OUTPUT_JSON.write_text(json.dumps({"routes": routes}, indent=2, ensure_ascii=False) + "\n")
    print(f"Gallery data generated: {len(routes)} route(s) → {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
