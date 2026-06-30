# Atlas Viewer — Architecture & Code Issues

Audit date: 2026-06-26. Scope: `server.py`, `build_brain_bundle.py`, `obj_utils.py`,
`index.html` (5,080 lines), with spot checks of the mesh/data assets.

Issues are ordered worst-first and grouped by category. Each entry lists the
**location**, the **problem**, **why it matters**, and a **suggested fix**.
Severity tags: 🔴 critical · 🟠 high · 🟡 medium · 🔵 low.

> Note: this is a localhost developer tool, which lowers (but does not remove) the
> impact of the web-security items — a malicious web page in the same browser, or
> a compromised CDN, is still a realistic threat model.

---

## A. Security

### A1. 🔴 Server exposes the entire project directory to any website (CORS `*`)
- **Where:** `server.py:116` (`directory=APP_DIR`), `server.py:225`
  (`Access-Control-Allow-Origin: *`), `server.py:235-237` (`do_OPTIONS`).
- **Problem:** The handler serves files rooted at `APP_DIR` and adds
  `Access-Control-Allow-Origin: *` to **every** response, with no `Origin` or
  `Host` validation. While the server runs, any web page open in the same browser
  can `fetch('http://localhost:8765/server.py')`, `/.git/config`,
  `/.claude/settings.local.json`, etc., and read the bytes cross-origin.
- **Why it matters:** Cross-origin data exfiltration of source, git history, and
  local config from a "convenience" server. Also vulnerable to DNS-rebinding so a
  remote attacker can reach the bound port.
- **Fix:**
  1. Drop the blanket `ACAO: *`. It is not needed for same-origin app loads. If
     CORS is genuinely required for some asset, scope it to specific paths and to
     `http://localhost:8765` only.
  2. Add a `Host` header allowlist check (reject anything but `localhost:8765` /
     `127.0.0.1:8765`) to blunt DNS rebinding.
  3. Restrict what is servable — see A2. Do **not** serve from the repo root that
     also contains `.git`, `.claude`, and source. Serve from a dedicated
     `static/` (or per-route) directory instead.

### A2. 🔴 `/cache/` and `/labels/` path validation is security theater
- **Where:** `server.py:140-150` (the `do_GET` existence checks).
- **Problem:** `fname = path[len("/cache/"):]` is never normalized. A request to
  `/cache/../server.py` produces `fname == "../server.py"`, whose
  `os.path.isfile(os.path.join(CACHE_DIR, fname))` resolves to `APP_DIR/server.py`
  and **passes** the check; the request then falls through to the base handler and
  is served. The check blocks nothing it appears to block.
- **Why it matters:** The guard gives a false sense of safety. (The base
  `translate_path` does prevent escaping `APP_DIR`, but everything inside
  `APP_DIR` is already servable — see A1 — so the net effect is wide-open.)
- **Fix:** After joining, call `os.path.realpath` and verify the result is still
  inside `CACHE_DIR` / `LABELS_DIR` with `os.path.commonpath`. Reject (403)
  otherwise. Better: maintain an explicit allowlist of servable subtrees and 404
  everything else, rather than relying on the base handler's default routing.

### A3. 🔴 No supply-chain integrity — every dependency is fetched live from public CDNs
- **Where:**
  - NiiVue: `index.html:1663-1667` (`unpkg`/`jsdelivr`, version `0.69.0`).
  - three.js: `index.html:3069-3070`.
  - brainchop model: `index.html:2373` — **pinned to `@master`** (mutable branch).
  - TensorFlow.js core + WASM backend injected as `<script>` at runtime:
    `index.html:2379-2387` (`loadScript`), `2396-2397`, `2416-2417`.
  - **Zero `integrity=` attributes anywhere** (0 matches in the file).
- **Problem:** A CDN compromise, an unpkg/jsdelivr hijack, or a single push to the
  brainchop `master` branch results in arbitrary code (or a swapped model)
  executing in the user's browser, silently. `@master` is non-reproducible by
  design.
- **Why it matters:** This is the highest-leverage remote-code path in the app.
- **Fix:**
  1. Pin brainchop to an immutable commit SHA, not `@master`.
  2. Add Subresource Integrity (`integrity=` + `crossorigin="anonymous"`) to every
     `<script type="module">`/CDN import. For dynamically `import()`ed modules and
     `loadScript`-injected scripts, SRI on dynamic imports is limited — prefer
     **vendoring** these libraries locally (serve from `static/vendor/`) so the
     app has no runtime CDN trust at all. This also fixes A5 (offline/availability).
  3. Pin exact versions for TF.js (already done via `TFJS_VER`, `2374`) and keep
     them in lockstep with a documented, audited SHA set.

