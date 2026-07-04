#!/usr/bin/env python3
# Hand-rolls app/assets/rider-dot.glb: a minimal binary glTF puck used for the
# 3D rider marker (see renderRiderDot in app/app.js). No 3D modeling tool
# available in this environment, so the mesh is built directly from vertex
# math — the same "no external dependencies, encode the binary format by
# hand" approach app/fit.mjs takes for FIT files.
#
# Two materials so the puck reads as the brand dot from any angle: a bright
# amber top face and a paler amber rim (side wall + bottom), matching
# RIDER_DOT_COLOR / RIDER_DOT_RING_COLOR in app.js. Both use
# KHR_materials_unlit — confirmed by testing (not assumed) that an ordinary
# lit PBR material renders solid black here regardless of normals, winding,
# doubleSided, or texturing: the alpha renderer's real-time lighting on
# custom Model3DElement content can leave an upward-facing surface with
# effectively zero light. Unlit is also the semantically correct choice for
# a location marker anyway — it must stay clearly visible at any time of day
# or camera angle, not dim to black in shadow like a real physical object.
#
# Baked to a true 1 meter diameter (0.5m radius) so Model3DElement's `scale`
# in app.js is a plain real-world multiplier (RIDER_DOT_SCALE), not a
# unitless fudge factor.
import json
import math
import pathlib
import struct

OUT_PATH = pathlib.Path("app/assets/rider-dot.glb")

RADIUS_METERS = 0.5
HEIGHT_METERS = 0.15
SEGMENTS = 24

TOP_COLOR = (0xF6 / 255, 0xA5 / 255, 0x2C / 255)  # RIDER_DOT_COLOR
RIM_COLOR = (0xF9 / 255, 0xC9 / 255, 0x82 / 255)  # opaque approximation of RIDER_DOT_RING_COLOR over amber


def pad(data, alignment, filler):
    remainder = len(data) % alignment
    return data if remainder == 0 else data + filler * (alignment - remainder)


def build_geometry():
    half_h = HEIGHT_METERS / 2
    positions = []

    def add(position):
        positions.append(position)
        return len(positions) - 1

    top_center = add((0.0, half_h, 0.0))
    bottom_center = add((0.0, -half_h, 0.0))

    top_cap_rim, bottom_cap_rim = [], []
    for i in range(SEGMENTS):
        angle = 2 * math.pi * i / SEGMENTS
        x, z = RADIUS_METERS * math.cos(angle), RADIUS_METERS * math.sin(angle)
        top_cap_rim.append(add((x, half_h, z)))
        bottom_cap_rim.append(add((x, -half_h, z)))

    top_indices = []
    for i in range(SEGMENTS):
        j = (i + 1) % SEGMENTS
        top_indices += [top_center, top_cap_rim[i], top_cap_rim[j]]

    body_indices = []
    for i in range(SEGMENTS):
        j = (i + 1) % SEGMENTS
        body_indices += [bottom_center, bottom_cap_rim[j], bottom_cap_rim[i]]
        body_indices += [top_cap_rim[i], bottom_cap_rim[i], top_cap_rim[j]]
        body_indices += [top_cap_rim[j], bottom_cap_rim[i], bottom_cap_rim[j]]

    return positions, top_indices, body_indices


def accessor_bounds(vectors):
    mins = [min(v[axis] for v in vectors) for axis in range(3)]
    maxs = [max(v[axis] for v in vectors) for axis in range(3)]
    return mins, maxs


def unlit_material(name, color):
    return {
        "name": name,
        "pbrMetallicRoughness": {"baseColorFactor": [*color, 1.0], "metallicFactor": 0.0, "roughnessFactor": 1.0},
        "doubleSided": True,
        "extensions": {"KHR_materials_unlit": {}},
    }


def main():
    positions, top_indices, body_indices = build_geometry()

    positions_bin = pad(b"".join(struct.pack("<3f", *p) for p in positions), 4, b"\x00")
    top_indices_bin = pad(b"".join(struct.pack("<H", i) for i in top_indices), 4, b"\x00")
    body_indices_bin = pad(b"".join(struct.pack("<H", i) for i in body_indices), 4, b"\x00")
    binary = positions_bin + top_indices_bin + body_indices_bin

    pos_min, pos_max = accessor_bounds(positions)
    positions_len = len(positions) * 12
    top_indices_len = len(top_indices) * 2
    body_indices_len = len(body_indices) * 2

    positions_offset = 0
    top_indices_offset = len(positions_bin)
    body_indices_offset = top_indices_offset + len(top_indices_bin)

    gltf = {
        "asset": {"version": "2.0", "generator": "scripts/generate_rider_dot_model.py"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": 0}, "indices": 1, "material": 0},
                    {"attributes": {"POSITION": 0}, "indices": 2, "material": 1},
                ]
            }
        ],
        "materials": [
            unlit_material("rider-dot-top", TOP_COLOR),
            unlit_material("rider-dot-rim", RIM_COLOR),
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": pos_min,
                "max": pos_max,
            },
            {"bufferView": 1, "componentType": 5123, "count": len(top_indices), "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5123, "count": len(body_indices), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": positions_offset, "byteLength": positions_len, "target": 34962},
            {"buffer": 0, "byteOffset": top_indices_offset, "byteLength": top_indices_len, "target": 34963},
            {"buffer": 0, "byteOffset": body_indices_offset, "byteLength": body_indices_len, "target": 34963},
        ],
        "buffers": [{"byteLength": len(binary)}],
    }

    json_chunk = pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), 4, b" ")
    bin_chunk = binary  # already 4-byte aligned by construction

    def chunk(chunk_type, data):
        return struct.pack("<II", len(data), chunk_type) + data

    body = chunk(0x4E4F534A, json_chunk) + chunk(0x004E4942, bin_chunk)
    header = struct.pack("<4sII", b"glTF", 2, 12 + len(body))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(header + body)
    print(f"wrote {OUT_PATH} ({len(header) + len(body)} bytes, {len(positions)} vertices)")


if __name__ == "__main__":
    main()
