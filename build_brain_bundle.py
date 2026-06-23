#!/usr/bin/env python3
"""
build_brain_bundle.py  —  one-time pre-bake for the Explore tab.

Reads the 160 AAL3 region meshes in meshes/*.obj and produces a single
meshes/brain_bundle.json that the browser Explore tab loads in one request.

For each region it:
  * normalizes geometry to the same transform used by the Blender prototype
    (whole brain centered at origin, ~4 units across, no distortion),
  * computes the region centroid (explode home + radial direction),
  * derives display name, hemisphere, anatomical lobe, and a (curated,
    approximate) functional network from the file name,
  * stores geometry as base64-encoded Float32 positions + Uint32 indices
    (compact, and decoded directly into a THREE.BufferGeometry in-browser —
    no extra loader needed; vertex normals are computed client-side).

Run:  python build_brain_bundle.py
No third-party dependencies (standard library only).
"""

import os
import sys
import glob
import json
import struct
import base64

APP_DIR   = os.path.dirname(os.path.abspath(__file__))
MESH_DIR  = os.path.join(APP_DIR, "meshes")
OUT_PATH  = os.path.join(MESH_DIR, "brain_bundle.json")
TARGET    = 4.0   # target max dimension of the whole brain, in scene units

# ───────────────────────────────────────────────────────────────────────────
#  Lobe (anatomical) grouping — matched by substring against the base name.
#  First match wins, so order from most specific to most general.
# ───────────────────────────────────────────────────────────────────────────
LOBE_RULES = [
    ("Cerebellum",   "Cerebellum"), ("Vermis",        "Cerebellum"),
    ("Thal",         "Subcortical"), ("Caudate",       "Subcortical"),
    ("Putamen",      "Subcortical"), ("Pallidum",      "Subcortical"),
    ("N_Acc",        "Subcortical"), ("VTA",           "Subcortical"),
    ("SN_",          "Subcortical"), ("Red_N",         "Subcortical"),
    ("Raphe",        "Subcortical"),
    ("Calcarine",    "Occipital"),  ("Cuneus",        "Occipital"),
    ("Lingual",      "Occipital"),  ("Occipital",     "Occipital"),
    ("Postcentral",  "Parietal"),   ("Parietal",      "Parietal"),
    ("SupraMarginal","Parietal"),   ("Angular",       "Parietal"),
    ("Precuneus",    "Parietal"),   ("Paracentral",   "Parietal"),
    ("Temporal",     "Temporal"),   ("Heschl",        "Temporal"),
    ("Fusiform",     "Temporal"),
    ("Insula",       "Limbic"),     ("Cingulate",     "Limbic"),
    ("ACC",          "Limbic"),     ("Hippocampus",   "Limbic"),
    ("ParaHippocampal","Limbic"),   ("Amygdala",      "Limbic"),
    ("OFC",          "Frontal"),    ("Olfactory",     "Frontal"),
    ("Rectus",       "Frontal"),    ("Rolandic",      "Frontal"),
    ("Supp_Motor",   "Frontal"),    ("Precentral",    "Frontal"),
    ("Frontal",      "Frontal"),
]

# ───────────────────────────────────────────────────────────────────────────
#  Functional network — curated AAL3 -> Yeo-style mapping, keyed by the
#  hemisphere-agnostic base name (number prefix and _L/_R suffix removed).
#  APPROXIMATE: AAL3 is anatomical, so this is a best-effort assignment.
# ───────────────────────────────────────────────────────────────────────────
NETWORK_MAP = {
    # Visual
    "Calcarine": "Visual", "Cuneus": "Visual", "Lingual": "Visual",
    "Occipital_Sup": "Visual", "Occipital_Mid": "Visual", "Occipital_Inf": "Visual",
    "Fusiform": "Visual",
    # Somatomotor (incl. auditory)
    "Precentral": "Somatomotor", "Postcentral": "Somatomotor",
    "Rolandic_Oper": "Somatomotor", "Supp_Motor_Area": "Somatomotor",
    "Paracentral_Lobule": "Somatomotor", "Heschl": "Somatomotor",
    "Temporal_Sup": "Somatomotor",
    # Dorsal attention
    "Parietal_Sup": "DorsalAttention", "Temporal_Inf": "DorsalAttention",
    # Salience / ventral attention
    "Insula": "Salience", "Cingulate_Mid": "Salience", "SupraMarginal": "Salience",
    "ACC_pre": "Salience", "ACC_sup": "Salience",
    # Limbic
    "Frontal_Inf_Orb_2": "Limbic", "Olfactory": "Limbic", "Rectus": "Limbic",
    "OFCmed": "Limbic", "OFCant": "Limbic", "OFCpost": "Limbic", "OFClat": "Limbic",
    "Hippocampus": "Limbic", "ParaHippocampal": "Limbic", "Amygdala": "Limbic",
    "Temporal_Pole_Sup": "Limbic", "Temporal_Pole_Mid": "Limbic", "ACC_sub": "Limbic",
    # Frontoparietal (executive control)
    "Frontal_Sup_2": "Frontoparietal", "Frontal_Mid_2": "Frontoparietal",
    "Frontal_Inf_Oper": "Frontoparietal", "Frontal_Inf_Tri": "Frontoparietal",
    "Parietal_Inf": "Frontoparietal",
    # Default mode
    "Frontal_Sup_Medial": "DefaultMode", "Frontal_Med_Orb": "DefaultMode",
    "Cingulate_Post": "DefaultMode", "Angular": "DefaultMode",
    "Precuneus": "DefaultMode", "Temporal_Mid": "DefaultMode",
    # Subcortical
    "Caudate": "Subcortical", "Putamen": "Subcortical", "Pallidum": "Subcortical",
    "N_Acc": "Subcortical",
    # Brainstem / midbrain
    "VTA": "Brainstem", "SN_pc": "Brainstem", "SN_pr": "Brainstem",
    "Red_N": "Brainstem", "Raphe_D": "Brainstem",
}


