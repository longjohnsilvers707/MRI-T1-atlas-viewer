"""
brain_render.py — Generic 3-D mesh-rendering and orthogonal slice-imaging
primitives for atlas-viewer AAL3 region meshes (meshes/*.obj, MNI space).

Provides the shared building blocks consumed by both
``render_dexterity_brain_figures.py`` (paper figures) and ``atlas_cli.py``
(interactive CLI).  All paths resolve relative to the repo root — the directory
containing this file — regardless of the caller's working directory.

Public API
----------
Constants:
    MESHDIR        path to the meshes directory
    ALL_MESHES     sorted list of all .obj file paths (strings)
    VIEWS          dict of camera-angle presets
    C_CTX          glass-brain context hex colour
    _ALLV          (N, 3) float array — union of all mesh vertices, for bbox

Rendering:
    load_obj(p)                         -> (V, F) cached numpy arrays
    meshes_matching(substrs, hemi)      -> list[str] paths
    centroid(paths)                     -> (3,) float ndarray
    shaded_facecolors(V, F, rgb, ...)   -> (N, 3) float ndarray
    add_mesh(ax, paths, rgb, ...)       add Poly3DCollection to 3-D axes
    style_3d(ax, V_all, zoom)           apply orthographic framing + hide axes
    base_axes(fig, pos, view)           -> styled 3-D subplot
    context(ax, exclude_substrs)        draw faint whole-brain glass context

Slices:
    render_slices(region_substrs, ...)  -> matplotlib Figure (1×3)
    draw_slice_axes(axes, ...)          draw onto caller-supplied 3-element axes
"""
from __future__ import annotations

import glob
import re
from pathlib import Path
from typing import Sequence

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from obj_utils import read_obj_numpy_cached

# Repository root — always the directory containing this file.
HERE = Path(__file__).resolve().parent
MESHDIR = HERE / "meshes"

# Shared memoisation cache: str(path) -> (V, F)
_cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}

# Glass-brain context colour (neutral blue-grey).
C_CTX = "#b9c2cc"


# ──────────────────────────────────────────── OBJ loading ──────────────────


