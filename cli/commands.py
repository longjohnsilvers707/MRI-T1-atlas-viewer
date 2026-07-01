"""Subcommand handlers for the atlas-viewer CLI (render / list / favorites)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from build_brain_bundle import base_name, lobe_for, network_for

from .constants import FAVORITES_PATH
from .favorites import _load_favorites, _save_favorites
from .presets import argv_to_preset, preset_to_argv
from .regions import _all_region_names, _region_info
from .render import _do_render


# ─────────────────────── render ───────────────────────────────────────────────


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


# ─────────────────────── list / regions ───────────────────────────────────────


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


# ─────────────────────── favorites ────────────────────────────────────────────


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
