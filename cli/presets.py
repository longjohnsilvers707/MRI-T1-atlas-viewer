"""preset <-> argv conversion.

The string format produced by :func:`preset_to_argv` is a shared contract with
the browser's "Export CLI command" button (spec §4).  Keep the two in sync.
"""
from __future__ import annotations

import argparse
from typing import Any

from .constants import DEFAULT_PALETTE


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