def load_obj(p: Path) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(V, F)`` numpy arrays for an OBJ mesh, memoised per path.

    Delegates to :func:`obj_utils.read_obj_numpy_cached`, which fan-triangulates
    any polygon face, so quads and n-gons are handled correctly.
    """
    return read_obj_numpy_cached(p, _cache)


# All .obj files sorted by name (so region index order is preserved).
ALL_MESHES: list[str] = sorted(glob.glob(str(MESHDIR / "*.obj")))


# ──────────────────────────────────────── Region selection ─────────────────


def meshes_matching(substrs: Sequence[str], hemi: str | None = None) -> list[str]:
    """Return mesh paths whose filename contains any of *substrs*.

    Matching is case-insensitive and performed against the hemisphere-inclusive
    base name (i.e. the stem after stripping the numeric index prefix, e.g.
    ``"Occipital_Sup_L"``).

    Parameters
    ----------
    substrs:
        Substrings to match (e.g. ``["Occipital_Sup", "Occipital_Mid"]``).
    hemi:
        Optional ``"L"`` or ``"R"``; when given, only paths whose base name
        ends with ``_<hemi>`` are included.
    """
    out: list[str] = []
    for m in ALL_MESHES:
        stem = Path(m).stem          # e.g. 053_Occipital_Sup_L
        base = stem.split("_", 1)[1] # Occipital_Sup_L
        if any(s.lower() in base.lower() for s in substrs):
            if hemi and not base.endswith("_" + hemi):
                continue
            out.append(m)
    return out


def centroid(paths: Sequence[str]) -> np.ndarray:
    """Return the mean vertex position (shape ``(3,)``) across *paths*."""
    pts = [load_obj(Path(p))[0] for p in paths]
    return np.vstack(pts).mean(axis=0)


# ─────────────────────────────────────── 3-D rendering helpers ─────────────


def shaded_facecolors(
    V: np.ndarray,
    F: np.ndarray,
    rgb: str | tuple,
    light: np.ndarray = np.array([0.4, -0.5, 0.8]),
    amb: float = 0.55,
) -> np.ndarray:
    """Compute per-face Lambertian shading.

    Returns an ``(N, 3)`` float RGB array that can be concatenated with an
    alpha column and passed to :class:`Poly3DCollection`.

    Parameters
    ----------
    V, F:
        Vertex and face arrays from :func:`load_obj`.
    rgb:
        Any matplotlib colour spec for the base colour.
    light:
        Unnormalised light direction vector.
    amb:
        Ambient light coefficient (0–1).
    """
    light = light / np.linalg.norm(light)
    tri = V[F]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1
    n = n / ln[:, None]
    b = amb + (1 - amb) * np.clip(n @ light, 0, 1)
    base = np.array(matplotlib.colors.to_rgb(rgb))
    return np.clip(b[:, None] * base[None, :], 0, 1)


def add_mesh(
    ax,
    paths: Sequence[str],
    rgb: str | tuple,
    alpha: float = 0.95,
    shade: bool = True,
    decim: int = 1,
    zorder: int = 2,
) -> None:
    """Add mesh geometry from *paths* to a 3-D matplotlib axes.

    Parameters
    ----------
    ax:
        A ``mpl_toolkits.mplot3d.Axes3D`` instance.
    paths:
        OBJ file paths to render.
    rgb:
        Any matplotlib colour spec.
    alpha:
        Face opacity.
    shade:
        Apply Lambertian shading when ``True``; flat colour otherwise.
    decim:
        Face decimation stride (``decim=4`` → keep every 4th face), useful
        for cheap glass-brain context passes.
    zorder:
        Depth ordering hint for overlapping collections.
    """
    for p in paths:
        V, F = load_obj(Path(p))
        if decim > 1:
            F = F[::decim]
        polys = V[F]
        if shade:
            fc = shaded_facecolors(V, F, rgb)
            fc = np.concatenate([fc, np.full((len(fc), 1), alpha)], axis=1)
        else:
            fc = matplotlib.colors.to_rgba(rgb, alpha)
        pc = Poly3DCollection(
            polys, facecolors=fc, edgecolors="none", linewidths=0, zorder=zorder
        )
        ax.add_collection3d(pc)


def style_3d(ax, V_all: np.ndarray, zoom: float = 1.5) -> None:
    """Apply consistent orthographic framing and hide axes for a 3-D subplot.

    Sets symmetric axis limits so the whole brain fits inside the viewport,
    enables orthographic projection, and hides all axis decorations.

    Parameters
    ----------
    ax:
        The 3-D axes to style.
    V_all:
        Vertex array used to derive the bounding box (typically ``_ALLV`` for
        whole-brain framing).
    zoom:
        Passed to ``set_box_aspect`` for matplotlib ≥ 3.3.
    """
    mn = V_all.min(0); mx = V_all.max(0); ctr = (mn + mx) / 2
    r = (mx - mn).max() / 2 * 1.02
    ax.set_xlim(ctr[0] - r, ctr[0] + r)
    ax.set_ylim(ctr[1] - r, ctr[1] + r)
    ax.set_zlim(ctr[2] - r, ctr[2] + r)
    try:
        ax.set_proj_type("ortho")
    except Exception:
        pass
    try:
        ax.set_box_aspect((1, 1, 1), zoom=zoom)
    except TypeError:
        ax.set_box_aspect((1, 1, 1))
    ax.set_axis_off()


# Whole-brain bounding-box vertices — built once at import time.  All figure
# functions use this as V_all so the 3-D frame stays consistent across plots.
_ALLV: np.ndarray = np.vstack([load_obj(Path(m))[0] for m in ALL_MESHES])

# Named camera presets (elev/azim passed to ax.view_init).
VIEWS: dict[str, dict[str, int]] = {
    "right_lateral": dict(elev=6,  azim=0),
    "left_lateral":  dict(elev=6,  azim=180),
    "posterior":     dict(elev=8,  azim=-90),
    "superior":      dict(elev=88, azim=-90),
    "oblique":       dict(elev=18, azim=-62),
}


def base_axes(fig, pos, view: dict[str, int]):
    """Add a pre-styled 3-D subplot to *fig* at grid position *pos*.

    Parameters
    ----------
    fig:
        The parent Figure.
    pos:
        Subplot position (integer like ``131``, or a GridSpec slice).
    view:
        A dict with ``elev`` and ``azim`` keys (pick from :data:`VIEWS`).

    Returns
    -------
    Axes3D
    """
    ax = fig.add_subplot(pos, projection="3d")
    ax.view_init(elev=view["elev"], azim=view["azim"])
    style_3d(ax, _ALLV)
    return ax


def context(ax, exclude_substrs: Sequence[str] = ()) -> None:
    """Draw the faint whole-brain glass-brain context onto *ax*.

    Regions whose names contain any substring in *exclude_substrs* are
    excluded from the context pass so coloured regions can pop forward
    without being occluded.
    """
    excl: set[str] = set()
    for s in exclude_substrs:
        excl.update(meshes_matching([s]))
    paths = [m for m in ALL_MESHES if m not in excl]
    add_mesh(ax, paths, C_CTX, alpha=0.11, shade=False, decim=4, zorder=1)


# ──────────────────────────────────────────── Slice rendering ──────────────


def _load_slice_volume(
    volume_file: Path | None,
    label_file: Path | None,
    region_substrs: Sequence[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Load the AAL volume and return (A, mask, brain).

    Parameters
    ----------
    volume_file:
        NIfTI volume path; defaults to ``<repo>/cache/aal.nii.gz``.
    label_file:
        Text label file (one ``index name [code]`` per line); defaults to
        ``<repo>/labels/aal.txt``.
    region_substrs:
        Substrings to match against the name column of *label_file*.

    Returns
    -------
    A : (X, Y, Z) int array — voxel labels (1-based line index).
    mask : (X, Y, Z) bool array — True where any matched region lives.
    brain : (X, Y, Z) bool array — True where any region lives (> 0).
    """
    import nibabel as nib

    if volume_file is None:
        volume_file = HERE / "cache" / "aal.nii.gz"
    if label_file is None:
        label_file = HERE / "labels" / "aal.txt"

    aal = nib.load(str(volume_file))
    A = np.asarray(aal.get_fdata()).astype(int)

    # Match label-file lines (1-based line number is the voxel value).
    region_codes: list[int] = []
    with open(label_file) as fh:
        for i, ln in enumerate(fh, start=1):
            parts = ln.split()
            name_col = parts[1] if len(parts) >= 2 else (parts[0] if parts else "")
            if name_col and any(
                re.search(re.escape(s), name_col, re.IGNORECASE)
                for s in region_substrs
            ):
                region_codes.append(i)

    mask = np.isin(A, region_codes)
    brain = A > 0
    return A, mask, brain


