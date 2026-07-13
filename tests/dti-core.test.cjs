'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const core = require('../js/dti-core.js')

const ROOT = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function readLabelValues(relative) {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, relative)))
  const little = bytes.readInt32LE(0) === 348
  const int16 = offset => little ? bytes.readInt16LE(offset) : bytes.readInt16BE(offset)
  const int32 = offset => little ? bytes.readInt32LE(offset) : bytes.readInt32BE(offset)
  const float32 = offset => little ? bytes.readFloatLE(offset) : bytes.readFloatBE(offset)
  const dims = [int16(42), int16(44), int16(46)]
  const datatype = int16(70)
  const offset = Math.floor(float32(108))
  const count = dims[0] * dims[1] * dims[2]
  const readers = {
    2: { size: 1, read: at => bytes.readUInt8(at) },
    4: { size: 2, read: int16 },
    8: { size: 4, read: int32 },
  }
  const reader = readers[datatype]
  assert.ok(reader, `unsupported label datatype ${datatype}`)
  const values = new Set()
  for (let index = 0; index < count; index++) values.add(reader.read(offset + index * reader.size))
  values.delete(0)
  return { dims, values }
}

test('DTI catalog contains distinct, bundled JHU and SMATT atlases', () => {
  assert.equal(core.validateCatalog(core.ATLAS_CATALOG), true)
  assert.deepEqual(Object.keys(core.ATLAS_CATALOG).sort(), ['jhu', 'smatt'])
  for (const atlas of Object.values(core.ATLAS_CATALOG)) {
    assert.equal(atlas.modality, 'dti')
    for (const asset of [atlas.volumeUrl, atlas.labelsUrl]) {
      assert.equal(fs.existsSync(path.join(ROOT, asset.replace(/^\.\//, ''))), true, asset)
    }
  }
  assert.notEqual(core.ATLAS_CATALOG.jhu.labelsUrl, './labels/jhu.txt',
    'DTI must not reuse the Faria functional JHU labels')
})

test('official FSL metadata parses sparse white-matter label values', () => {
  const jhu = core.parseFslAtlasXml(read('labels/jhu-dti81.xml'))
  const smatt = core.parseFslAtlasXml(read('labels/smatt.xml'))
  assert.equal(jhu.length, 50)
  assert.equal(smatt.length, 60)
  assert.equal(jhu[0].name, 'Middle cerebellar peduncle')
  assert.equal(smatt.some(label => label.index === 101 && label.name === 'Left-M1'), true)
  assert.equal(smatt.some(label => label.index === 0), false)
})

test('bundled label voxels agree with official metadata IDs', () => {
  for (const [volume, metadata] of [
    ['cache/jhu-icbm-dti81-labels-1mm.nii.gz', 'labels/jhu-dti81.xml'],
    ['cache/smatt-labels-1mm.nii.gz', 'labels/smatt.xml'],
  ]) {
    const image = readLabelValues(volume)
    const known = new Set(core.parseFslAtlasXml(read(metadata)).map(label => label.index))
    assert.deepEqual(image.dims, [182, 218, 182])
    assert.ok(image.values.size > 1)
    for (const value of image.values) assert.equal(known.has(value), true, `${volume}: label ${value}`)
  }
})

test('filtering composes text and hemisphere without mutating labels', () => {
  const labels = core.hydrateLabels(core.parseFslAtlasXml(read('labels/jhu-dti81.xml')))
  const snapshot = JSON.stringify(labels)
  const result = core.filterLabels(labels, 'corticospinal', 'Left')
  assert.deepEqual(result.map(label => label.name), ['Corticospinal tract L'])
  assert.equal(JSON.stringify(labels), snapshot)
})

test('label LUT preserves sparse indices and hides unchecked tracts', () => {
  const labels = core.hydrateLabels([
    { index: 1, name: 'Right-M1', group: 'Right' },
    { index: 101, name: 'Left-M1', group: 'Left' },
  ])
  const lut = core.buildLabelLut(labels, new Set([101]), 0.5)
  assert.deepEqual(lut.I, [0, 1, 101])
  assert.deepEqual(lut.labels, ['Background', 'Right-M1', 'Left-M1'])
  assert.deepEqual(lut.A, [0, 0, 128])
})

test('DTI DOM contract covers every controller id and lazy tab hook', () => {
  const html = read('index.html')
  const controller = read('js/dti.js')
  assert.match(html, /data-tab="dti"/)
  assert.match(html, /id="view-dti"/)
  assert.match(controller, /window\.dtiInit\s*=/)
  assert.match(controller, /window\.__captureDtiPane\s*=/)

  const ids = new Set([...controller.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]))
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), id)
})
