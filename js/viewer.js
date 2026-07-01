// ═══════════════════════════════════════════════════════════════════════
//  ATLAS VIEWER — main module
//
//  Extracted from the former inline <script type="module"> in index.html.
//  Pure helpers now live in sibling ES modules and are imported below;
//  cross-tab sharing with the Explore/fMRI classic script remains via the
//  documented window.* contract (window.NiivueLib, window.diag, etc.).
// ═══════════════════════════════════════════════════════════════════════
import { importNiivue }                       from './niivue-loader.js'
import { parseSpace, parsePipe }              from './label-parsers.js'
import { hsl2rgb, genColors, rgb2hex, hex2rgb } from './color-utils.js'

// Diagnostics logger (defined in the early classic script as window.diag)
const diag = (level, ...args) => (window.diag ? window.diag(level, ...args) : console.log(level, ...args))

const { Niivue, SHOW_RENDER, NVImage } = await importNiivue()
diag('info', 'NiiVue module loaded')
// Expose to the classic-script tabs (the fMRI slice strip builds its own Niivue).
window.NiivueLib = { Niivue, NVImage, SHOW_RENDER }
// ═══════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════
let nv           = null
let regions      = []   // { index, name, short?, category?, color:[r,g,b], visible:bool }
let atlasLut     = null // live reference to NiiVue LUT array
let currentKey   = 'aal'
let hoverIdx     = -1
let searchTerm   = ''
let figureMode   = false

// ═══════════════════════════════════════════════════════════════════════
//  NIIVUE COLORMAP
//
//  NiiVue's cmapper.makeLabelLut expects parallel arrays:
//    { R, G, B, A, I, labels }   (NOT a packed LUT)
//
//  R[i] / G[i] / B[i] / A[i] gives the colour of label I[i].
// ═══════════════════════════════════════════════════════════════════════
function buildColormap() {
  const R = [0], G = [0], B = [0], A = [0], I = [0]
  const labels = ['Background']
  for (const r of regions) {
    if (r.index === 0) continue        // index 0 reserved for background
    R.push(r.color[0])
    G.push(r.color[1])
    B.push(r.color[2])
    A.push(r.visible ? 255 : 0)
    I.push(r.index)
    labels.push(r.name)
  }
  return { R, G, B, A, I, labels }
}

// Push current `regions` state to NiiVue and re-upload to GPU.
// Cheap to call (≤192 regions × a few math ops), so we use it for every
// update path — bulk buttons, checkboxes, swatches alike.
function applyColormap() {
  if (!nv || nv.volumes.length < 2) return
  nv.volumes[1].setColormapLabel(buildColormap())
  atlasLut = nv.volumes[1].colormapLabel.lut
  nv.updateGLVolume()
}

// ═══════════════════════════════════════════════════════════════════════
//  SELECTION HELPERS
// ═══════════════════════════════════════════════════════════════════════
function selectAll(vis) {
  for (const r of regions) r.visible = vis
  applyColormap()
  renderList()
}

function invertSel() {
  for (const r of regions) r.visible = !r.visible
  applyColormap()
  renderList()
}

function randomColors() {
  const c = genColors(regions.length)
  regions.forEach((r, i) => { r.color = c[i] })
  applyColormap()
  renderList()
}

// ═══════════════════════════════════════════════════════════════════════
//  REGION LIST RENDER
// ═══════════════════════════════════════════════════════════════════════
function renderList() {
  const listEl  = document.getElementById('regionList')
  const countEl = document.getElementById('rpCount')
  const q       = searchTerm.toLowerCase()
  const shown   = q ? regions.filter(r => r.name.toLowerCase().includes(q)) : regions
  const vis     = regions.filter(r => r.visible).length

  countEl.textContent =
    `${vis} / ${regions.length} visible` +
    (q ? ` — ${shown.length} matching "${q}"` : '')

  if (!shown.length) {
    listEl.innerHTML = '<div class="empty-state">No matching regions</div>'
    return
  }

  // For JHU atlas, group by category
  const useGroups = currentKey === 'jhu' && shown.some(r => r.category)
  let html = ''

  if (useGroups) {
    const catNames = { 1: 'Cortical', 2: 'Subcortical', 3: 'CSF / Ventricles' }
    const cats = [1, 2, 3]
    for (const cat of cats) {
      const grp = shown.filter(r => (r.category ?? 1) === cat)
      if (!grp.length) continue
      html += `<div class="region-group-hdr">${catNames[cat] ?? cat}</div>`
      html += grp.map(r => regionRow(r)).join('')
    }
  } else {
    html = shown.map(r => regionRow(r)).join('')
  }

  listEl.innerHTML = html
}

function regionRow(r) {
  const hov = r.index === hoverIdx ? ' hovered' : ''
  const hexColor = rgb2hex(r.color)           // controlled hex string
  const name = escapeHtml(r.name)             // region name may come from uploaded data
  return `<div class="region-item${hov}" data-idx="${r.index}">
    <input type="checkbox" class="r-vis" ${r.visible ? 'checked' : ''}>
    <div class="swatch-wrap" style="background:${hexColor}">
      <input type="color" class="r-col" value="${hexColor}">
    </div>
    <span class="r-name ${r.visible ? '' : 'off'}" title="${name}">${name}</span>
  </div>`
}

// Region-list interactions via event delegation (replaces the old inline
// on*= handler strings + window._tv/_tc shims, so a CSP without unsafe-inline
// can hold — issues.md A4).
function setRegionVisible(idx, vis) {
  const r = regions.find(r => r.index === idx)
  if (!r) return
  r.visible = vis
  applyColormap()
  const nameEl = document.querySelector(`[data-idx="${idx}"] .r-name`)
  if (nameEl) nameEl.classList.toggle('off', !vis)
  document.getElementById('rpCount').textContent =
    `${regions.filter(r => r.visible).length} / ${regions.length} visible`
}

// A colour drag fires 'input' per pixel, and each applyColormap() re-uploads the
// LUT to the GPU (updateGLVolume). Update the colour state + swatch synchronously,
// but coalesce the GPU upload to one per animation frame.
let _tcRaf = 0
function setRegionColor(idx, hex) {
  const r = regions.find(r => r.index === idx)
  if (!r) return
  r.color = hex2rgb(hex)
  const sw = document.querySelector(`[data-idx="${idx}"] .swatch-wrap`)
  if (sw) sw.style.background = hex
  if (!_tcRaf) _tcRaf = requestAnimationFrame(() => { _tcRaf = 0; applyColormap() })
}