def draw_slice_axes(
    axes: Sequence,
    brain: np.ndarray,
    mask: np.ndarray,
    cx: int,
    cy: int,
    cz: int,
    color: str = "#1b6ca8",
    bg_color: str = "#d7dce1",
) -> None:
    """Draw axial / coronal / sagittal slices onto *axes* (length-3 sequence).

    All three axes are configured identically: brain silhouette in *bg_color*,
    highlighted mask in *color*, square aspect, no tick decorations.

    Parameters
    ----------
    axes:
        Exactly three matplotlib Axes objects: axial, coronal, sagittal.
    brain, mask:
        Boolean 3-D arrays from :func:`_load_slice_volume`.
    cx, cy, cz:
        Voxel-space slice positions.
    color, bg_color:
        Hex colours for highlighted region and brain silhouette respectively.
    """
    grey = matplotlib.colors.ListedColormap([bg_color])
    hi_cmap = matplotlib.colors.ListedColormap([color])

    slices = [
        (axes[0], brain[:, :, cz],  mask[:, :, cz],  f"Axial (z={cz})"),
        (axes[1], brain[:, cy, :],  mask[:, cy, :],  f"Coronal (y={cy})"),
        (axes[2], brain[cx, :, :],  mask[cx, :, :],  f"Sagittal (x={cx})"),
    ]
    for ax, bg_sl, ov_sl, title in slices:
        ax.imshow(
            np.ma.masked_where(~bg_sl, np.ones_like(bg_sl, float)).T,
            cmap=grey, origin="lower", interpolation="nearest",
        )
        if ov_sl.any():
            ax.imshow(
                np.ma.masked_where(~ov_sl, np.ones_like(ov_sl, float)).T,
                cmap=hi_cmap, origin="lower", interpolation="nearest", alpha=0.95,
            )
        ax.set_title(title, fontsize=10)
        ax.set_axis_off()
        ax.set_aspect("equal")


