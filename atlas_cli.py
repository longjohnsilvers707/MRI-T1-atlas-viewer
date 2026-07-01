#!/usr/bin/env python
"""
atlas_cli.py — Terminal-imaging CLI for atlas-viewer AAL3 region meshes.

This is a thin entry point.  The implementation lives in the :mod:`cli`
package (``cli/``), split into focused modules:

    cli/constants.py   Paths, palette, taxonomy value sets.
    cli/deps.py        Lazy numpy / matplotlib / nibabel checks.
    cli/regions.py     Region discovery, taxonomy, selection, colours.
    cli/presets.py     preset <-> argv conversion (shared browser contract).
    cli/favorites.py   Favorites store load/save.
    cli/render.py      Figure rendering (3-D views + 4-panel layout).
    cli/commands.py    Subcommand handlers.
    cli/parser.py      argparse wiring.

Usage is unchanged::

    python atlas_cli.py list
    python atlas_cli.py render --regions Precentral_L,Precentral_R -o motor.png
    python atlas_cli.py favorites save motor --regions Precentral --figure

Equivalent module form::

    python -m cli list

Renders 3-D brain figures and orthogonal atlas-slice panels directly from the
command line, matching the preset JSON schema shared with the browser's
"Export CLI command" button (see the shared contract in the project docs).

Dependencies
------------
numpy, matplotlib, nibabel are required only for rendering.  If they are
missing the CLI prints the install command and exits cleanly.

    pip install numpy matplotlib nibabel
    # or inside the project venv:
    .venv/bin/pip install numpy matplotlib nibabel
"""
from __future__ import annotations

from cli import main

if __name__ == "__main__":
    main()
