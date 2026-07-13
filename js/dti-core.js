/*
 * Pure DTI-atlas helpers shared by the browser UI and dependency-free tests.
 * Keep this file free of DOM/WebGL calls: atlas metadata, label parsing,
 * filtering, and LUT generation are all deterministic and independently
 * testable.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DtiCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const ATLAS_CATALOG = Object.freeze({
    jhu: Object.freeze({
      id: 'jhu',
      modality: 'dti',
      name: 'JHU ICBM-DTI-81 White-Matter Labels',
      shortName: 'JHU DTI-81',
      kind: 'label',
      space: 'ICBM-DTI-81 standard space',
      volumeUrl: './cache/jhu-icbm-dti81-labels-1mm.nii.gz',
      labelsUrl: './labels/jhu-dti81.xml',
      description: '50 core white-matter structures from the ICBM-DTI-81 diffusion atlas.',
      citation: 'Mori et al. (2008); Oishi et al. (2008)',
      sourceRevision: 'FSL data_atlases b3ad6133f723052d8295c48c68bbc8ab05961874',
    }),
    smatt: Object.freeze({
      id: 'smatt',
      modality: 'dti',
      name: 'Human Sensorimotor Tracts Labels (SMATT)',
      shortName: 'SMATT',
      kind: 'label',
      space: 'MNI standard space',
      volumeUrl: './cache/smatt-labels-1mm.nii.gz',
      labelsUrl: './labels/smatt.xml',
      description: '60 right/left sensorimotor tract combinations derived from diffusion MRI in 100 subjects.',
      citation: 'Archer et al. (2018)',
      sourceRevision: 'FSL data_atlases b3ad6133f723052d8295c48c68bbc8ab05961874',
    }),
  })

  const LABEL_COLORS = Object.freeze([
    [78, 121, 167], [225, 87, 89], [89, 161, 79], [242, 142, 43],
    [175, 122, 161], [118, 183, 178], [237, 201, 72], [255, 157, 167],
    [156, 117, 95], [186, 176, 172], [105, 179, 238], [255, 190, 90],
  ])

  function validateCatalog(catalog) {
    const entries = Object.values(catalog || {})
    if (entries.length < 2) throw new Error('DTI catalog must contain at least two atlases')
    if (!entries.some(a => a.id === 'jhu')) throw new Error('DTI catalog must include the JHU atlas')
    const ids = new Set()
    for (const atlas of entries) {
      for (const key of ['id', 'name', 'kind', 'space', 'volumeUrl', 'labelsUrl', 'citation']) {
        if (!atlas[key]) throw new Error(`DTI atlas is missing ${key}`)
      }
      if (atlas.modality !== 'dti') throw new Error(`${atlas.id} is not marked as a DTI atlas`)
      if (atlas.kind !== 'label') throw new Error(`${atlas.id} is not a discrete label atlas`)
      if (ids.has(atlas.id)) throw new Error(`Duplicate DTI atlas id: ${atlas.id}`)
      ids.add(atlas.id)
    }
    return true
  }

  function decodeXml(text) {
    return String(text)
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  }

  function labelGroup(name) {
    const value = String(name).trim()
    if (/^right[- ]/i.test(value) || /\sR\s*$/i.test(value)) return 'Right'
    if (/^left[- ]/i.test(value) || /\sL\s*$/i.test(value)) return 'Left'
    return 'Midline / bilateral'
  }

  function parseFslAtlasXml(text) {
    const labels = []
    const labelRx = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi
    let match
    while ((match = labelRx.exec(String(text)))) {
      const idx = /\bindex\s*=\s*["'](-?\d+)["']/i.exec(match[1])
      if (!idx) continue
      const index = Number(idx[1])
      const name = decodeXml(match[2].replace(/<[^>]+>/g, '').trim())
      if (!Number.isInteger(index) || index <= 0 || !name || /^unclassified$/i.test(name)) continue
      labels.push({ index, name, group: labelGroup(name) })
    }
    labels.sort((a, b) => a.index - b.index)
    return labels
  }

  function colorForLabel(label, position) {
    const salt = Math.abs((label.index * 2654435761 + position * 97) | 0)
    return LABEL_COLORS[salt % LABEL_COLORS.length].slice()
  }

  function hydrateLabels(labels) {
    return labels.map((label, position) => ({
      ...label,
      color: colorForLabel(label, position),
    }))
  }

  function filterLabels(labels, query, group) {
    const q = String(query || '').trim().toLowerCase()
    return labels.filter(label => {
      if (group && group !== 'all' && label.group !== group) return false
      return !q || label.name.toLowerCase().includes(q)
    })
  }

  function clamp01(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1, n))
  }

  function buildLabelLut(labels, visible, opacity) {
    const R = [0], G = [0], B = [0], A = [0], I = [0], names = ['Background']
    const alpha = Math.round(clamp01(opacity) * 255)
    const shown = visible instanceof Set ? visible : new Set(labels.map(label => label.index))
    for (const label of labels) {
      const color = label.color || colorForLabel(label, I.length - 1)
      R.push(color[0]); G.push(color[1]); B.push(color[2])
      A.push(shown.has(label.index) ? alpha : 0)
      I.push(label.index); names.push(label.name)
    }
    return { R, G, B, A, I, labels: names }
  }

  validateCatalog(ATLAS_CATALOG)

  return Object.freeze({
    ATLAS_CATALOG,
    buildLabelLut,
    filterLabels,
    hydrateLabels,
    labelGroup,
    parseFslAtlasXml,
    validateCatalog,
  })
})