def render_slices(
    region_substrs: Sequence[str],
    *,
    x: int | None = None,
    y: int | None = None,
    z: int | None = None,
    color: str = "#1b6ca8",
    bg_color: str = "#d7dce1",
    title: str | None = None,
    label_file: Path | None = None,
    volume_file: Path | None = None,
) -> plt.Figure:
    """Render axial, coronal, and sagittal atlas slices with selected regions.

    This is the generalised version of the ``fig_slices()`` function previously
    contained in ``render_dexterity_brain_figures.py``.

    Parameters
    ----------
    region_substrs:
        Substrings matched (case-insensitively) against the label-file name
        column to identify which voxels to highlight.
    x, y, z:
        Voxel-space slice positions.  ``None`` → auto from the median
        coordinate of the highlighted mask, falling back to the volume centre
        if no voxels match.
    color:
        Hex colour for the highlighted voxels.
    bg_color:
        Hex colour for the whole-brain silhouette.
    title:
        Optional figure super-title.
    label_file:
        Path to label text file; defaults to ``<repo>/labels/aal.txt``.
    volume_file:
        Path to NIfTI volume; defaults to ``<repo>/cache/aal.nii.gz``.

    Returns
    -------
    matplotlib.figure.Figure
        A 1×3 figure (axial, coronal, sagittal).  The caller is responsible
        for saving and closing it.
    """
    A, mask, brain = _load_slice_volume(volume_file, label_file, region_substrs)

    if mask.sum() == 0:
        # No voxels matched; fall back to whole-brain centre so the figure
        # still renders with a silhouette rather than crashing.
        bvx, bvy, bvz = np.where(brain)
        cx_fb = int(np.median(bvx)) if len(bvx) else A.shape[0] // 2
        cy_fb = int(np.median(bvy)) if len(bvy) else A.shape[1] // 2
        cz_fb = int(np.median(bvz)) if len(bvz) else A.shape[2] // 2
        cx = x if x is not None else cx_fb
        cy = y if y is not None else cy_fb
        cz = z if z is not None else cz_fb
    else:
        xs, ys, zs = np.where(mask)
        cx = x if x is not None else int(np.median(xs))
        cy = y if y is not None else int(np.median(ys))
        cz = z if z is not None else int(np.median(zs))

    fig, axes = plt.subplots(1, 3, figsize=(12, 4.6))
    draw_slice_axes(axes, brain, mask, cx, cy, cz, color=color, bg_color=bg_color)

    if title:
        fig.suptitle(title, fontsize=13, fontweight="bold", y=1.0)

    fig.tight_layout()
    return fig
