"""Region discovery, taxonomy lookup, selection, and colour assignment."""
from __future__ import annotations

import glob
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

from .constants import DEFAULT_PALETTE, MESHDIR


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
