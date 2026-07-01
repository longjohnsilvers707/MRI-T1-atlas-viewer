"""Figure rendering: 3-D view(s) and the 4-panel publication layout.

Heavy imports (matplotlib, brain_render) are deferred into the render functions
so that non-rendering commands (list / favorites) stay fast and dependency-free.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from .constants import DEFAULT_PALETTE
from .deps import _require_render_deps, _require_slice_deps
from .regions import _assign_colors, _select_regions


def _do_render(preset: dict[str, Any], out_path: Path) -> None:
    """Execute a render from a resolved preset dict.

    Imports brain_render (which loads all meshes into the cache) only when
    actually rendering, so list/favorites commands stay fast.
    """
    _require_render_deps()

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import brain_render as br

    # ── Collect regions ──────────────────────────────────────────────────────
    preset_regions: list[dict] = preset.get("regions", [])
    sel = preset.get("select") or {}

    # Substrings from explicit regions list.
    explicit_names = [r["name"] for r in preset_regions]

    selected = _select_regions(
        region_names=explicit_names,
        lobes=sel.get("lobe") or [],
        networks=sel.get("network") or [],
        hemis=sel.get("hemi") or [],
    )

    if not selected:
        sys.exit(
            "No regions selected. Use --regions, --lobe, --network, or --hemi to "
            "choose which brain regions to render.\n"
            "Run `python atlas_cli.py list` to see all available regions."
        )

    # Colour overrides from preset (CLI overrides were already merged by caller).
    color_overrides: dict[str, str] = {
        r["name"]: r["color"] for r in preset_regions if r.get("color")
    }
    color_map = _assign_colors(selected, color_overrides, preset_regions)

    # Group regions by colour for efficient batch rendering.
    from collections import defaultdict
    color_groups: dict[str, list[str]] = defaultdict(list)
    for name in selected:
        color_groups[color_map.get(name, DEFAULT_PALETTE[0])].append(name)

    dpi    = preset.get("dpi", 300) or 300
    title  = preset.get("title")
    bg     = preset.get("background", "white") or "white"
    do_ctx = preset.get("context", True)

    # Matplotlib background colour.
    bg_rgba = matplotlib.colors.to_rgba(bg)

    # Region substrings for context exclusion.
    all_substrs = list(selected)  # use full region names as exclude-substrs

    # ── Slices configuration ─────────────────────────────────────────────────
    slices_cfg = preset.get("slices") or {}
    sx = slices_cfg.get("x")
    sy = slices_cfg.get("y")
    sz = slices_cfg.get("z")

    # Warn if nibabel is missing when figure or slices are requested.
    need_slices = preset.get("figure") or (sx is not None or sy is not None or sz is not None)
    if need_slices:
        _require_slice_deps()

    atlas = (preset.get("atlas") or "aal3").lower()
    if atlas not in ("aal", "aal3"):
        print(
            f"Warning: 3-D meshes are AAL3-only.  Atlas '{atlas}' is set in the "
            "preset; 3-D rendering will use AAL3 meshes regardless.",
            file=sys.stderr,
        )

    plt.rcParams.update({"font.family": "DejaVu Sans", "savefig.dpi": dpi,
                         "savefig.bbox": "tight", "figure.dpi": 150})

    # ── 4-panel figure (--figure) ────────────────────────────────────────────
    if preset.get("figure"):
        _render_figure_panel(
            color_groups, all_substrs, do_ctx, bg_rgba,
            sx, sy, sz, selected, title, dpi, out_path,
        )
        return

    # ── 3-D view(s) ──────────────────────────────────────────────────────────
    view_names: list[str] = preset.get("views") or ["oblique"]
    invalid = [v for v in view_names if v not in br.VIEWS]
    if invalid:
        sys.exit(
            f"Unknown view(s): {invalid}.  "
            f"Valid views: {list(br.VIEWS.keys())}"
        )

    n_views = len(view_names)
    if n_views == 1:
        fig = plt.figure(figsize=(8, 7))
        fig.patch.set_facecolor(bg_rgba)
        ax = br.base_axes(fig, 111, br.VIEWS[view_names[0]])
        if do_ctx:
            br.context(ax, exclude_substrs=all_substrs)
        for color, names in color_groups.items():
            paths = br.meshes_matching(names)
            if paths:
                br.add_mesh(ax, paths, color, alpha=0.95, zorder=3)
        if title:
            fig.suptitle(title, fontsize=13, fontweight="bold")
    else:
        cols = min(n_views, 3)
        rows = (n_views + cols - 1) // cols
        fig = plt.figure(figsize=(6 * cols, 6 * rows))
        fig.patch.set_facecolor(bg_rgba)
        for i, vk in enumerate(view_names):
            ax = br.base_axes(fig, rows * 100 + cols * 10 + i + 1, br.VIEWS[vk])
            if do_ctx:
                br.context(ax, exclude_substrs=all_substrs)
            for color, names in color_groups.items():
                paths = br.meshes_matching(names)
                if paths:
                    br.add_mesh(ax, paths, color, alpha=0.95, zorder=3)
            ax.set_title(vk.replace("_", " ").title(), fontsize=10, y=0.98)
        if title:
            fig.suptitle(title, fontsize=13, fontweight="bold", y=1.01)
        fig.tight_layout()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(out_path), dpi=dpi)
    plt.close(fig)
    print(f"Saved -> {out_path}")


def _render_figure_panel(
    color_groups: dict[str, list[str]],
    all_substrs: list[str],
    do_ctx: bool,
    bg_rgba: tuple,
    sx: int | None,
    sy: int | None,
    sz: int | None,
    selected: list[str],
    title: str | None,
    dpi: int,
    out_path: Path,
) -> None:
    """Render the 4-panel publication layout (3 slices + 1 3-D view)."""
    import matplotlib.pyplot as plt
    import matplotlib.gridspec as gridspec
    import brain_render as br

    # Compute auto slice positions from the 3-D mesh centroids if not given.
    # This gives a sensible starting plane even without nibabel.
    if any(v is None for v in (sx, sy, sz)):
        all_paths = []
        for names in color_groups.values():
            all_paths.extend(br.meshes_matching(names))
        if all_paths:
            # Mesh centroid in MNI voxel space (approximate; the AAL volume
            # has ~2 mm isotropic voxels with the standard AAL affine).
            c_mni = br.centroid(all_paths)
            # Convert MNI mm -> AAL voxel indices (rough: origin ≈ voxel 45,63,36,
            # voxel size 2 mm).  Only used as fallback default.
            c_vox = (
                int((c_mni[0] + 90) / 2),
                int((c_mni[1] + 126) / 2),
                int((c_mni[2] + 72) / 2),
            )
            sx = sx if sx is not None else c_vox[0]
            sy = sy if sy is not None else c_vox[1]
            sz = sz if sz is not None else c_vox[2]

    # Determine a single highlight colour for the slices (most common colour
    # across selected regions, or the first entry).
    hi_color = next(iter(color_groups.keys()), "#1b6ca8")

    # Load slice data.
    A, mask, brain = br._load_slice_volume(None, None, all_substrs)
    if mask.sum() > 0:
        import numpy as np
        xs, ys, zs = np.where(mask)
        sx = sx if sx is not None else int(np.median(xs))
        sy = sy if sy is not None else int(np.median(ys))
        sz = sz if sz is not None else int(np.median(zs))
    else:
        import numpy as np
        bvx, bvy, bvz = np.where(brain)
        sx = sx if sx is not None else (int(np.median(bvx)) if len(bvx) else A.shape[0] // 2)
        sy = sy if sy is not None else (int(np.median(bvy)) if len(bvy) else A.shape[1] // 2)
        sz = sz if sz is not None else (int(np.median(bvz)) if len(bvz) else A.shape[2] // 2)

    # Build a 2×2 GridSpec: top row = slices (3 cols), bottom-right = 3-D.
    # We use a 1×4 layout for maximum horizontal real estate.
    fig = plt.figure(figsize=(18, 5))
    fig.patch.set_facecolor(bg_rgba)
    gs = gridspec.GridSpec(1, 4, figure=fig, wspace=0.05)

    # Slice axes (2-D).
    ax_axial   = fig.add_subplot(gs[0, 0])
    ax_coronal = fig.add_subplot(gs[0, 1])
    ax_sag     = fig.add_subplot(gs[0, 2])
    br.draw_slice_axes(
        [ax_axial, ax_coronal, ax_sag],
        brain, mask, sx, sy, sz,
        color=hi_color, bg_color="#d7dce1",
    )

    # 3-D axes.
    ax_3d = fig.add_subplot(gs[0, 3], projection="3d")
    ax_3d.view_init(elev=br.VIEWS["oblique"]["elev"], azim=br.VIEWS["oblique"]["azim"])
    br.style_3d(ax_3d, br._ALLV)
    if do_ctx:
        br.context(ax_3d, exclude_substrs=all_substrs)
    for color, names in color_groups.items():
        paths = br.meshes_matching(names)
        if paths:
            br.add_mesh(ax_3d, paths, color, alpha=0.95, zorder=3)
    ax_3d.set_title("Oblique (3-D)", fontsize=10, y=0.98)

    if title:
        fig.suptitle(title, fontsize=13, fontweight="bold", y=1.02)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(out_path), dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved -> {out_path}")
