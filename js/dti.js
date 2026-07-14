/* global DtiCore */
// DTI volume/tract-atlas tab. This owns one lazily-created NiiVue context and
// deliberately has no animation loop: hidden tabs consume no render time.
(function () {
  'use strict'

  const core = window.DtiCore
  if (!core) {
    console.error('DTI tab disabled: js/dti-core.js did not load')
    return
  }

  const TEMPLATE = Object.freeze({
    url: './cache/jhu-icbm-fa-2mm.nii.gz',
    name: 'JHU ICBM FA template (2 mm)',
  })
  const METRICS = Object.freeze({
    fa: { name: 'Fractional anisotropy (FA)', colormap: 'gray', min: 0, max: 0.7 },
    md: { name: 'Mean diffusivity (MD)', colormap: 'viridis', min: 0, max: 0.003 },
    ad: { name: 'Axial diffusivity (AD)', colormap: 'viridis', min: 0, max: 0.003 },
    rd: { name: 'Radial diffusivity (RD)', colormap: 'viridis', min: 0, max: 0.003 },
    other: { name: 'Other scalar map', colormap: 'gray', min: null, max: null },
  })

  const D = {
    initPromise: null,
    nv: null,
    lib: null,
    atlasId: 'jhu',
    atlasImage: null,
    backgroundImage: null,
    templateImage: null,
    labels: [],
    visible: new Set(),
    search: '',
    group: 'all',
    metric: 'fa',
    sourceName: TEMPLATE.name,
    ready: false,
    uiReady: false,
    loadToken: 0,
  }

  const $ = id => document.getElementById(id)

  function waitForNiivue(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const started = performance.now()
      const poll = () => {
        if (window.NiivueLib) return resolve(window.NiivueLib)
        if (performance.now() - started > timeoutMs) return reject(new Error('NiiVue did not become available'))
        setTimeout(poll, 100)
      }
      poll()
    })
  }

  function showLoading(message) {
    $('dtiLoadingMsg').textContent = message
    $('dtiLoading').classList.add('active')
  }

  function hideLoading() {
    $('dtiLoading').classList.remove('active')
  }

  function toast(message, type) {
    const el = $('dtiToast')
    el.textContent = message
    el.className = type === 'err' ? 'modality-toast show err' : 'modality-toast show'
    clearTimeout(el._timer)
    el._timer = setTimeout(() => { el.className = 'modality-toast' }, 3200)
  }

  function populateAtlasSelect() {
    const select = $('dtiAtlasSelect')
    select.textContent = ''
    Object.values(core.ATLAS_CATALOG).forEach(atlas => {
      const option = document.createElement('option')
      option.value = atlas.id
      option.textContent = atlas.name
      select.appendChild(option)
    })
    select.value = D.atlasId
  }

  function setupUi() {
    if (D.uiReady) return
    D.uiReady = true
    populateAtlasSelect()

    $('dtiAtlasSelect').onchange = event => loadAtlas(event.target.value)
    $('dtiSearch').oninput = event => { D.search = event.target.value; renderTractList() }
    $('dtiGroup').onchange = event => { D.group = event.target.value; renderTractList() }
    $('dtiAll').onclick = () => setFilteredVisibility(true)
    $('dtiNone').onclick = () => setFilteredVisibility(false)
    $('dtiInvert').onclick = () => {
      for (const label of filteredLabels()) {
        if (D.visible.has(label.index)) D.visible.delete(label.index)
        else D.visible.add(label.index)
      }
      applyAtlasDisplay(); renderTractList()
    }

    $('dtiScalarFile').onchange = event => {
      const file = event.target.files && event.target.files[0]
      if (file) loadUserBackground(file)
      event.target.value = ''
    }
    $('dtiResetData').onclick = resetBackground
    $('dtiMetric').onchange = event => {
      D.metric = event.target.value
      updateBackgroundDisplay()
      updateDataInfo()
    }

    $('dtiViewMode').onchange = applyViewMode
    $('dtiAtlasOpacity').oninput = applyAtlasDisplay
    $('dtiBgOpacity').oninput = updateBackgroundDisplay
    $('dtiOutline').onchange = () => { if (D.nv) D.nv.setAtlasOutline(+$('dtiOutline').value) }
    $('dtiCrosshair').onchange = () => {
      if (!D.nv) return
      D.nv.setCrosshairWidth($('dtiCrosshair').checked ? 1 : 0)
      D.nv.drawScene()
    }
    $('dtiShowAtlas').onchange = applyAtlasDisplay
    $('dtiResetView').onclick = resetView
    $('dtiScreenshot').onclick = savePng

    $('dtiTractList').addEventListener('change', event => {
      if (!event.target.classList.contains('dt-tract-check')) return
      const row = event.target.closest('[data-index]')
      if (!row) return
      const index = Number(row.dataset.index)
      if (event.target.checked) D.visible.add(index); else D.visible.delete(index)
      applyAtlasDisplay(); updateTractCount()
    })
    $('dtiTractList').addEventListener('dblclick', event => {
      const row = event.target.closest('[data-index]')
      if (!row) return
      D.visible = new Set([Number(row.dataset.index)])
      applyAtlasDisplay(); renderTractList()
      toast('Showing selected tract only')
    })
  }

  function filteredLabels() {
    return core.filterLabels(D.labels, D.search, D.group)
  }

  function setFilteredVisibility(on) {
    for (const label of filteredLabels()) {
      if (on) D.visible.add(label.index); else D.visible.delete(label.index)
    }
    applyAtlasDisplay(); renderTractList()
  }

  function updateTractCount() {
    const matching = filteredLabels().length
    $('dtiTractCount').textContent = `${D.visible.size} / ${D.labels.length} visible` +
      (matching !== D.labels.length ? ` · ${matching} matching` : '')
  }

  function renderTractList() {
    const list = $('dtiTractList')
    list.textContent = ''
    const filtered = filteredLabels()
    if (!filtered.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'; empty.textContent = 'No matching tracts'
      list.appendChild(empty); updateTractCount(); return
    }

    // FSL's JHU labels alternate R/L by numeric index. Group them for display
    // while preserving the original index order within each group.
    const groupOrder = ['Right', 'Left', 'Midline / bilateral']
    const ordered = D.group === 'all'
      ? groupOrder.flatMap(group => filtered.filter(label => label.group === group))
      : filtered
    let previousGroup = ''
    for (const label of ordered) {
      if (D.group === 'all' && label.group !== previousGroup) {
        previousGroup = label.group
        const heading = document.createElement('div')
        heading.className = 'dt-group-heading'; heading.textContent = previousGroup
        list.appendChild(heading)
      }
      const row = document.createElement('label')
      row.className = 'dt-tract-row'; row.dataset.index = String(label.index)
      row.title = 'Double-click to show this tract only'

      const check = document.createElement('input')
      check.type = 'checkbox'; check.className = 'dt-tract-check'
      check.checked = D.visible.has(label.index)
      const swatch = document.createElement('span')
      swatch.className = 'dt-tract-swatch'
      swatch.style.background = `rgb(${label.color.join(',')})`
      const name = document.createElement('span')
      name.className = 'dt-tract-name'; name.textContent = label.name
      const index = document.createElement('span')
      index.className = 'dt-tract-index'; index.textContent = String(label.index)
      row.append(check, swatch, name, index)
      list.appendChild(row)
    }
    updateTractCount()
  }

  function applyAtlasDisplay() {
    if (!D.nv || D.nv.volumes.length < 2 || !D.atlasImage) return
    D.atlasImage.setColormapLabel(core.buildLabelLut(D.labels, D.visible, 1))
    const opacity = $('dtiShowAtlas').checked ? +$('dtiAtlasOpacity').value / 100 : 0
    D.nv.setOpacity(1, opacity)
  }

  function updateBackgroundDisplay() {
    if (!D.nv || !D.backgroundImage || D.nv.volumes.length < 1) return
    const metric = METRICS[D.metric]
    D.backgroundImage.setColormap(metric.colormap)
    if (metric.min != null && metric.max != null) {
      D.backgroundImage.cal_min = metric.min
      D.backgroundImage.cal_max = metric.max
    }
    D.nv.setOpacity(0, +$('dtiBgOpacity').value / 100)
    D.nv.updateGLVolume()
  }

  function updateDataInfo() {
    const image = D.backgroundImage
    const dims = image && image.hdr && image.hdr.dims
    const shape = dims ? `${dims[1]} × ${dims[2]} × ${dims[3]}` : 'volume unavailable'
    $('dtiSrcTag').textContent = D.sourceName
    $('dtiDataInfo').textContent = `${METRICS[D.metric].name} · ${shape}`
  }

  function installVolumes() {
    if (!D.nv || !D.backgroundImage || !D.atlasImage) return
    ;[...D.nv.volumes].forEach(volume => D.nv.removeVolume(volume))
    D.nv.addVolume(D.backgroundImage)
    D.nv.addVolume(D.atlasImage)
    updateBackgroundDisplay()
    applyAtlasDisplay()
    D.nv.setAtlasOutline(+$('dtiOutline').value)
    applyViewMode()
    updateDataInfo()
    D.nv.drawScene()
  }

  async function loadAtlas(atlasId) {
    const atlas = core.ATLAS_CATALOG[atlasId]
    if (!atlas || !D.lib) return
    const token = ++D.loadToken
    showLoading(`Loading ${atlas.shortName}…`)
    try {
      const [response, atlasImage] = await Promise.all([
        fetch(atlas.labelsUrl),
        D.lib.NVImage.loadFromUrl({ url: atlas.volumeUrl, name: atlas.name }),
      ])
      if (!response.ok) throw new Error(`Could not load ${atlas.labelsUrl} (${response.status})`)
      const labels = core.hydrateLabels(core.parseFslAtlasXml(await response.text()))
      if (!labels.length) throw new Error(`${atlas.shortName} contains no readable labels`)
      if (token !== D.loadToken) return

      D.atlasId = atlasId
      D.atlasImage = atlasImage
      D.labels = labels
      D.visible = new Set(labels.map(label => label.index))
      $('dtiAtlasSelect').value = atlasId
      $('dtiAtlasDescription').textContent = `${atlas.description} ${atlas.citation}.`
      installVolumes()
      renderTractList()
      toast(`${atlas.shortName}: ${labels.length} tracts loaded`)
      if (window.diag) window.diag('info', 'DTI atlas loaded', atlas.name, labels.length + ' labels')
    } catch (error) {
      console.error(error)
      if (token !== D.loadToken) return
      toast(error.message || String(error), 'err')
      $('dtiTractList').textContent = ''
      const empty = document.createElement('div')
      empty.className = 'empty-state'; empty.textContent = `Atlas unavailable: ${error.message || error}`
      $('dtiTractList').appendChild(empty)
    } finally {
      if (token === D.loadToken) hideLoading()
    }
  }

  async function loadUserBackground(file) {
    if (!/\.nii(?:\.gz)?$/i.test(file.name)) {
      toast('Choose a NIfTI file (.nii or .nii.gz)', 'err'); return
    }
    showLoading(`Loading ${file.name}…`)
    try {
      const image = await D.lib.NVImage.loadFromFile({ file })
      D.backgroundImage = image
      D.sourceName = file.name
      installVolumes()
      toast(`Loaded ${file.name}`)
    } catch (error) {
      console.error(error); toast(error.message || String(error), 'err')
    } finally {
      hideLoading()
    }
  }

  function resetBackground() {
    if (!D.templateImage) return
    D.backgroundImage = D.templateImage
    D.sourceName = TEMPLATE.name
    D.metric = 'fa'; $('dtiMetric').value = 'fa'
    installVolumes()
    toast('Restored the JHU FA template')
  }

  function applyViewMode() {
    if (!D.nv) return
    const modes = {
      multi: D.nv.sliceTypeMultiplanar,
      axial: D.nv.sliceTypeAxial,
      sagittal: D.nv.sliceTypeSagittal,
      coronal: D.nv.sliceTypeCoronal,
      render: D.nv.sliceTypeRender,
    }
    D.nv.opts.multiplanarShowRender = D.lib.SHOW_RENDER.ALWAYS
    D.nv.setSliceType(modes[$('dtiViewMode').value] ?? D.nv.sliceTypeMultiplanar)
  }

  function resetView() {
    if (!D.nv) return
    D.nv.scene.crosshairPos = D.nv.mm2frac([0, 0, 0])
    D.nv.setRenderAzimuthElevation(290, 25)
    D.nv.drawScene()
  }

  function capturePane(pane) {
    if (!D.ready || !D.nv) return null
    const atlas = core.ATLAS_CATALOG[D.atlasId]
    const types = {
      multi: D.nv.sliceTypeMultiplanar,
      axial: D.nv.sliceTypeAxial,
      sagittal: D.nv.sliceTypeSagittal,
      coronal: D.nv.sliceTypeCoronal,
      render: D.nv.sliceTypeRender,
    }
    const labels = { multi: 'All views', axial: 'Axial', sagittal: 'Sagittal', coronal: 'Coronal', render: '3D render' }
    const previous = D.nv.opts.sliceType
    try {
      D.nv.setSliceType(types[pane] ?? types.multi)
      D.nv.drawScene()
      const url = $('dtiCanvas').toDataURL('image/png')
      if (!url || url.length < 200) return null
      return { url, tab: 'dti', label: `DTI · ${atlas.shortName} · ${labels[pane] || labels.multi}` }
    } catch (error) {
      console.error(error); return null
    } finally {
      D.nv.setSliceType(previous); D.nv.drawScene()
    }
  }

  function savePng() {
    const shot = capturePane($('dtiViewMode').value)
    if (!shot) { toast('The DTI view is not ready yet', 'err'); return }
    const link = document.createElement('a')
    link.href = shot.url
    link.download = `brain_dti_${D.atlasId}_${Date.now()}.png`
    link.click(); toast('PNG saved')
  }

  async function init() {
    setupUi()
    showLoading('Loading DTI viewer…')
    try {
      D.lib = await waitForNiivue()
      D.nv = new D.lib.Niivue({
        show3Dcrosshair: true,
        isOrientCube: true,
        backColor: [0.01, 0.015, 0.025, 1],
        crosshairColor: [0.95, 0.55, 0.15, 1],
        onLocationChange: data => { $('dtiLocation').textContent = data.string || 'Move the crosshair to inspect a tract' },
        logging: false,
      })
      await D.nv.attachTo('dtiCanvas')
      D.nv.opts.multiplanarShowRender = D.lib.SHOW_RENDER.ALWAYS
      D.nv.opts.crosshairGap = 8
      D.nv.opts.dragMode = D.nv.dragModes.pan
      D.nv.setMultiplanarPadPixels(6)

      D.templateImage = await D.lib.NVImage.loadFromUrl({
        url: TEMPLATE.url, name: TEMPLATE.name, colormap: 'gray',
      })
      D.backgroundImage = D.templateImage
      await loadAtlas(D.atlasId)
      resetView()
      D.ready = true
      hideLoading()
      if (window.diag) window.diag('info', 'DTI tab initialized')
    } catch (error) {
      console.error(error)
      const msg = $('dtiLoadingMsg')
      msg.style.color = 'var(--danger)'; msg.style.whiteSpace = 'pre-wrap'
      msg.textContent = `DTI viewer unavailable: ${error.message || error}`
      toast(error.message || String(error), 'err')
    }
  }

  window.dtiInit = function () {
    if (!D.initPromise) D.initPromise = init()
    return D.initPromise
  }
  window.dtiResume = function () {
    if (!D.ready || !D.nv) return
    try { D.nv.resizeListener(); D.nv.drawScene() } catch (error) { console.error(error) }
  }
  window.__captureDtiPane = capturePane
})()
