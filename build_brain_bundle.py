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
No third-party dependencies (standard library only). OBJ parsing is shared with
the other scripts via obj_utils.read_obj, which is itself standard-library only.
"""

import os
import sys
import glob
import json
import struct
import base64

from obj_utils import read_obj

APP_DIR   = os.path.dirname(os.path.abspath(__file__))
MESH_DIR  = os.path.join(APP_DIR, "meshes")
OUT_PATH  = os.path.join(MESH_DIR, "brain_bundle.json")
TARGET    = 4.0   # target max dimension of the whole brain, in scene units

# ───────────────────────────────────────────────────────────────────────────
#  Region taxonomy — explicit, exhaustive (lobe, network) per AAL3 base name.
#
#  Keyed by the hemisphere-agnostic base name (number prefix and _L/_R suffix
#  removed). This deliberately replaces the old substring/first-match-wins
#  rules: every region is looked up by an exact key, so there is no ordering
#  dependence and a future mesh-name change fails the build loudly (see the
#  assertion in main()) instead of silently falling through to "Other".
#
#  - lobe    : anatomical grouping
#              {Frontal, Parietal, Temporal, Occipital, Limbic, Subcortical,
#               Cerebellum}
#  - network : APPROXIMATE AAL3 -> Yeo-style functional network. AAL3 is an
#              anatomical atlas, so this is a curated best-effort assignment
#              (surfaced to users via meta.networkNote).
#              {Visual, Somatomotor, DorsalAttention, Salience, Limbic,
#               Frontoparietal, DefaultMode, Subcortical, Brainstem, Cerebellar}
# ───────────────────────────────────────────────────────────────────────────
REGION_TAXONOMY = {
    "ACC_pre": ("Limbic", "Salience"),
    "ACC_sub": ("Limbic", "Limbic"),
    "ACC_sup": ("Limbic", "Salience"),
    "Amygdala": ("Limbic", "Limbic"),
    "Angular": ("Parietal", "DefaultMode"),
    "Calcarine": ("Occipital", "Visual"),
    "Caudate": ("Subcortical", "Subcortical"),
    "Cerebellum_10": ("Cerebellum", "Cerebellar"),
    "Cerebellum_3": ("Cerebellum", "Cerebellar"),
    "Cerebellum_4_5": ("Cerebellum", "Cerebellar"),
    "Cerebellum_6": ("Cerebellum", "Cerebellar"),
    "Cerebellum_7b": ("Cerebellum", "Cerebellar"),
    "Cerebellum_8": ("Cerebellum", "Cerebellar"),
    "Cerebellum_9": ("Cerebellum", "Cerebellar"),
    "Cerebellum_Crus1": ("Cerebellum", "Cerebellar"),
    "Cerebellum_Crus2": ("Cerebellum", "Cerebellar"),
    "Cingulate_Mid": ("Limbic", "Salience"),
    "Cingulate_Post": ("Limbic", "DefaultMode"),
    "Cuneus": ("Occipital", "Visual"),
    "Frontal_Inf_Oper": ("Frontal", "Frontoparietal"),
    "Frontal_Inf_Orb_2": ("Frontal", "Limbic"),
    "Frontal_Inf_Tri": ("Frontal", "Frontoparietal"),
    "Frontal_Med_Orb": ("Frontal", "DefaultMode"),
    "Frontal_Mid_2": ("Frontal", "Frontoparietal"),
    "Frontal_Sup_2": ("Frontal", "Frontoparietal"),
    "Frontal_Sup_Medial": ("Frontal", "DefaultMode"),
    "Fusiform": ("Temporal", "Visual"),
    "Heschl": ("Temporal", "Somatomotor"),
    "Hippocampus": ("Limbic", "Limbic"),
    "Insula": ("Limbic", "Salience"),
    "Lingual": ("Occipital", "Visual"),
    "N_Acc": ("Subcortical", "Subcortical"),
    "OFCant": ("Frontal", "Limbic"),
    "OFClat": ("Frontal", "Limbic"),
    "OFCmed": ("Frontal", "Limbic"),
    "OFCpost": ("Frontal", "Limbic"),
    "Occipital_Inf": ("Occipital", "Visual"),
    "Occipital_Mid": ("Occipital", "Visual"),
    "Occipital_Sup": ("Occipital", "Visual"),
    "Olfactory": ("Frontal", "Limbic"),
    "Pallidum": ("Subcortical", "Subcortical"),
    "ParaHippocampal": ("Limbic", "Limbic"),
    "Paracentral_Lobule": ("Parietal", "Somatomotor"),
    "Parietal_Inf": ("Parietal", "Frontoparietal"),
    "Parietal_Sup": ("Parietal", "DorsalAttention"),
    "Postcentral": ("Parietal", "Somatomotor"),
    "Precentral": ("Frontal", "Somatomotor"),
    "Precuneus": ("Parietal", "DefaultMode"),
    "Putamen": ("Subcortical", "Subcortical"),
    "Raphe_D": ("Subcortical", "Brainstem"),
    "Rectus": ("Frontal", "Limbic"),
    "Red_N": ("Subcortical", "Brainstem"),
    "Rolandic_Oper": ("Frontal", "Somatomotor"),
    "SN_pc": ("Subcortical", "Brainstem"),
    "SN_pr": ("Subcortical", "Brainstem"),
    "Supp_Motor_Area": ("Frontal", "Somatomotor"),
    "SupraMarginal": ("Parietal", "Salience"),
    "Temporal_Inf": ("Temporal", "DorsalAttention"),
    "Temporal_Mid": ("Temporal", "DefaultMode"),
    "Temporal_Pole_Mid": ("Temporal", "Limbic"),
    "Temporal_Pole_Sup": ("Temporal", "Limbic"),
    "Temporal_Sup": ("Temporal", "Somatomotor"),
    "Thal_AV": ("Subcortical", "Subcortical"),
    "Thal_IL": ("Subcortical", "Subcortical"),
    "Thal_LGN": ("Subcortical", "Subcortical"),
    "Thal_LP": ("Subcortical", "Subcortical"),
    "Thal_MDl": ("Subcortical", "Subcortical"),
    "Thal_MDm": ("Subcortical", "Subcortical"),
    "Thal_MGN": ("Subcortical", "Subcortical"),
    "Thal_PuA": ("Subcortical", "Subcortical"),
    "Thal_PuI": ("Subcortical", "Subcortical"),
    "Thal_PuL": ("Subcortical", "Subcortical"),
    "Thal_PuM": ("Subcortical", "Subcortical"),
    "Thal_VA": ("Subcortical", "Subcortical"),
    "Thal_VL": ("Subcortical", "Subcortical"),
    "Thal_VPL": ("Subcortical", "Subcortical"),
    "VTA": ("Subcortical", "Brainstem"),
    "Vermis_10": ("Cerebellum", "Cerebellar"),
    "Vermis_1_2": ("Cerebellum", "Cerebellar"),
    "Vermis_3": ("Cerebellum", "Cerebellar"),
    "Vermis_4_5": ("Cerebellum", "Cerebellar"),
    "Vermis_6": ("Cerebellum", "Cerebellar"),
    "Vermis_7": ("Cerebellum", "Cerebellar"),
    "Vermis_8": ("Cerebellum", "Cerebellar"),
    "Vermis_9": ("Cerebellum", "Cerebellar"),
}


def base_name(name):
    """Strip a trailing _L / _R hemisphere tag for taxonomy lookup."""
    if name.endswith("_L") or name.endswith("_R"):
        return name[:-2]
    return name


def lobe_for(name):
    entry = REGION_TAXONOMY.get(base_name(name))
    return entry[0] if entry else "Other"


def network_for(name):
    entry = REGION_TAXONOMY.get(base_name(name))
    return entry[1] if entry else "Other"


def hemisphere_for(name):
    if name.endswith("_L"):
        return "L"
    if name.endswith("_R"):
        return "R"
    return "M"   # midline (Vermis, Raphe)


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
        verts, tris = read_obj(path)
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

    # ── C3: report the parsed index set and flag the documented gaps so a
    #        missing-file regression is distinguishable from expected sparsity.
    indices_seen = sorted(int(os.path.basename(p).partition("_")[0]) for p in
                          (q[0] for q in parsed))
    EXPECTED_MISSING = {35, 36, 81, 82, 133, 134, 160, 167, 168}  # known AAL3 gaps
    full = set(range(indices_seen[0], indices_seen[-1] + 1))
    missing = sorted(full - set(indices_seen))
    unexpected = sorted(set(missing) - EXPECTED_MISSING)
    print("  index range: %d..%d (%d meshes)"
          % (indices_seen[0], indices_seen[-1], len(indices_seen)))
    print("  expected gaps present: %s  (159_VTA_L and 169_Raphe_D are solo by design)"
          % sorted(set(missing) & EXPECTED_MISSING))
    if unexpected:
        print("  WARNING: UNEXPECTED missing indices (possible missing mesh files): %s"
              % unexpected)

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
        if lobe == "Other" or net == "Other":
            unmapped.append("%s (%s)" % (name, base_name(name)))
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

    # ── C1: fail loudly rather than baking "Other" into the bundle. Every
    #        region must resolve to a known lobe AND network via REGION_TAXONOMY.
    if unmapped:
        print("\nERROR: %d region(s) have no taxonomy entry (lobe/network = "
              "'Other'). Add their base name to REGION_TAXONOMY:" % len(unmapped))
        for n in unmapped:
            print("   ", n)
        sys.exit(1)

    with open(OUT_PATH, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUT_PATH) / 1_048_576
    print("\nWrote %s  (%.1f MB, %d regions)" % (OUT_PATH, size_mb, len(regions)))
    print("Lobes   :", dict(sorted(lobes.items())))
    print("Networks:", dict(sorted(networks.items())))
    print("\nAll regions mapped to a lobe and functional network. ✓")


if __name__ == "__main__":
    main()
