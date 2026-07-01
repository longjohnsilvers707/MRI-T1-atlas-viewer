"""Favorites store: load/save of named preset collections on disk."""
from __future__ import annotations

import json
import sys
from typing import Any

from .constants import FAVORITES_PATH


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