def lobe_for(base):
    for needle, lobe in LOBE_RULES:
        if needle in base:
            return lobe
    return "Other"


def base_name(name):
    """Strip a trailing _L / _R hemisphere tag for network lookup."""
    if name.endswith("_L") or name.endswith("_R"):
        return name[:-2]
    return name


def network_for(name):
    base = base_name(name)
    if base in NETWORK_MAP:
        return NETWORK_MAP[base]
    # Thalamic nuclei share a prefix; map them all to Subcortical.
    if base.startswith("Thal"):
        return "Subcortical"
    if base.startswith("Cerebellum") or base.startswith("Vermis"):
        return "Cerebellar"
    return "Other"


def hemisphere_for(name):
    if name.endswith("_L"):
        return "L"
    if name.endswith("_R"):
        return "R"
    return "M"   # midline (Vermis, Raphe)


def parse_obj(path):
    """Return (verts, tri_indices) — verts: list[(x,y,z)], tris: flat list of ints."""
    verts = []
    tris = []
    with open(path, "r") as f:
        for line in f:
            if line.startswith("v "):
                _, x, y, z = line.split()[:4]
                verts.append((float(x), float(y), float(z)))
            elif line.startswith("f "):
                # tokens may be "a", "a/b", "a/b/c"; take the vertex index only
                idx = [int(tok.split("/")[0]) - 1 for tok in line.split()[1:]]
                # triangulate any polygon as a fan
                for k in range(1, len(idx) - 1):
                    tris.extend((idx[0], idx[k], idx[k + 1]))
    return verts, tris


def b64_floats(values):
    return base64.b64encode(struct.pack("<%df" % len(values), *values)).decode("ascii")


def b64_uints(values):
    return base64.b64encode(struct.pack("<%dI" % len(values), *values)).decode("ascii")


def main():
    files = sorted(glob.glob(os.path.join(MESH_DIR, "*.obj")))
    if not files:
        print("ERROR: no .obj files found in", MESH_DIR)
        sys.exit(1)

    print("Parsing %d meshes..." % len(files))
    parsed = []
    gmin = [float("inf")] * 3
    gmax = [float("-inf")] * 3
    for path in files:
        verts, tris = parse_obj(path)
        if not verts or not tris:
            print("  WARNING: empty mesh skipped:", os.path.basename(path))
            continue
        bmin = [min(v[a] for v in verts) for a in range(3)]
        bmax = [max(v[a] for v in verts) for a in range(3)]
        for a in range(3):
            gmin[a] = min(gmin[a], bmin[a])
            gmax[a] = max(gmax[a], bmax[a])
        parsed.append((path, verts, tris, bmin, bmax))

    center = [(gmin[a] + gmax[a]) / 2 for a in range(3)]
    dims = [gmax[a] - gmin[a] for a in range(3)]
    factor = TARGET / max(dims)
    print("  global center: %s  dims: %s  scale factor: %.6f"
          % ([round(c, 2) for c in center], [round(d, 1) for d in dims], factor))

    regions = []
    lobes, networks, unmapped = {}, {}, []
    for path, verts, tris, bmin, bmax in parsed:
        stem = os.path.splitext(os.path.basename(path))[0]   # e.g. 041_Hippocampus_L
        head, _, name = stem.partition("_")                  # 041 , Hippocampus_L
        index = int(head)
        display = name.replace("_", " ")
        hemi = hemisphere_for(name)
        lobe = lobe_for(name)
        net = network_for(name)
        if net == "Other":
            unmapped.append(name)
        lobes[lobe] = lobes.get(lobe, 0) + 1
        networks[net] = networks.get(net, 0) + 1

        # normalized vertices: (p - center) * factor  (flat x,y,z,...)
        pos = []
        for (x, y, z) in verts:
            pos.append((x - center[0]) * factor)
            pos.append((y - center[1]) * factor)
            pos.append((z - center[2]) * factor)
        centroid = [((bmin[a] + bmax[a]) / 2 - center[a]) * factor for a in range(3)]

        regions.append({
            "index": index,
            "name": name,
            "displayName": display,
            "hemisphere": hemi,
            "lobe": lobe,
            "network": net,
            "centroid": [round(c, 5) for c in centroid],
            "positions": b64_floats(pos),
            "indices": b64_uints(tris),
        })

    regions.sort(key=lambda r: r["index"])
    bundle = {
        "meta": {
            "count": len(regions),
            "scaleFactor": factor,
            "center": center,
            "target": TARGET,
            "units": "scaled",
            "atlas": "AAL3",
            "networkNote": "Functional network assignment is approximate "
                           "(AAL3 -> Yeo-style), curated by name.",
        },
        "regions": regions,
    }

    with open(OUT_PATH, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUT_PATH) / 1_048_576
    print("\nWrote %s  (%.1f MB, %d regions)" % (OUT_PATH, size_mb, len(regions)))
    print("Lobes   :", dict(sorted(lobes.items())))
    print("Networks:", dict(sorted(networks.items())))
    if unmapped:
        print("\nUNMAPPED networks (%d) -> fill NETWORK_MAP:" % len(unmapped))
        for n in unmapped:
            print("   ", n)
    else:
        print("\nAll regions mapped to a functional network. ✓")


if __name__ == "__main__":
    main()