;(function wireRegionList() {
  const listEl = document.getElementById('regionList')
  if (!listEl) return
  listEl.addEventListener('change', e => {
    const item = e.target.closest('[data-idx]'); if (!item) return
    const idx = +item.dataset.idx
    if (e.target.classList.contains('r-vis')) setRegionVisible(idx, e.target.checked)
    else if (e.target.classList.contains('r-col')) setRegionColor(idx, e.target.value)
  })
  listEl.addEventListener('input', e => {
    if (!e.target.classList.contains('r-col')) return
    const item = e.target.closest('[data-idx]'); if (!item) return
    setRegionColor(+item.dataset.idx, e.target.value)
  })
})()

// ═══════════════════════════════════════════════════════════════════════
//  ATLAS LOADING
// ═══════════════════════════════════════════════════════════════════════
const MNI_URL = './cache/mni152.nii.gz'

const ATLAS_META = {
  aal: {
    name:       'AAL',
    volumeURL:  './cache/aal.nii.gz',
    labelPath:  './labels/aal.txt',
    parser:     parseSpace,
  },
  jhu: {
    name:       'JHU',
    volumeURL:  null,
    labelPath:  './labels/jhu.txt',
    parser:     parsePipe,
  },
  aicha: {
    name:       'AICHA',
    volumeURL:  null,
    labelPath:  './labels/AICHAhr.txt',
    parser:     parseSpace,
  },
  cit168: {
    name:       'CIT168',
    volumeURL:  null,
    labelPath:  './labels/CIT168.txt',
    parser:     parseSpace,
  },
}

function showLoading(msg) {
  document.getElementById('loadingMsg').textContent = msg
  document.getElementById('loadingOverlay').classList.add('active')
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active')
}

