#!/usr/bin/env python3
"""
aal3_to_obj.py
Convert an AAL3-labeled NIfTI volume (in MNI152 space) into one smooth .obj
mesh per brain region, ready to import into Blender as separate objects.

Pipeline, per region:
    binary mask -> pad -> gaussian pre-smooth -> marching cubes
    -> Taubin smooth -> (optional) decimate -> apply NIfTI affine -> export .obj

Because every region is transformed by the SAME NIfTI affine, all the exported
meshes stay perfectly aligned in MNI millimeter space -- so when you import them
into Blender they reassemble into a whole brain automatically.

Usage:
    python aal3_to_obj.py AAL3v1.nii.gz --labels AAL3v1.nii.txt --out meshes/
    python aal3_to_obj.py AAL3v1.nii.gz --sigma 1.2 --taubin 30 --max-faces 8000

Requirements:
    pip install nibabel numpy scipy scikit-image trimesh
"""

import argparse
import csv
import os
import numpy as np
import nibabel as nib
from scipy import ndimage
from skimage import measure
import trimesh


def load_label_names(path):
    """AAL3 ships a lookup table (index name color...). Returns {index: name}."""
    names = {}
    if not path or not os.path.exists(path):
        return names
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and parts[0].lstrip("-").isdigit():
                names[int(parts[0])] = parts[1]
    return names


def region_to_mesh(mask, affine, gaussian_sigma=1.0, taubin_iters=20,
                   target_faces=None):
    """Turn one binary region mask into a smooth trimesh Mesh in world (mm) space."""
    pad = 2
    binary = np.pad(mask.astype(np.float32), pad, mode="constant")  # pad -> watertight
    m = binary
    if gaussian_sigma > 0:
        m = ndimage.gaussian_filter(m, sigma=gaussian_sigma)       # anti-stair-stepping

    # Small/thin regions can get blurred so much that nothing reaches level=0.5;
    # in that case fall back to the un-smoothed binary mask (always spans 0..1).
    if m.max() <= 0.5 or m.min() >= 0.5:
        m = binary

    verts, faces, _normals, _vals = measure.marching_cubes(m, level=0.5)
    verts -= pad  # undo padding offset, back to original voxel-index space

    # voxel index (i,j,k) -> world (x,y,z) mm using the NIfTI affine
    verts_h = np.c_[verts, np.ones(len(verts))]
    verts_world = (affine @ verts_h.T).T[:, :3]

    mesh = trimesh.Trimesh(vertices=verts_world, faces=faces, process=True)

    if taubin_iters > 0:
        # Taubin (not plain Laplacian) so the mesh doesn't shrink as it smooths
        mesh = trimesh.smoothing.filter_taubin(mesh, iterations=taubin_iters)

    if target_faces and len(mesh.faces) > target_faces:
        try:
            mesh = mesh.simplify_quadric_decimation(target_faces)
        except Exception as e:  # decimation needs an optional backend; skip if absent
            print(f"    [decimation unavailable: {e}]")

    return mesh


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("atlas", help="AAL3 labeled NIfTI (.nii / .nii.gz)")
    ap.add_argument("--labels", default=None,
                    help="AAL3 lookup .txt (index name ...) for naming files")
    ap.add_argument("--out", default="meshes", help="output directory")
    ap.add_argument("--sigma", type=float, default=1.0,
                    help="gaussian pre-smoothing in voxels (0 = off, blockier)")
    ap.add_argument("--taubin", type=int, default=20,
                    help="Taubin smoothing iterations (0 = off)")
    ap.add_argument("--max-faces", type=int, default=0,
                    help="decimate each mesh to <= N faces (0 = no decimation)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    img = nib.load(args.atlas)
    data = np.asarray(img.dataobj)
    affine = img.affine
    names = load_label_names(args.labels)

    # iterate only over labels actually present -- AAL3 skips some indices
    # (e.g. 35, 36, 81, 82 are empty), so never assume a contiguous range
    labels = [int(v) for v in np.unique(data) if v != 0]
    print(f"Found {len(labels)} non-zero labels.")

    centroids = []
    for lab in labels:
        mask = data == lab
        if mask.sum() < 10:
            print(f"  [skip] label {lab}: too few voxels")
            continue
        mesh = region_to_mesh(
            mask, affine,
            gaussian_sigma=args.sigma,
            taubin_iters=args.taubin,
            target_faces=(args.max_faces or None))

        name = names.get(lab, f"region_{lab}")
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
        fname = f"{lab:03d}_{safe}.obj"
        mesh.export(os.path.join(args.out, fname))
        c = mesh.centroid
        centroids.append([lab, name, round(c[0], 2), round(c[1], 2), round(c[2], 2)])
        print(f"  {fname}: {len(mesh.vertices)} verts / {len(mesh.faces)} faces")

    # centroids.csv lets you script a radial "explode" in Blender later
    with open(os.path.join(args.out, "centroids.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["label", "name", "x", "y", "z"])
        w.writerows(centroids)

    print(f"\nDone: {len(centroids)} meshes + centroids.csv written to {args.out}/")


if __name__ == "__main__":
    main()
