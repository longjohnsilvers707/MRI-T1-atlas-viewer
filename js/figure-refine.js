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
  const FONT_FAMILIES = Object.freeze({
    system: 'system-ui, sans-serif',
    arial: 'Arial, sans-serif',
    serif: 'Georgia, serif',
    times: '"Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  })
  const LABEL_DEFAULTS = Object.freeze({
    position: 'top-left', fontSize: 36, fontFamily: 'system', fontWeight: '600',
    italic: false, color: '#e6edf3', background: '#0d1117', backgroundOpacity: 82,
  })

  const R = {
    uiReady: false,
    presetId: 'letter',
    pageW: core.PAGE_PRESETS.letter.w,
    pageH: core.PAGE_PRESETS.letter.h,
    background: 'white',
    backgroundColor: '#ffffff',
    columns: 'auto',
    showLabels: true,
    marginPx: 60,
    gapPx: 48,
    snap: false,
    gridPx: 40,
    items: [],
    selectedId: null,
    nextZ: 1,
    drag: null,
  }

  const $ = id => document.getElementById(id)
  const genId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function fontStack(key) { return FONT_FAMILIES[key] || FONT_FAMILIES.system }
  function rgba(hex, opacity) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!match) return 'transparent'
    const n = parseInt(match[1], 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(Number(opacity) || 0, 0, 100) / 100})`
  }
  function ensureLabelStyle(it) {
    it.labelStyle = Object.assign({}, LABEL_DEFAULTS, it.labelStyle || {})
    return it.labelStyle
  }

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
        const fit = Math.min(1, 1 / it.w, 1 / it.h)
        it.w *= fit; it.h *= fit
        it.x = clamp(it.x, 0, Math.max(0, 1 - it.w))
        it.y = clamp(it.y, 0, Math.max(0, 1 - it.h))
      }
    })
  }

  function renderPage() {
    const page = $('frPage')
    page.style.aspectRatio = R.pageW + ' / ' + R.pageH
    page.classList.toggle('fr-transparent', R.background === 'transparent')
    const pageColor = R.background === 'custom' ? R.backgroundColor : BG_COLORS[R.background]
    page.style.background = R.background === 'transparent' ? '' : pageColor

    const overlay = $('frGridOverlay')
    overlay.classList.toggle('active', R.snap)
    if (R.snap) {
      overlay.style.backgroundSize = (R.gridPx / R.pageW * 100) + '% ' + (R.gridPx / R.pageH * 100) + '%'
    }

    const layer = $('frPanelsLayer')
    layer.innerHTML = ''
    ;[...R.items].sort((a, b) => a.z - b.z).forEach(it => layer.appendChild(buildPanel(it)))
    ensurePageObserver()
    updateScaledTypography()
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
      const style = ensureLabelStyle(it)
      const img = document.createElement('img')
      img.src = it.src; img.draggable = false; img.alt = it.label
      el.appendChild(img)
      if (it.showLabel) {
        const badge = document.createElement('div')
        badge.className = 'fr-badge'; badge.contentEditable = 'true'; badge.spellcheck = false
        badge.textContent = it.label; badge.title = 'Click to rename'
        badge.dataset.position = style.position
        badge.style.fontFamily = fontStack(style.fontFamily)
        badge.style.fontWeight = style.fontWeight
        badge.style.fontStyle = style.italic ? 'italic' : 'normal'
        badge.style.color = style.color
        badge.style.background = rgba(style.background, style.backgroundOpacity)
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
      box.innerText = it.text
      box.style.textAlign = it.align; box.style.color = it.color
      box.style.fontFamily = fontStack(it.fontFamily)
      box.style.fontWeight = it.fontWeight
      box.style.fontStyle = it.italic ? 'italic' : 'normal'
      box.style.lineHeight = it.lineHeight
      box.style.background = rgba(it.background, it.backgroundOpacity)
      box.addEventListener('mousedown', e => { e.stopPropagation(); selectItem(it.id) })
      box.addEventListener('input', () => { it.text = box.innerText })
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
    pageObserver = new ResizeObserver(() => updateScaledTypography())
    pageObserver.observe($('frPage'))
  }
  function updateScaledTypography() {
    const rect = $('frPage').getBoundingClientRect()
    if (!rect.height) return
    const scale = rect.height / R.pageH
    R.items.forEach(it => {
      const panel = document.querySelector('.fr-panel[data-id="' + it.id + '"]')
      if (!panel) return
      if (it.kind === 'text') {
        const el = panel.querySelector('.fr-textbox')
        if (el) {
          el.style.fontSize = Math.max(8, (it.fontSize || 72) * scale) + 'px'
          el.style.padding = Math.max(2, (it.padding || 12) * scale) + 'px'
        }
      } else {
        const badge = panel.querySelector('.fr-badge')
        const style = ensureLabelStyle(it)
        if (badge) {
          badge.style.fontSize = Math.max(8, style.fontSize * scale) + 'px'
          badge.style.padding = Math.max(2, 8 * scale) + 'px ' + Math.max(3, 12 * scale) + 'px'
        }
      }
    })
  }

  // ── Selection ──
  function selectItem(id) {
    R.selectedId = id
    document.querySelectorAll('.fr-panel').forEach(el => el.classList.toggle('selected', el.dataset.id === id))
    renderInspector()
  }
  function deselect() { selectItem(null) }

  function fieldRow(label, control, unit) {
    const row = document.createElement('label'); row.className = 'ctrl-row fr-field-row'
    const text = document.createElement('span'); text.className = 'ctrl-lbl'; text.textContent = label
    row.append(text, control)
    if (unit) { const suffix = document.createElement('span'); suffix.className = 'fr-unit'; suffix.textContent = unit; row.appendChild(suffix) }
    return row
  }

  function numberField(value, min, max, step, onChange) {
    const input = document.createElement('input'); input.type = 'number'
    input.value = String(value); input.min = String(min); input.max = String(max); input.step = String(step)
    input.onchange = () => onChange(clamp(Number(input.value) || 0, min, max))
    return input
  }

  function selectField(options, value, onChange) {
    const select = document.createElement('select')
    options.forEach(([key, label]) => {
      const option = document.createElement('option'); option.value = key; option.textContent = label
      option.selected = key === value; select.appendChild(option)
    })
    select.onchange = () => onChange(select.value)
    return select
  }

  function checkField(checked, onChange) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked
    input.onchange = () => onChange(input.checked)
    return input
  }

  function colorField(value, onChange) {
    const input = document.createElement('input'); input.type = 'color'; input.value = value
    input.oninput = () => onChange(input.value)
    return input
  }

  const FONT_OPTIONS = [
    ['system', 'System sans'], ['arial', 'Arial'], ['serif', 'Georgia'],
    ['times', 'Times New Roman'], ['mono', 'Monospace'],
  ]

  function geometryEditor(it) {
    const wrap = document.createElement('div'); wrap.className = 'fr-inspector-group'
    const title = document.createElement('div'); title.className = 'fr-inspector-title'; title.textContent = 'Position & size'
    const grid = document.createElement('div'); grid.className = 'fr-geometry-grid'
    const specs = [
      ['X', 'x', 0, 100], ['Y', 'y', 0, 100],
      ['W', 'w', 2, 100], ['H', 'h', 2, 100],
    ]
    specs.forEach(([label, key, min, max]) => {
      const cell = document.createElement('label'); cell.textContent = label
      const input = numberField(Math.round(it[key] * 1000) / 10, min, max, 0.1, value => {
        it[key] = value / 100
        if (it.kind === 'image' && it.naturalW && it.naturalH) {
          if (key === 'w') it.h = it.w * (it.naturalH / it.naturalW) * (R.pageW / R.pageH)
          if (key === 'h') it.w = it.h * (it.naturalW / it.naturalH) * (R.pageH / R.pageW)
          const fit = Math.min(1, 1 / it.w, 1 / it.h)
          it.w *= fit; it.h *= fit
        }
        it.x = clamp(it.x, 0, Math.max(0, 1 - it.w))
        it.y = clamp(it.y, 0, Math.max(0, 1 - it.h))
        if (key === 'w' || key === 'h') { renderPage(); renderInspector() } else updatePanelStyle(it)
      })
      cell.appendChild(input); grid.appendChild(cell)
    })
    wrap.append(title, grid)
    return wrap
  }

  function renderInspector() {
    const it = R.items.find(x => x.id === R.selectedId)
    const empty = $('frInspectorEmpty'), body = $('frInspectorBody')
    if (!it) { empty.style.display = ''; body.style.display = 'none'; body.innerHTML = ''; return }
    empty.style.display = 'none'; body.style.display = ''
    body.innerHTML = ''

    if (it.kind === 'image') {
      const style = ensureLabelStyle(it)
      const name = document.createElement('input'); name.type = 'text'; name.value = it.label
      name.oninput = () => {
        it.label = name.value || 'View'
        const badge = document.querySelector('.fr-panel[data-id="' + it.id + '"] .fr-badge')
        if (badge) badge.textContent = it.label
      }
      body.append(
        fieldRow('Label text', name),
        fieldRow('Show label', checkField(it.showLabel, value => { it.showLabel = value; renderPage() })),
        fieldRow('Position', selectField([
          ['top-left', 'Top left'], ['top-center', 'Top centre'],
          ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'],
        ], style.position, value => { style.position = value; renderPage() })),
        fieldRow('Font', selectField(FONT_OPTIONS, style.fontFamily, value => { style.fontFamily = value; renderPage() })),
        fieldRow('Font size', numberField(style.fontSize, 12, 240, 1, value => { style.fontSize = value; updateScaledTypography() }), 'px'),
        fieldRow('Weight', selectField([['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold']], style.fontWeight, value => { style.fontWeight = value; renderPage() })),
        fieldRow('Italic', checkField(style.italic, value => { style.italic = value; renderPage() })),
        fieldRow('Text colour', colorField(style.color, value => { style.color = value; renderPage() })),
        fieldRow('Label fill', colorField(style.background, value => { style.background = value; renderPage() })),
        fieldRow('Fill opacity', numberField(style.backgroundOpacity, 0, 100, 1, value => { style.backgroundOpacity = value; renderPage() }), '%'),
      )
    } else {
      const content = document.createElement('textarea'); content.rows = 3; content.value = it.text
      content.oninput = () => {
        it.text = content.value
        const box = document.querySelector('.fr-panel[data-id="' + it.id + '"] .fr-textbox')
        if (box) box.innerText = it.text
      }
      body.append(
        fieldRow('Content', content),
        fieldRow('Font', selectField(FONT_OPTIONS, it.fontFamily, value => { it.fontFamily = value; renderPage() })),
        fieldRow('Font size', numberField(it.fontSize, 12, 300, 1, value => { it.fontSize = value; updateScaledTypography() }), 'px'),
        fieldRow('Weight', selectField([['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold']], it.fontWeight, value => { it.fontWeight = value; renderPage() })),
        fieldRow('Italic', checkField(it.italic, value => { it.italic = value; renderPage() })),
        fieldRow('Align', selectField([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], it.align, value => { it.align = value; renderPage() })),
        fieldRow('Line height', numberField(it.lineHeight, 0.8, 2.5, 0.05, value => { it.lineHeight = value; renderPage() })),
        fieldRow('Text colour', colorField(it.color, value => { it.color = value; renderPage() })),
        fieldRow('Box fill', colorField(it.background, value => { it.background = value; renderPage() })),
        fieldRow('Fill opacity', numberField(it.backgroundOpacity, 0, 100, 1, value => { it.backgroundOpacity = value; renderPage() }), '%'),
        fieldRow('Padding', numberField(it.padding, 0, 120, 1, value => { it.padding = value; updateScaledTypography() }), 'px'),
      )
    }

    body.appendChild(geometryEditor(it))

    const layerRow = document.createElement('div'); layerRow.className = 'btn-row'
    const front = document.createElement('button'); front.textContent = 'To front'
    front.onclick = () => { it.z = ++R.nextZ; renderPage() }
    const back = document.createElement('button'); back.textContent = 'To back'
    back.onclick = () => { const minZ = Math.min(0, ...R.items.map(x => x.z)); it.z = minZ - 1; renderPage() }
    layerRow.append(front, back)

    const duplicate = document.createElement('button'); duplicate.textContent = 'Duplicate'
    duplicate.onclick = () => duplicateItem(it)
    layerRow.appendChild(duplicate)

    const del = document.createElement('button'); del.className = 'vp-btn danger'; del.textContent = 'Delete panel'
    del.onclick = () => deleteItem(it.id)

    body.append(layerRow, del)
  }

  function duplicateItem(it) {
    const copy = JSON.parse(JSON.stringify(it))
    copy.id = genId(); copy.x = clamp(it.x + 0.025, 0, Math.max(0, 1 - it.w))
    copy.y = clamp(it.y + 0.025, 0, Math.max(0, 1 - it.h)); copy.z = ++R.nextZ
    R.items.push(copy); R.selectedId = copy.id
    renderPage(); renderInspector()
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
    const fit = Math.min(1, 1 / w, 1 / h)
    it.w = Math.max(0.02, w * fit); it.h = Math.max(0.02, h * fit)
    it.x = clamp(x, 0, Math.max(0, 1 - it.w)); it.y = clamp(y, 0, Math.max(0, 1 - it.h))
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
      sourceId: shot.id || null,
      label: shot.label || 'View', showLabel: R.showLabels, labelStyle: { ...LABEL_DEFAULTS }, z: ++R.nextZ,
    }
    R.items.push(item)
    selectItem(item.id)
    renderPage()
    return item
  }

  async function addAllFromCollection() {
    const shots = (window.VP && window.VP.getItems) ? window.VP.getItems() : []
    if (!shots.length) { toast('Nothing captured yet — add views from the Collection panel first', 'err'); return }
    const hadImages = R.items.some(it => it.kind === 'image')
    const existing = new Set(R.items.filter(it => it.kind === 'image' && it.sourceId).map(it => it.sourceId))
    const pending = shots.filter(shot => !existing.has(shot.id))
    for (const shot of pending) await addImageItem(shot)
    if (pending.length && !hadImages) autoArrange()
    toast(pending.length ? `Added ${pending.length} view${pending.length === 1 ? '' : 's'}` : 'All collected views are already on the page', 'ok')
  }

  function autoArrange() {
    const images = R.items.filter(it => it.kind === 'image')
    if (!images.length) { toast('Add some views first', 'err'); return }
    const placed = core.autoArrangeGrid(images, R.pageW, R.pageH, {
      columns: R.columns,
      margin: R.marginPx,
      gap: R.gapPx,
    })
    const byId = new Map(placed.map(p => [p.id, p]))
    images.forEach(it => {
      const p = byId.get(it.id)
      if (p) { it.x = p.x; it.y = p.y; it.w = p.w; it.h = p.h }
    })
    renderPage()
  }

  function addTextBox(kind = 'body') {
    const heading = kind === 'heading'
    const item = {
      id: genId(), kind: 'text', x: 0.15, y: heading ? 0.08 : 0.42, w: heading ? 0.7 : 0.4, h: heading ? 0.08 : 0.12,
      text: heading ? 'Figure title' : 'Caption text',
      fontSize: heading ? 112 : 64, fontFamily: 'system', fontWeight: heading ? '700' : '400',
      italic: false, align: heading ? 'center' : 'left', lineHeight: 1.25,
      color: R.background === 'dark' ? '#e6edf3' : '#111111',
      background: '#ffffff', backgroundOpacity: 0, padding: 12, z: ++R.nextZ,
    }
    R.items.push(item)
    selectItem(item.id)
    renderPage()
    const el = document.querySelector('.fr-panel[data-id="' + item.id + '"] .fr-textbox')
    if (el) { el.focus(); document.execCommand && document.execCommand('selectAll', false, null) }
  }

  // ── Export ──
  function truncateText(ctx, text, maxWidth) {
    let output = String(text || '')
    if (ctx.measureText(output).width <= maxWidth) return output
    while (output.length > 1 && ctx.measureText(output + '…').width > maxWidth) output = output.slice(0, -1)
    return output + '…'
  }

  function drawBadge(ctx, it, x, y, boxW, boxH) {
    const style = ensureLabelStyle(it)
    const padX = 12, padY = 8, fontPx = Math.max(12, style.fontSize)
    ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight} ${fontPx}px ${fontStack(style.fontFamily)}`
    const label = truncateText(ctx, it.label, Math.max(1, boxW - padX * 2 - 8))
    const textW = ctx.measureText(label).width
    const bw = Math.min(boxW - 8, textW + padX * 2), bh = fontPx * 1.25 + padY * 2
    const centred = style.position.endsWith('center')
    const bottom = style.position.startsWith('bottom')
    const r = Math.min(10, bh / 4)
    const bx = centred ? x + (boxW - bw) / 2 : x + 4
    const by = bottom ? y + boxH - bh - 4 : y + 4
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
    ctx.arcTo(bx, by + bh, bx, by, r)
    ctx.arcTo(bx, by, bx + bw, by, r)
    ctx.closePath()
    ctx.fillStyle = rgba(style.background, style.backgroundOpacity); ctx.fill()
    ctx.fillStyle = style.color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    ctx.fillText(label, bx + padX, by + bh / 2)
  }

  function drawTextBox(ctx, it, x, y, w, h) {
    const fontPx = Math.max(8, it.fontSize || 64)
    const padding = Math.max(0, it.padding || 0)
    if (it.backgroundOpacity > 0) {
      ctx.fillStyle = rgba(it.background, it.backgroundOpacity)
      ctx.fillRect(x, y, w, h)
    }
    ctx.font = `${it.italic ? 'italic ' : ''}${it.fontWeight || '400'} ${fontPx}px ${fontStack(it.fontFamily)}`
    ctx.fillStyle = it.color || '#111111'
    ctx.textBaseline = 'top'
    ctx.textAlign = it.align || 'left'
    const contentW = Math.max(1, w - padding * 2)
    const tx = it.align === 'center' ? x + w / 2 : it.align === 'right' ? x + w - padding : x + padding
    const lines = core.wrapText(s => ctx.measureText(s).width, it.text || '', contentW)
    const lineHeight = fontPx * (it.lineHeight || 1.25)
    let ty = y + padding
    for (const line of lines) {
      if (ty + lineHeight > y + h - padding) break
      ctx.fillText(line, tx, ty, contentW)
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
      ctx.fillStyle = R.background === 'custom' ? R.backgroundColor : BG_COLORS[R.background]
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    const cache = new Map()
    try {
      for (const it of [...R.items].sort((a, b) => a.z - b.z)) {
        const x = it.x * R.pageW, y = it.y * R.pageH, w = it.w * R.pageW, h = it.h * R.pageH
        if (it.kind === 'image') {
          let img = cache.get(it.src)
          if (!img) { img = await loadImg(it.src); cache.set(it.src, img) }
          ctx.drawImage(img, x, y, w, h)
          if (it.showLabel) drawBadge(ctx, it, x, y, w, h)
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
    $('frBackground').onchange = () => {
      R.background = $('frBackground').value
      $('frBackgroundColorRow').style.display = R.background === 'custom' ? '' : 'none'
      renderPage()
    }
    $('frBackgroundColor').oninput = () => { R.backgroundColor = $('frBackgroundColor').value; renderPage() }
    $('frColumns').onchange = () => {
      R.columns = $('frColumns').value
      if (R.items.some(it => it.kind === 'image')) autoArrange()
    }
    $('frShowLabels').onchange = () => {
      R.showLabels = $('frShowLabels').checked
      R.items.filter(it => it.kind === 'image').forEach(it => { it.showLabel = R.showLabels })
      renderPage(); renderInspector()
    }
    $('frMargin').onchange = () => {
      R.marginPx = clamp(parseInt($('frMargin').value, 10) || 0, 0, 600)
      $('frMargin').value = R.marginPx
      if (R.items.some(it => it.kind === 'image')) autoArrange()
    }
    $('frGap').onchange = () => {
      R.gapPx = clamp(parseInt($('frGap').value, 10) || 0, 0, 600)
      $('frGap').value = R.gapPx
      if (R.items.some(it => it.kind === 'image')) autoArrange()
    }
    $('frSnap').onchange = () => { R.snap = $('frSnap').checked; renderPage() }
    $('frGridSize').onchange = () => { R.gridPx = Math.max(4, parseInt($('frGridSize').value, 10) || 40); renderPage() }
    $('frAutoArrange').onclick = autoArrange
    $('frImportAll').onclick = addAllFromCollection
    $('frAddText').onclick = addTextBox
    $('frAddHeading').onclick = () => addTextBox('heading')
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
  window.refineOpenCollection = async function () {
    setupUi()
    refreshImportList()
    await addAllFromCollection()
  }
})()
