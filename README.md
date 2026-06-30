

Browser-based viewer for the AAL, JHU, AICHA, and CIT168 brain
atlases on the MNI152 template. Built on [NiiVue](https://niivue.com).

Two tabs:

* **Figure** — the publication workflow: show/hide individual regions, recolor
  any region, control X/Y/Z slice positions, then save a clean PNG of all four
  views (axial, sagittal, coronal, 3-D render).
* **Explore** — an interactive 3-D brain (Three.js) for teaching and exploration:
  *explode* the regions apart and hold, *reassemble* them, color/group by
  anatomical lobe · hemisphere · functional network, isolate a group, and
  hover/click to highlight and identify any region.

The Figure tab also includes a **Gray-matter volume** panel: compute per-region
volumes for the loaded atlas, or drag in a subject T1 for a quick in-browser
GM/WM segmentation and brain-volume estimate — no FSL, no install
([details below](#gray-matter-volume)). A **Show atlas** toggle (bare vs. atlased
brain), a **Diagnostics / error log** export, and an adaptive GPU/CPU compute
backend round out this release (see the [changelog](#changelog)).

---

## Requirement

* Python 3.8 or newer (any platform — Windows / macOS / Linux)
* A modern browser with WebGL2 (Chrome, Edge, Firefox, Safari)
* No internet required — NiiVue, Three.js, TensorFlow.js, and the brainchop
  segmentation model are vendored locally under `vendor/` and served by the app
  (public CDNs are used only as a fallback if a local copy is missing). The
  MNI152 + AAL NIfTI atlas files are still downloaded into `cache/` on first run

No `pip install`, no Node, no build step.

> Tip: a real GPU makes the 3-D illumination modes and subject segmentation much
> faster. On software-only WebGL the app still works — gradient lighting is
> disabled and segmentation falls back to the CPU/WASM backend automatically.

---

## Running the application

```
python server.py
```

That's it. The server starts on `http://localhost:8765` and auto-opens
your browser. On first run it downloads ~4.5 MB of MNI152 + AAL NIfTI
files into `cache/`; subsequent launches are instant.

Press Ctrl+C in the terminal to stop.

---


workflow:

1. Pick atlas → click None in the region panel
2. Use search to find your regions of interest → check 2–3 boxes
3. Recolor by clicking the swatch next to each region
4. Set Outline = Opaque in Display for crisp ROI edges
5. Move the X/Y/Z sliders to show the slice planes you want
6. Click Figure mode → Save PNG

---

## Command-line imaging (`atlas_cli.py`)

Make brain images straight from the terminal — no browser, no web session.
`atlas_cli.py` renders AAL3 regions as 3-D PNGs or a 4-panel publication figure
(axial + sagittal + coronal slices + a 3-D render), using the same mesh/slice
rendering as the figure script.

### Install (one time)

The CLI needs a few scientific Python packages (the web app itself does **not**):

```
pip install numpy matplotlib nibabel
```

or, to keep them out of your system Python, in a project venv:

```
python -m venv .venv
.venv/bin/pip install numpy matplotlib nibabel      # Windows: .venv\Scripts\pip
```

`atlas_cli.py list` works with the standard library alone; `render` is the part
that needs the packages above and prints this install line if they're missing.

### List what you can render

```
python atlas_cli.py list                 # all 160 AAL3 regions (+ lobe/network/hemi)
python atlas_cli.py list --lobes         # available lobes
python atlas_cli.py list --networks      # available functional networks
python atlas_cli.py list --filter Occip  # filter by substring
```

Region names follow the mesh files: `Precentral_L`, `Occipital_Sup_R`, …. A name
**without** a hemisphere suffix (`Occipital_Sup`) matches **both** sides.

### Render

```
# A few regions, custom colours, one 3-D oblique view
python atlas_cli.py render \
  --regions Precentral_L,Occipital_Sup \
  --color Precentral_L=#e07b39 \
  --view oblique -o motor.png

# Whole-lobe selection, left hemisphere, 4-panel publication figure
python atlas_cli.py render --lobe Frontal --hemi L --figure -o frontal_L.png

# By functional network
python atlas_cli.py render --network Visual --figure -o visual.png
```

Useful flags: `--view right_lateral,left_lateral,posterior,superior,oblique`
(ignored with `--figure`), `--figure` (4-panel), `--slice-x/-y/-z N` (figure
slice planes; default auto), `--bg white|black|#hex`, `--no-context` (drop the
faint glass brain), `--dpi 300`, `--title "..."`. The 3-D meshes are **AAL3-only**;
slices come from `cache/aal.nii.gz`.

### Favorites — save image patterns you like

```
python atlas_cli.py favorites save motor --regions Precentral_L,Precentral_R --color Precentral_L=#e07b39
python atlas_cli.py favorites list
python atlas_cli.py favorites show motor         # prints the preset + equivalent command
python atlas_cli.py favorites render motor -o motor.png
python atlas_cli.py favorites delete motor
```

Favorites live in `~/.atlas-viewer/favorites.json`.

### Make a pattern in the browser → get a command

You don't have to compose the flags by hand. Build the look you want in the web
**Figure** tab (pick regions, recolour, set slice planes), then click
**Export CLI command**. The modal gives you:

* a ready-to-paste `python atlas_cli.py render …` command,
* the equivalent **preset JSON** (Copy JSON / Download preset).

Run the command to regenerate the figure offline, or save the preset and feed it
back in:

```
python atlas_cli.py render --preset my_figure.json -o my_figure.png
python atlas_cli.py favorites import my_figure.json --name my_figure
```

(The 3-D meshes are AAL3-only, so exporting from the JHU/AICHA/CIT168 atlases
flags a note; the slice panels still render.)

---

## Gray-matter volume

The **Gray-matter volume** panel (bottom of the Figure sidebar) gives two ways to
get GM volumes — both run entirely in the browser, no FSL install and no upload:

* **Region volumes (this atlas)** — instantly tabulates every parcel of the loaded
  atlas (voxel count × voxel size → mm³ / cm³) plus a total. These are *template*
  (MNI-space) volumes. Sort by any column; **Save CSV** to export.
* **Subject T1 → quick GM estimate** — drag in a T1 NIfTI and the app segments it
  into gray / white matter with [brainchop](https://github.com/neuroneural/brainchop)'s
  fast model (`model5_gw_ae`) on your GPU via TensorFlow.js, then reports GM / WM /
  total-brain cm³. The conformed T1 is loaded into the viewer with the classified
  tissue shaded on top (GM orange, WM blue); use the **Atlas opacity** slider or
  **Show atlas** toggle to adjust or hide the shading, and pick an atlas to return
  to the template view. It's a *rough* estimate from a deliberately small, fast model —
  not FSL-FAST quality — but needs no native tools. TensorFlow.js and the model are
  served locally from `vendor/` (no CDN, works offline).

## Explore tab (3-D)

Switch to the **Explore** tab for an interactive 3-D brain built from the AAL3
region meshes (`meshes/*.obj`):

* **Explode slider** (0–100%) spreads the 160 regions radially outward and holds
  at any amount. **Explode** animates the regions apart and **Reassemble** animates
  them smoothly back together; **Whole** snaps instantly to the fully assembled brain.
* **Color / group by** anatomical lobe, hemisphere, or functional network; click
  a group to *isolate* it (hide the rest).
* **White-matter tracts** — overlay wires that run *beneath* the cortex connecting
  region centroids. Toggle them on, then filter to **all** tracts, only those
  touching the **selected region**, or only those **within a functional network**.
  Show/hide by connection type (commissural · association · local U-fibre ·
  projection), and tune **density**, **thickness**, **opacity**, and tract
  colouring. Make the gray matter glassy (◐ opacity) to see the wires underneath.
  The connectivity is *schematic* — inferred from region geometry and network
  labels as a teaching aid, **not** subject tractography.
* **Hover** any region to identify it; **click** to select and dim the others.
* Search + per-region show/hide; **Save PNG** of the 3-D view.
* Drag to orbit, scroll to zoom, shift-drag (or right-drag) to pan.

### One-time mesh bake

The Explore tab loads a single pre-baked bundle, `meshes/brain_bundle.json`. It
ships in the repo; regenerate it (e.g. after changing the meshes) with:

```
python build_brain_bundle.py
```

This normalizes the meshes, computes per-region centroids, and tags each region
with lobe / hemisphere / functional network. **Note:** the functional-network
assignment (AAL3 → Yeo-style) is *approximate* and curated by region name — edit
the `REGION_TAXONOMY` table in `build_brain_bundle.py` to refine it (the build
fails if any region is left unmapped).

> **`meshes/brain_bundle.json` is the only mesh asset the viewer loads at
> runtime** (one ~6.8 MB `fetch`). The 160 `meshes/*.obj` files are *build
> inputs*, not runtime assets — they're generated by `aal3_to_obj.py`, baked into
> the bundle by `build_brain_bundle.py`, and read directly by the figure script
> `render_dexterity_brain_figures.py`. The browser never loads them, so they don't
> need to be served to use the app; keep them only if you intend to regenerate the
> bundle or render figures.

## fMRI tab (time-course playback)

The **fMRI** tab plays a *time × region* activation matrix back on the 3-D AAL3
brain: as you scrub or play, each region is recoloured by its activation at that
timepoint, so you watch different areas "light up" over the run.

* **Transport (the feeder control)** — Play / Pause (or the spacebar), a frame
  scrubber, a step-back-to-start button, a loop toggle, and a speed selector
  (2–16 TR/s). A live time readout shows the current TR and seconds.
* **Feeder / reference plot** — a trace docked under the render shows a reference
  signal with a moving playhead; click the plot to seek. By default it's the task
  design (dummy) or the global mean (uploaded data); tick **Feeder = selected
  region** to drive it from whichever region you click. The selected region's own
  time course is overlaid in gold.
* **Triple-slice strip** — below the 3-D render, a NiiVue **axial / sagittal /
  coronal** view (just like the Figure tab) shows the activation on real MNI152
  slices, recoloured every timepoint in step with the 3-D brain. Drag in the
  slices to move the crosshair. The 3-D meshes are AAL3 but the bundled slice
  volume is AAL(116), so activation is mapped onto the atlas by region name
  (≈108/116 regions match; a few AAL3-only parcels — orbital frontal splits,
  some thalamic/cingulate names — stay transparent and show bare anatomy).
* **Display** — choose a **Hot** (magnitude) or **Cool–warm** (signed) colour map,
  set an activation **threshold** (regions below it stay dark) and an **intensity**
  gain; a colour-scale legend reflects the current data range. These apply to both
  the 3-D render and the slices.
* **Bring your own data** — drop in an **activations CSV** (rows = timepoints,
  columns = regions; columns are matched to AAL3 regions by header name, or by
  order if there's no header and the count is 160) and/or a **feeder CSV** (one
  value per timepoint). A **Reset to dummy** button restores the built-in demo.

**Dummy data:** out of the box the tab shows a synthetic **block design** —
functional networks switch on in turn, each region following its network's
HRF-convolved boxcar with added noise, and the feeder is the task regressor. It's
a teaching/demo signal, not real fMRI.

---

Citations

If you use figures generated by this tool in a publication, please cite the
underlying atlases. Each atlas is the work of its original authors — this
viewer is only a thin visualization layer on top of NiiVue.

AAL — Automated Anatomical Labeling (116 regions, bundled by default)

> Tzourio-Mazoyer N, Landeau B, Papathanassiou D, Crivello F, Etard O,
> Delcroix N, Mazoyer B, Joliot M. (2002).
> Automated Anatomical Labeling of activations in SPM using a Macroscopic
> Anatomical Parcellation of the MNI MRI single-subject brain.
> NeuroImage 15(1):273–289. doi:[10.1006/nimg.2001.0978](https://doi.org/10.1006/nimg.2001.0978)

AAL3 — extended AAL (166 regions, optional swap-in)

> Rolls ET, Huang C-C, Lin C-P, Feng J, Joliot M. (2020).
> *Automated anatomical labelling atlas 3.*
> NeuroImage 206:116189. doi:[10.1016/j.neuroimage.2019.116189](https://doi.org/10.1016/j.neuroimage.2019.116189)

AICHA — Atlas of Intrinsic Connectivity of Homotopic Areas (192 regions)

> Joliot M, Jobard G, Naveau M, Delcroix N, Petit L, Zago L, Crivello F,
> Mellet E, Mazoyer B, Tzourio-Mazoyer N. (2015).
> *AICHA: An atlas of intrinsic connectivity of homotopic areas.*
> Journal of Neuroscience Methods 254:46–59.
> doi:[10.1016/j.jneumeth.2015.07.013](https://doi.org/10.1016/j.jneumeth.2015.07.013)

### JHU — Functional Connectivity Atlas (189 gray-matter parcels)

> Faria AV, Joel SE, Zhang Y, Oishi K, van Zijl PCM, Miller MI, Pekar JJ,
> Mori S. (2012).
> *Atlas-based analysis of resting-state functional connectivity:
> Evaluation for reproducibility and multi-modal anatomy-function
> correlation studies.*
> NeuroImage 61(3):613–621.
> doi:[10.1016/j.neuroimage.2012.03.078](https://doi.org/10.1016/j.neuroimage.2012.03.078)

*Note:* the "JHU" name is also used for the JHU-MNI DTI white-matter atlas
(Mori et al.). The atlas bundled here is the Faria 2012 functional /
gray-matter atlas; cite accordingly.

### CIT168 — Reinforcement Learning Atlas (16 subcortical nuclei)

> Pauli WM, Nili AN, Tyszka JM. (2018).
> *A high-resolution probabilistic in vivo atlas of human subcortical brain
> nuclei.*
> Scientific Data 5:180063. doi:[10.1038/sdata.2018.63](https://doi.org/10.1038/sdata.2018.63)

---

## Software acknowledgments

This viewer would not exist without two pieces of prior work:

NiiVue — Rorden C. et al.
WebGL2 medical-image viewer that does all the actual rendering here.
[niivue.com](https://niivue.com) · [github.com/niivue/niivue](https://github.com/niivue/niivue)
The [AAL atlas demo](https://niivue.com/demos/features/atlas.html) was
the direct reference for label-based volume rendering, hover-to-identify,
and the colormap-LUT pattern used throughout `index.html`.

Surf Ice — Rorden C.
3-D surface viewer. The bundled label-file conventions (per-atlas `.txt`
mapping region index → name) follow the format Surf Ice popularized, and
its atlas catalog informed which atlases this viewer ships labels for.
[nitrc.org/projects/surfice](https://www.nitrc.org/projects/surfice)

---

## Changelog

### 2026-06-30

A security- and robustness-hardening pass driven by a code audit (`issues.md`),
covering the server, the OBJ/bundle build, and the in-browser app. No user-facing
workflow changes; the app behaves the same but with the supply-chain, XSS, and
resource-leak risks closed. (The Explore-tab 3-D engine is **Three.js**, used
throughout this changelog.)

**Supply chain / offline (libraries now vendored locally)**

* Third-party libraries are no longer fetched from a public CDN at runtime. The
  exact pinned builds — NiiVue 0.69.0, Three.js 0.160.0, TensorFlow.js 4.22.0
  (core + WASM backend), and the brainchop `model5_gw_ae` model — are vendored
  under `vendor/` and served locally from `/vendor/`. The app now works offline
  and trusts no CDN code; the public CDNs remain only as a last-resort fallback.
* The brainchop model is pinned to an **immutable commit SHA**
  (`4c87885…`) instead of the mutable `@master` branch, so a push upstream can no
  longer silently swap the model/weights executed in your browser.
* `scripts/fetch_vendor.sh` reproduces `vendor/` from scratch; `vendor/SHA256SUMS`
  is an integrity manifest (`cd vendor && sha256sum -c SHA256SUMS`);
  `vendor/README.md` documents the pinned versions.

**Browser security (CSP + XSS)**

* Added a strict **Content-Security-Policy**: scripts run only from `'self'` (the
  vendored modules) plus the three first-party inline blocks allow-listed by
  SHA-256 hash — there is **no `unsafe-inline` for scripts**, so an injected
  inline script or `on*=` handler is refused. `object-src 'none'`, `base-uri
  'self'`. (`'unsafe-eval'` / `'wasm-unsafe-eval'` / `blob:` are retained because
  TensorFlow.js needs them.) `scripts/csp_hashes.py` recomputes/validates the
  hashes after any edit to an inline block.
* Replaced the region-list inline `on*=` handler strings (and the `window._tv` /
  `window._tc` shims) with delegated event listeners, and routed interpolated
  region names through a single `escapeHtml()` helper — including the uploaded
  T1 file name, the one genuinely user-controlled string reaching the UI.

**GPU resource lifecycle**

* Added `disposeObject3D()` (frees geometry, materials, and their textures) and
  routed the tract and connection-arc rebuilds through it — arc materials
  previously leaked on every rebuild, growing GPU memory over a long session.

**Error handling**

* The full-screen fatal-error overlay is now reserved for genuine *startup*
  failures. After the app is up, a stray unhandled promise rejection goes to the
  diagnostics log and a toast instead of blanking the working UI.

**Server (`server.py`)**

* Dropped the blanket `Access-Control-Allow-Origin: *` and added a `Host`-header
  allow-list, so other web pages / DNS-rebinding can no longer read local files
  cross-origin.
* Path handling for `/cache/` and `/labels/` now resolves the real path and
  rejects traversal (e.g. `/cache/../server.py`); project source, `.git`,
  `.claude`, and dotfiles are no longer servable.
* Atlas downloads are streamed to a temp file, **SHA-256-verified**, and only
  then moved into place; an existing cached file failing its checksum is
  re-downloaded. The server is now threaded (`ThreadingHTTPServer`) so concurrent
  range requests don't serialize.

**Build / data correctness + tests**

* `obj_utils.read_obj` now handles negative (relative) OBJ indices, bounds-checks
  every face index, and raises clear `file:line` errors on malformed input.
* `build_brain_bundle.py` replaces the substring-matched lobe/network rules with
  one explicit `REGION_TAXONOMY` table (order-independent) and **fails the build**
  if any region is unmapped; it also logs the parsed index set and flags the
  documented AAL3 gaps. Bundle output is byte-identical to before.
* Added the first test harness in the repo: `tests/test_obj_utils.py`
  (`python -m pytest`; dev deps in `requirements-dev.txt`).

### 2026-06-29

**Command-line imaging (`atlas_cli.py`, new)** — render brain images from the
terminal without a web session:

* `render` selected AAL3 regions (by name, `--lobe`, `--network`, `--hemi`) as
  3-D view PNGs or a `--figure` 4-panel publication layout, with per-region
  `--color`, slice planes, background, DPI, and title.
* `list` for region/lobe/network discovery (standard-library only).
* `favorites` save/list/show/render/delete/import — named patterns stored in
  `~/.atlas-viewer/favorites.json`.
* `--preset <file.json>` renders from an exported preset.
* New **Export CLI command** button in the Figure tab: build a pattern in the
  browser, then copy the equivalent `atlas_cli.py` command or download the preset
  JSON to regenerate it offline (or `favorites import` it).

**Refactor / de-duplication** — generic mesh/slice rendering primitives extracted
into a shared `brain_render.py` (used by both `atlas_cli.py` and
`render_dexterity_brain_figures.py`, which no longer carries its own copies);
the CLI reuses the lobe/network/hemisphere taxonomy from `build_brain_bundle.py`
rather than re-curating it.

### 2026-06-23

**White-matter tracts (Explore tab, new)** — a selectable connectome overlay that
draws wires *beneath* the gray matter, connecting AAL3 region centroids:

* **Tubes routed under the cortex** — each tract is a tube whose midpoint bows
  toward the brain interior, so it reads as a fibre running below the surface.
  Endpoints are anchored to the assembled-brain centroids and the wires fade out
  as the regions explode apart.
* **Four connection classes**, each toggleable and individually coloured:
  *commissural* (homotopic L↔R), *association* (long intra-network, same
  hemisphere), *local* U-fibres (short, same lobe), and *projection* (subcortical
  hub ↔ cortex). Generated client-side from the bundle's centroids + network /
  lobe / hemisphere labels — no rebuild of `brain_bundle.json` needed.
* **Show filters** — *all*, only tracts touching the **selected region**, or only
  tracts **within a chosen functional network**. Wires also respect region
  show/hide and group isolation.
* **Sliders** for density (how many wires), thickness, and opacity; **colour by**
  connection type / functional network / single colour.
* Honestly labelled as *schematic* connectivity (a teaching aid), **not** subject
  tractography — there's no DTI data in the app.

**fMRI tab (new)** — a third tab that plays a *time × region* activation matrix
back on the AAL3 brain, lighting up areas over time:

* **Its own Three.js scene** sharing the cached `brain_bundle.json` and Three.js
  import (refactored into a single `getBundle()` loader shared with Explore).
* **Transport / feeder control** — Play/Pause (spacebar), frame scrubber, restart,
  loop, and a 2–16 TR/s speed selector, with a TR/seconds readout.
* **Feeder / reference plot** docked under the render, with a moving playhead and
  click-to-seek; the selected region's time course is overlaid. The feeder can be
  the task design (dummy), the global mean, an uploaded signal, or the selected
  region.
* **Hot / cool–warm colour maps**, an activation threshold, an intensity gain, and
  a colour-scale legend.
* **User data** — load an activations CSV (columns matched to regions by name or
  order) and/or a feeder CSV; **Reset to dummy** restores the demo.
* **Dummy** is a synthetic block design (networks activate in turn, HRF-smoothed,
  noisy) so the tab is usable immediately — a teaching signal, not real fMRI.
* **Triple-slice strip** — a NiiVue axial/sagittal/coronal view under the 3-D
  render (like the Figure tab), showing the activation on MNI152 slices in sync
  with playback. The bundled volume is AAL(116) while the meshes are AAL3, so
  activation is name-mapped onto the atlas (≈108/116 regions; the rest stay
  transparent). NiiVue classes are exposed from the module via `window.NiivueLib`
  so the classic-script tab can build its own instance; failures degrade
  gracefully (the 3-D view keeps working).

### 2026-06-17

A session focused on adding gray-matter volume calculation (without FSL),
visualizing it, and hardening the app on machines without a GPU.

**Gray-matter volume (new)** — replaces the abandoned FSL approach with
in-browser, no-install tools (a new **Gray-matter volume** panel + results modal):

* **Region volumes (this atlas)** — pure-JS voxel tally of the loaded atlas:
  per-region volume in mm³/cm³, total GM, a sortable table, and CSV export.
  Works for AAL/JHU/AICHA/CIT168; reported in template (MNI) space.
* **Subject T1 → quick GM estimate** — drag in a T1 and segment GM/WM in the
  browser with brainchop's fast model (`model5_gw_ae`) on TensorFlow.js, then
  report GM / WM / total-brain cm³ (rough estimate, not FSL-FAST quality).
* **Segmentation overlay** — the conformed T1 loads into the viewer with the
  classified tissue shaded on top (GM orange, WM blue); adjust with the **Atlas
  opacity** slider or **Show atlas** toggle. A **Back to atlas view (MNI152)**
  button restores the template + atlas view.

**Robustness / works-anywhere**

* **Adaptive TF.js backend** — uses the GPU (WebGL) only on real hardware;
  otherwise falls back to WASM (CPU/SIMD) → CPU, so segmentation runs anywhere
  and never triggers the WebGL path that crashes software renderers.
* **3D render crash fixed** — selecting Medium/High illumination could throw an
  unhandled async rejection and blank the app; the call is now caught with a
  Matte fallback.
* **Software-WebGL handling** — on software/virtualized WebGL (e.g. SwiftShader),
  gradient illumination (Medium/High) renders blank and can crash the tab, so
  those options are detected and disabled with an explanatory hint.
* **Diagnostics / error log** — a global logger captures errors from startup, an
  environment snapshot (GPU vendor/renderer, active backend, etc.), and key
  events; the **Diagnostics / error log** button opens a viewer and exports a
  shareable `.txt`.

**UI fixes**

* Switching to JHU/AICHA/CIT168 (which ship no bundled NIfTI) now shows the bare
  MNI brain and prompts for a file instead of leaving the previous atlas visible.
* The Figure-tab sidebar now scrolls, so every settings panel is reachable on
  shorter windows.
* Added a **Show atlas** toggle (bare brain vs. atlased brain).
* Explore tab: **Whole** now snaps instantly to assembled while **Reassemble**
  animates (previously both did the same thing).

---

## License

The viewer code (`server.py`, `index.html`) is provided as-is for academic
and personal use. Atlas data and the NiiVue / Surf Ice software are
governed by their respective upstream licenses — please honor them.
