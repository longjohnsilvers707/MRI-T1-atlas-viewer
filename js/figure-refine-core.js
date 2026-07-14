/*
 * Pure layout/export helpers for the Figure Refinement tab, shared by the
 * browser controller and dependency-free tests. Keep this file free of
 * DOM/canvas calls: page presets, grid snapping, auto-arrange math, and text
 * wrapping are all deterministic and independently testable.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.FigureRefineCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // Pixel dimensions at a print-appropriate resolution (~300dpi for the
  // physical-page presets); "custom" has no fixed size, callers supply one.
  const PAGE_PRESETS = Object.freeze({
    letter: Object.freeze({ id: 'letter', name: 'Letter (8.5×11in)', w: 2550, h: 3300 }),
    a4: Object.freeze({ id: 'a4', name: 'A4 (210×297mm)', w: 2480, h: 3508 }),
    wide: Object.freeze({ id: 'wide', name: 'Widescreen (16:9)', w: 3300, h: 1856 }),
    square: Object.freeze({ id: 'square', name: 'Square', w: 2400, h: 2400 }),
  })

  function snapToGrid(px, gridSize) {
    const g = Number(gridSize)
    if (!Number.isFinite(g) || g <= 0) return px
    return Math.round(px / g) * g
  }

  // Lay out `items` (each needs naturalW/naturalH) into a tidy rows×cols grid
  // sized to pageW×pageH, contain-fitting each image within its cell so
  // aspect ratio is preserved (letterboxed, never distorted). `options` can
  // supply explicit columns, margin, and gap values in page pixels. Returns
  // [{ id, x, y, w, h }] in normalized (0..1) page fractions.
  function autoArrangeGrid(items, pageW, pageH, options) {
    const n = items.length
    if (!n || !(pageW > 0) || !(pageH > 0)) return []
    const opts = options || {}
    const requestedCols = Number.parseInt(opts.columns, 10)
    const cols = Math.max(1, Math.min(n,
      Number.isFinite(requestedCols) ? requestedCols : Math.ceil(Math.sqrt(n))))
    const rows = Math.ceil(n / cols)
    const defaultMargin = Math.round(Math.min(pageW, pageH) * 0.02)
    const margin = Math.max(0, Math.min(
      Number.isFinite(Number(opts.margin)) ? Number(opts.margin) : defaultMargin,
      Math.min(pageW, pageH) * 0.24,
    ))
    const availableW = Math.max(1, pageW - margin * 2)
    const availableH = Math.max(1, pageH - margin * 2)
    const requestedGap = Math.max(0,
      Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : Math.round(pageW * 0.015))
    const maxGapW = cols > 1 ? (availableW - cols) / (cols - 1) : requestedGap
    const maxGapH = rows > 1 ? (availableH - rows) / (rows - 1) : requestedGap
    const gap = Math.max(0, Math.min(requestedGap, maxGapW, maxGapH))
    const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols
    const cellH = (pageH - margin * 2 - gap * (rows - 1)) / rows

    return items.map((it, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      const cellX = margin + c * (cellW + gap)
      const cellY = margin + r * (cellH + gap)
      const nw = it.naturalW || 4
      const nh = it.naturalH || 3
      const s = Math.min(cellW / nw, cellH / nh)
      const dw = nw * s
      const dh = nh * s
      const x = cellX + (cellW - dw) / 2
      const y = cellY + (cellH - dh) / 2
      return { id: it.id, x: x / pageW, y: y / pageH, w: dw / pageW, h: dh / pageH }
    })
  }

  // Greedy word-wrap against an injected width-measuring function (so this
  // stays canvas-free and testable). Hard-breaks any single word that alone
  // exceeds maxWidth instead of overflowing or dropping characters. Explicit
  // line breaks are retained so multi-paragraph text boxes export faithfully.
  function wrapText(measure, text, maxWidth) {
    const lines = []
    for (const paragraph of String(text).replace(/\r/g, '').split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean)
      if (!words.length) { lines.push(''); continue }
      let line = ''
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word
        if (measure(candidate) <= maxWidth) { line = candidate; continue }
        if (line) { lines.push(line); line = '' }
        if (measure(word) <= maxWidth) { line = word; continue }
        let chunk = ''
        for (const ch of word) {
          const test = chunk + ch
          if (!chunk || measure(test) <= maxWidth) { chunk = test }
          else { lines.push(chunk); chunk = ch }
        }
        line = chunk
      }
      if (line) lines.push(line)
    }
    return lines.length ? lines : ['']
  }

  return Object.freeze({
    PAGE_PRESETS,
    snapToGrid,
    autoArrangeGrid,
    wrapText,
  })
})
