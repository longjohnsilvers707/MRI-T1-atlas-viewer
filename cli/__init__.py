"""
atlas-viewer terminal-imaging CLI package.

Renders 3-D brain figures and orthogonal atlas-slice panels directly from the
command line, matching the preset JSON schema shared with the browser's
"Export CLI command" button (see the shared contract in the project docs).

The public entry point is :func:`main`.  The implementation is split across
focused modules:

    constants   Paths, palette, and taxonomy value sets.
    deps        Lazy dependency checks (numpy / matplotlib / nibabel).
    regions     Region discovery, taxonomy lookup, selection, colour assignment.
    presets     preset <-> argv conversion (shared browser contract).
    favorites   Favorites store load/save.
    render      Figure rendering (3-D views and 4-panel layout).
    commands    Subcommand handlers (render / list / favorites).
    parser      argparse wiring.

For backwards compatibility the commonly used helpers are re-exported here so
``from cli import preset_to_argv`` and friends keep working.
"""
from __future__ import annotations

from .constants import (
    DEFAULT_PALETTE,
    FAVORITES_PATH,
    HERE,
    MESHDIR,
    VALID_LOBES,
    VALID_NETWORKS,
)
from .parser import build_parser
from .presets import argv_to_preset, preset_to_argv
from .regions import (
    _all_region_names,
    _assign_colors,
    _region_info,
    _select_regions,
)


def main(argv: list[str] | None = None) -> None:
    """Entry point for the atlas-viewer CLI."""
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


__all__ = [
    "main",
    "build_parser",
    "preset_to_argv",
    "argv_to_preset",
    "DEFAULT_PALETTE",
    "FAVORITES_PATH",
    "HERE",
    "MESHDIR",
    "VALID_LOBES",
    "VALID_NETWORKS",
    "_all_region_names",
    "_region_info",
    "_select_regions",
    "_assign_colors",
]
