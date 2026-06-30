"""
atlas_cli.py — Terminal-imaging CLI for atlas-viewer AAL3 region meshes.

Renders 3-D brain figures and orthogonal atlas-slice panels directly from the
command line, matching the preset JSON schema shared with the browser's
"Export CLI command" button (see the shared contract in the project docs).

Subcommands
-----------
render     Render selected AAL3 regions as a 3-D PNG or 4-panel figure.
list       List available regions (alias: regions).
favorites  Manage named preset collections (save / list / show / render /
           delete / import).

Quick start
-----------
# List all regions:
python atlas_cli.py list

# Render occipital regions from the right side:
python atlas_cli.py render --regions Occipital_Sup_L,Occipital_Sup_R \\
    --color Occipital_Sup_L=#1b6ca8 --color Occipital_Sup_R=#e07b39 \\
    --view right_lateral -o occipital.png

# 4-panel publication figure with slice planes:
python atlas_cli.py render --regions Precentral_L,Precentral_R \\
    --figure -o motor_fig.png

# Save a favorite and re-render it later:
python atlas_cli.py favorites save motor --regions Precentral --figure
python atlas_cli.py favorites render motor -o motor_fig.png

Dependencies
------------
numpy, matplotlib, nibabel must be installed.  If they are missing the CLI
prints the install command and exits cleanly.

    pip install numpy matplotlib nibabel
    # or inside the project venv:
    .venv/bin/pip install numpy matplotlib nibabel

Preset JSON (§2 of the shared contract)
----------------------------------------
Both this CLI and the browser's Export button use the same JSON shape::

    {
      "version": 1,
      "atlas": "aal3",
      "regions": [{"name": "Precentral_L", "color": "#e07b39"}],
      "select": {"lobe": [], "network": [], "hemi": []},
      "views": ["oblique"],
      "figure": false,
      "slices": {"x": null, "y": null, "z": null},
      "background": "white",
      "context": true,
      "dpi": 300,
      "title": null
    }
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path
from typing import Any

# Taxonomy functions live in build_brain_bundle (standard-library-only module).
# Import them unconditionally — they never pull in numpy/matplotlib.
from build_brain_bundle import (
    base_name,
    hemisphere_for,
    lobe_for,
    network_for,
)

# ─────────────────────────── constants ────────────────────────────────────────

HERE = Path(__file__).resolve().parent
MESHDIR = HERE / "meshes"

# Storage for named presets.
FAVORITES_PATH = Path.home() / ".atlas-viewer" / "favorites.json"

# Default colour palette for auto-assigned region colours (up to 15 regions
# before cycling).  Chosen for perceptual distinctness on white backgrounds.
DEFAULT_PALETTE = [
    "#1b6ca8", "#e07b39", "#6a51a3", "#2a9d8f", "#d62728",
    "#264653", "#8d6e63", "#e9c46a", "#4e9a06", "#c07020",
    "#3498db", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6",
]

# Valid lobe and network values (sourced from build_brain_bundle taxonomy).
VALID_LOBES = {
    "Frontal", "Parietal", "Temporal", "Occipital",
    "Limbic", "Subcortical", "Cerebellum", "Other",
}
VALID_NETWORKS = {
    "Visual", "Somatomotor", "DorsalAttention", "Salience",
    "Limbic", "Frontoparietal", "DefaultMode",
    "Subcortical", "Brainstem", "Cerebellar", "Other",
}


# ─────────────────────────── dependency check ─────────────────────────────────


def _require_render_deps() -> None:
    """Exit with a clear message if matplotlib or nibabel are absent."""
    missing = []
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        missing.append("matplotlib")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    if missing:
        sys.exit(
            "Missing required packages: {}\n"
            "Install them with:\n"
            "    pip install numpy matplotlib nibabel\n"
            "Or inside the project venv:\n"
            "    .venv/bin/pip install numpy matplotlib nibabel".format(
                ", ".join(missing)
            )
        )


def _require_slice_deps() -> None:
    """Exit with a clear message if nibabel is absent (needed for slices)."""
    try:
        import nibabel  # noqa: F401
    except ImportError:
        sys.exit(
            "nibabel is required for slice rendering.\n"
            "Install it with:\n"
            "    pip install numpy matplotlib nibabel\n"
            "Or inside the project venv:\n"
            "    .venv/bin/pip install numpy matplotlib nibabel"
        )


# ─────────────────────────── region helpers ───────────────────────────────────


def _all_region_names() -> list[str]:
    """Return all AAL3 region names from the meshes directory (sorted)."""
    names = []
    for p in sorted(glob.glob(str(MESHDIR / "*.obj"))):
        stem = Path(p).stem          # e.g. 053_Occipital_Sup_L
        name = stem.split("_", 1)[1] # Occipital_Sup_L
        names.append(name)
    return names


def _region_info(name: str) -> dict[str, str]:
    """Return a dict with lobe, network, and hemisphere for *name*."""
    bn = base_name(name)
    return {
        "name": name,
        "lobe": lobe_for(bn),
        "network": network_for(name),
        "hemi": hemisphere_for(name),
    }


def _select_regions(
    region_names: list[str],
    lobes: list[str],
    networks: list[str],
    hemis: list[str],
) -> list[str]:
    """Return all AAL3 region names matching any of the selection criteria.

    Explicit *region_names* are matched as case-insensitive substrings against
    the hemisphere-inclusive base name (e.g. ``"Occipital_Sup"`` matches both
    ``Occipital_Sup_L`` and ``Occipital_Sup_R``).  Lobe/network/hemi selections
    are ORed together and then ORed with the explicit names.

    Parameters
    ----------
    region_names:
        Substrings to match against mesh names (from ``--regions`` flag).
    lobes:
        Lobe names to bulk-select (from ``--lobe`` flag).
    networks:
        Network names to bulk-select (from ``--network`` flag).
    hemis:
        Hemisphere codes to bulk-select (``"L"``, ``"R"``) from ``--hemi``.

    Returns
    -------
    list[str]
        Deduplicated list of matching region names in mesh-file order.
    """
    all_names = _all_region_names()
    seen: set[str] = set()
    result: list[str] = []

    for name in all_names:
        matched = False

        # Explicit substring match against the full name (incl. hemisphere).
        if region_names and any(
            s.lower() in name.lower() for s in region_names
        ):
            matched = True

        # Bulk taxonomy selection.
        if not matched and (lobes or networks or hemis):
            info = _region_info(name)
            if lobes and info["lobe"] in lobes:
                matched = True
            if networks and info["network"] in networks:
                matched = True
            if hemis and info["hemi"] in hemis:
                matched = True

        if matched and name not in seen:
            result.append(name)
            seen.add(name)

    return result


def _assign_colors(
    selected: list[str],
    color_overrides: dict[str, str],
    preset_regions: list[dict[str, Any]],
) -> dict[str, str]:
    """Return a name -> hex-colour mapping for all selected regions.

    Precedence (highest first):
      1. CLI ``--color name=#hex`` overrides.
      2. Colours from the loaded preset's ``regions`` list.
      3. Auto-assigned from :data:`DEFAULT_PALETTE` (cycling).
    """
    color_map: dict[str, str] = {}

    # Preset colours as baseline.
    for entry in preset_regions:
        if "color" in entry:
            color_map[entry["name"]] = entry["color"]

    # CLI overrides win.
    color_map.update(color_overrides)

    # Auto-fill uncoloured regions from the palette.
    palette_idx = 0
    for name in selected:
        if name not in color_map:
            color_map[name] = DEFAULT_PALETTE[palette_idx % len(DEFAULT_PALETTE)]
            palette_idx += 1

    return color_map


# ─────────────────────── preset <-> argv helpers ──────────────────────────────


def preset_to_argv(preset: dict[str, Any]) -> str:
    """Convert a preset dict to the equivalent ``atlas_cli.py render`` command.

    This string format is a shared contract with the browser's "Export CLI
    command" button (spec §4).  The format rules are:

    - Subcommand ``render`` first.
    - ``--atlas`` always present.
    - ``--regions`` is a single comma-joined list (no spaces).
    - One ``--color name=#hex`` per region that has an explicit colour.
    - ``--figure`` flag (no value) for the 4-panel layout; otherwise
      ``--view a,b,...`` for named views.
    - Slice flags (``--slice-x``, ``--slice-y``, ``--slice-z``) only when set.
    - ``--dpi`` always present.
    - Always ends with ``-o figure.png``.

    Parameters
    ----------
    preset:
        Dict conforming to the §2 preset schema.

    Returns
    -------
    str
        Shell-ready command string.
    """
    parts: list[str] = ["python atlas_cli.py render"]

    atlas = preset.get("atlas", "aal3")
    parts.append(f"--atlas {atlas}")

    # Explicit region list.
    regions: list[dict] = preset.get("regions", [])
    if regions:
        names = ",".join(r["name"] for r in regions)
        parts.append(f"--regions {names}")
        for r in regions:
            if r.get("color"):
                parts.append(f"--color {r['name']}={r['color']}")

    # Bulk selection fields.
    sel = preset.get("select") or {}
    if sel.get("lobe"):
        parts.append("--lobe " + ",".join(sel["lobe"]))
    if sel.get("network"):
        parts.append("--network " + ",".join(sel["network"]))
    if sel.get("hemi"):
        parts.append("--hemi " + ",".join(sel["hemi"]))

    # Layout: 4-panel figure or named views.
    if preset.get("figure"):
        parts.append("--figure")
    else:
        views: list[str] = preset.get("views") or ["oblique"]
        parts.append("--view " + ",".join(views))

    # Slice positions (only when explicitly set).
    slices = preset.get("slices") or {}
    if slices.get("x") is not None:
        parts.append(f"--slice-x {slices['x']}")
    if slices.get("y") is not None:
        parts.append(f"--slice-y {slices['y']}")
    if slices.get("z") is not None:
        parts.append(f"--slice-z {slices['z']}")

    # Optional render settings.
    bg = preset.get("background", "white")
    if bg and bg != "white":
        parts.append(f"--bg {bg}")

    if not preset.get("context", True):
        parts.append("--no-context")

    dpi = preset.get("dpi", 300)
    parts.append(f"--dpi {dpi}")

    title = preset.get("title")
    if title:
        # Wrap in double-quotes; inner double-quotes are escaped.
        safe_title = title.replace('"', '\\"')
        parts.append(f'--title "{safe_title}"')

    if preset.get("meshWarning"):
        parts.append("# NOTE: 3-D meshes are AAL3-only; slice rendering still works")

    parts.append("-o figure.png")
    return " ".join(parts)


def argv_to_preset(args: argparse.Namespace) -> dict[str, Any]:
    """Convert a parsed ``render`` :class:`argparse.Namespace` to a preset dict.

    The returned dict conforms to the §2 preset schema and can be stored as
    a favorite or exported for the browser to import.
    """
    # Parse --regions (comma-separated).
    region_names: list[str] = (
        [r.strip() for r in args.regions.split(",") if r.strip()]
        if getattr(args, "regions", None)
        else []
    )

    # Parse --color name=#hex (repeatable list).
    color_map: dict[str, str] = {}
    for spec in getattr(args, "color", None) or []:
        if "=" in spec:
            rname, hx = spec.split("=", 1)
            color_map[rname.strip()] = hx.strip()

    # Collect regions with auto-palette where colour not specified.
    palette_idx = 0
    regions: list[dict[str, Any]] = []
    for name in region_names:
        entry: dict[str, Any] = {"name": name}
        if name in color_map:
            entry["color"] = color_map[name]
        else:
            entry["color"] = DEFAULT_PALETTE[palette_idx % len(DEFAULT_PALETTE)]
            palette_idx += 1
        regions.append(entry)

    def _csv(val: str | None) -> list[str]:
        return [v.strip() for v in val.split(",") if v.strip()] if val else []

    preset: dict[str, Any] = {
        "version": 1,
        "atlas": getattr(args, "atlas", "aal3") or "aal3",
        "regions": regions,
        "select": {
            "lobe":    _csv(getattr(args, "lobe",    None)),
            "network": _csv(getattr(args, "network", None)),
            "hemi":    _csv(getattr(args, "hemi",    None)),
        },
        "views":      _csv(getattr(args, "view",     None)) or ["oblique"],
        "figure":     bool(getattr(args, "figure",   False)),
        "slices": {
            "x": getattr(args, "slice_x", None),
            "y": getattr(args, "slice_y", None),
            "z": getattr(args, "slice_z", None),
        },
        "background": getattr(args, "bg",    "white") or "white",
        "context":    not bool(getattr(args, "no_context", False)),
        "dpi":        getattr(args, "dpi",   300),
        "title":      getattr(args, "title", None),
    }
    return preset


# ─────────────────────── favorites storage ────────────────────────────────────


def _load_favorites() -> dict[str, Any]:
    """Load the favorites store from disk.

    Returns ``{"version": 1, "favorites": {}}`` on a missing or corrupt file
    (prints a warning in the corrupt case).
    """
    if not FAVORITES_PATH.exists():
        return {"version": 1, "favorites": {}}
    try:
        with open(FAVORITES_PATH) as fh:
            data = json.load(fh)
        if not isinstance(data.get("favorites"), dict):
            raise ValueError("'favorites' key missing or wrong type")
        return data
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        print(
            f"Warning: favorites file is corrupt ({exc}); starting fresh.\n"
            f"  Path: {FAVORITES_PATH}",
            file=sys.stderr,
        )
        return {"version": 1, "favorites": {}}


def _save_favorites(data: dict[str, Any]) -> None:
    """Write the favorites store to disk, creating the directory if needed."""
    FAVORITES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(FAVORITES_PATH, "w") as fh:
        json.dump(data, fh, indent=2)


# ─────────────────────── render logic ─────────────────────────────────────────


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


# ─────────────────────── subcommand handlers ──────────────────────────────────


def cmd_render(args: argparse.Namespace) -> None:
    """Handler for the ``render`` subcommand."""
    # Start with an empty preset and merge in the loaded one (if any).
    preset: dict[str, Any] = {}

    if getattr(args, "preset", None):
        preset_path = Path(args.preset)
        if not preset_path.exists():
            sys.exit(f"Preset file not found: {preset_path}")
        with open(preset_path) as fh:
            preset = json.load(fh)
        if preset.get("version", 0) != 1:
            print(
                f"Warning: preset version {preset.get('version')} — "
                "expected 1; will attempt to load anyway.",
                file=sys.stderr,
            )

    # Merge explicit CLI flags over preset values.  The rule: any flag that
    # differs from its default overrides the preset field.
    def _csv(val: str | None) -> list[str]:
        return [v.strip() for v in val.split(",") if v.strip()] if val else []

    # Regions: CLI --regions adds to (or replaces) preset regions list.
    cli_region_names = _csv(getattr(args, "regions", None))
    if cli_region_names:
        # Build fresh list from CLI names, preserving any colours from --color.
        cli_color_map: dict[str, str] = {}
        for spec in getattr(args, "color", None) or []:
            if "=" in spec:
                rn, hx = spec.split("=", 1)
                cli_color_map[rn.strip()] = hx.strip()
        new_regions: list[dict[str, Any]] = []
        pal_idx = 0
        for n in cli_region_names:
            entry: dict[str, Any] = {"name": n}
            if n in cli_color_map:
                entry["color"] = cli_color_map[n]
            new_regions.append(entry)
        # Merge: if a name already exists in preset keep preset colour
        # (CLI --color overrides already applied above).
        existing: dict[str, dict] = {r["name"]: r for r in preset.get("regions", [])}
        merged_regions = []
        for entry in new_regions:
            if entry["name"] in existing and "color" not in entry:
                entry["color"] = existing[entry["name"]].get("color", "")
            merged_regions.append(entry)
        preset["regions"] = merged_regions
    elif getattr(args, "color", None):
        # No new region names but colour overrides; patch existing preset regions.
        cli_color_map = {}
        for spec in args.color:
            if "=" in spec:
                rn, hx = spec.split("=", 1)
                cli_color_map[rn.strip()] = hx.strip()
        for r in preset.get("regions", []):
            if r["name"] in cli_color_map:
                r["color"] = cli_color_map[r["name"]]

    # Select (lobe / network / hemi).
    sel = preset.setdefault("select", {"lobe": [], "network": [], "hemi": []})
    if getattr(args, "lobe", None):
        sel["lobe"] = _csv(args.lobe)
    if getattr(args, "network", None):
        sel["network"] = _csv(args.network)
    if getattr(args, "hemi", None):
        sel["hemi"] = _csv(args.hemi)

    # Layout flags.
    if getattr(args, "figure", False):
        preset["figure"] = True
    if getattr(args, "view", None):
        preset["views"] = _csv(args.view)

    # Slice positions.
    slices = preset.setdefault("slices", {"x": None, "y": None, "z": None})
    if getattr(args, "slice_x", None) is not None:
        slices["x"] = args.slice_x
    if getattr(args, "slice_y", None) is not None:
        slices["y"] = args.slice_y
    if getattr(args, "slice_z", None) is not None:
        slices["z"] = args.slice_z

    # Misc.
    if getattr(args, "bg", None):
        preset["background"] = args.bg
    if getattr(args, "no_context", False):
        preset["context"] = False
    if getattr(args, "dpi", None):
        preset["dpi"] = args.dpi
    if getattr(args, "title", None):
        preset["title"] = args.title
    if getattr(args, "atlas", None):
        preset["atlas"] = args.atlas

    # Validate that at least some region is selected.
    has_regions = bool(preset.get("regions")) or any(
        preset.get("select", {}).get(k) for k in ("lobe", "network", "hemi")
    )
    if not has_regions:
        sys.exit(
            "No regions specified.  Use at least one of:\n"
            "  --regions name1,name2\n"
            "  --lobe Frontal,Parietal\n"
            "  --network Visual\n"
            "  --hemi L\n"
            "  --preset path.json\n"
            "Run `python atlas_cli.py list` to see all available regions."
        )

    out_path = Path(getattr(args, "out", "figure.png") or "figure.png")
    _do_render(preset, out_path)


def cmd_list(args: argparse.Namespace) -> None:
    """Handler for the ``list`` / ``regions`` subcommand."""
    names = _all_region_names()

    # Apply --filter substring.
    filt = getattr(args, "filter", None)
    if filt:
        names = [n for n in names if filt.lower() in n.lower()]

    do_lobes    = getattr(args, "lobes",    False)
    do_networks = getattr(args, "networks", False)

    if do_lobes:
        from collections import defaultdict
        groups: dict[str, list[str]] = defaultdict(list)
        for n in names:
            groups[lobe_for(base_name(n))].append(n)
        for grp in sorted(groups):
            print(f"\n{grp} ({len(groups[grp])} regions)")
            for n in groups[grp]:
                print(f"  {n}")
    elif do_networks:
        from collections import defaultdict
        groups = defaultdict(list)
        for n in names:
            groups[network_for(n)].append(n)
        for grp in sorted(groups):
            print(f"\n{grp} ({len(groups[grp])} regions)")
            for n in groups[grp]:
                print(f"  {n}")
    else:
        print(f"{len(names)} AAL3 regions:\n")
        for n in names:
            info = _region_info(n)
            print(f"  {n:<35}  lobe={info['lobe']:<14}  net={info['network']:<18}  hemi={info['hemi']}")


# ─────────────────────── favorites subcommands ────────────────────────────────


def cmd_favorites(args: argparse.Namespace) -> None:
    """Dispatch favorites sub-subcommands."""
    sub = getattr(args, "fav_sub", None)
    if sub == "save":
        fav_save(args)
    elif sub == "list":
        fav_list(args)
    elif sub == "show":
        fav_show(args)
    elif sub == "render":
        fav_render(args)
    elif sub == "delete":
        fav_delete(args)
    elif sub == "import":
        fav_import(args)
    else:
        print("favorites: choose a sub-subcommand: save | list | show | render | delete | import")


def fav_save(args: argparse.Namespace) -> None:
    """Save a named favorite from CLI flags or a preset file."""
    name: str = args.name

    if getattr(args, "from_preset", None):
        preset_path = Path(args.from_preset)
        if not preset_path.exists():
            sys.exit(f"Preset file not found: {preset_path}")
        with open(preset_path) as fh:
            preset = json.load(fh)
    else:
        # Build preset from the render-like flags attached to 'favorites save'.
        preset = argv_to_preset(args)

    data = _load_favorites()
    data["favorites"][name] = preset
    _save_favorites(data)
    print(f"Saved favorite '{name}' -> {FAVORITES_PATH}")


def fav_list(args: argparse.Namespace) -> None:
    """List all saved favorites."""
    data = _load_favorites()
    favs = data["favorites"]
    if not favs:
        print("No favorites saved yet.  Use `python atlas_cli.py favorites save <name> ...`")
        return
    print(f"{len(favs)} saved favorite(s):")
    for name, preset in favs.items():
        regions = [r["name"] for r in preset.get("regions", [])]
        region_str = ", ".join(regions[:3])
        if len(regions) > 3:
            region_str += f", ... (+{len(regions) - 3} more)"
        print(f"  {name:<24}  regions=[{region_str}]")


def fav_show(args: argparse.Namespace) -> None:
    """Print the preset JSON and equivalent command line for a saved favorite."""
    data = _load_favorites()
    name: str = args.name
    if name not in data["favorites"]:
        sys.exit(
            f"Favorite '{name}' not found.  "
            f"Available: {list(data['favorites'].keys())}"
        )
    preset = data["favorites"][name]
    print(f"# Preset JSON for '{name}':")
    print(json.dumps(preset, indent=2))
    print()
    print("# Equivalent command:")
    print(preset_to_argv(preset))


def fav_render(args: argparse.Namespace) -> None:
    """Render a saved favorite by name."""
    data = _load_favorites()
    name: str = args.name
    if name not in data["favorites"]:
        sys.exit(
            f"Favorite '{name}' not found.  "
            f"Available: {list(data['favorites'].keys())}"
        )
    preset = data["favorites"][name]
    out_path = Path(getattr(args, "out", None) or "figure.png")
    _do_render(preset, out_path)


def fav_delete(args: argparse.Namespace) -> None:
    """Delete a saved favorite by name."""
    data = _load_favorites()
    name: str = args.name
    if name not in data["favorites"]:
        sys.exit(
            f"Favorite '{name}' not found.  "
            f"Available: {list(data['favorites'].keys())}"
        )
    del data["favorites"][name]
    _save_favorites(data)
    print(f"Deleted favorite '{name}'.")


def fav_import(args: argparse.Namespace) -> None:
    """Import a preset file exported by the browser into favorites."""
    src = Path(args.file)
    if not src.exists():
        sys.exit(f"File not found: {src}")
    with open(src) as fh:
        preset = json.load(fh)
    # Derive a name from --name, or from the file stem.
    name: str = getattr(args, "name", None) or src.stem
    data = _load_favorites()
    data["favorites"][name] = preset
    _save_favorites(data)
    print(f"Imported '{src}' as favorite '{name}' -> {FAVORITES_PATH}")


# ─────────────────────── argument parser ──────────────────────────────────────


def _add_render_flags(p: argparse.ArgumentParser) -> None:
    """Attach all render-related flags to *p* (shared by render + favorites save)."""
    p.add_argument(
        "--regions", metavar="NAME1,NAME2",
        help="Comma-separated AAL3 region names (or substrings) to render.  "
             "A name without a hemisphere suffix matches both sides.",
    )
    p.add_argument(
        "--lobe", metavar="L1,L2",
        help="Bulk-select all regions belonging to these lobe(s). "
             f"Valid: {', '.join(sorted(VALID_LOBES))}.",
    )
    p.add_argument(
        "--network", metavar="N1,N2",
        help="Bulk-select all regions assigned to these functional network(s). "
             f"Valid: {', '.join(sorted(VALID_NETWORKS))}.",
    )
    p.add_argument(
        "--hemi", metavar="L|R",
        help="Bulk-select all regions of a given hemisphere (L or R).",
    )
    p.add_argument(
        "--color", metavar="NAME=#HEX", action="append",
        help="Assign a hex colour to a region (repeatable).  "
             "Example: --color Precentral_L=#e07b39",
    )
    p.add_argument(
        "--view", metavar="VIEW1,VIEW2",
        help="Comma-separated named views for 3-D rendering.  "
             f"Options: {', '.join(['right_lateral', 'left_lateral', 'posterior', 'superior', 'oblique'])}.",
    )
    p.add_argument(
        "--figure", action="store_true",
        help="Render the 4-panel publication layout "
             "(axial + coronal + sagittal slices + one 3-D view) instead of a single 3-D view.",
    )
    p.add_argument("--slice-x", type=int, dest="slice_x", metavar="N",
                   help="Voxel x-index for the sagittal slice plane.")
    p.add_argument("--slice-y", type=int, dest="slice_y", metavar="N",
                   help="Voxel y-index for the coronal slice plane.")
    p.add_argument("--slice-z", type=int, dest="slice_z", metavar="N",
                   help="Voxel z-index for the axial slice plane.")
    p.add_argument("--bg", metavar="COLOR", default="white",
                   help="Background colour (name or #hex, default: white).")
    p.add_argument("--no-context", dest="no_context", action="store_true",
                   help="Suppress the faint glass-brain context behind selected regions.")
    p.add_argument("--dpi", type=int, default=300,
                   help="Output image resolution in DPI (default: 300).")
    p.add_argument("--title", metavar="TEXT",
                   help="Optional figure title.")
    p.add_argument("--atlas", metavar="ATLAS", default="aal3",
                   help="Atlas identifier (aal or aal3; 3-D meshes are AAL3-only).")


def build_parser() -> argparse.ArgumentParser:
    """Construct and return the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="atlas_cli.py",
        description=(
            "atlas-viewer terminal-imaging CLI.  Render AAL3 brain regions "
            "as 3-D PNGs or 4-panel publication figures directly from the terminal."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python atlas_cli.py list\n"
            "  python atlas_cli.py list --lobes\n"
            "  python atlas_cli.py render --regions Precentral_L,Precentral_R "
            "--color Precentral_L=#e07b39 -o motor.png\n"
            "  python atlas_cli.py render --lobe Frontal --hemi L --figure -o frontal_L.png\n"
            "  python atlas_cli.py favorites save motor --regions Precentral --figure\n"
            "  python atlas_cli.py favorites render motor -o motor_fig.png\n"
        ),
    )
    subs = parser.add_subparsers(dest="command", metavar="SUBCOMMAND")
    subs.required = True

    # ── render ───────────────────────────────────────────────────────────────
    p_render = subs.add_parser(
        "render",
        help="Render selected AAL3 regions as a PNG.",
        description="Render selected AAL3 region meshes as a 3-D PNG or 4-panel figure.",
    )
    p_render.add_argument(
        "--preset", metavar="PATH",
        help="Load options from a preset JSON file (§2 schema).  "
             "Explicit flags override preset fields.",
    )
    _add_render_flags(p_render)
    p_render.add_argument(
        "-o", "--out", metavar="FILE", default="figure.png",
        help="Output PNG file path (default: figure.png).",
    )
    p_render.set_defaults(func=cmd_render)

    # ── list / regions ────────────────────────────────────────────────────────
    for alias in ("list", "regions"):
        p_list = subs.add_parser(
            alias,
            help="List available AAL3 regions." if alias == "list"
                 else "Alias for `list`.",
            description="Print all available AAL3 region names with their "
                        "lobe, network, and hemisphere assignments.",
        )
        p_list.add_argument(
            "--lobes", action="store_true",
            help="Group output by anatomical lobe.",
        )
        p_list.add_argument(
            "--networks", action="store_true",
            help="Group output by functional network.",
        )
        p_list.add_argument(
            "--filter", metavar="SUBSTR",
            help="Show only regions whose name contains SUBSTR (case-insensitive).",
        )
        p_list.set_defaults(func=cmd_list)

    # ── favorites ─────────────────────────────────────────────────────────────
    p_fav = subs.add_parser(
        "favorites",
        help="Manage named region presets.",
        description=(
            "Save, list, show, render, delete, or import named preset collections "
            f"stored in {FAVORITES_PATH}."
        ),
    )
    fav_subs = p_fav.add_subparsers(dest="fav_sub", metavar="ACTION")
    fav_subs.required = True

    # favorites save
    p_fav_save = fav_subs.add_parser(
        "save",
        help="Save the current render options as a named favorite.",
    )
    p_fav_save.add_argument("name", help="Name for the favorite.")
    p_fav_save.add_argument(
        "--from-preset", dest="from_preset", metavar="PATH",
        help="Load from a preset JSON file instead of CLI flags.",
    )
    _add_render_flags(p_fav_save)
    p_fav_save.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="save")

    # favorites list
    p_fav_list = fav_subs.add_parser("list", help="List all saved favorites.")
    p_fav_list.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="list")

    # favorites show
    p_fav_show = fav_subs.add_parser(
        "show",
        help="Print the preset JSON and equivalent command for a favorite.",
    )
    p_fav_show.add_argument("name", help="Favorite name.")
    p_fav_show.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="show")

    # favorites render
    p_fav_render = fav_subs.add_parser(
        "render",
        help="Render a saved favorite by name.",
    )
    p_fav_render.add_argument("name", help="Favorite name.")
    p_fav_render.add_argument(
        "-o", "--out", metavar="FILE", default="figure.png",
        help="Output PNG path (default: figure.png).",
    )
    p_fav_render.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="render")

    # favorites delete
    p_fav_del = fav_subs.add_parser(
        "delete",
        help="Delete a saved favorite by name.",
    )
    p_fav_del.add_argument("name", help="Favorite name.")
    p_fav_del.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="delete")

    # favorites import
    p_fav_import = fav_subs.add_parser(
        "import",
        help="Import a browser-exported preset JSON as a named favorite.",
    )
    p_fav_import.add_argument("file", help="Path to the preset JSON file.")
    p_fav_import.add_argument(
        "--name", metavar="NAME",
        help="Override the favorite name (default: file stem).",
    )
    p_fav_import.set_defaults(func=lambda a: cmd_favorites(a), fav_sub="import")

    p_fav.set_defaults(func=cmd_favorites)

    return parser


def main(argv: list[str] | None = None) -> None:
    """Entry point for the atlas-viewer CLI."""
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
