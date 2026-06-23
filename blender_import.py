#!/usr/bin/env python3
"""
blender_import.py  --  Blender "connector" for aal3_to_obj.py output.

Imports every region .obj that aal3_to_obj.py produced into Blender as a
separate, correctly-named object, all aligned in MNI millimeter space so they
reassemble into a whole brain. Optionally uses centroids.csv to push each
region radially outward (an "exploded" view) and to tint left/right
hemispheres so the two sides are easy to tell apart.

HOW TO RUN
----------
Option A -- inside Blender's GUI:
    1. Open Blender.
    2. Switch a area to the "Scripting" workspace (top tab).
    3. Open this file (Text Editor -> Open), set MESH_DIR below if needed,
       and press "Run Script" (Alt+P).

Option B -- headless from a terminal:
    blender --background --python blender_import.py
    # or save a .blend at the end (see SAVE_BLEND below):
    blender --background --python blender_import.py

Edit the CONFIG block to taste. No external Python packages are required --
this runs against Blender's bundled Python (it does NOT need nibabel/trimesh).
"""

import os
import csv
import math

import bpy  # provided by Blender; not importable from plain CPython


# ----------------------------------------------------------------------------
# CONFIG -- edit these
# ----------------------------------------------------------------------------
# Folder containing the *.obj files + centroids.csv. If left as "", the script
# assumes a "meshes" folder next to this .py file.
MESH_DIR = ""

# Scale factor applied on import. MNI coords are in millimeters; Blender's
# default unit is 1 m, so 1.0 makes the brain ~0.15 m wide. Use 0.01 to get a
# ~15 cm brain if that feels nicer in the viewport. Visual only.
SCALE = 1.0

# Exploded view: push each region away from the brain centroid by this factor.
# 0.0 = assembled whole brain (default). Try 0.5 for a gentle spread.
EXPLODE = 0.0

# Tint left (blue) / right (red) / midline (grey) hemispheres via name suffix.
COLOR_BY_HEMISPHERE = True

# Collect every region under one Collection so it's easy to hide/move as a unit.
COLLECTION_NAME = "AAL3_Brain"

# If set to a path, save a .blend there at the end (handy for headless runs).
SAVE_BLEND = ""  # e.g. r"C:\path\to\brain.blend"
# ----------------------------------------------------------------------------


def _resolve_mesh_dir():
    if MESH_DIR:
        return MESH_DIR
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
    return os.path.join(here, "meshes")


def _import_obj(filepath):
    """Import one .obj across Blender versions; return the new object(s)."""
    before = set(bpy.data.objects)
    if hasattr(bpy.ops.wm, "obj_import"):          # Blender 4.x (and 3.3+)
        bpy.ops.wm.obj_import(filepath=filepath)
    else:                                          # legacy Blender 3.x / 2.9x
        bpy.ops.import_scene.obj(filepath=filepath)
    return [o for o in bpy.data.objects if o not in before]


def _load_centroids(mesh_dir):
    """Returns {label_name: (x, y, z)} from centroids.csv, if present."""
    path = os.path.join(mesh_dir, "centroids.csv")
    cents = {}
    if not os.path.exists(path):
        return cents
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                cents[row["name"]] = (float(row["x"]), float(row["y"]), float(row["z"]))
            except (KeyError, ValueError):
                continue
    return cents


def _hemisphere_color(name):
    """Crude L/R tint from the AAL3 naming convention (..._L / ..._R)."""
    if name.endswith("_L"):
        return (0.25, 0.45, 0.95, 1.0)   # blue
    if name.endswith("_R"):
        return (0.95, 0.30, 0.25, 1.0)   # red
    return (0.70, 0.70, 0.70, 1.0)       # midline / vermis -> grey


def _get_material(name):
    rgba = _hemisphere_color(name)
    key = f"hemi_{name[-2:]}" if name[-2:] in ("_L", "_R") else "hemi_mid"
    mat = bpy.data.materials.get(key)
    if mat is None:
        mat = bpy.data.materials.new(key)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = rgba
    return mat


def main():
    mesh_dir = _resolve_mesh_dir()
    if not os.path.isdir(mesh_dir):
        raise SystemExit(f"Mesh folder not found: {mesh_dir}\n"
                         f"Set MESH_DIR at the top of {os.path.basename(__file__)}.")

    obj_files = sorted(f for f in os.listdir(mesh_dir) if f.lower().endswith(".obj"))
    if not obj_files:
        raise SystemExit(f"No .obj files in {mesh_dir}. Run aal3_to_obj.py first.")

    centroids = _load_centroids(mesh_dir)

    # Brain center = mean of all region centroids (for the explode direction).
    if centroids:
        cx = sum(c[0] for c in centroids.values()) / len(centroids)
        cy = sum(c[1] for c in centroids.values()) / len(centroids)
        cz = sum(c[2] for c in centroids.values()) / len(centroids)
        brain_center = (cx, cy, cz)
    else:
        brain_center = (0.0, 0.0, 0.0)

    # Dedicated collection so the whole brain is one tidy group.
    coll = bpy.data.collections.get(COLLECTION_NAME)
    if coll is None:
        coll = bpy.data.collections.new(COLLECTION_NAME)
        bpy.context.scene.collection.children.link(coll)

    imported = 0
    for fname in obj_files:
        path = os.path.join(mesh_dir, fname)
        new_objs = _import_obj(path)
        if not new_objs:
            print(f"  [warn] nothing imported from {fname}")
            continue

        # Region name = filename without the "NNN_" prefix and ".obj" suffix.
        stem = os.path.splitext(fname)[0]
        region = stem.split("_", 1)[1] if "_" in stem and stem.split("_", 1)[0].isdigit() else stem

        for obj in new_objs:
            obj.name = region

            # Move into our collection (unlink from wherever the importer put it).
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            coll.objects.link(obj)

            # Optional radial explode using this region's centroid.
            if EXPLODE and region in centroids:
                rx, ry, rz = centroids[region]
                obj.location = (
                    (rx - brain_center[0]) * EXPLODE * SCALE,
                    (ry - brain_center[1]) * EXPLODE * SCALE,
                    (rz - brain_center[2]) * EXPLODE * SCALE,
                )

            obj.scale = (SCALE, SCALE, SCALE)

            if COLOR_BY_HEMISPHERE:
                obj.data.materials.clear()
                obj.data.materials.append(_get_material(region))

        imported += 1
        print(f"  imported {fname} -> {region}")

    print(f"\nDone: {imported} regions imported into collection '{COLLECTION_NAME}'.")

    if SAVE_BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=SAVE_BLEND)
        print(f"Saved blend file -> {SAVE_BLEND}")


if __name__ == "__main__":
    main()
