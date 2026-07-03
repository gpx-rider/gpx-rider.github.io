#!/usr/bin/env python3
import json
import pathlib
import shutil

GALLERY_DIR = pathlib.Path("gallery")
APP_DIR = pathlib.Path("app")
OUTPUT_JSON = APP_DIR / "gallery.json"
APP_GALLERY_DIR = APP_DIR / "gallery"


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

        routes.append({
            "id": entry.name,
            "title": title,
            "description": body,
            "screenshot": f"gallery/{entry.name}/{screenshot.name}" if screenshot else None,
            "gpx": f"gallery/{entry.name}/export.gpx",
        })

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