### A4. 🟠 No Content-Security-Policy; unsafe-by-construction `innerHTML` + inline handlers
- **Where:**
  - No CSP header in `server.py` and no `<meta http-equiv="Content-Security-Policy">`.
  - 24 `innerHTML` assignment sites. Names interpolated unescaped, e.g.
    `index.html:1872` (`title="${r.name}">${r.name}`), `3539`
    (`title="${r.meta.displayName}">${r.meta.displayName}`), `3590`
    (`${meta.name} · region #${meta.index}`), `3953`/`3970` (connection editor),
    `2366`/`2604` (volume tables).
  - Inline event-handler strings forced by the `innerHTML` pattern: `1865-1870`
    (`onchange="_tv(...)" oninput="_tc(...)"`), with `window._tv`/`window._tc`
    shims at `1877`/`1894`.
- **Problem:** Region/display names are injected raw into both HTML and inline JS.
  Today the names come from bundled label files (`labels/*.txt`) and the baked
  bundle, so it is "safe by data provenance." But the architecture *requires*
  unsafe interpolation, and there are user-supplied data paths that can feed these
  sinks: uploaded atlas NIfTIs (`fileJHU`/`fileAICHA`/`fileCIT168`, `index.html:1058-1072`),
  the T1 upload (`1182`), and the activation CSV (`fmActFile`, `1447`, handler
  `4708`). If any user-controlled string reaches a name field, it is stored XSS.
- **Why it matters:** One feature change away from real script injection, with no
  CSP backstop.
- **Fix:**
  1. Add a strict CSP (no `unsafe-inline` for scripts; this requires removing the
     inline `on*=` handlers).
  2. Replace `innerHTML` string-building with DOM construction
     (`document.createElement` + `textContent`) or escape all interpolated values
     through a single `escapeHtml()` helper.
  3. Replace inline `onchange`/`oninput` handlers with delegated
     `addEventListener` bound by `data-idx` (the codebase already uses delegation
     for the region list at `4092` — extend that pattern and delete the
     `window._tv`/`_tc` shims).

### A5. 🟡 App is non-functional offline / when a CDN is down or rate-limited
- **Where:** Same CDN dependencies as A3.
- **Problem:** First load requires unpkg/jsdelivr to be reachable and honest. The
  CDN fallback loop (`importNiivue`, `1669-1680`) only swaps between public CDNs;
  there is no local fallback. A library load failure surfaces as a fatal overlay.
- **Fix:** Vendor libraries locally (covered by A3.2). The Python server can fetch
  them once into `static/vendor/` the same way it prefetches NIfTI files.

---

## B. Architecture & maintainability

### B1. 🟠 5,080-line single `index.html`, ~68 globals, three coupled `<script>` blocks, no tests
- **Where:** `index.html:1609` (classic), `1658` (`type="module"`), `2824`
  (classic). Cross-script coupling via `window.*`: `window.NiivueLib` (`1689`),
  `window.diag` (`1634`), `window._tv`/`_tc` (`1877`/`1894`). ~68 top-level
  `let/const/var/window.` declarations.
- **Problem:** One ES module and two classic scripts communicate through globals.
  State is global and mutable across the three tabs (figure / explore / fmri).
  There is no build step, no module boundaries, and **no tests** in the repo.
- **Why it matters:** This is the dominant structural weakness. The app cannot be
  unit-tested, and any refactor is high-risk because state ownership is implicit.
- **Fix (incremental, not a rewrite):**
  1. Introduce a bundler (Vite/esbuild) and split into ES modules: `niivue-view`,
     `explore`, `fmri`, `labels`, `colors`, `diag`. Import instead of `window.*`.
  2. Encapsulate per-tab state in objects/classes rather than file-level globals.
  3. Add a test harness (Vitest) and start with pure functions: `parseSpace`,
     `parsePipe` (`1696`/`1707`), color utils (`1726`), the OBJ/bundle decoders.

### B2. 🟠 Up to four WebGL contexts; none released on tab switch
- **Where:** NiiVue renderer (`new Niivue(...)`, `index.html:2673`); Explore main
  renderer (`new THREE.WebGLRenderer`, `3276`); Explore gizmo renderer (`3376`);
  fMRI renderer (`4256`). Plus the optional TF.js WebGL backend (`2410`/`2424`).
  `switchTab` (`2828-2840`) pauses the RAF loops but never disposes contexts;
  re-entering a tab calls `startAnim()`/`fmriStartAnim()` without teardown.
