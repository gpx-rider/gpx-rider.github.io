#!/usr/bin/env python3
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
# noise-filtered ascent counter), so gallery cards report the same total
# ascent the app shows once the route is loaded.
CLIMB_NOISE_THRESHOLD_METERS = 2
# Elevation samples per route for the cards' mini profile strip.
PROFILE_SAMPLES = 44

EARTH_RADIUS_M = 6371000


def haversine(a, b):
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


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
    """Total distance, noise-filtered ascent, and an evenly-spaced
    elevation profile — the same numbers app/route.mjs derives on load."""
    distance = 0.0
    cumulative = [0.0]
    ascent = 0.0
    anchor = points[0][2]
    for prev, cur in zip(points, points[1:]):
        distance += haversine(prev[:2], cur[:2])
        cumulative.append(distance)
        delta = cur[2] - anchor
        if delta >= CLIMB_NOISE_THRESHOLD_METERS:
            ascent += delta
            anchor = cur[2]
        elif delta <= -CLIMB_NOISE_THRESHOLD_METERS:
            anchor = cur[2]

    elevations = []
    index = 0
    for i in range(PROFILE_SAMPLES):
        target = distance * i / (PROFILE_SAMPLES - 1)
        while index < len(cumulative) - 2 and cumulative[index + 1] < target:
            index += 1
        span = cumulative[index + 1] - cumulative[index]
        t = (target - cumulative[index]) / span if span > 0 else 0.0
        ele = points[index][2] + (points[index + 1][2] - points[index][2]) * t
        elevations.append(round(ele))

    return round(distance), round(ascent), elevations


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
            distance, ascent, elevations = route_stats(points)
            route["distanceMeters"] = distance
            route["ascentMeters"] = ascent
            route["elevations"] = elevations

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
