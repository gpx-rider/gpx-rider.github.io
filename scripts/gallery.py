#!/usr/bin/env python3
import pathlib
import re

GALLERY_DIR = pathlib.Path("gallery")
README = pathlib.Path("README.md")


def parse_desc(path):
    text = path.read_text().strip()
    lines = text.split("\n")
    title = lines[0].lstrip("#").strip()
    body = "\n".join(lines[1:]).strip()
    return title, body


def build_gallery():
    entries = sorted(
        d for d in GALLERY_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")
    )
    blocks = []
    for entry in entries:
        desc_file = entry / "desc.md"
        gpx_file = entry / "export.gpx"
        screenshot = next(entry.glob("screenshot.*"), None)

        if not desc_file.exists() or not gpx_file.exists():
            continue

        title, body = parse_desc(desc_file)
        gpx_path = gpx_file.as_posix()

        lines = [f"#### [{title}]({gpx_path})"]
        if screenshot:
            lines += ["", f"![]({screenshot.as_posix()})"]
        lines += ["", body, "", f"[⬇ Download GPX]({gpx_path})"]
        blocks.append("\n".join(lines))

    return "\n\n---\n\n".join(blocks)


def update_readme(gallery_md):
    content = README.read_text()
    replacement = f"<!-- gallery-start -->\n{gallery_md}\n<!-- gallery-end -->"
    new_content = re.sub(
        r"<!-- gallery-start -->.*?<!-- gallery-end -->",
        replacement,
        content,
        flags=re.DOTALL,
    )
    if new_content == content:
        raise SystemExit("ERROR: gallery markers not found in README.md")
    README.write_text(new_content)
    n = gallery_md.count("⬇")
    print(f"Gallery updated: {n} route(s)")


if __name__ == "__main__":
    update_readme(build_gallery())
