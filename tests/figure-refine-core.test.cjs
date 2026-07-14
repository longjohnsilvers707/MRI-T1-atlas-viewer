'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const core = require('../js/figure-refine-core.js')

const ROOT = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

test('page presets are sane and print-appropriate', () => {
  assert.deepEqual(Object.keys(core.PAGE_PRESETS).sort(), ['a4', 'letter', 'square', 'wide'])
  for (const preset of Object.values(core.PAGE_PRESETS)) {
    assert.ok(preset.w > 0 && preset.h > 0, preset.id)
    assert.ok(preset.w >= 1800 && preset.h >= 1800, `${preset.id} should be print-resolution, not screen-res`)
  }
  assert.ok(core.PAGE_PRESETS.wide.w > core.PAGE_PRESETS.wide.h, 'wide preset must be landscape')
  assert.equal(core.PAGE_PRESETS.square.w, core.PAGE_PRESETS.square.h)
})

test('snapToGrid rounds to the nearest grid line and passes through when disabled', () => {
  assert.equal(core.snapToGrid(103, 40), 120)
  assert.equal(core.snapToGrid(99, 40), 80)
  assert.equal(core.snapToGrid(20, 40), 40)
  assert.equal(core.snapToGrid(123, 0), 123, 'gridSize 0 disables snapping')
  assert.equal(core.snapToGrid(123, null), 123, 'missing gridSize disables snapping')
})

test('autoArrangeGrid tiles the page without overlap and preserves aspect ratio', () => {
  const items = [
    { id: 'a', naturalW: 800, naturalH: 600 },   // 4:3
    { id: 'b', naturalW: 600, naturalH: 800 },   // 3:4 (portrait)
    { id: 'c', naturalW: 1200, naturalH: 400 },  // wide panorama
  ]
  const pageW = 2550, pageH = 3300
  const placed = core.autoArrangeGrid(items, pageW, pageH)
  assert.equal(placed.length, 3)

  const rects = placed.map(p => ({ x: p.x * pageW, y: p.y * pageH, w: p.w * pageW, h: p.h * pageH }))
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false, `items ${i} and ${j} overlap`)
    }
  }
  // Every placed rect stays on the page.
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= pageW + 1e-6 && r.y + r.h <= pageH + 1e-6)
  }
  // Aspect ratio preserved (letterboxed, never stretched).
  for (let i = 0; i < items.length; i++) {
    const wantRatio = items[i].naturalW / items[i].naturalH
    const gotRatio = rects[i].w / rects[i].h
    assert.ok(Math.abs(wantRatio - gotRatio) < 1e-6, `item ${items[i].id} aspect ratio distorted`)
  }
})

test('autoArrangeGrid handles empty input and missing dimensions safely', () => {
  assert.deepEqual(core.autoArrangeGrid([], 2000, 2000), [])
  const placed = core.autoArrangeGrid([{ id: 'x' }], 2000, 2000)
  assert.equal(placed.length, 1)
  assert.ok(placed[0].w > 0 && placed[0].h > 0, 'falls back to a default aspect ratio instead of NaN')
})

test('autoArrangeGrid honours explicit one- and two-column layouts', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), naturalW: 1600, naturalH: 900 }))
  const pageW = 2550, pageH = 3300

  const one = core.autoArrangeGrid(items, pageW, pageH, { columns: 1, margin: 60, gap: 48 })
  assert.equal(one.length, 5)
  for (let i = 1; i < one.length; i++) {
    assert.ok(one[i].y > one[i - 1].y, 'one-column layout should place every image on a new row')
    assert.equal(rectsOverlap(one[i - 1], one[i]), false)
  }

  const two = core.autoArrangeGrid(items, pageW, pageH, { columns: 2, margin: 60, gap: 48 })
  assert.ok(two[1].x > two[0].x, 'second item should occupy column two')
  assert.equal(two[1].y, two[0].y, 'first two items should share a row')
  assert.ok(two[2].y > two[0].y, 'third item should begin row two')
  assert.equal(two[2].x, two[0].x, 'third item should return to column one')
  for (let i = 0; i < two.length; i++) {
    for (let j = i + 1; j < two.length; j++) assert.equal(rectsOverlap(two[i], two[j]), false)
  }
})

test('wrapText wraps on word boundaries and never drops characters', () => {
  const measure = s => s.length * 10
  const lines = core.wrapText(measure, 'the quick brown fox jumps', 90)
  assert.deepEqual(lines.join(' '), 'the quick brown fox jumps')
  for (const line of lines) assert.ok(measure(line) <= 90, `"${line}" exceeds maxWidth`)
})

test('wrapText hard-breaks a single word wider than maxWidth instead of overflowing', () => {
  const measure = s => s.length * 10
  const lines = core.wrapText(measure, 'supercalifragilisticexpialidocious', 80)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(measure(line) <= 80)
  assert.equal(lines.join(''), 'supercalifragilisticexpialidocious', 'no characters may be dropped')
})

test('wrapText handles empty/whitespace-only text without throwing', () => {
  assert.deepEqual(core.wrapText(s => s.length, '', 100), [''])
  assert.deepEqual(core.wrapText(s => s.length, '   ', 100), [''])
})

test('wrapText preserves explicit line and paragraph breaks', () => {
  assert.deepEqual(core.wrapText(s => s.length * 10, 'first line\n\nsecond line', 200), [
    'first line', '', 'second line',
  ])
})

test('Refine tab DOM contract covers every controller id and lazy tab hook', () => {
  const html = read('index.html')
  const controller = read('js/figure-refine.js')
  assert.match(html, /data-tab="refine"/)
  assert.match(html, /id="view-refine"/)
  assert.match(html, /id="frColumns"/)
  assert.match(html, /id="frAddHeading"/)
  assert.doesNotMatch(html, /id="vpArrange"/, 'legacy fixed-aspect arrange modal should be removed')
  assert.match(controller, /window\.refineInit\s*=/)

  const ids = new Set([...controller.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]))
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), id)
})