async function loadAtlas(key, userFile = null) {
  const meta = ATLAS_META[key]
  if (!meta) return

  showLoading(`Loading ${meta.name}…`)
  currentKey = key

  try {
    // 1. Fetch label file from local server (/labels/)
    const resp = await fetch(meta.labelPath)
    if (!resp.ok) throw new Error(`Label fetch failed (${resp.status}) — is server.py running?`)
    const text = await resp.text()
    const parsed = meta.parser(text)
    if (!parsed.length) throw new Error('No regions parsed from label file')

    // 2. Assign colors
    const colors = genColors(parsed.length)
    regions = parsed.map((r, i) => ({ ...r, color: colors[i], visible: true }))

    // 3. Resolve volume source
    const volURL  = meta.volumeURL || null
    const volFile = userFile || null
    if (!volURL && !volFile) {
      // This atlas ships no NIfTI (JHU/AICHA/CIT168 need a user file). Drop any
      // previously-loaded atlas overlay and show the bare MNI template, so it's
      // clear the atlas changed rather than silently leaving the old one up.
      await nv.loadVolumes([ { url: MNI_URL } ])
      calibrateSliceSliders()
      hideLoading()
      toast(`Select a ${meta.name} NIfTI file above to continue`, 'info')
      document.getElementById('regionList').innerHTML =
        '<div class="empty-state">Load a NIfTI file to display this atlas</div>'
      document.getElementById('rpCount').textContent = `${regions.length} regions (no volume loaded)`
      renderList()
      return
    }

    // 4. Load volumes
    showLoading(`Fetching ${meta.name} volume…`)
    const volEntry = volFile
      ? { url: URL.createObjectURL(volFile), name: volFile.name }
      : { url: volURL }

    await nv.loadVolumes([ { url: MNI_URL }, volEntry ])

    // 5. Install colormap (proper R/G/B/A/I format)
    applyColormap()

    // 6. Restore display settings
    syncDisplayControls()

    // 7. Default 3D angle + slice-slider calibration
    nv.setRenderAzimuthElevation(290, 30)
    calibrateSliceSliders()

    renderList()
    diag('info', 'atlas loaded', meta.name, regions.length + ' regions')
    toast(`${meta.name}: ${regions.length} regions loaded`)

  } catch (err) {
    diag('error', 'atlas load failed', key, err)
    toast(err.message, 'err')
    document.getElementById('regionList').innerHTML =
      `<div class="empty-state">Error: ${err.message}</div>`
  } finally {
    hideLoading()
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  DISPLAY CONTROLS
// ═══════════════════════════════════════════════════════════════════════
// Atlas overlay opacity, gated by the "Show atlas" toggle (0 = bare brain).
function applyAtlasVisibility() {
  if (!nv || nv.volumes.length < 2) return
  const on = document.getElementById('chkShowAtlas').checked
  const op = +document.getElementById('slAtlasOpacity').value / 100
  nv.setOpacity(1, on ? op : 0)
}

// nv.setVolumeRenderIllumination is async and can throw on the GPU when gradient
// illumination is enabled (value > 0). Left uncaught it becomes an unhandled
// rejection → the global handler shows the fatal-error overlay (looks like a crash).
// Catch it, warn, and fall back to Matte so the app stays usable.
async function setRenderIllumination(val) {
  if (!nv) return
  try {
    await nv.setVolumeRenderIllumination(val)
    nv.updateGLVolume()   // force the render tile to rebind the new shader/gradient
  } catch (e) {
    console.error('3D illumination failed', e)
    toast('3D illumination unavailable on this GPU — using Matte', 'err')
    const sel = document.getElementById('selRender')
    if (sel) sel.value = '0'
    try { await nv.setVolumeRenderIllumination(0); nv.updateGLVolume() } catch (_) { /* give up quietly */ }
  }
}

// Gradient illumination (Medium/High) renders to a 3D-texture framebuffer. That
// works on real GPUs but silently yields an all-zero gradient on software/
// virtualized WebGL (SwiftShader, llvmpipe, "Microsoft Basic Render"), which makes
// the 3D brain render blank. Detect those and disable the gradient modes.
function gradientRenderSupported() {
  try {
    const dbg = nv.gl.getExtension('WEBGL_debug_renderer_info')
    const r = (dbg ? (nv.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '').toLowerCase()
    if (!r) return true   // can't tell → allow
    return !/swiftshader|llvmpipe|softpipe|software|basic render|paravirtual|microsoft basic/.test(r)
  } catch (_) {
    return true
  }
}

// Disable the gradient render options when the GPU can't render them.
function gateRenderOptions() {
  if (gradientRenderSupported()) return
  const sel = document.getElementById('selRender')
  if (!sel) return
  for (const o of sel.options) {
    if (+o.value > 0) { o.disabled = true; o.text += ' (needs GPU)' }
  }
  if (+sel.value > 0) { sel.value = '0'; setRenderIllumination(0) }   // never start blank
  const hint = document.getElementById('renderHint')
  if (hint) hint.style.display = ''
  toast('Software WebGL detected (no GPU) — 3D illumination disabled. Enable hardware acceleration in your browser for full 3D.', 'err')
}

function syncDisplayControls() {
  if (!nv || nv.volumes.length < 2) return
  nv.setOpacity(0, +document.getElementById('slBgOpacity').value / 100)
  applyAtlasVisibility()
  nv.setAtlasOutline(+document.getElementById('selOutline').value)
  setRenderIllumination(+document.getElementById('selRender').value)   // self-catching
  nv.setInterpolation(document.getElementById('chkInterp').checked)
}

// ═══════════════════════════════════════════════════════════════════════
//  SLICE POSITION (X / Y / Z) CONTROLS
//
//  - Sliders push to nv.scene.crosshairPos (which determines the slice
//    shown in each 2-D view).
//  - onLocationChange (canvas click / drag) pushes back into sliders.
//  - Slider ranges are computed from the loaded volume's actual extents.
// ═══════════════════════════════════════════════════════════════════════
const _AX = ['X', 'Y', 'Z']
let _syncingFromCanvas = false   // re-entrancy guard

function calibrateSliceSliders() {
  if (!nv || nv.volumes.length === 0) return
  // Sample the 8 corners of the volume in fractional space and take
  // per-axis min/max of their mm positions.
  const cs = [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]]
  const mms = cs.map(c => nv.frac2mm(c))
  for (let a = 0; a < 3; a++) {
    const vs   = mms.map(m => m[a])
    const lo   = Math.floor(Math.min(...vs))
    const hi   = Math.ceil(Math.max(...vs))
    const slid = document.getElementById('sl' + _AX[a])
    slid.min = lo
    slid.max = hi
  }
  updateSlidersFromCrosshair()
}

function updateSlidersFromCrosshair() {
  if (!nv || nv.volumes.length === 0) return
  _syncingFromCanvas = true
  const mm = nv.frac2mm(nv.scene.crosshairPos)
  for (let a = 0; a < 3; a++) {
    const v = Math.round(mm[a])
    document.getElementById('sl' + _AX[a]).value     = v
    document.getElementById('rd' + _AX[a]).textContent = `${v} mm`
  }
  _syncingFromCanvas = false
}

function setSliceMM(axis, mmVal) {
  if (!nv || nv.volumes.length === 0) return
  const mm = nv.frac2mm(nv.scene.crosshairPos)
  mm[axis] = mmVal
  nv.scene.crosshairPos = nv.mm2frac(mm)
  nv.drawScene()
  document.getElementById('rd' + _AX[axis]).textContent = `${mmVal} mm`
  // mirror the actual displayed coordinates in the status bar
  const data = { string: `(${mm[0].toFixed(0)}, ${mm[1].toFixed(0)}, ${mm[2].toFixed(0)}) mm` }
  document.getElementById('locationLabel').textContent = data.string
}

function centerCrosshair() {
  if (!nv || nv.volumes.length === 0) return
  nv.scene.crosshairPos = nv.mm2frac([0, 0, 0])
  nv.drawScene()
  updateSlidersFromCrosshair()
}

// ═══════════════════════════════════════════════════════════════════════
//  HOVER TRACKING
// ═══════════════════════════════════════════════════════════════════════
function onMouseMove(e) {
  if (!nv || nv.volumes.length < 2) return
  const pos = nv.getNoPaddingNoBorderCanvasRelativeMousePosition(e, nv.gl.canvas)
  if (!pos) return
  const frac = nv.canvasPos2frac([pos.x * nv.uiData.dpr, pos.y * nv.uiData.dpr])
  if (frac[0] < 0) return
  const mm  = nv.frac2mm(frac)
  const vox = nv.volumes[1].mm2vox(mm)
  const idx = nv.volumes[1].getValue(vox[0], vox[1], vox[2])
  if (!isFinite(idx) || idx === hoverIdx) return

  hoverIdx = idx
  nv.opts.atlasActiveIndex = idx
  nv.updateGLVolume()

  const r = regions.find(r => r.index === idx)
  document.getElementById('hoverLabel').textContent =
    r ? `Region: ${r.name}` : (idx > 0 ? `Index: ${idx}` : 'Hover over brain')

  // Highlight matching row without full re-render
  document.querySelectorAll('.region-item.hovered')
    .forEach(el => el.classList.remove('hovered'))
  const row = document.querySelector(`.region-item[data-idx="${idx}"]`)
  if (row) {
    row.classList.add('hovered')
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

function onMouseLeave() {
  hoverIdx = -1
  document.getElementById('hoverLabel').textContent = 'Hover over brain to identify regions'
}

// ═══════════════════════════════════════════════════════════════════════
//  SCREENSHOT
// ═══════════════════════════════════════════════════════════════════════
function saveScreenshot() {
  if (!nv) return
  // Synchronously redraw then capture before browser can clear the buffer
  nv.drawScene()
  const canvas = document.getElementById('gl1')
  const url = canvas.toDataURL('image/png')
  if (!url || url.length < 200) {
    toast('Screenshot failed — try again', 'err')
    return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = `atlas_${currentKey}_${Date.now()}.png`
  a.click()
  toast('Screenshot saved')
}

// Capture the Figure (NiiVue) canvas at native resolution for the Collection panel.
// Synchronously redraws so the WebGL backbuffer is fresh before toDataURL reads it.
window.__captureFigure = function () {
  if (!nv) return null
  nv.drawScene()
  const url = document.getElementById('gl1').toDataURL('image/png')
  if (!url || url.length < 200) return null
  const meta = (typeof ATLAS_META !== 'undefined' && ATLAS_META[currentKey]) ? ATLAS_META[currentKey] : null
  return { url, tab: 'figure', label: 'Figure · ' + (meta ? meta.name : currentKey) }
}

// ═══════════════════════════════════════════════════════════════════════
//  FIGURE MODE  (hides crosshairs & status bar for clean capture)
// ═══════════════════════════════════════════════════════════════════════
function toggleFigureMode() {
  figureMode = !figureMode
  const btn = document.getElementById('btnFigureMode')

  if (figureMode) {
    btn.textContent = 'Figure mode (on)'
    btn.style.borderColor = 'var(--success)'
    document.getElementById('statusBar').style.display = 'none'
    if (nv) {
      nv.opts.crosshairWidth = 0
      nv.opts.isOrientCube = false
      nv.drawScene()
    }
  } else {
    btn.textContent = 'Figure mode'
    btn.style.borderColor = ''
    document.getElementById('statusBar').style.display = 'flex'
    if (nv) {
      nv.opts.crosshairWidth = document.getElementById('chkCrosshair').checked ? 1 : 0
      nv.opts.isOrientCube = true
      nv.drawScene()
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════════
let _toastTimer = null
function toast(msg, type = 'info') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = type === 'err' ? 'show err' : 'show'
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500)
}

// ═══════════════════════════════════════════════════════════════════════
//  GRAY-MATTER VOLUME CALCULATION
//  Part 1: per-region atlas volumes (pure JS, no dependency)
//  Part 2: subject T1 GM segmentation via brainchop fast model (TF.js)
// ═══════════════════════════════════════════════════════════════════════
let _vmCsv = null   // () => { filename, text }  for the active modal's CSV export

function openVolModal(title) {
  document.getElementById('vmTitle').textContent = title
  document.getElementById('volModal').classList.add('active')
}
function closeVolModal() {
  document.getElementById('volModal').classList.remove('active')
}
function setVmCsv(fn, label = 'Save CSV') {
  _vmCsv = fn
  const b = document.getElementById('vmCsv')
  b.style.display = fn ? '' : 'none'
  b.textContent = label
}
function saveVolCsv() {
  if (!_vmCsv) return
  const { filename, text } = _vmCsv()
  const blob = new Blob([text], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  toast('CSV saved')
}
// Compact cm³ formatting: big numbers need no decimals, small regions do
function fmtVol(cm3) {
  return cm3 >= 100 ? cm3.toFixed(0) : cm3 >= 10 ? cm3.toFixed(1) : cm3.toFixed(2)
}

// ── Part 1: atlas region volumes ───────────────────────────────────────
let _volRows = []
let _volSort = { key: 'cm3', dir: -1 }

function computeRegionVolumes() {
  if (!nv || nv.volumes.length < 2 || !nv.volumes[1].img) {
    toast('Load an atlas volume first', 'err'); return
  }
  const vol = nv.volumes[1]
  const img = vol.img
  // voxel volume (mm³) from the spatial pixDims (indices 1..3)
  const pd = vol.hdr?.pixDims || vol.pixDims || [0, 1, 1, 1]
  const voxMM3 = Math.abs(pd[1] * pd[2] * pd[3]) || 1

  // single pass over the label volume — never getValue() per voxel (millions)
  const counts = new Map()
  for (let i = 0; i < img.length; i++) {
    const idx = Math.round(img[i])
    if (idx > 0) counts.set(idx, (counts.get(idx) || 0) + 1)   // idx 0 = background
  }
  if (!counts.size) { toast('No labeled voxels found in atlas', 'err'); return }

  const byIndex = new Map(regions.map(r => [r.index, r]))
  _volRows = []
  let totVox = 0
  for (const [idx, n] of counts) {
    const r = byIndex.get(idx)
    _volRows.push({ name: r ? r.name : `Index ${idx}`, vox: n,
                    mm3: n * voxMM3, cm3: n * voxMM3 / 1000 })
    totVox += n
  }
  _volSort = { key: 'cm3', dir: -1 }
  const totCm3 = totVox * voxMM3 / 1000
  const meta = ATLAS_META[currentKey]

  document.getElementById('vmContent').innerHTML = `
    <div class="vm-sub">
      ${meta ? meta.name : currentKey} · ${_volRows.length} regions · voxel
      ${voxMM3.toFixed(2)} mm³. Volumes are in <b>template (MNI) space</b> — they
      describe the atlas, not a specific subject.
    </div>
    <div class="vm-summary">
      <div class="vm-stat"><div class="k">Total GM</div>
        <div class="v">${fmtVol(totCm3)} <span class="u">cm³</span></div></div>
      <div class="vm-stat"><div class="k">Regions</div>
        <div class="v">${_volRows.length}</div></div>
    </div>
    <div class="vm-body"><table class="vol-table">
      <thead><tr>
        <th data-k="name">Region</th><th data-k="vox">Voxels</th>
        <th data-k="mm3">mm³</th><th data-k="cm3">cm³</th>
      </tr></thead>
      <tbody id="vmTableBody"></tbody>
      <tfoot><tr class="total-row">
        <td>Total</td><td>${totVox.toLocaleString()}</td>
        <td>${(totVox * voxMM3).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        <td>${fmtVol(totCm3)}</td>
      </tr></tfoot>
    </table></div>`

  renderVolTableBody()
  document.querySelectorAll('#vmContent thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k
      if (_volSort.key === k) _volSort.dir *= -1
      else _volSort = { key: k, dir: k === 'name' ? 1 : -1 }
      renderVolTableBody()
    }
  })

  setVmCsv(() => ({
    filename: `region_volumes_${currentKey}.csv`,
    text: 'Region,Voxels,Volume_mm3,Volume_cm3\n' +
      _volRows.map(r => `"${r.name}",${r.vox},${r.mm3.toFixed(2)},${r.cm3.toFixed(4)}`).join('\n') +
      `\nTotal,${totVox},${(totVox * voxMM3).toFixed(2)},${totCm3.toFixed(4)}\n`,
  }))
  openVolModal('Region volumes')
}

function renderVolTableBody() {
  const k = _volSort.key, dir = _volSort.dir
  const rows = [..._volRows].sort((a, b) => {
    const va = a[k], vb = b[k]
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir
  })
  document.getElementById('vmTableBody').innerHTML = rows.map(r => `
    <tr><td>${escapeHtml(r.name)}</td><td>${r.vox.toLocaleString()}</td>
    <td>${r.mm3.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
    <td>${fmtVol(r.cm3)}</td></tr>`).join('')
}

// ── Part 2: subject GM segmentation (brainchop fast model) ─────────────
// model5_gw_ae: 256³×1 in → 3 classes out (0 bg / 1 white / 2 gray).
// Model + weights are vendored locally under /vendor/ (fetched at the pinned
// commit 4c87885 by scripts/fetch_vendor.sh), so no brainchop/CDN code or data
// is trusted at runtime (issues.md A3/A5).
const BC_MODEL_BASE = './vendor/brainchop/model5_gw_ae'
const TFJS_VER = '4.22.0'
let _tf = null, _bcModel = null, _segBusy = false
let _segBackend = 'n/a'   // which TF.js backend inference actually ran on
let _bcLabels = ['background', 'White Matter', 'Grey Matter']   // colormap3.json order

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = res
    s.onerror = () => rej(new Error('script load failed: ' + src))
    document.head.appendChild(s)
  })
}

// Adaptive backend: WebGL only on a real GPU (it crashes software renderers);
// otherwise WASM (CPU/SIMD) → plain CPU. This makes segmentation work anywhere.
async function loadTF() {
  if (_tf) return _tf
  diag('info', 'loadTF: loading TensorFlow.js core', TFJS_VER)
  if (!window.tf) {
    const urls = [
      `./vendor/tfjs/tf.min.js`,   // local vendored copy first (A3/A5)
      `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${TFJS_VER}/dist/tf.min.js`,
      `https://unpkg.com/@tensorflow/tfjs@${TFJS_VER}/dist/tf.min.js`,
    ]
    let ok = false, last
    for (const u of urls) {
      try { await loadScript(u); if (window.tf) { ok = true; break } }
      catch (e) { last = e; diag('error', 'TF core CDN failed', u, e) }
    }
    if (!ok) throw new Error('Could not load TensorFlow.js (' + (last?.message || last) + ')')
  }
  _tf = window.tf
  diag('info', 'TF.js core', _tf.version_core)

  const hw = gradientRenderSupported()   // true ⇒ real GPU
  const order = hw ? ['webgl', 'wasm', 'cpu'] : ['wasm', 'cpu']
  diag('info', 'backend preference', order.join(' > '), 'softwareGL=' + !hw)

  // Ensure the WASM backend is registered before we try to select it
  if (order.includes('wasm') && (!_tf.findBackend || !_tf.findBackend('wasm'))) {
    try {
      const wasmBase = './vendor/tfjs/'   // local vendored .wasm binaries (A3/A5)
      try { await loadScript(wasmBase + 'tf-backend-wasm.min.js') }
      catch (_) { await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_VER}/dist/tf-backend-wasm.min.js`) }
      if (_tf.wasm && _tf.wasm.setWasmPaths) _tf.wasm.setWasmPaths(wasmBase)
      else if (_tf.setWasmPaths) _tf.setWasmPaths(wasmBase)
      diag('info', 'WASM backend script loaded')
    } catch (e) { diag('error', 'WASM backend load failed', e) }
  }

  for (const b of order) {
    try {
      if (await _tf.setBackend(b)) { await _tf.ready(); _segBackend = b; break }
    } catch (e) { diag('error', `setBackend(${b}) failed`, e) }
  }
  if (_segBackend === 'n/a') { await _tf.ready(); _segBackend = _tf.getBackend() }
  diag('info', 'active TF backend', _segBackend)
  return _tf
}

async function loadBcModel() {
  if (!_bcModel) _bcModel = await _tf.loadLayersModel(BC_MODEL_BASE + '/model.json')
  return _bcModel
}
async function loadBcLabels() {
  try {
    const r = await fetch(BC_MODEL_BASE + '/colormap3.json')
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.labels)) _bcLabels = j.labels }
  } catch (e) { /* keep fallback labels */ }
}

async function runSegmentation(file) {
  if (_segBusy) return
  if (typeof nv.conform !== 'function') {
    toast('This NiiVue build lacks conform(); cannot segment', 'err'); return
  }
  _segBusy = true
  document.getElementById('btnSegment').disabled = true
  diag('info', 'segmentation start', file.name, file.size + ' bytes')
  try {
    showLoading('Reading T1…')
    const nvImg = await NVImage.loadFromFile({ file, name: file.name })

    // Conform to 256³, 1 mm isotropic, RAS+ — the space brainchop trains on,
    // and the reason each output voxel is exactly 1 mm³ (so count == mm³).
    showLoading('Conforming to 256³ (1 mm)…')
    // toRAS=true to match brainchop's training orientation; 256³ @ 1 mm are the defaults
    const conf = await nv.conform(nvImg, true)
    const src = conf.img
    const nvox = src.length

    // min–max intensity normalization to 0..1 (expected by the _ae model)
    showLoading('Preparing input…')
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < nvox; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v }
    const rng = (mx - mn) || 1
    const f = new Float32Array(nvox)
    for (let i = 0; i < nvox; i++) f[i] = (src[i] - mn) / rng

    showLoading('Loading segmentation model…')
    await loadTF()
    await loadBcModel()
    await loadBcLabels()

    const cpuMode = _segBackend !== 'webgl'
    showLoading(`Running segmentation (${_segBackend})…` + (cpuMode ? ' — CPU mode, this can take a while' : ''))
    diag('info', 'inference begin', 'backend=' + _segBackend, 'voxels=' + nvox)
    await new Promise(r => setTimeout(r, 30))   // let the overlay paint first

    const t0 = performance.now()
    const side = Math.round(Math.cbrt(nvox))     // 256
    const labelsT = _tf.tidy(() => {
      const input = _tf.tensor(f, [1, side, side, side, 1])
      const out = _bcModel.predict(input)
      return (Array.isArray(out) ? out[0] : out).argMax(-1)   // [1,s,s,s] class ids
    })
    const labData = await labelsT.data()
    labelsT.dispose()
    diag('info', 'inference done', Math.round(performance.now() - t0) + ' ms')

    const counts = {}
    for (let i = 0; i < labData.length; i++) { const c = labData[i]; counts[c] = (counts[c] || 0) + 1 }

    showLoading('Rendering segmentation…')
    displaySegmentation(conf, labData)
    hideLoading()
    showSegResults(counts, file.name)
  } catch (err) {
    hideLoading()
    diag('error', 'segmentation failed', 'backend=' + _segBackend, err)
    const oom = /memory|texture|webgl|out of|alloc/i.test(err.message || '')
    toast('Segmentation failed: ' + (err.message || err) +
          (oom ? ' (ran out of memory — see Diagnostics)' : ' — see Diagnostics'), 'err')
  } finally {
    _segBusy = false
    document.getElementById('btnSegment').disabled = false
  }
}

// Shading colors for the on-brain overlay (and the modal legend)
function segColorFor(name) {
  if (/gr[ae]y|(^|\W)gm(\W|$)/i.test(name)) return [255, 140, 0]   // GM — orange
  if (/white|(^|\W)wm(\W|$)/i.test(name))   return [74, 163, 255]  // WM — blue
  return [170, 170, 170]
}

// NiiVue label LUT (R/G/B/A/I) over the brainchop tissue classes
function buildSegLUT() {
  const R = [], G = [], B = [], A = [], I = [], labels = []
  for (let c = 0; c < _bcLabels.length; c++) {
    I.push(c); labels.push(_bcLabels[c] || `Class ${c}`)
    if (c === 0 || /background/i.test(_bcLabels[c] || '')) {
      R.push(0); G.push(0); B.push(0); A.push(0)        // class 0 transparent
    } else {
      const col = segColorFor(_bcLabels[c] || '')
      R.push(col[0]); G.push(col[1]); B.push(col[2]); A.push(255)
    }
  }
  return { R, G, B, A, I, labels }
}

// Replace the canvas with the conformed T1 + the GM/WM segmentation shaded on top
function displaySegmentation(conf, labData) {
  try {
    conf.colormap = 'gray'
    conf.opacity = 1

    // Label overlay sharing the T1 geometry
    const labVol = conf.clone()
    labVol.name = 'segmentation'
    const lab8 = new Uint8Array(labData.length)
    for (let i = 0; i < labData.length; i++) lab8[i] = labData[i]
    labVol.img = lab8

    ;[...nv.volumes].forEach(v => nv.removeVolume(v))   // drop MNI + atlas
    nv.addVolume(conf)
    nv.addVolume(labVol)
    labVol.setColormapLabel(buildSegLUT())             // mirror the atlas colormap path

    // Semi-transparent shading so the underlying brain stays visible
    document.getElementById('slAtlasOpacity').value = 60
    document.getElementById('chkShowAtlas').checked = true
    applyAtlasVisibility()
    document.getElementById('selOutline').value = '0'
    nv.setAtlasOutline(0)
    calibrateSliceSliders()
    nv.updateGLVolume()
    toast('Showing segmentation on your T1 — pick an atlas to return to template view')
  } catch (e) {
    console.error('overlay display failed', e)
    toast('Computed volumes, but could not render the overlay: ' + (e.message || e), 'err')
  }
}

function showSegResults(counts, fname) {
  const cm3 = v => v / 1000   // 1 mm³ voxels ⇒ cm³ = voxels / 1000
  let gmVox = 0, wmVox = 0, brainVox = 0
  const rows = []
  for (const c in counts) {
    const ci = +c
    const name = _bcLabels[ci] || `Class ${ci}`
    if (ci === 0 || /background/i.test(name)) continue
    const vox = counts[c]
    brainVox += vox
    if (/gr[ae]y|(^|\W)gm(\W|$)/i.test(name)) gmVox += vox
    else if (/white|(^|\W)wm(\W|$)/i.test(name)) wmVox += vox
    rows.push({ name, vox })
  }
  rows.sort((a, b) => b.vox - a.vox)

  document.getElementById('vmContent').innerHTML = `
    <div class="vm-sub">
      ${escapeHtml(fname)} · brainchop fast model (model5_gw_ae) · 1 mm³ voxels.
      <b>Rough estimate</b> from a quick, lower-accuracy model — not FSL-FAST quality.
      Nothing was uploaded; this ran locally on your GPU. The classified tissue is
      shaded on your T1 behind this dialog — adjust with the <b>Atlas opacity</b>
      slider or hide it with <b>Show atlas</b>.
    </div>
    <div class="vm-summary">
      <div class="vm-stat"><div class="k">Gray matter</div>
        <div class="v">${fmtVol(cm3(gmVox))} <span class="u">cm³</span></div></div>
      <div class="vm-stat"><div class="k">White matter</div>
        <div class="v">${fmtVol(cm3(wmVox))} <span class="u">cm³</span></div></div>
      <div class="vm-stat"><div class="k">Total brain</div>
        <div class="v">${fmtVol(cm3(brainVox))} <span class="u">cm³</span></div></div>
    </div>
    <div class="vm-body"><table class="vol-table">
      <thead><tr><th>Tissue</th><th>Voxels</th><th>cm³</th></tr></thead>
      <tbody>${rows.map(r =>
        `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;
          margin-right:7px;vertical-align:middle;background:rgb(${segColorFor(r.name).join(',')})"></span>${escapeHtml(r.name)}</td>
        <td>${r.vox.toLocaleString()}</td><td>${fmtVol(cm3(r.vox))}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr class="total-row">
        <td>Total brain</td><td>${brainVox.toLocaleString()}</td><td>${fmtVol(cm3(brainVox))}</td>
      </tr></tfoot>
    </table></div>`

  setVmCsv(() => ({
    filename: `gm_estimate_${fname.replace(/\.(nii|gz)+$/i, '')}.csv`,
    text: 'Tissue,Voxels,Volume_cm3\n' +
      rows.map(r => `"${r.name}",${r.vox},${cm3(r.vox).toFixed(2)}`).join('\n') +
      `\nTotal brain,${brainVox},${cm3(brainVox).toFixed(2)}\n`,
  }))
  openVolModal('Brain volume estimate (rough)')
}

// ═══════════════════════════════════════════════════════════════════════
//  DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════
function collectEnv() {
  const L = []
  L.push('Brain Atlas Viewer — diagnostics')
  L.push('Generated : ' + new Date().toISOString())
  L.push('URL       : ' + location.href)
  L.push('UserAgent : ' + navigator.userAgent)
  L.push('Platform  : ' + (navigator.platform || '?') + '  · cores ' + (navigator.hardwareConcurrency || '?') +
         '  · mem ' + (navigator.deviceMemory || '?') + 'GB')
  L.push('Viewport  : ' + innerWidth + 'x' + innerHeight + '  dpr ' + (devicePixelRatio || 1))
  try {
    const gl = nv && nv.gl
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      L.push('GL vendor : ' + (dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)))
      L.push('GL render : ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)))
      L.push('GL version: ' + gl.getParameter(gl.VERSION))
      L.push('Hardware GPU (heuristic): ' + gradientRenderSupported())
    } else { L.push('WebGL     : NiiVue not initialized') }
  } catch (e) { L.push('WebGL probe failed: ' + e) }
  L.push('NiiVue vols: ' + (nv ? nv.volumes.length : 'n/a') + '  · atlas ' + currentKey)
  L.push('TF.js     : ' + (window.tf ? window.tf.version_core : 'not loaded') + '  · backend ' + _segBackend)
  return L.join('\n')
}

function buildDiagnosticsReport() {
  const log = window.__diag || []
  const body = log.length
    ? log.map(e => `[${e.t}] ${String(e.level).toUpperCase()}: ${e.msg}`).join('\n')
    : '(no events logged)'
  return collectEnv() + '\n\n── Event log (' + log.length + ') ──\n' + body + '\n'
}

function showDiagnostics() {
  const report = buildDiagnosticsReport()
  document.getElementById('vmContent').innerHTML =
    '<div class="vm-sub">Environment and recent events. Click <b>Save log</b> to download a file you can share for debugging.</div>' +
    '<div class="vm-body"><pre style="margin:0;padding:12px 16px;font-size:11px;line-height:1.5;' +
    'white-space:pre-wrap;word-break:break-word;color:var(--text)">' +
    report.replace(/</g, '&lt;') + '</pre></div>'
  setVmCsv(() => ({ filename: `atlas_diagnostics_${Date.now()}.txt`, text: buildDiagnosticsReport() }), 'Save log')
  openVolModal('Diagnostics')
}

// ═══════════════════════════════════════════════════════════════════════
//  CLI EXPORT  — §4 of atlas_cli_spec: builds preset JSON + command string
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a preset object (spec §2) from the current Figure-tab state.
 * Reads: regions[], currentKey, slX/slY/slZ sliders, nv volumes.
 * @returns {Object} preset
 */
function buildFigurePreset() {
  const isAal = currentKey === 'aal' || currentKey === 'aal3'

  // Slice positions from MNI-mm sliders → voxel indices via the loaded atlas volume.
  // Only non-centre (non-zero mm) axes are exported; centre → null (CLI auto-selects).
  const mmX = parseInt(document.getElementById('slX').value, 10)
  const mmY = parseInt(document.getElementById('slY').value, 10)
  const mmZ = parseInt(document.getElementById('slZ').value, 10)

  let sliceX = null, sliceY = null, sliceZ = null
  if (nv && nv.volumes.length >= 2) {
    const vol = nv.volumes[1]
    if (typeof vol.mm2vox === 'function') {
      const vox = vol.mm2vox([mmX, mmY, mmZ])
      if (mmX !== 0) sliceX = Math.round(vox[0])
      if (mmY !== 0) sliceY = Math.round(vox[1])
      if (mmZ !== 0) sliceZ = Math.round(vox[2])
    }
  }

  /** @type {Object} */
  const preset = {
    version:    1,
    atlas:      currentKey,
    regions:    regions
      .filter(r => r.visible)
      .map(r => ({ name: r.name, color: rgb2hex(r.color) })),
    select:     { lobe: [], network: [], hemi: [] },
    views:      ['oblique'],
    figure:     true,
    slices:     { x: sliceX, y: sliceY, z: sliceZ },
    background: 'white',
    context:    true,
    dpi:        300,
    title:      null,
  }

  if (!isAal) preset.meshWarning = true

  return preset
}

/**
 * Convert a preset (§2) to the equivalent `python atlas_cli.py render …` string.
 * Format rules match the CLI's `preset_to_argv` (spec §4).
 * @param {Object} preset
 * @returns {string}
 */
function buildCliCommand(preset) {
  const parts = ['python atlas_cli.py render']
  parts.push(`--atlas ${preset.atlas}`)

  if (preset.regions.length > 0) {
    parts.push(`--regions ${preset.regions.map(r => r.name).join(',')}`)
    for (const r of preset.regions) {
      if (r.color) parts.push(`--color ${r.name}=${r.color}`)
    }
  }

  // --figure flag (no value) for the 4-panel layout
  parts.push('--figure')

  // Slice flags only when position is non-null (i.e. slider was moved off centre)
  if (preset.slices.x !== null) parts.push(`--slice-x ${preset.slices.x}`)
  if (preset.slices.y !== null) parts.push(`--slice-y ${preset.slices.y}`)
  if (preset.slices.z !== null) parts.push(`--slice-z ${preset.slices.z}`)

  parts.push(`--dpi ${preset.dpi ?? 300}`)
  parts.push('-o figure.png')

  return parts.join(' ')
}

function openCliModal() {
  const preset  = buildFigurePreset()
  const cmd     = buildCliCommand(preset)
  const jsonStr = JSON.stringify(preset, null, 2)

  document.getElementById('cliCmdText').value  = cmd
  document.getElementById('cliJsonText').value = jsonStr

  const showWarn = !!preset.meshWarning
  document.getElementById('cliWarnBanner').style.display  = showWarn ? '' : 'none'
  document.getElementById('cliAtlasNote').style.display   = showWarn ? '' : 'none'

  document.getElementById('cliModal').classList.add('active')
}

function closeCliModal() {
  document.getElementById('cliModal').classList.remove('active')
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════
async function init() {
  showLoading('Initializing NiiVue…')

  nv = new Niivue({
    show3Dcrosshair:  true,
    backColor:        [0, 0, 0, 1],
    isOrientCube:     true,   // L/R · A/P · S/I orientation cube on the 3D render
    onLocationChange: (data) => {
      document.getElementById('locationLabel').textContent = data.string
      if (!_syncingFromCanvas) updateSlidersFromCrosshair()
    },
    logging: false,
  })

  await nv.attachTo('gl1')

  nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS
  nv.opts.crosshairGap          = 10
  nv.opts.yoke3Dto2DZoom        = true
  nv.opts.dragMode              = nv.dragModes.pan
  nv.setMultiplanarPadPixels(6)

  // Disable gradient render modes if this GPU can't render them (avoids blank 3D)
  gateRenderOptions()
  diag('info', 'environment\n' + collectEnv())

  // ── Atlas selector ──────────────────────────────────────
  const atlasSelect = document.getElementById('atlasSelect')

  function showAtlasPanel(key) {
    ['aal', 'jhu', 'aicha', 'cit168'].forEach(k => {
      const el = document.getElementById(`panel-${k}`)
      if (el) el.style.display = k === key ? '' : 'none'
    })
  }

  atlasSelect.onchange = () => {
    const key = atlasSelect.value
    showAtlasPanel(key)
    if (key === 'aal') loadAtlas('aal')
    // For others, user must load a file first (or region list shows prompt)
    else loadAtlas(key)
  }

  // File inputs for atlases requiring local NIfTI
  document.getElementById('fileJHU').onchange   = e => { if (e.target.files[0]) loadAtlas('jhu',    e.target.files[0]) }
  document.getElementById('fileAICHA').onchange = e => { if (e.target.files[0]) loadAtlas('aicha',  e.target.files[0]) }
  document.getElementById('fileCIT168').onchange= e => { if (e.target.files[0]) loadAtlas('cit168', e.target.files[0]) }

  // ── Display controls ────────────────────────────────────
  document.getElementById('chkShowAtlas').onchange = () => applyAtlasVisibility()
  document.getElementById('slAtlasOpacity').oninput = () => {
    // Moving the slider implies you want the atlas visible
    document.getElementById('chkShowAtlas').checked = true
    applyAtlasVisibility()
  }
  document.getElementById('slBgOpacity').oninput = () => {
    if (nv.volumes.length > 0) nv.setOpacity(0, +document.getElementById('slBgOpacity').value / 100)
  }
  document.getElementById('selOutline').onchange = () => {
    nv.setAtlasOutline(+document.getElementById('selOutline').value)
  }
  document.getElementById('selRender').onchange = () => {
    setRenderIllumination(+document.getElementById('selRender').value)
  }
  document.getElementById('bgColor').oninput = () => {
    const h = document.getElementById('bgColor').value
    nv.opts.backColor = [
      parseInt(h.slice(1,3),16)/255,
      parseInt(h.slice(3,5),16)/255,
      parseInt(h.slice(5,7),16)/255,
      1,
    ]
    nv.drawScene()
  }
  document.getElementById('chkCrosshair').onchange = () => {
    if (!figureMode) {
      nv.opts.crosshairWidth = document.getElementById('chkCrosshair').checked ? 1 : 0
      nv.drawScene()
    }
  }
  document.getElementById('chkInterp').onchange = () => {
    nv.setInterpolation(document.getElementById('chkInterp').checked)
  }

  // ── Region panel actions ─────────────────────────────────
  document.getElementById('regionSearch').oninput = e => {
    searchTerm = e.target.value
    renderList()
  }
  document.getElementById('btnAll').onclick    = () => selectAll(true)
  document.getElementById('btnNone').onclick   = () => selectAll(false)
  document.getElementById('btnInvert').onclick = () => invertSel()
  document.getElementById('btnRandColors').onclick = () => randomColors()

  // ── Slice position sliders ───────────────────────────────
  for (let a = 0; a < 3; a++) {
    const sl = document.getElementById('sl' + _AX[a])
    sl.oninput = () => setSliceMM(a, parseInt(sl.value))
  }
  document.getElementById('btnCenter').onclick = () => centerCrosshair()

  // ── Viewer buttons ───────────────────────────────────────
  document.getElementById('btnScreenshot').onclick   = () => saveScreenshot()
  document.getElementById('btnFigureMode').onclick   = () => toggleFigureMode()

  // ── Volume calculation ───────────────────────────────────
  document.getElementById('btnRegionVol').onclick = () => computeRegionVolumes()
  document.getElementById('btnRestoreAtlas').onclick = () => {
    // Leave the segmentation view: restore the MNI152 + atlas display defaults
    // that displaySegmentation() overrode, then reload the current atlas.
    document.getElementById('slAtlasOpacity').value = 85
    document.getElementById('chkShowAtlas').checked = true
    document.getElementById('selOutline').value = '0.01'
    loadAtlas(currentKey)
  }
  const fileT1 = document.getElementById('fileT1')
  const btnSeg = document.getElementById('btnSegment')
  fileT1.onchange = () => { btnSeg.disabled = !fileT1.files.length }
  btnSeg.onclick  = () => { if (fileT1.files[0]) runSegmentation(fileT1.files[0]) }
  document.getElementById('vmClose').onclick = closeVolModal
  document.getElementById('vmDone').onclick  = closeVolModal
  document.getElementById('vmCsv').onclick   = saveVolCsv
  document.getElementById('btnDiag').onclick = () => showDiagnostics()
  document.getElementById('volModal').onclick = e => { if (e.target.id === 'volModal') closeVolModal() }

  // ── CLI Export ───────────────────────────────────────────
  document.getElementById('btnExportCli').addEventListener('click', openCliModal)
  document.getElementById('btnCliClose').addEventListener('click', closeCliModal)
  document.getElementById('cliModal').addEventListener('click', e => {
    if (e.target.id === 'cliModal') closeCliModal()
  })
  document.getElementById('btnCliCopyCmd').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cliCmdText').value)
      .then(() => toast('Command copied'))
      .catch(() => toast('Copy failed — select and copy manually', 'err'))
  })
  document.getElementById('btnCliCopyJson').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cliJsonText').value)
      .then(() => toast('JSON copied'))
      .catch(() => toast('Copy failed — select and copy manually', 'err'))
  })
  document.getElementById('btnCliDownload').addEventListener('click', () => {
    const json = document.getElementById('cliJsonText').value
    const blob = new Blob([json], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `atlas_preset_${currentKey}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Preset downloaded')
  })

  // ── Canvas events ────────────────────────────────────────
  const canvas = document.getElementById('gl1')
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseleave', onMouseLeave)

  // ── Resize observer ──────────────────────────────────────
  new ResizeObserver(() => { if (nv) nv.resizeListener() })
    .observe(document.getElementById('viewer'))

  // ── Load default atlas ───────────────────────────────────
  showAtlasPanel('aal')
  await loadAtlas('aal')
}

init().then(() => { window.__appReady = true }).catch(err => {
  console.error(err)
  document.getElementById('loadingMsg').textContent = `Failed: ${err.message}`
  document.getElementById('loadingOverlay').classList.add('active')
})