- **Problem:** Each tab keeps its own live GL context once visited. With the TF.js
  WebGL backend that is up to 5 contexts. Browsers cap live contexts (~8-16) and
  do not guarantee reclamation; nothing calls `renderer.dispose()` /
  `forceContextLoss()` on hide.
- **Why it matters:** Risk of `CONTEXT_LOST` and steady GPU-memory growth in long
  sessions, especially after repeated atlas reloads/segmentations.
- **Good news:** Both three.js loops are dirty-flag gated (`needsRender` at `4206`,
  `F.need` at `4841`) and `switchTab` pauses them, so idle CPU is fine.
- **Fix:** On tab hide, stop the loop (already done) **and** release GPU resources
  for tabs unlikely to be revisited soon: `renderer.dispose()` and, if needed,
  `renderer.forceContextLoss()`, recreating lazily on return. Prefer reusing a
  single renderer/context across the explore main + gizmo if feasible.

### B3. 🟡 Incomplete GPU resource lifecycle (geometry/material/texture leaks)
- **Where:** Only 6 `dispose()` sites: `index.html:2491`, `3169`, `3750`, `3814`,
  `3885`, `3913`. The bundle build creates ~160 `BufferGeometry` objects
  (`3296-3297`, `4269-4270`).
- **Problem:** Atlas switches, re-segmentation, and bundle re-init paths do not
  obviously dispose the geometries/materials/textures they replace. The fMRI scene
  (`4256+`) and explore scene each allocate many meshes.
- **Fix:** Audit every place that replaces scene contents or rebuilds geometry and
  ensure the old `geometry`/`material`/`texture` are disposed first. Add a small
  `disposeObject3D(root)` helper (the traverse at `3814` is a start) and call it on
  every rebuild.

---

## C. Data & correctness

### C1. 🟠 Functional-network / lobe taxonomy is hand-curated guesswork shown as fact
- **Where:** `build_brain_bundle.py:41-62` (`LOBE_RULES`, substring match,
  first-match-wins), `69-103` (`NETWORK_MAP`, explicitly "APPROXIMATE"),
  consumed/displayed in the Learn panel (`index.html:3577-3590`) and Explore
  grouping (`3418`, `3519`).
- **Problem:**
  - Lobe assignment is **substring `in` matching with order dependence**
    (`lobe_for`, `106-110`). The rule `("ACC", "Limbic")` matches *any* base name
    containing `ACC`; reordering the list silently changes results.
  - The network map is a best-effort AAL3→Yeo curation with debatable calls, e.g.
    `Temporal_Sup → Somatomotor` (`78`), `Frontal_Inf_Orb_2 → Limbic` (`85`).
  - A future mesh-name change silently produces `"Other"` or a wrong category with
    no error.
- **Why it matters:** Users see these as anatomical/functional truth in the UI.
- **Fix:**
  1. Replace substring matching with an explicit, exhaustive `name → {lobe,
     network}` table keyed by the canonical AAL3 base name (no `in`/ordering).
  2. Add a build-time assertion that **every** mesh maps to a known lobe and
     network; fail the build on `"Other"` (the script already collects `unmapped`
     at `186`/`233` — make it fatal, or at least exit non-zero).
  3. Surface the "approximate" caveat in the UI, not just the bundle meta (`220`).

### C2. 🟠 OBJ parser silently corrupts on valid-but-unusual input
- **Where:** `obj_utils.py:35-60` (`read_obj`).
- **Problems:**
  - **Negative (relative) OBJ indices not handled:** `int("-1") - 1 == -2`
    (`line 56`). Relative-index OBJ files produce wrong geometry with no error.
  - **No bounds checking:** out-of-range face indices are accepted and only blow up
    later (or wrap, in numpy).
  - `split()[:4]` (`51`) assumes exactly `v x y z`; a `v x y z w` line silently
    drops `w` (usually fine) but a malformed line throws an opaque `ValueError`.
  - Fan triangulation (`58-59`) assumes convex, planar n-gons.
- **Fix:** Handle negative indices relative to the current vertex count; validate
  index ranges and raise a clear error with file + line number; document the
  convex-n-gon assumption. Add unit tests with tri/quad/n-gon/negative-index
  fixtures.

### C3. 🟡 Sparse, asymmetric mesh indices can break "contiguous 1..N" assumptions
- **Where:** `meshes/*.obj`. Confirmed gaps before indices **037, 083, 135, 161,
  169**; `159_VTA_L` has no `_R`; `169_Raphe_D` is solo. Build globs and parses
  `int(head)` (`build_brain_bundle.py:181`), which is fine.
