"""argparse wiring for the atlas-viewer CLI."""
from __future__ import annotations

import argparse

from .commands import cmd_favorites, cmd_list, cmd_render
from .constants import FAVORITES_PATH, VALID_LOBES, VALID_NETWORKS


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
