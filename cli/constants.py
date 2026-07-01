"""Constants shared across the atlas-viewer CLI package.

Paths are resolved relative to the project root (the parent of this package)
so the CLI works regardless of the current working directory.
"""
from __future__ import annotations

from pathlib import Path

# Project root = parent of the ``cli/`` package directory.
HERE = Path(__file__).resolve().parent.parent
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