- **Problem:** Any downstream code (viewer colormap indexing, array sizing) that
  assumes dense `1..N` region indices will mis-map or index out of bounds.
- **Fix:** Confirm the viewer keys regions by `index` (map/dict), never by array
  position. Add a sanity check/log of the index set at load. Document the expected
  gaps so they aren't mistaken for missing files.

---

## D. Server robustness

### D1. 🟠 Single-threaded `HTTPServer` serializes all asset requests
- **Where:** `server.py:12` (import), `server.py:256`
  (`HTTPServer(("localhost", PORT), AtlasHandler)`).
- **Problem:** NiiVue fires many concurrent Range requests alongside the 6.5 MB
  bundle and per-mesh loads. A single-threaded server processes one at a time; a
  slow or stuck Range stream blocks every other asset.
- **Why it matters:** The app's whole job is parallel asset loading; this directly
  hurts perceived performance and can stall the UI.
- **Fix:** Use `http.server.ThreadingHTTPServer` (drop-in). Confirm the
  `_RangeFileWrapper` / file handles are per-request (they are) so threading is
  safe.

### D2. 🟡 Downloaded NIfTI files have no integrity check and are cached indefinitely
- **Where:** `server.py:28-66` (`download_with_progress` / `prefetch_atlas_files`);
  cache policy `max-age=3600` at `server.py:121-123`.
- **Problem:** Files from `raw.githubusercontent` (`server.py:21-25`) are trusted
  with no checksum. A corrupted/truncated/compromised response is cached and reused
  forever (the file-existence check at `52` never re-validates content). Bundle
  regeneration also serves stale-for-an-hour to browsers because asset URLs carry
  no content hash.
- **Fix:** Record and verify a SHA-256 for each known atlas file before accepting
  it; re-download on mismatch. For app-generated assets (`brain_bundle.json`,
  meshes), add a content-hash query string or `ETag`/`Last-Modified` revalidation
  so updates aren't masked by `max-age`.

### D3. 🔵 Whole-file buffering during download
- **Where:** `server.py:33-45` (`bytearray` accumulates the full body, then writes).
- **Problem:** Fine at current sizes (≤ ~4 MB), but unbounded for larger atlases;
  also writes only after a complete read, so the on-disk file is all-or-nothing
  (acceptable, but worth noting alongside D2's missing checksum).
- **Fix:** Stream to a `.part` temp file and `os.replace` on success; verify
  checksum before the rename.

---

## E. Error handling & UX

### E1. 🟡 Global `unhandledrejection` replaces the whole UI with a fatal overlay
- **Where:** `index.html:1651-1655` → `showFatalError` (`1614-1630`).
- **Problem:** Any uncaught promise rejection — including benign/optional async
  paths — nukes the app to a fatal error screen. Meanwhile other failures are
  silently swallowed (`loadBcLabels` catch at `2442`, WASM backend load at `2421`,
  CDN fallback loops). Error handling is inconsistent: some failures vanish, others
  are catastrophic.
- **Fix:** Reserve `showFatalError` for genuinely unrecoverable startup failures
  (e.g. NiiVue import). Route non-fatal rejections to a toast + the `diag` ring
  buffer (`1633-1645`) instead of the full-screen overlay. Audit `async` paths to
  ensure optional features fail soft.

### E2. 🔵 Diagnostics are in-memory only (1000-entry ring buffer)
- **Where:** `index.html:1633-1645` (`window.__diag`, capped at 1000).
- **Problem:** No way to export logs when reporting a bug; oldest entries are
  dropped silently.
- **Fix:** Add a "copy/download diagnostics" action that serializes `__diag`
  (and `_segBackend`, library versions) to clipboard/file.

---

## Suggested order of attack
1. **A1 + A2 + D1** — small, high-value `server.py` changes (CORS/host lock-down,
   real path validation, threading).
2. **A3 + A5** — pin brainchop to a SHA, vendor libraries locally, add SRI.
3. **A4** — escape interpolated names + delegated handlers + CSP (depends on
   removing inline `on*=`).
4. **C1 + C2** — make the build assert full taxonomy coverage; harden the OBJ
   parser; add the first unit tests.
5. **B2 + B3** — GPU context/resource disposal on tab switch and rebuild.
6. **B1** — the modularization/build-step refactor (largest effort; do last,
   incrementally, behind the new test harness).
