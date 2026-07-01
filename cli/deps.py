"""Lazy dependency checks.

The app and build scripts are standard-library-only; numpy/matplotlib/nibabel
are only needed for rendering.  These helpers exit with a clear install message
so ``list`` and ``favorites`` commands stay usable without the heavy stack.
"""
from __future__ import annotations

import sys


def _require_render_deps() -> None:
    """Exit with a clear message if matplotlib or numpy are absent."""
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
