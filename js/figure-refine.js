/* global FigureRefineCore */
// Figure Refinement tab — free-position/resize canvas for composing captured
// views (from the Collection panel) and text captions into a publication-
// ready multi-panel figure on a fixed-size page. No animation loop; purely
// DOM + a single export-time canvas render.
(function () {
  'use strict'

  const core = window.FigureRefineCore
  if (!core) {
    console.error('Refine tab disabled: js/figure-refine-core.js did not load')
    return
  }

  const BG_COLORS = { white: '#ffffff', dark: '#0d1117', transparent: null }

  const R = {
    uiReady: false,
    presetId: 'letter',
    pageW: core.PAGE_PRESETS.letter.w,
    pageH: core.PAGE_PRESETS.letter.h,
    background: 'white',
    snap: false,
    gridPx: 40,
    items: [],
    selectedId: null,
    nextZ: 1,
    drag: null,
  }

  const $ = id => document.getElementById(id)
  const genId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im); im.onerror = reject; im.src = src
    })
  }

  function toast(message, kind) {
    const el = $('frToast')
    el.textContent = message
    el.className = kind === 'err' ? 'modality-toast show err' : 'modality-toast show'
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3200)
  }

  // ── Page ──
  function applyPresetDimensions() {
    if (R.presetId === 'custom') {
      R.pageW = Math.max(200, parseInt($('frCustomW').value, 10) || 2000)
      R.pageH = Math.max(200, parseInt($('frCustomH').value, 10) || 2000)
    } else {
      const preset = core.PAGE_PRESETS[R.presetId]
      R.pageW = preset.w; R.pageH = preset.h
    }
    fixImageAspects()
  }

  // Panels store position/size as page fractions, so switching page presets
  // never needs to touch x/y/w — only an image's height fraction depends on
  // the page's own aspect ratio, since width and height fractions are each
  // relative to a different page dimension.
  function fixImageAspects() {
    R.items.forEach(it => {
      if (it.kind === 'image' && it.naturalW && it.naturalH) {
        it.h = it.w * (it.naturalH / it.naturalW) * (R.pageW / R.pageH)
      }
    })
  }

  function renderPage() {
    const page = $('frPage')
    page.style.aspectRatio = R.pageW + ' / ' + R.pageH
    page.classList.toggle('fr-transparent', R.background === 'transparent')
    page.style.background = R.background === 'transparent' ? '' : BG_COLORS[R.background]

    const overlay = $('frGridOverlay')
    overlay.classList.toggle('active', R.snap)
    if (R.snap) {
      overlay.style.backgroundSize = (R.gridPx / R.pageW * 100) + '% ' + (R.gridPx / R.pageH * 100) + '%'
    }

    const layer = $('frPanelsLayer')
    layer.innerHTML = ''
    ;[...R.items].sort((a, b) => a.z - b.z).forEach(it => layer.appendChild(buildPanel(it)))
    ensurePageObserver()
    updateTextFontSizes()
  }

  function positionPanel(el, it) {
    el.style.left = (it.x * 100) + '%'; el.style.top = (it.y * 100) + '%'
    el.style.width = (it.w * 100) + '%'; el.style.height = (it.h * 100) + '%'
  }

  function updatePanelStyle(it) {
    const el = document.querySelector('.fr-panel[data-id="' + it.id + '"]')
    if (el) positionPanel(el, it)
  }

  function buildPanel(it) {
    const el = document.createElement('div')
    el.className = 'fr-panel' + (it.kind === 'text' ? ' fr-text-panel' : '') + (it.id === R.selectedId ? ' selected' : '')
    el.dataset.id = it.id
    positionPanel(el, it)
    el.style.zIndex = it.z

    if (it.kind === 'image') {
      const img = document.createElement('img')
      img.src = it.src; img.draggable = false; img.alt = it.label
      el.appendChild(img)
      if (it.showLabel) {
        const badge = document.createElement('div')
        badge.className = 'fr-badge'; badge.contentEditable = 'true'; badge.spellcheck = false
        badge.textContent = it.label; badge.title = 'Click to rename'
        badge.addEventListener('mousedown', e => { e.stopPropagation(); selectItem(it.id) })
        badge.addEventListener('input', () => { it.label = badge.textContent.trim() || 'View' })
        badge.addEventListener('keydown', e => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); badge.blur() }
        })
        el.appendChild(badge)
      }
      el.addEventListener('mousedown', e => startDrag(e, it, 'move'))
    } else {
      const bar = document.createElement('div')
      bar.className = 'fr-bar'; bar.title = 'Drag to move'
      bar.innerHTML = '<span class="fr-grip">⋿</span><span class="fr-bar-tag">Text</span>'
      bar.addEventListener('mousedown', e => startDrag(e, it, 'move'))

      const box = document.createElement('div')
      box.className = 'fr-textbox'; box.contentEditable = 'true'; box.spellcheck = false
      box.textContent = it.text
      box.style.textAlign = it.align; box.style.color = it.color
      box.addEventListener('mousedown', e => { e.stopPropagation(); selectItem(it.id) })
      box.addEventListener('input', () => { it.text = box.textContent })
      box.addEventListener('keydown', e => e.stopPropagation())
      el.append(bar, box)
    }

    ;['nw', 'ne', 'sw', 'se'].forEach(corner => {
      const handle = document.createElement('span')
      handle.className = 'fr-handle fr-handle-' + corner
      handle.addEventListener('mousedown', e => { e.stopPropagation(); startDrag(e, it, 'resize', corner) })
      el.appendChild(handle)
    })

    return el
  }

  let pageObserver = null
  function ensurePageObserver() {
    if (pageObserver) return
    pageObserver = new ResizeObserver(() => updateTextFontSizes())
    pageObserver.observe($('frPage'))
  }
  function updateTextFontSizes() {
    const hPx = $('frPage').getBoundingClientRect().height
    if (!hPx) return
    R.items.forEach(it => {
      if (it.kind !== 'text') return
      const el = document.querySelector('.fr-panel[data-id="' + it.id + '"] .fr-textbox')
      if (el) el.style.fontSize = Math.max(8, it.fontFrac * hPx) + 'px'
    })
  }

  // ── Selection ──
  function selectItem(id) {
    R.selectedId = id
    document.querySelectorAll('.fr-panel').forEach(el => el.classList.toggle('selected', el.dataset.id === id))
    renderInspector()
  }
  function deselect() { selectItem(null) }

  function renderInspector() {
    const it = R.items.find(x => x.id === R.selectedId)
    const empty = $('frInspectorEmpty'), body = $('frInspectorBody')
    if (!it) { empty.style.display = ''; body.style.display = 'none'; body.innerHTML = ''; return }
    empty.style.display = 'none'; body.style.display = ''
    body.innerHTML = ''

    if (it.kind === 'image') {
      const row = document.createElement('label'); row.className = 'ctrl-row'
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.showLabel
      cb.onchange = () => { it.showLabel = cb.checked; renderPage() }
      row.append('Show view label ', cb)
      body.appendChild(row)
    } else {
      const sizeRow = document.createElement('div'); sizeRow.className = 'ctrl-row'
      const sizeLbl = document.createElement('span'); sizeLbl.className = 'ctrl-lbl'; sizeLbl.textContent = 'Font size'
      const sizeInput = document.createElement('input')
      sizeInput.type = 'number'; sizeInput.min = '8'; sizeInput.max = '140'
      sizeInput.value = Math.round(it.fontFrac * 1000)
      sizeInput.onchange = () => { it.fontFrac = Math.max(8, parseInt(sizeInput.value, 10) || 28) / 1000; updateTextFontSizes() }
      sizeRow.append(sizeLbl, sizeInput)

      const alignRow = document.createElement('div'); alignRow.className = 'ctrl-row'
      const alignLbl = document.createElement('span'); alignLbl.className = 'ctrl-lbl'; alignLbl.textContent = 'Align'
      const alignSel = document.createElement('select')
      ;['left', 'center', 'right'].forEach(v => {
        const opt = document.createElement('option')
        opt.value = v; opt.textContent = v[0].toUpperCase() + v.slice(1)
        if (v === it.align) opt.selected = true
        alignSel.appendChild(opt)
      })
      alignSel.onchange = () => {
        it.align = alignSel.value
        const el = document.querySelector('.fr-panel[data-id="' + it.id + '"] .fr-textbox')
        if (el) el.style.textAlign = it.align
      }
      alignRow.append(alignLbl, alignSel)

      const colorRow = document.createElement('div'); colorRow.className = 'ctrl-row'
      const colorLbl = document.createElement('span'); colorLbl.className = 'ctrl-lbl'; colorLbl.textContent = 'Color'
      const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = it.color
      colorInput.oninput = () => {
        it.color = colorInput.value
        const el = document.querySelector('.fr-panel[data-id="' + it.id + '"] .fr-textbox')
        if (el) el.style.color = it.color
      }
      colorRow.append(colorLbl, colorInput)

      body.append(sizeRow, alignRow, colorRow)
    }

    const layerRow = document.createElement('div'); layerRow.className = 'btn-row'
    const front = document.createElement('button'); front.textContent = 'Bring to front'
    front.onclick = () => { it.z = ++R.nextZ; renderPage() }
    const back = document.createElement('button'); back.textContent = 'Send to back'
    back.onclick = () => { const minZ = Math.min(0, ...R.items.map(x => x.z)); it.z = minZ - 1; renderPage() }
    layerRow.append(front, back)

    const del = document.createElement('button'); del.className = 'vp-btn'; del.textContent = 'Delete panel'
    del.onclick = () => deleteItem(it.id)

    body.append(layerRow, del)
  }

  function deleteItem(id) {
    R.items = R.items.filter(x => x.id !== id)
    if (R.selectedId === id) R.selectedId = null
    renderPage(); renderInspector()
  }

  // ── Drag / resize (mouse events, matching the rest of this codebase) ──
  function startDrag(e, it, mode, corner) {
    if (e.button !== 0) return
    e.preventDefault()
    selectItem(it.id)
    const rect = $('frPage').getBoundingClientRect()
    R.drag = {
      id: it.id, mode, corner,
      startClientX: e.clientX, startClientY: e.clientY,
      startX: it.x, startY: it.y, w: it.w, h: it.h,
      pageWpx: rect.width, pageHpx: rect.height,
    }
    document.body.style.userSelect = 'none'
  }

  function moveDrag(it, d, e) {
    const dxFrac = (e.clientX - d.startClientX) / d.pageWpx
    const dyFrac = (e.clientY - d.startClientY) / d.pageHpx
    let nx = d.startX + dxFrac, ny = d.startY + dyFrac
    if (R.snap) {
      nx = core.snapToGrid(nx * R.pageW, R.gridPx) / R.pageW
      ny = core.snapToGrid(ny * R.pageH, R.gridPx) / R.pageH
    }
    it.x = Math.max(0, Math.min(1 - it.w, nx))
    it.y = Math.max(0, Math.min(1 - it.h, ny))
  }

  // Resizes from the dragged corner while keeping the opposite corner fixed;
  // image panels derive the non-dominant axis from the native aspect ratio
  // so they can never be stretched/distorted.
  function resizeDrag(it, d, e) {
    const dxFrac = (e.clientX - d.startClientX) / d.pageWpx
    const dyFrac = (e.clientY - d.startClientY) / d.pageHpx
    const corner = d.corner
    const anchorX = corner.includes('w') ? d.startX + d.w : d.startX
    const anchorY = corner.includes('n') ? d.startY + d.h : d.startY

    let rawW = corner.includes('w') ? (anchorX - (d.startX + dxFrac)) : (d.w + dxFrac)
    let rawH = corner.includes('n') ? (anchorY - (d.startY + dyFrac)) : (d.h + dyFrac)
    rawW = Math.max(0.02, rawW); rawH = Math.max(0.02, rawH)

    let w = rawW, h = rawH
    if (it.kind === 'image' && it.naturalW && it.naturalH) {
      const wScale = rawW / d.w, hScale = rawH / d.h
      if (Math.abs(wScale - 1) >= Math.abs(hScale - 1)) {
        h = w * (it.naturalH / it.naturalW) * (R.pageW / R.pageH)
      } else {
        w = h * (it.naturalW / it.naturalH) * (R.pageH / R.pageW)
      }
    }

    let x = corner.includes('w') ? anchorX - w : d.startX
    let y = corner.includes('n') ? anchorY - h : d.startY
    if (R.snap) {
      x = core.snapToGrid(x * R.pageW, R.gridPx) / R.pageW
      y = core.snapToGrid(y * R.pageH, R.gridPx) / R.pageH
      w = core.snapToGrid(w * R.pageW, R.gridPx) / R.pageW
      h = core.snapToGrid(h * R.pageH, R.gridPx) / R.pageH
    }
    it.x = x; it.y = y; it.w = Math.max(0.02, w); it.h = Math.max(0.02, h)
  }

  function initDragHandlers() {
    window.addEventListener('mousemove', e => {
      if (!R.drag) return
      const it = R.items.find(x => x.id === R.drag.id)
      if (!it) { R.drag = null; return }
      if (R.drag.mode === 'move') moveDrag(it, R.drag, e); else resizeDrag(it, R.drag, e)
      updatePanelStyle(it)
    })
    window.addEventListener('mouseup', () => {
      if (!R.drag) return
      R.drag = null
      document.body.style.userSelect = ''
      renderInspector()
    })
  }

  // ── Keyboard: delete / deselect / nudge (skipped while editing text) ──
  function initKeyHandlers() {
    document.addEventListener('keydown', e => {
      const view = $('view-refine')
      if (!view || view.hidden) return
      const editing = document.activeElement && document.activeElement.isContentEditable
      if (e.key === 'Escape') {
        if (editing) document.activeElement.blur()
        deselect(); return
      }
      if (!R.selectedId || editing) return
      const it = R.items.find(x => x.id === R.selectedId)
      if (!it) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(R.selectedId); return }
      const nudge = (e.shiftKey ? 10 : 1)
      let moved = true
      if (e.key === 'ArrowLeft') it.x -= nudge / R.pageW
      else if (e.key === 'ArrowRight') it.x += nudge / R.pageW
      else if (e.key === 'ArrowUp') it.y -= nudge / R.pageH
      else if (e.key === 'ArrowDown') it.y += nudge / R.pageH
      else moved = false
      if (moved) {
        e.preventDefault()
        it.x = Math.max(0, Math.min(1 - it.w, it.x)); it.y = Math.max(0, Math.min(1 - it.h, it.y))
        updatePanelStyle(it)
      }
    })
  }

  // ── Import from Collection ──
  function refreshImportList() {
    const list = $('frImportList')
    list.innerHTML = ''
    const shots = (window.VP && window.VP.getItems) ? window.VP.getItems() : []
    $('frImportEmpty').style.display = shots.length ? 'none' : ''
    $('frImportAll').disabled = shots.length === 0

    shots.forEach(shot => {
      const row = document.createElement('div'); row.className = 'fr-import-row'
      const img = document.createElement('img'); img.className = 'fr-import-thumb'; img.src = shot.url
      const label = document.createElement('div'); label.className = 'fr-import-label'; label.textContent = shot.label
      const add = document.createElement('button'); add.className = 'vp-btn'; add.textContent = 'Add'
      add.onclick = () => addImageItem(shot)
      row.append(img, label, add)
      list.appendChild(row)
    })
  }

  async function addImageItem(shot) {
    let img
    try { img = await loadImg(shot.url) } catch (error) { console.error(error); toast('Could not read that capture', 'err'); return null }
    const count = R.items.filter(x => x.kind === 'image').length
    const baseW = 0.34
    const cascade = (count % 6) * 0.035
    const item = {
      id: genId(), kind: 'image',
      x: 0.05 + cascade, y: 0.05 + cascade,
      w: baseW, h: baseW * (img.naturalHeight / img.naturalWidth) * (R.pageW / R.pageH),
      src: shot.url, naturalW: img.naturalWidth, naturalH: img.naturalHeight,
      label: shot.label || 'View', showLabel: true, z: ++R.nextZ,
    }
    R.items.push(item)
    selectItem(item.id)
    renderPage()
    return item
  }

  async function addAllFromCollection() {
    const shots = (window.VP && window.VP.getItems) ? window.VP.getItems() : []
    if (!shots.length) { toast('Nothing captured yet — add views from the Collection panel first', 'err'); return }
    for (const shot of shots) await addImageItem(shot)
    autoArrange()
    toast(`Added ${shots.length} view${shots.length === 1 ? '' : 's'}`, 'ok')
  }

  function autoArrange() {
    const images = R.items.filter(it => it.kind === 'image')
    if (!images.length) { toast('Add some views first', 'err'); return }
    const placed = core.autoArrangeGrid(images, R.pageW, R.pageH)
    const byId = new Map(placed.map(p => [p.id, p]))
    images.forEach(it => {
      const p = byId.get(it.id)
      if (p) { it.x = p.x; it.y = p.y; it.w = p.w; it.h = p.h }
    })
    renderPage()
  }

  function addTextBox() {
    const item = {
      id: genId(), kind: 'text', x: 0.15, y: 0.42, w: 0.4, h: 0.12,
      text: 'Caption text', fontFrac: 0.028, align: 'left', color: '#111111', z: ++R.nextZ,
    }
    R.items.push(item)
    selectItem(item.id)
    renderPage()
    const el = document.querySelector('.fr-panel[data-id="' + item.id + '"] .fr-textbox')
    if (el) { el.focus(); document.execCommand && document.execCommand('selectAll', false, null) }
  }

  // ── Export ──
  function drawBadge(ctx, label, x, y, boxW) {
    const pad = 6, fontPx = Math.max(11, Math.round(R.pageH * 0.014))
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`
    const textW = ctx.measureText(label).width
    const bw = Math.min(boxW - 8, textW + pad * 2), bh = fontPx + pad
    const r = 5, bx = x + 4, by = y + 4
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
    ctx.arcTo(bx, by + bh, bx, by, r)
    ctx.arcTo(bx, by, bx + bw, by, r)
    ctx.closePath()
    ctx.fillStyle = 'rgba(13,17,23,0.82)'; ctx.fill()
    ctx.fillStyle = '#e6edf3'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    ctx.fillText(label, bx + pad, by + bh / 2, bw - pad * 2)
  }

  function drawTextBox(ctx, it, x, y, w, h) {
    const fontPx = Math.max(8, it.fontFrac * R.pageH)
    ctx.font = `${fontPx}px system-ui, sans-serif`
    ctx.fillStyle = it.color || '#111111'
    ctx.textBaseline = 'top'
    ctx.textAlign = it.align || 'left'
    const tx = it.align === 'center' ? x + w / 2 : it.align === 'right' ? x + w : x
    const lines = core.wrapText(s => ctx.measureText(s).width, it.text || '', w)
    const lineHeight = fontPx * 1.25
    let ty = y
    for (const line of lines) {
      if (ty + lineHeight > y + h) break
      ctx.fillText(line, tx, ty, w)
      ty += lineHeight
    }
  }

  async function saveExport() {
    if (!R.items.length) { toast('Add a view or text box first', 'err'); return }
    toast('Building figure…')
    const canvas = document.createElement('canvas')
    canvas.width = R.pageW; canvas.height = R.pageH
    const ctx = canvas.getContext('2d')
    if (R.background !== 'transparent') {
      ctx.fillStyle = BG_COLORS[R.background]; ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    const cache = new Map()
    try {
      for (const it of [...R.items].sort((a, b) => a.z - b.z)) {
        const x = it.x * R.pageW, y = it.y * R.pageH, w = it.w * R.pageW, h = it.h * R.pageH
        if (it.kind === 'image') {
          let img = cache.get(it.src)
          if (!img) { img = await loadImg(it.src); cache.set(it.src, img) }
          ctx.drawImage(img, x, y, w, h)
          if (it.showLabel) drawBadge(ctx, it.label, x, y, w)
        } else {
          drawTextBox(ctx, it, x, y, w, h)
        }
      }
    } catch (error) {
      console.error(error); toast('Could not build the figure', 'err'); return
    }

    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `figure_${R.presetId}_${Date.now()}.png`
    a.click()
    toast('Saved figure PNG', 'ok')
  }

  // ── Wiring ──
  function setupUi() {
    if (R.uiReady) return
    R.uiReady = true

    $('frPreset').onchange = () => {
      R.presetId = $('frPreset').value
      $('frCustomRow').style.display = R.presetId === 'custom' ? '' : 'none'
      applyPresetDimensions(); renderPage()
    }
    $('frCustomW').onchange = $('frCustomH').onchange = () => {
      if (R.presetId === 'custom') { applyPresetDimensions(); renderPage() }
    }
    $('frBackground').onchange = () => { R.background = $('frBackground').value; renderPage() }
    $('frSnap').onchange = () => { R.snap = $('frSnap').checked; renderPage() }
    $('frGridSize').onchange = () => { R.gridPx = Math.max(4, parseInt($('frGridSize').value, 10) || 40); renderPage() }
    $('frAutoArrange').onclick = autoArrange
    $('frImportAll').onclick = addAllFromCollection
    $('frAddText').onclick = addTextBox
    $('frSavePng').onclick = saveExport

    $('frPage').addEventListener('mousedown', e => { if (e.target === $('frPage') || e.target === $('frPanelsLayer')) deselect() })

    initDragHandlers()
    initKeyHandlers()
  }

  window.refineInit = function () {
    setupUi()
    applyPresetDimensions()
    renderPage()
    renderInspector()
    refreshImportList()
  }
  window.refineResume = function () {
    refreshImportList()
  }
})()
