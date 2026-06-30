"""
Publication brain figures for the Dexterity-DTI (occipital FA vs dorsal-stream
connectivity) paper, rendered from the atlas-viewer AAL3 region meshes (meshes/*.obj,
MNI space) and the cached MNI152 + AAL volumes (cache/).

Outputs PNGs into the study's figures_v16/brain_figures/ folder.

Mesh ROIs are AAL3 anatomical regions used as illustrative proxies for the analysis
nodes (the analysis used AICHA-384 / JHU parcels); this is a localisation aid, stated
in the figure note. No subject data is shown.

All generic rendering primitives (load_obj, meshes_matching, centroid,
shaded_facecolors, add_mesh, style_3d, base_axes, context, VIEWS, _ALLV,
render_slices) are now provided by brain_render.py; this module focuses solely
on the paper-specific figure logic and ROI definitions.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

# All rendering primitives live in brain_render — no duplication here.
from brain_render import (
    ALL_MESHES,
    C_CTX,
    HERE,
    VIEWS,
    _ALLV,
    add_mesh,
    base_axes,
    centroid,
    context,
    load_obj,
    meshes_matching,
    render_slices,
    shaded_facecolors,
    style_3d,
)

# Output figures folder. Defaults to a local path next to this script; both the
# output and (optional) study folder can be overridden on the command line or
# via environment variables (see main()). OUT is resolved in main() before the
# figure functions (which read it as a module global) are called.
DEFAULT_OUT = HERE / "figures" / "brain_figures"
STUDY: Path | None = None
OUT = DEFAULT_OUT

plt.rcParams.update({"font.family": "DejaVu Sans", "savefig.dpi": 300,
                     "savefig.bbox": "tight", "figure.dpi": 150})

# colours (consistent with the data figures)
C_DEX   = "#1b6ca8"   # dexterity-specific tissue (occipital FA)
C_GRIP  = "#e07b39"   # shared / connectivity
C_EARLY = "#6a51a3"   # early visual
C_SPL   = "#2a9d8f"
C_IPS   = "#d62728"   # hub
C_M1    = "#264653"
C_S1    = "#8d6e63"
C_SMA   = "#e9c46a"

# ROI group definitions (AAL3 mesh substrings)
OCC_GYRI  = ["Occipital_Sup", "Occipital_Mid", "Occipital_Inf"]
EARLY_VIS = ["Calcarine", "Cuneus", "Lingual"]
SPL = ["Parietal_Sup"]
IPS = ["Parietal_Inf"]
M1  = ["Precentral"]
S1  = ["Postcentral"]
SMA = ["Supp_Motor_Area"]

NOTE = ("AAL3 region meshes on MNI152 (atlas-viewer); illustrative anatomical "
        "localisation of analysis nodes (analysis used AICHA-384/JHU parcels). "
        "No subject data shown.")


# ---------------------------------------------------------------- FIG 1
def fig_occipital_fa():
    fig = plt.figure(figsize=(12, 5.2))
    for i, (vk, title) in enumerate([("right_lateral", "Right lateral"),
                                     ("posterior", "Posterior"),
                                     ("left_lateral", "Left lateral")]):
        ax = base_axes(fig, 131 + i, VIEWS[vk])
        context(ax, exclude_substrs=OCC_GYRI)
        add_mesh(ax, meshes_matching(OCC_GYRI), C_DEX, alpha=0.97, zorder=3)
        ax.set_title(title, fontsize=10, y=0.98)
    fig.suptitle("Occipital FA ROI — the dexterity-specific tissue (β = 0.25, grip null)",
                 fontsize=13, fontweight="bold", y=1.02)
    fig.text(0.5, -0.02, NOTE, ha="center", fontsize=7, color="#666", wrap=True)
    fig.tight_layout()
    fig.savefig(OUT / "brain1_occipital_FA_ROI.png")
    plt.close(fig)
    print("saved brain1")


# ---------------------------------------------------------------- FIG 2
def fig_parcel_distinction():
    fig = plt.figure(figsize=(11, 5.4))
    for i, (vk, title) in enumerate([("posterior", "Posterior"),
                                     ("right_lateral", "Right lateral")]):
        ax = base_axes(fig, 121 + i, VIEWS[vk])
        context(ax, exclude_substrs=OCC_GYRI + EARLY_VIS)
        add_mesh(ax, meshes_matching(EARLY_VIS), C_EARLY, alpha=0.95, zorder=2)
        add_mesh(ax, meshes_matching(OCC_GYRI), C_DEX, alpha=0.97, zorder=3)
        ax.set_title(title, fontsize=10, y=0.98)
    leg = [Patch(fc=C_DEX, label="Lateral/gyral occipital (FA ROI; survives WB control)"),
           Patch(fc=C_EARLY, label="Early visual: calcarine/cuneus/lingual (diluting set)")]
    fig.legend(handles=leg, loc="lower center", ncol=1, frameon=False,
               fontsize=8.5, bbox_to_anchor=(0.5, -0.04))
    fig.suptitle("Parcel definition matters: gyral occipital vs early-visual cortex",
                 fontsize=13, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(OUT / "brain2_parcel_distinction.png")
    plt.close(fig)
    print("saved brain2")


# ---------------------------------------------------------------- FIG 3
NODE_GROUPS = [
    ("Occipital (visual entry)", OCC_GYRI, C_DEX),
    ("SPL", SPL, C_SPL),
    ("IPS (hub)", IPS, C_IPS),
    ("SMA", SMA, C_SMA),
    ("M1", M1, C_M1),
    ("S1", S1, C_S1),
]


def fig_dorsal_nodes():
    fig = plt.figure(figsize=(12, 5.4))
    for i, (vk, title) in enumerate([("oblique", "Oblique"),
                                     ("superior", "Superior"),
                                     ("posterior", "Posterior")]):
        ax = base_axes(fig, 131 + i, VIEWS[vk])
        allnodes = sum([g[1] for g in NODE_GROUPS], [])
        context(ax, exclude_substrs=allnodes)
        for _, subs, col in NODE_GROUPS:
            add_mesh(ax, meshes_matching(subs), col, alpha=0.95, zorder=3)
        ax.set_title(title, fontsize=10, y=0.98)
    leg = [Patch(fc=c, label=l) for l, _, c in NODE_GROUPS]
    fig.legend(handles=leg, loc="lower center", ncol=6, frameon=False,
               fontsize=8.5, bbox_to_anchor=(0.5, -0.03))
    fig.suptitle("Dorsal visuomotor stream nodes (8-pathway connectivity family)",
                 fontsize=13, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(OUT / "brain3_dorsal_nodes.png")
    plt.close(fig)
    print("saved brain3")


# ---------------------------------------------------------------- FIG 4
# pathways: (A_subs, B_subs, shared?) shared=True means grip-overlapping (orange)
PATHWAYS = [
    ("Occipital", OCC_GYRI, "IPS", IPS, True),     # lat-occ<->IPS grip-shared
    ("Occipital", OCC_GYRI, "SPL", SPL, True),     # lat-occ<->SPL grip-shared
    ("EarlyVis", EARLY_VIS, "SPL", SPL, False),
    ("SPL", SPL, "IPS", IPS, False),
    ("IPS", IPS, "SMA", SMA, False),
    ("IPS", IPS, "M1", M1, False),
    ("IPS", IPS, "S1", S1, False),
]


def _node_centroids(hemi):
    """Centroid per node group for one hemisphere, in NODE_GROUPS order."""
    cents = {}
    for label, subs, col in NODE_GROUPS:
        cents[label] = (centroid(meshes_matching(subs, hemi=hemi)), col)
    return cents


def _draw_connectome(ax, hemis=("L", "R"), shared_col=C_GRIP, other_col="#555555",
                     lw_shared=3.4, lw_other=2.2, node_size=340, mono_nodes=None):
    """Connectome style: node spheres at centroids + connecting pathway lines on top."""
    label_by_subs = {tuple(subs): label for label, subs, _ in NODE_GROUPS}
    for hemi in hemis:
        cents = _node_centroids(hemi)
        # pathway lines first (so nodes sit on top)
        for an, asub, bn, bsub, shared in PATHWAYS:
            la = label_by_subs.get(tuple(asub)); lb = label_by_subs.get(tuple(bsub))
            ca = cents[la][0] if la in cents else centroid(meshes_matching(asub, hemi=hemi))
            cb = cents[lb][0] if lb in cents else centroid(meshes_matching(bsub, hemi=hemi))
            col = shared_col if shared else other_col
            lw = lw_shared if shared else lw_other
            ax.plot([ca[0], cb[0]], [ca[1], cb[1]], [ca[2], cb[2]],
                    color=col, lw=lw, alpha=0.95, zorder=5, solid_capstyle="round")
        # early-visual node (origin of pathway 3)
        ev = centroid(meshes_matching(EARLY_VIS, hemi=hemi))
        ax.scatter(*ev, s=node_size, color=(mono_nodes or C_EARLY),
                   edgecolors="white", linewidths=1.2, depthshade=False, zorder=6)
        for label, (c, col) in cents.items():
            ax.scatter(*c, s=node_size, color=(mono_nodes or col),
                       edgecolors="white", linewidths=1.2, depthshade=False, zorder=6)


def fig_dorsal_pathways():
    fig = plt.figure(figsize=(10, 7.4))
    ax = base_axes(fig, 111, VIEWS["oblique"])
    context(ax)
    _draw_connectome(ax)
    ax.set_title("Oblique view (both hemispheres)", fontsize=10, y=0.99)
    node_leg = [Patch(fc=C_EARLY, label="Early visual")] + \
               [Patch(fc=c, label=l) for l, _, c in NODE_GROUPS]
    line_leg = [Line2D([0], [0], color=C_GRIP, lw=3.4,
                       label="Visual-entry pathway (also grip-associated)"),
                Line2D([0], [0], color="#555555", lw=2.2,
                       label="Other dorsal pathway (dex-leaning, not dex-preferential)")]
    leg1 = fig.legend(handles=node_leg, loc="lower center", ncol=7, frameon=False,
                      fontsize=8, bbox_to_anchor=(0.5, 0.06), title="Nodes")
    fig.add_artist(leg1)
    fig.legend(handles=line_leg, loc="lower center", ncol=2, frameon=False,
               fontsize=8.5, bbox_to_anchor=(0.5, 0.0), title="Pathways")
    fig.suptitle("Dorsal-stream pathways: associated with dexterity but shared with grip (0/8 preferential)",
                 fontsize=12, fontweight="bold", y=0.98)
    fig.savefig(OUT / "brain4_dorsal_pathways.png")
    plt.close(fig)
    print("saved brain4")


# ---------------------------------------------------------------- FIG 5 (key contrast)
# pathways with Table 3 data: (label, A_subs, B_subs, dex_beta, dex_FDRsig, grip_FDRsig)
PW_DATA = [
    ("Lat-occ ↔ IPS",  OCC_GYRI, IPS, 0.160, True,  True),
    ("Lat-occ ↔ SPL",  OCC_GYRI, SPL, 0.065, False, True),
    ("Early-vis ↔ SPL", EARLY_VIS, SPL, 0.075, False, False),
    ("SPL ↔ IPS",      SPL, IPS, 0.127, True,  False),
    ("IPS ↔ SMA",      IPS, SMA, 0.131, True,  False),
    ("IPS ↔ M1",       IPS, M1,  0.094, False, False),
    ("IPS ↔ S1",       IPS, S1,  0.126, True,  False),
]
_BNORM = matplotlib.colors.Normalize(vmin=0.05, vmax=0.17)
# high-contrast blue ramp: even the smallest beta stays clearly visible
_BCMAP = matplotlib.colors.LinearSegmentedColormap.from_list(
    "betaBlue", ["#7fb3d5", "#2e75b6", "#15375e"])


def _connectome_on_regions(ax, hemis=("L", "R"), region_alpha=0.22, node_size=300,
                           context_alpha=0.04):
    # faint whole-brain context
    add_mesh(ax, ALL_MESHES, C_CTX, alpha=context_alpha, shade=False, decim=5, zorder=1)
    # translucent colored regions (so you can see WHERE each node sits)
    add_mesh(ax, meshes_matching(EARLY_VIS), C_EARLY, alpha=region_alpha, shade=True, zorder=2)
    for label, subs, col in NODE_GROUPS:
        add_mesh(ax, meshes_matching(subs), col, alpha=region_alpha, shade=True, zorder=2)
    # connections, weighted by dexterity beta
    for hemi in hemis:
        for label, asub, bsub, beta, dsig, gsig in PW_DATA:
            ca = centroid(meshes_matching(asub, hemi=hemi))
            cb = centroid(meshes_matching(bsub, hemi=hemi))
            col = _BCMAP(_BNORM(beta))
            lw = 3.0 + 18 * beta
            # orange casing flags grip-shared pathways
            if gsig:
                ax.plot([ca[0], cb[0]], [ca[1], cb[1]], [ca[2], cb[2]],
                        color=C_GRIP, lw=lw + 4.5, alpha=0.7, zorder=4,
                        solid_capstyle="round")
            ax.plot([ca[0], cb[0]], [ca[1], cb[1]], [ca[2], cb[2]],
                    color=col, lw=lw, alpha=1.0, zorder=5,
                    solid_capstyle="round", ls="-" if dsig else (0, (3, 2)))
    # node spheres on top
    for hemi in hemis:
        ev = centroid(meshes_matching(EARLY_VIS, hemi=hemi))
        ax.scatter(*ev, s=node_size, color=C_EARLY, edgecolors="white",
                   linewidths=1.4, depthshade=False, zorder=6)
        for label, subs, col in NODE_GROUPS:
            c = centroid(meshes_matching(subs, hemi=hemi))
            ax.scatter(*c, s=node_size, color=col, edgecolors="white",
                       linewidths=1.4, depthshade=False, zorder=6)


def fig_connectome_regions():
    fig = plt.figure(figsize=(13.5, 6.2))
    for i, (vk, title) in enumerate([("oblique", "Oblique"),
                                     ("superior", "Superior"),
                                     ("right_lateral", "Lateral")]):
        ax = base_axes(fig, 131 + i, VIEWS[vk])
        _connectome_on_regions(ax)
        ax.set_title(title, fontsize=10, y=0.99)
    # node legend
    node_leg = [Patch(fc=C_EARLY, label="Early visual")] + \
               [Patch(fc=c, label=l) for l, _, c in NODE_GROUPS]
    leg1 = fig.legend(handles=node_leg, loc="lower center", ncol=7, frameon=False,
                      fontsize=8, bbox_to_anchor=(0.5, 0.085), title="Nodes (region + sphere)")
    fig.add_artist(leg1)
    # line-style legend
    line_leg = [
        Line2D([0], [0], color=_BCMAP(_BNORM(0.16)), lw=4, label="Connection (solid = dexterity FDR-sig)"),
        Line2D([0], [0], color=_BCMAP(_BNORM(0.075)), lw=2, ls=(0, (4, 2)), label="Connection (dashed = dex n.s.)"),
        Line2D([0], [0], color=C_GRIP, lw=6, alpha=0.55, label="Orange casing = also grip FDR-sig (shared)"),
    ]
    fig.legend(handles=line_leg, loc="lower center", ncol=3, frameon=False,
               fontsize=8, bbox_to_anchor=(0.5, 0.0), title="Connections (width ∝ dexterity β)")
    # colorbar for beta
    sm = matplotlib.cm.ScalarMappable(norm=_BNORM, cmap=_BCMAP)
    cax = fig.add_axes([0.92, 0.32, 0.012, 0.4])
    cb = fig.colorbar(sm, cax=cax)
    cb.set_label("Dexterity β (connectivity)", fontsize=8)
    cb.ax.tick_params(labelsize=7)
    fig.suptitle("Dorsal-stream connectome: nodes overlaid on their cortical regions, connections weighted by dexterity β",
                 fontsize=12.5, fontweight="bold", y=1.0)
    fig.text(0.5, -0.04, NOTE, ha="center", fontsize=7, color="#666")
    fig.savefig(OUT / "brain7_connectome_on_regions.png")
    plt.close(fig)
    print("saved brain7")


def fig_connectome_detail():
    """Single right hemisphere, large, regions + nodes + labelled connections."""
    fig = plt.figure(figsize=(9.5, 8.4))
    ax = base_axes(fig, 111, VIEWS["oblique"])
    _connectome_on_regions(ax, hemis=("R",), region_alpha=0.26, node_size=460)
    # label each node near its centroid, lifted and with a white background box
    for label, subs, col in [("Early visual", EARLY_VIS, C_EARLY)] + \
            [(l, s, c) for l, s, c in NODE_GROUPS]:
        c = centroid(meshes_matching(subs, hemi="R"))
        ax.text(c[0], c[1], c[2] + 14, label, fontsize=8.8, fontweight="bold",
                color="#1a1a1a", ha="center", va="bottom", zorder=8,
                bbox=dict(boxstyle="round,pad=0.18", fc="white", ec=col, lw=1.0, alpha=0.9))
    ax.set_title("Right hemisphere, oblique", fontsize=10, y=0.99)
    line_leg = [
        Line2D([0], [0], color=_BCMAP(_BNORM(0.16)), lw=4, label="Dexterity FDR-significant connection"),
        Line2D([0], [0], color=_BCMAP(_BNORM(0.075)), lw=2, ls=(0, (4, 2)), label="Non-significant connection"),
        Line2D([0], [0], color=C_GRIP, lw=6, alpha=0.55, label="Also grip FDR-significant (shared with grip)"),
    ]
    fig.legend(handles=line_leg, loc="lower center", ncol=1, frameon=False,
               fontsize=8.5, bbox_to_anchor=(0.5, 0.02))
    sm = matplotlib.cm.ScalarMappable(norm=_BNORM, cmap=_BCMAP)
    cax = fig.add_axes([0.88, 0.34, 0.018, 0.36])
    cb = fig.colorbar(sm, cax=cax); cb.set_label("Dexterity β", fontsize=9)
    cb.ax.tick_params(labelsize=8)
    fig.suptitle("Dorsal-stream connectome (detail): IPS hub and its dexterity-weighted connections",
                 fontsize=12.5, fontweight="bold", y=0.99)
    fig.text(0.5, 0.0, NOTE, ha="center", fontsize=7, color="#666")
    fig.savefig(OUT / "brain8_connectome_detail.png")
    plt.close(fig)
    print("saved brain8")


def fig_dissociation():
    fig = plt.figure(figsize=(12.5, 6))
    # left: occipital FA tissue
    ax1 = base_axes(fig, 121, VIEWS["oblique"])
    context(ax1, exclude_substrs=OCC_GYRI)
    add_mesh(ax1, meshes_matching(OCC_GYRI), C_DEX, alpha=0.97, zorder=3)
    ax1.set_title("A  Regional occipital FA (tissue quality)\nbeta = 0.25, grip null - DISSOCIATES",
                  fontsize=10.5, color=C_DEX, y=0.97)
    # right: connectivity network (connectome style, all one colour = shared with grip)
    ax2 = base_axes(fig, 122, VIEWS["oblique"])
    context(ax2)
    _draw_connectome(ax2, shared_col=C_GRIP, other_col=C_GRIP,
                     lw_shared=2.6, lw_other=2.6, mono_nodes=C_GRIP)
    ax2.set_title("B  Dorsal-stream connectivity (wiring)\nshared with grip - does NOT dissociate",
                  fontsize=10.5, color=C_GRIP, y=0.97)
    fig.suptitle("Vision's contribution to dexterity is a tissue-quality effect, not a wiring effect",
                 fontsize=13, fontweight="bold", y=1.01)
    fig.text(0.5, 0.005, NOTE, ha="center", fontsize=7, color="#666")
    fig.tight_layout()
    fig.savefig(OUT / "brain5_dissociation_anatomy.png")
    plt.close(fig)
    print("saved brain5")


# ---------------------------------------------------------------- FIG 6 (slices)
def fig_slices():
    """Orthogonal atlas slices built from the AAL volume itself (no resampling):
    brain silhouette in grey, occipital gyri highlighted, on the atlas's own grid.

    Delegates to brain_render.render_slices() for volume loading and drawing.
    """
    fig = render_slices(
        OCC_GYRI,
        color=C_DEX,
        title="Occipital FA ROI on the AAL atlas (occipital gyri highlighted)",
    )
    slice_note = ("AAL atlas volume (atlas-viewer); illustrative anatomical localisation of "
                  "the occipital-FA ROI (analysis used AICHA-384 gyral occipital parcels). "
                  "No subject data shown.")
    fig.text(0.5, 0.01, slice_note, ha="center", fontsize=7, color="#666")
    fig.savefig(OUT / "brain6_atlas_slices.png")
    plt.close(fig)
    print("saved brain6")


def main():
    global STUDY, OUT
    ap = argparse.ArgumentParser(
        description="Render publication brain figures for the Dexterity-DTI paper.")
    ap.add_argument(
        "--out", default=os.environ.get("BRAIN_FIGURES_OUT"),
        help="Output directory for the PNG figures. Defaults to the "
             "BRAIN_FIGURES_OUT env var, or ./figures/brain_figures next to "
             "this script. If --study is given (and --out is not), the output "
             "defaults to <study>/figures_v16/brain_figures.")
    ap.add_argument(
        "--study", default=os.environ.get("DEXTERITY_STUDY"),
        help="Optional study root folder. When given without --out, figures are "
             "written to <study>/figures_v16/brain_figures.")
    args = ap.parse_args()

    if args.study:
        STUDY = Path(args.study).expanduser()
    if args.out:
        OUT = Path(args.out).expanduser()
    elif STUDY is not None:
        OUT = STUDY / "figures_v16" / "brain_figures"
    else:
        OUT = DEFAULT_OUT
    OUT.mkdir(parents=True, exist_ok=True)

    fig_occipital_fa()
    fig_parcel_distinction()
    fig_dorsal_nodes()
    fig_dorsal_pathways()
    fig_dissociation()
    fig_slices()
    print(f"\nAll brain figures -> {OUT}")


if __name__ == "__main__":
    main()
