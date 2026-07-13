// ───── Tab switching (independent of Three.js load) ─────
const tabButtons = [...document.querySelectorAll('.tab-btn')]
let exploreInited = false, fmriInited = false, dtiInited = false
// GPU-context lifecycle (issues.md B2): each tab's WebGL context is created
// lazily exactly once (guarded by the *Inited flags below) and then reused —
// switching tabs only pauses/resumes the dirty-flag-gated RAF loops, it never
// allocates a new context, so repeated tab switching does not grow the live
// context count. We deliberately do NOT dispose()/forceContextLoss() a tab's
// renderer on hide: recreating NiiVue/three contexts mid-session risks
// CONTEXT_LOST and state-restore bugs that outweigh reclaiming one idle
// context. Steady GPU growth instead came from geometry/material rebuilds,
// which are now freed via disposeObject3D (B3).
function switchTab(name) {
  document.getElementById('view-figure').hidden  = name !== 'figure'
  document.getElementById('view-explore').hidden = name !== 'explore'
  document.getElementById('view-fmri').hidden    = name !== 'fmri'
  document.getElementById('view-dti').hidden     = name !== 'dti'
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  if (name === 'explore') {
    if (!exploreInited) { exploreInited = true; initExplore() }  // initExplore kicks startAnim()
    else startAnim()                                             // returning: resume the paused loop
  } else if (name === 'fmri') {
    if (!fmriInited) { fmriInited = true; fmriInit() }           // fmriInit kicks fmriStartAnim()
    else fmriStartAnim()
  } else if (name === 'dti') {
    // The DTI controller owns one NiiVue context and no RAF loop. Resize only
    // after the hidden panel becomes visible so its canvas gets real bounds.
    if (!dtiInited) { dtiInited = true; window.dtiInit() }
    else window.dtiResume()
  }
}
tabButtons.forEach(b => (b.onclick = () => switchTab(b.dataset.tab)))

// ───── Collapsible settings sections ─────
// Every settings panel with a bold header becomes a foldable dropdown so the
// long sidebars don't force endless scrolling. We wrap each header's following
// siblings in a .collapse-body and toggle a .collapsed class on click. The
// open/closed state is remembered per section in localStorage.
function initCollapsibleSections() {
  const SECTIONS = '.ex-section, .fm-section, .dti-section, #atlasSection, #slicePanel, #controlsPanel, #volumePanel, #regionPanel, #exportCliPanel'
  document.querySelectorAll(SECTIONS).forEach(sec => {
    if (sec.dataset.collapsibleInit) return
    // Only sections whose first real control is a bold label header become
    // dropdowns (skips e.g. the white-matter-tracts section, which is already
    // driven by its own checkbox).
    const header = sec.querySelector(':scope > .label-xs')
    if (!header) return
    sec.dataset.collapsibleInit = '1'
    sec.classList.add('collapsible')

    const body = document.createElement('div')
    body.className = 'collapse-body'
    let n = header.nextElementSibling
    while (n) { const next = n.nextElementSibling; body.appendChild(n); n = next }
    sec.appendChild(body)

    header.classList.add('collapse-toggle')
    header.setAttribute('role', 'button')
    header.setAttribute('tabindex', '0')

    const key = 'av-collapse:' + (sec.id || header.textContent.trim().slice(0, 32))
    try { if (localStorage.getItem(key) === '1') sec.classList.add('collapsed') } catch (e) {}

    const toggle = e => {
      // Don't fold when the click/keypress lands on a control inside the header
      // (e.g. the "Center" button in the MNI-position header).
      if (e.target.closest('button, input, select, a')) return
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
      }
      sec.classList.toggle('collapsed')
      try { localStorage.setItem(key, sec.classList.contains('collapsed') ? '1' : '0') } catch (e) {}
    }
    header.addEventListener('click', toggle)
    header.addEventListener('keydown', toggle)
  })
}
initCollapsibleSections()

// Shared, cached brain-bundle loader — both the Explore and fMRI tabs build
// their (independent) Three.js scenes from this single fetch.
let _bundlePromise = null
function getBundle() {
  if (!_bundlePromise) {
    _bundlePromise = fetch('./meshes/brain_bundle.json').then(r => {
      if (!r.ok) throw new Error('meshes/brain_bundle.json not found.\nRun:  python build_brain_bundle.py')
      return r.json()
    })
  }
  return _bundlePromise
}

// ───── Palettes ─────
const LOBE_COLORS = {
  Frontal: '#4e79a7', Parietal: '#59a14f', Temporal: '#e15759',
  Occipital: '#b07aa1', Limbic: '#f28e2b', Subcortical: '#76b7b2',
  Cerebellum: '#edc948', Other: '#8c8c8c',
}
const NETWORK_COLORS = {
  Visual: '#9b59b6', Somatomotor: '#5da3e0', DorsalAttention: '#2ecc71',
  Salience: '#e056fd', Limbic: '#f6c744', Frontoparietal: '#e67e22',
  DefaultMode: '#e74c3c', Subcortical: '#16a085', Cerebellar: '#f1c40f',
  Brainstem: '#95a5a6', Other: '#8c8c8c',
}
const HEMI_COLORS  = { L: '#4e79a7', R: '#e15759', M: '#b0b0b0' }
const SINGLE_COLOR = '#aab4c0'
function paletteFor(mode) {
  return mode === 'lobe' ? LOBE_COLORS
       : mode === 'network' ? NETWORK_COLORS
       : mode === 'hemisphere' ? HEMI_COLORS : null
}
function colorForGroup(mode, key) {
  const pal = paletteFor(mode)
  return pal ? (pal[key] || '#888888') : SINGLE_COLOR
}

// ───── Learn-mode descriptions ─────
// Keyed by the hemisphere-agnostic AAL3 base name (the _L/_R suffix is stripped
// before lookup). Each entry: what the region is + what it does.
const REGION_INFO = {
  Precentral: "The primary motor cortex (M1), forming the precentral gyrus. It sends commands to the muscles of the opposite side of the body; its map of the body is the classic 'motor homunculus'.",
  Frontal_Sup_2: "Superior frontal gyrus. Involved in higher cognition, working memory, and self-awareness; its medial part contributes to planning and motor control.",
  Frontal_Mid_2: "Middle frontal gyrus, much of the dorsolateral prefrontal cortex. Central to working memory, attention, planning, and executive control of behavior.",
  Frontal_Inf_Oper: "Inferior frontal gyrus, pars opercularis — part of Broca's area on the left. Supports speech production and the motor planning of language.",
  Frontal_Inf_Tri: "Inferior frontal gyrus, pars triangularis — part of Broca's area on the left. Involved in language production, syntax, and semantic selection.",
  Frontal_Inf_Orb_2: "Orbital part of the inferior frontal gyrus. Contributes to language, and to reward and emotional valuation via its orbitofrontal connections.",
  Rolandic_Oper: "Rolandic operculum, covering the insula where motor/sensory cortex meets it. Involved in motor control of the face, mouth, swallowing, and speech articulation.",
  Supp_Motor_Area: "Supplementary motor area (SMA). Plans and sequences movements, coordinates both hands, and helps initiate self-generated actions.",
  Olfactory: "Olfactory cortex region. Processes the sense of smell and links odors to memory and emotion.",
  Frontal_Sup_Medial: "Medial superior frontal gyrus, including pre-SMA and dorsomedial prefrontal cortex. Supports decision-making, social cognition, and the default-mode network.",
  Frontal_Med_Orb: "Medial orbitofrontal cortex. Encodes reward value and supports emotion-based decision-making; a core default-mode region.",
  Rectus: "Gyrus rectus, on the ventral medial frontal lobe. Part of the orbitofrontal system involved in emotion, reward, and social behavior.",
  OFCmed: "Medial orbitofrontal cortex. Represents the value and pleasantness of rewards and guides choice.",
  OFCant: "Anterior orbitofrontal cortex. Involved in reward valuation, expectation, and flexible decision-making.",
  OFCpost: "Posterior orbitofrontal cortex. Integrates taste, smell, and emotion to evaluate outcomes.",
  OFClat: "Lateral orbitofrontal cortex. Signals non-reward/punishment and supports behavioral flexibility and impulse control.",
  Insula: "Insular cortex, buried in the lateral sulcus. Integrates interoception (body state), taste, pain, and emotion, and is a hub of the salience network.",
  Cingulate_Mid: "Mid-cingulate cortex. Links emotion, pain, and cognitive control to action selection and conflict monitoring.",
  Cingulate_Post: "Posterior cingulate cortex. A central default-mode hub involved in self-referential thought, memory retrieval, and awareness.",
  ACC_pre: "Pregenual anterior cingulate cortex. Part of the salience/affective network involved in emotion regulation and error monitoring.",
  ACC_sup: "Supracallosal (dorsal) anterior cingulate cortex. Supports cognitive control, conflict detection, and effort-based decisions.",
  ACC_sub: "Subgenual anterior cingulate cortex. A key node for mood regulation, strongly implicated in depression.",
  Hippocampus: "The hippocampus. Essential for forming new long-term memories and for spatial navigation.",
  ParaHippocampal: "Parahippocampal gyrus. Feeds the hippocampus and supports memory encoding and the processing of spatial/scene context.",
  Amygdala: "The amygdala. Detects emotional salience — especially fear and threat — and drives emotional learning and autonomic responses.",
  Calcarine: "Primary visual cortex (V1), lining the calcarine sulcus. The first cortical stage of vision, mapping the visual field.",
  Cuneus: "Cuneus, in the medial occipital lobe. Early visual area processing the lower visual field.",
  Lingual: "Lingual gyrus. Visual area processing the upper visual field, color, and word/letter recognition.",
  Occipital_Sup: "Superior occipital gyrus. Higher visual area contributing to spatial and motion vision (dorsal stream).",
  Occipital_Mid: "Middle occipital gyrus. Higher visual area for object and motion processing.",
  Occipital_Inf: "Inferior occipital gyrus. Early stage of the ventral 'what' stream for object and face recognition.",
  Fusiform: "Fusiform gyrus. Specialized for recognizing faces, objects, and written words (the visual word form and fusiform face areas).",
  Postcentral: "Primary somatosensory cortex (S1), the postcentral gyrus. Receives touch, pressure, and body-position signals from the opposite side of the body.",
  Parietal_Sup: "Superior parietal lobule. Integrates sensation for spatial awareness, attention, and visually guided movement.",
  Parietal_Inf: "Inferior parietal lobule. Multisensory hub for attention, number sense, tool use, and language.",
  SupraMarginal: "Supramarginal gyrus. Involved in phonological processing, the perception of space, and interpreting gestures.",
  Angular: "Angular gyrus. Integrates language, number, and memory; a default-mode hub for semantic processing and concept retrieval.",
  Precuneus: "Precuneus, on the medial parietal lobe. A default-mode hub for self-awareness, visuospatial imagery, and episodic memory retrieval.",
  Paracentral_Lobule: "Paracentral lobule. The medial extension of the motor and sensory cortices, controlling and sensing the lower limb and pelvic floor.",
  Caudate: "Caudate nucleus, part of the basal ganglia (striatum). Involved in goal-directed action, learning, and the gating of movement and habits.",
  Putamen: "Putamen, part of the basal ganglia (striatum). Regulates movement and motor learning within cortico-basal-ganglia loops.",
  Pallidum: "Globus pallidus, a basal ganglia output nucleus. Tunes and inhibits motor signals to enable smooth, controlled movement.",
  N_Acc: "Nucleus accumbens, part of the ventral striatum. The brain's reward and motivation center, central to pleasure, reinforcement, and addiction.",
  Heschl: "Heschl's gyrus — primary auditory cortex. The first cortical stage for processing sound, including pitch and loudness.",
  Temporal_Sup: "Superior temporal gyrus. Processes auditory information and, especially on the left (Wernicke's area), the comprehension of speech.",
  Temporal_Pole_Sup: "Superior temporal pole. Part of the anterior temporal hub for semantic memory, social, and emotional processing.",
  Temporal_Mid: "Middle temporal gyrus. Supports language and semantic memory, and (area MT) the perception of visual motion.",
  Temporal_Pole_Mid: "Middle temporal pole. Anterior temporal region for semantic knowledge and social-emotional processing.",
  Temporal_Inf: "Inferior temporal gyrus. The end of the ventral visual stream, central to recognizing objects, faces, and forms.",
  VTA: "Ventral tegmental area, in the midbrain. Origin of dopamine pathways for reward, motivation, and reinforcement learning.",
  Red_N: "Red nucleus, in the midbrain. Contributes to motor coordination, especially of the limbs, via the rubrospinal tract.",
  Raphe_D: "Dorsal raphe nucleus, in the brainstem. The main source of serotonin to the forebrain, regulating mood, sleep, and arousal.",
}

const PREFIX_INFO = [
  ["Thal", "Thalamic nucleus. The thalamus is the brain's central relay station, gating sensory and motor signals to the cortex and regulating arousal and consciousness."],
  ["Cerebellum", "Cerebellar hemisphere lobule. The cerebellum coordinates movement — balance, timing, and precision — and the Crus lobules also contribute to cognition and language."],
  ["Vermis", "Cerebellar vermis. The midline cerebellum that coordinates posture, balance, gait, and eye movements."],
]

const THAL_INFO = {
  Thal_AV: "Anteroventral thalamic nucleus. Part of the Papez circuit — supports memory and spatial navigation.",
  Thal_IL: "Intralaminar thalamic nuclei. Regulate arousal, alertness, and attention, and relay to the striatum.",
  Thal_LGN: "Lateral geniculate nucleus. The thalamic relay that carries vision from the retina to the primary visual cortex.",
  Thal_LP: "Lateral posterior thalamic nucleus. Connects with parietal cortex for spatial attention and integration.",
  Thal_MDl: "Mediodorsal nucleus (lateral part). Relays to the prefrontal cortex, supporting cognition and emotion.",
  Thal_MDm: "Mediodorsal nucleus (medial part). Connects with prefrontal/limbic cortex for memory, emotion, and decision-making.",
  Thal_MGN: "Medial geniculate nucleus. The thalamic relay that carries hearing to the primary auditory cortex.",
  Thal_PuA: "Pulvinar (anterior). Part of the pulvinar, integrating visual attention across cortical areas.",
  Thal_PuI: "Pulvinar (inferior). Supports visual attention and the coordination of cortical visual processing.",
  Thal_PuL: "Pulvinar (lateral). Involved in directing visual attention and binding visual information.",
  Thal_PuM: "Pulvinar (medial). Links to attention, salience, and higher-order visual and cognitive processing.",
  Thal_VA: "Ventral anterior nucleus. A basal-ganglia–to–cortex relay for initiating and planning movement.",
  Thal_VL: "Ventral lateral nucleus. Relays cerebellar and basal-ganglia signals to motor cortex for movement coordination.",
  Thal_VPL: "Ventral posterolateral nucleus. The thalamic relay for body touch and proprioception to somatosensory cortex.",
}

function infoFor(meta) {
  const base = (meta.name.endsWith('_L') || meta.name.endsWith('_R'))
    ? meta.name.slice(0, -2) : meta.name
  if (THAL_INFO[base]) return THAL_INFO[base]
  if (REGION_INFO[base]) return REGION_INFO[base]
  for (const [pre, txt] of PREFIX_INFO) if (base.startsWith(pre)) return txt
  return "An anatomical parcel of the AAL3 atlas. Hover and explore neighboring regions to see how it fits into the surrounding network."
}
const HEMI_NAME = { L: 'Left hemisphere', R: 'Right hemisphere', M: 'Midline' }

// ───── State ─────
let THREE, renderer, scene, camera, brain, arcGroup, raycaster, pointer, tmp
let brainRadius = 2              // outer cortical radius (bounding sphere); set in buildScene
let gizmoRenderer, gizmoScene, gizmoCamera, gizmoCube   // orientation cube
let learnMode = false                                   // Learn-mode toggle
let regions = []                 // { meta, mesh, baseColor }
const byIndex = new Map()
let colorBy = 'lobe'
let hovered = null, selected = null
let groupHidden = new Set()
let spin = false
let needsRender = true
let exSearch = ''
// Connection arcs: [{ id, fromIdx, toIdx, color, height, thickness, headSize,
// mode('one'|'two'|'none'), opacity, visible, _obj, _mat }]. Endpoints follow the
// regions' world centroids, so arcs re-bend on explode.
let arcs = []
let arcSeq = 0
let selectedArc = null
let connectMode = false, connectSrc = null
// Per-region explode (0..1) and opacity (0..1, <1 = glass) live on each mesh's
// userData — a single source of truth. The global slider and the group sliders
// are bulk writers over those, and per-region settings survive switching the
// grouping mode (lobe / network / hemisphere).
const K = 1.0, PUSH = 0.25       // explode: offset = (base*K + dir*PUSH) * amount
const orb = { target: null, radius: 11, theta: 0, phi: 1.1 }
let INIT_ORB = null
let tweening = false, tweenStart = 0
const TWEEN_DUR = 950

// ───── White-matter tracts (schematic connectome wires) ─────
// Edges are inferred once from region centroids + network/lobe/hemisphere
// metadata (no DTI data ships with the app). Each tract is a tube that bows
// toward the brain interior so it reads as a fibre running *under* the cortex.
let tractGroup = null              // THREE.Group of tube meshes (child of `brain`)
let tractEdges = []                // { i, j, type, network, weight, a, b }
const tractOpts = {
  show: false, filter: 'all', network: 'all',
  types: { commissural: true, association: true, local: true, projection: true },
  density: 0.45, thickness: 0.35, opacity: 0.85, colorBy: 'type',
}
const TRACT_TYPE_COLORS = {
  commissural: '#e15759',   // interhemispheric (corpus-callosum-like)
  association: '#4e79a7',   // long intra-hemispheric, within a network
  local:       '#59a14f',   // short U-fibres between neighbouring gyri
  projection:  '#f28e2b',   // subcortical hub ↔ cortex (thalamo-cortical etc.)
}

// ───── Init ─────
async function importThree() {
  const cdns = [
    '../vendor/three/three.module.js',   // local vendored copy first (A3/A5)
    'https://unpkg.com/three@0.160.0/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  ]
  let last
  for (const u of cdns) {
    try { return await import(u) } catch (e) { last = e; console.warn('three CDN failed', u, e) }
  }
  throw new Error('Could not load Three.js from CDN.\n' + (last?.message || last))
}

async function initExplore() {
  const msg = document.getElementById('exploreLoadingMsg')
  try {
    msg.textContent = 'Loading 3D engine…'
    THREE = await importThree()
    // First init with a queued subject bundle if one is waiting; otherwise the
    // reference atlas (cached for later "back to atlas").
    let bundle
    if (_pendingSubject) {
      bundle = _pendingSubject; _pendingSubject = null
      _subjectSource = bundle._srcLabel || 'Your brain'
    } else {
      msg.textContent = 'Fetching brain meshes…'
      bundle = await getBundle(); _atlasBundle = bundle
    }
    buildScene(bundle)
    updateSourceBanner()
    document.getElementById('exploreLoading').classList.remove('active')
    startAnim()
  } catch (e) {
    console.error(e)
    msg.style.color = 'var(--danger)'; msg.style.whiteSpace = 'pre-wrap'
    msg.style.textAlign = 'center'; msg.style.padding = '0 24px'; msg.style.fontFamily = 'monospace'
    msg.textContent = 'Error: ' + (e.message || e)
  }
}

function b64decode(b64, Type) {
  const bin = atob(b64), len = bin.length, buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
  return new Type(buf.buffer)
}

// ═══════════════════════════════════════════════════════════════════════
//  MESH QUALITY  (level-of-detail to lighten load on weak machines)
// ═══════════════════════════════════════════════════════════════════════
// Vertex-clustering decimation: vertices that land in the same cubic grid cell
// (cell size = a fraction of each region's bounding-box diagonal) collapse to a
// single averaged vertex, and triangles that degenerate are dropped. Because the
// cell size scales per-region, every region keeps its shape and none vanishes.
// 'high' leaves the original geometry untouched; coarser levels trade silhouette
// detail for far fewer triangles -> less GPU/CPU cost. Shared by Explore + fMRI.
const MESH_QFRAC = { high: 0, medium: 0.012, low: 0.025, vlow: 0.05 }
let meshQuality = 'high'

function decimateGeometry(srcGeo, frac) {
  if (!frac || frac <= 0) return srcGeo
  const pos = srcGeo.getAttribute('position')
  const index = srcGeo.getIndex()
  srcGeo.computeBoundingBox()
  const bb = srcGeo.boundingBox
  const cell = bb.min.distanceTo(bb.max) * frac
  if (cell <= 0) return srcGeo
  const inv = 1 / cell, vCount = pos.count
  const cells = new Map()             // cellKey -> { sx, sy, sz, n, ni }
  const vCell = new Array(vCount)     // vertex -> its cell record
  for (let i = 0; i < vCount; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const key = (((x - bb.min.x) * inv) | 0) + ',' +
                (((y - bb.min.y) * inv) | 0) + ',' +
                (((z - bb.min.z) * inv) | 0)
    let c = cells.get(key)
    if (!c) { c = { sx: 0, sy: 0, sz: 0, n: 0, ni: -1 }; cells.set(key, c) }
    c.sx += x; c.sy += y; c.sz += z; c.n++
    vCell[i] = c
  }
  // One averaged vertex per occupied cell
  const newPos = new Float32Array(cells.size * 3)
  let ni = 0
  for (const c of cells.values()) {
    c.ni = ni
    newPos[ni * 3] = c.sx / c.n; newPos[ni * 3 + 1] = c.sy / c.n; newPos[ni * 3 + 2] = c.sz / c.n
    ni++
  }
  // Remap triangles, dropping any that collapsed to fewer than 3 distinct cells
  const newIdx = []
  const triLen = index ? index.count : vCount
  for (let i = 0; i + 2 < triLen; i += 3) {
    const a = vCell[index ? index.getX(i)     : i].ni
    const b = vCell[index ? index.getX(i + 1) : i + 1].ni
    const c = vCell[index ? index.getX(i + 2) : i + 2].ni
    if (a !== b && b !== c && a !== c) newIdx.push(a, b, c)
  }
  if (newIdx.length < 3) return srcGeo   // too aggressive - keep the original
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(newPos, 3))
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(newIdx), 1))
  g.computeVertexNormals()
  return g
}

// Swap each region mesh's geometry to the level-of-detail for `frac`.
// `fullGeo` (the pristine bundle geometry) is kept so we can raise quality again.
function applyMeshLOD(regionList, frac) {
  for (const rec of regionList) {
    const mesh = rec.mesh
    const full = mesh.userData && mesh.userData.fullGeo
    if (!full) continue
    const next = decimateGeometry(full, frac)
    if (mesh.geometry !== full && mesh.geometry !== next) mesh.geometry.dispose()
    mesh.geometry = next
  }
}

function setMeshQuality(level) {
  if (!Object.prototype.hasOwnProperty.call(MESH_QFRAC, level)) level = 'high'
  meshQuality = level
  const frac = MESH_QFRAC[level]
  if (Array.isArray(regions) && regions.length && regions[0].mesh) applyMeshLOD(regions, frac)
  if (typeof F !== 'undefined' && F && F.regions && F.regions.length) applyMeshLOD(F.regions, frac)
  const e1 = document.getElementById('exMeshQuality'); if (e1) e1.value = level
  const e2 = document.getElementById('fmMeshQuality'); if (e2) e2.value = level
  needsRender = true
  if (typeof F !== 'undefined' && F) F.need = true
}

// ═══════════════════════════════════════════════════════════════════════
//  Shared Three.js engine helpers (used by BOTH the Explore and fMRI tabs)
//  The two tabs hold their scene/camera/orb state differently (Explore uses
//  module-scope globals, fMRI uses the `F` object), so these helpers take a
//  small "context" of accessors + callbacks instead of touching state directly.
// ═══════════════════════════════════════════════════════════════════════

// Z-up custom orbit controls (no external dependency). `ctx` provides:
//   getCamera()  → the THREE.PerspectiveCamera (read lazily; may be reassigned)
//   orb          → { target, radius, theta, phi } state object (mutated in place)
//   getTmp()     → a scratch THREE.Vector3 (for pan view-dir math; read lazily)
//   onChange()   → called after any camera move (sets the tab's dirty flag)
//   onHover(e)   → pointermove hover handler
//   onClick(e)   → fired on a click (pointerup without significant drag)
//   setInitOrb(o)→ stores the initial { radius, theta, phi } for reset
// Returns { syncCam, attach } — syncCam re-derives camera position from orb;
// attach(canvas) wires pointer/wheel listeners and seeds orb from the camera.
function makeOrbitController(ctx) {
  function syncCam() {
    const cam = ctx.getCamera()
    const { target, radius, theta, phi } = ctx.orb
    cam.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.sin(phi) * Math.sin(theta),
      target.z + radius * Math.cos(phi))
    cam.lookAt(target)
    ctx.onChange()
  }
  function attach(canvas) {
    const cam = ctx.getCamera()
    const orb = ctx.orb
    const off = cam.position.clone().sub(orb.target)
    orb.radius = off.length()
    orb.theta = Math.atan2(off.y, off.x)
    orb.phi = Math.acos(Math.min(1, Math.max(-1, off.z / orb.radius)))
    ctx.setInitOrb({ radius: orb.radius, theta: orb.theta, phi: orb.phi })
    syncCam()

    let dragging = false, mode = 'rot', px = 0, py = 0, sx = 0, sy = 0
    canvas.addEventListener('pointerdown', e => {
      dragging = true; mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'
      px = sx = e.clientX; py = sy = e.clientY; canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', e => {
      ctx.onHover(e)
      if (!dragging) return
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY
      if (mode === 'rot') {
        orb.theta -= dx * 0.006
        orb.phi = Math.min(Math.PI - 0.05, Math.max(0.05, orb.phi - dy * 0.006))
      } else {
        const cam2 = ctx.getCamera()
        const scale = orb.radius * 0.0016
        const viewDir = ctx.getTmp().subVectors(orb.target, cam2.position).normalize()
        const right = new THREE.Vector3().crossVectors(viewDir, cam2.up).normalize()
        const up = new THREE.Vector3().crossVectors(right, viewDir).normalize()
        orb.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale)
      }
      syncCam()
    })
    const end = e => {
      if (dragging && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) ctx.onClick(e)
      dragging = false
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', () => (dragging = false))
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    canvas.addEventListener('wheel', e => {
      e.preventDefault()
      orb.radius = Math.min(60, Math.max(2, orb.radius * (1 + Math.sign(e.deltaY) * 0.08)))
      syncCam()
    }, { passive: false })
  }
  return { syncCam, attach }
}

// Raycaster pick shared by both tabs. `meshes` is the candidate list (Explore
// passes only visible regions; fMRI passes all brain children). Mutates the
// supplied `pointer` vector and `raycaster`, exactly as the originals did.
function raycastPick(renderer, raycaster, pointer, camera, meshes, e) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(meshes, false)
  return hits.length ? hits[0].object : null
}

function buildScene(bundle) {
  const canvas = document.getElementById('glExplore')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#0b0e14')

  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200)
  camera.up.set(0, 0, 1)                 // MNI/OBJ space: +Z is superior
  camera.position.set(6, -8, 5)

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const d1 = new THREE.DirectionalLight(0xffffff, 0.85); d1.position.set(5, -6, 8); scene.add(d1)
  const d2 = new THREE.DirectionalLight(0x8899bb, 0.4);  d2.position.set(-6, 5, -3); scene.add(d2)

  brain = new THREE.Group(); scene.add(brain)
  arcGroup = new THREE.Group(); scene.add(arcGroup)   // connection arcs (independent of brain meshes)
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2(); tmp = new THREE.Vector3()
  orb.target = new THREE.Vector3(0, 0, 0)

  populateRegions(bundle)
  initOrbit(canvas)
  buildGizmo()
  setupUI()
  applyColors()
  applyExplode()

  new ResizeObserver(() => resize()).observe(document.getElementById('exploreViewer'))
  resize()
}

// Build region meshes + connectome from a bundle. Safe to call again to swap the
// whole scene to a different bundle (atlas ↔ subject): it disposes the previous
// meshes/tracts/arcs and rebuilds. UI event wiring (setupUI) stays one-time; the
// data-dependent lists are re-rendered by reloadBundle.
function populateRegions(bundle) {
  // Tear down anything from a previous bundle.
  clearArcs()
  disposeTracts()
  for (const rec of regions) {
    const full = rec.mesh.userData && rec.mesh.userData.fullGeo
    if (full && full !== rec.mesh.geometry) full.dispose()
    rec.mesh.geometry.dispose()
    if (rec.mesh.material) rec.mesh.material.dispose()
    brain.remove(rec.mesh)
  }
  regions.length = 0
  byIndex.clear()
  selected = null; hovered = null

  for (const r of bundle.regions) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(b64decode(r.positions, Float32Array), 3))
    geo.setIndex(new THREE.BufferAttribute(b64decode(r.indices, Uint32Array), 1))
    geo.computeVertexNormals()
    // Phong instead of Standard/PBR: regions are flat solid colours (no
    // metalness/roughness needed), so the cheaper shader saves fragment work
    // across all ~162 meshes. Low shininess + dark specular keeps the matte look.
    const mat = new THREE.MeshPhongMaterial({
      color: 0xffffff, shininess: 8, specular: 0x111111, emissive: 0x000000,
    })
    const mesh = new THREE.Mesh(geo, mat)
    const base = new THREE.Vector3(r.centroid[0], r.centroid[1], r.centroid[2])
    mesh.userData = {
      meta: r, base, fullGeo: geo,
      dir: base.lengthSq() > 1e-8 ? base.clone().normalize() : new THREE.Vector3(0, 0, 1),
      userVisible: true,
      explode: 0,      // per-region explode amount (0..1)
      opacity: 1,      // per-region opacity (1 = solid, <1 = glass)
    }
    brain.add(mesh)
    const rec = { meta: r, mesh, baseColor: new THREE.Color() }
    regions.push(rec); byIndex.set(r.index, rec)
  }

  // Outer radius of the whole brain — arcs use it to clear the cortical surface.
  brainRadius = new THREE.Box3().setFromObject(brain)
    .getBoundingSphere(new THREE.Sphere()).radius || 2

  applyMeshLOD(regions, MESH_QFRAC[meshQuality])
  buildConnectome()
}

// Dispose every connection arc and reset arc state (used on bundle swap).
function clearArcs() {
  for (const a of arcs) {
    if (a._obj) { if (arcGroup) arcGroup.remove(a._obj); disposeArcObj(a._obj) }
    if (a._mat) a._mat.dispose()
  }
  arcs = []; arcSeq = 0; selectedArc = null
}

// ═══════════════════════════════════════════════════════════════════════
//  SUBJECT BUNDLE HAND-OFF  (from the segmentation tab → this explode view)
// ═══════════════════════════════════════════════════════════════════════
// viewer.js segments an uploaded T1, turns the labelled volume into a bundle
// (js/subject-mesh.js) and calls window.loadSubjectExploded(bundle). The bundle
// has the identical shape as the atlas bundle, so the whole explode/colour/
// isolate machinery works unchanged.
let _atlasBundle = null       // reference-atlas bundle, cached for "back to atlas"
let _pendingSubject = null    // subject bundle awaiting first-time init
let _subjectSource = null     // label for the source banner (or null = atlas)

function loadSubjectExploded(bundle, opts) {
  opts = opts || {}
  _pendingSubject = bundle
  _pendingSubject._srcLabel = opts.title
    ? `Your brain · ${opts.mode === 'advanced' ? 'parcellation' : 'tissue'} · ${opts.title}`
    : 'Your brain'
  if (exploreInited) { applyPendingSubject() }
  else { switchTab('explore') }   // initExplore() will pick up _pendingSubject
}

// Apply a queued subject bundle to an already-initialised scene.
function applyPendingSubject() {
  const bundle = _pendingSubject; _pendingSubject = null
  if (!bundle) return
  _subjectSource = bundle._srcLabel || 'Your brain'
  reloadBundle(bundle)
  switchTab('explore')
  updateSourceBanner()
}

// Swap the live scene to a different bundle and refresh all data-driven UI.
function reloadBundle(bundle) {
  selectMesh(null)
  groupHidden.clear()
  // A subject bundle with only midline ('M') hemispheres reads best by lobe.
  if (bundle.meta && bundle.meta.atlas === 'subject' &&
      !bundle.regions.some(r => r.hemisphere === 'L' || r.hemisphere === 'R')) {
    colorBy = 'lobe'
    const cb = document.getElementById('exColorBy'); if (cb) cb.value = 'lobe'
  }
  populateRegions(bundle)
  populateArcDropdowns()
  applyColors(); applyVisibility(); applyExplode()
  renderGroups(); renderRegionList(); renderArcList()
  resetView()
  needsRender = true
}

// Reload the reference atlas (fetched + cached lazily). Clears subject mode.
function backToAtlas() {
  const done = b => { _atlasBundle = b; _subjectSource = null; reloadBundle(b); updateSourceBanner() }
  if (_atlasBundle) { done(_atlasBundle); return }
  getBundle().then(done).catch(e => exToast('Could not load atlas: ' + (e.message || e), 'err'))
}

// Small banner shown over the explode viewer while a subject brain is loaded.
function updateSourceBanner() {
  const el = document.getElementById('exSourceBanner')
  if (!el) return
  if (_subjectSource) {
    el.hidden = false
    el.querySelector('.ex-src-label').textContent = _subjectSource
  } else {
    el.hidden = true
  }
}

function resize() {
  if (!renderer) return
  const v = document.getElementById('exploreViewer')
  const w = v.clientWidth || 1, h = v.clientHeight || 1
  renderer.setSize(w, h, false)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  needsRender = true
}

// ───── Orbit controls (Z-up, custom — no extra dependency) ─────
// Shared controller wired to the Explore tab's globals (see makeOrbitController).
const exOrbit = makeOrbitController({
  getCamera: () => camera,
  orb,
  getTmp: () => tmp,   // lazy: real `tmp` is created in buildScene
  onChange: () => { needsRender = true },
  onHover: e => onHover(e),
  onClick: e => handleClick(e),
  setInitOrb: o => { INIT_ORB = o },
})
function syncCam() { exOrbit.syncCam() }
function initOrbit(canvas) { exOrbit.attach(canvas) }
function resetView() {
  Object.assign(orb, INIT_ORB); orb.target.set(0, 0, 0); syncCam()
}

// ───── Orientation gizmo (labeled L/R · A/P · S/I cube) ─────
function makeFaceTexture(label, bg) {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 7; g.strokeRect(4, 4, 120, 120)
  g.fillStyle = '#fff'; g.font = "bold 74px -apple-system, 'Segoe UI', sans-serif"
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(label, 64, 70)
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4
  return t
}
function buildGizmo() {
  const canvas = document.getElementById('glGizmo')
  gizmoRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  gizmoRenderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  gizmoRenderer.setSize(84, 84, false)
  gizmoScene = new THREE.Scene()
  gizmoCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 20)
  gizmoCamera.up.set(0, 0, 1)
  gizmoScene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(3, -4, 5); gizmoScene.add(dl)
  // BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z.
  // MNI/scene space: +X=Right, +Y=Anterior, +Z=Superior.
  const faces = [
    ['R', '#e15759'], ['L', '#4e79a7'],
    ['A', '#59a14f'], ['P', '#434956'],
    ['S', '#e0a33a'], ['I', '#434956'],
  ]
  const mats = faces.map(([lab, col]) =>
    new THREE.MeshStandardMaterial({ map: makeFaceTexture(lab, col), roughness: 0.75 }))
  gizmoCube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats)
  gizmoScene.add(gizmoCube)
}
function syncGizmo() {
  if (!gizmoRenderer) return
  // View the cube from the same direction the main camera views the brain,
  // so the cube always reflects the current orientation.
  const dir = tmp.subVectors(camera.position, orb.target).normalize()
  gizmoCamera.position.copy(dir).multiplyScalar(3)
  gizmoCamera.up.copy(camera.up)
  gizmoCamera.lookAt(0, 0, 0)
  gizmoRenderer.render(gizmoScene, gizmoCamera)
}

// ───── Picking / highlight ─────
function pick(e) {
  const vis = regions.filter(r => r.mesh.visible).map(r => r.mesh)
  return raycastPick(renderer, raycaster, pointer, camera, vis, e)
}
function onHover(e) {
  const m = pick(e)
  if (m === hovered) return
  hovered = m; applyHighlight()
  // While a quiz question is open, don't leak the answer via the hover readout.
  if (quiz.active && quiz.awaiting) {
    document.getElementById('exploreHover').textContent =
      'Quiz — click the region you think is the answer'
    return
  }
  const meta = m && m.userData.meta
  document.getElementById('exploreHover').textContent = meta
    ? `${meta.displayName}  ·  ${meta.lobe} / ${meta.network} / ${meta.hemisphere}`
    : 'Hover a region to identify · drag to orbit · scroll to zoom'
}
function handleClick(e) {
  if (connectMode) { handleConnectClick(e); return }
  if (quiz.active && quiz.awaiting) { handleQuizAnswer(pick(e)); return }
  selectMesh(pick(e))
}
function selectMesh(m) {
  selected = m; applyHighlight(); updateListSelection(); updateLearnPanel()
  document.getElementById('exploreSel').textContent = m ? `Selected: ${m.userData.meta.displayName}` : ''
  if (tractOpts.show && tractOpts.filter === 'selected') updateTracts()
}
// Single material-state updater: combines per-region opacity (glass), selection
// focus dimming, and hover/selected emissive. Called after any colour, opacity,
// or selection change.
function applyHighlight() {
  const focus = !!selected
  for (const r of regions) {
    const mat = r.mesh.material
    const u = r.mesh.userData
    const isSel = focus && r.mesh === selected
    // Selecting a region dims every other region to focus on it; with nothing
    // selected, each region shows at its own opacity (glass).
    const op = focus ? (isSel ? 1 : 0.12) : u.opacity
    mat.opacity = op
    mat.transparent = op < 1
    mat.depthWrite = op >= 1                  // translucent → don't occlude (see-through)
    const glassy = !focus && u.opacity < 1    // real per-region glass, not focus-dimming
    // Glass = a hollow, see-through shell: render both faces (three does a proper
    // back-then-front pass for double-sided transparent mats) so the far wall of
    // the blob shows through, reading as volume rather than a thin translucent cap.
    // DOUBLE_SIDED is a compile-time #define + program-cache key, so flag a shader
    // rebuild only when the side actually flips (not every slider tick).
    const side = glassy ? THREE.DoubleSide : THREE.FrontSide
    if (mat.side !== side) { mat.side = side; mat.needsUpdate = true }
    // Keep the sheen faint. A strong specular hotspot adds light on top and reads
    // as polished *solid* plastic, masking the transparency instead of selling it.
    mat.shininess = glassy ? 24 : 8
    mat.specular.setHex(glassy ? 0x223140 : 0x111111)
    mat.emissive.setHex(isSel ? 0x2554b0 : (hovered && r.mesh === hovered ? 0x444a55 : 0x000000))
  }
  needsRender = true
}

// ───── Colour / grouping / visibility ─────
function groupKeyOf(r) { return colorBy === 'single' ? 'All' : r.meta[colorBy] }
function applyColors() {
  for (const r of regions) {
    r.baseColor.set(colorForGroup(colorBy, groupKeyOf(r)))
    r.mesh.material.color.copy(r.baseColor)
  }
  applyHighlight()
}
function applyVisibility() {
  for (const r of regions)
    r.mesh.visible = r.mesh.userData.userVisible && !groupHidden.has(groupKeyOf(r))
  if (tractOpts.show) updateTracts()   // drop wires whose endpoints are now hidden
  needsRender = true
}
function groupList() {
  const counts = new Map()
  for (const r of regions) { const k = groupKeyOf(r); counts.set(k, (counts.get(k) || 0) + 1) }
  let keys = [...counts.keys()]
  const pal = paletteFor(colorBy)
  if (pal) {
    const order = Object.keys(pal)
    keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  } else keys.sort()
  return keys.map(k => ({ key: k, count: counts.get(k) }))
}
function renderGroups() {
  const el = document.getElementById('exGroupList')
  if (colorBy === 'single') {
    el.innerHTML = '<div class="file-hint">Single colour — no groups. Use the global Explode slider above, or the per-region sliders below.</div>'
    return
  }
  // Events are delegated from #exGroupList (bound once in setupUI), so this can
  // re-render freely without re-binding listeners.
  el.innerHTML = groupList().map(g => {
    const exp = Math.round(groupAvg(g.key, 'explode') * 100)
    const op  = Math.round(groupAvg(g.key, 'opacity') * 100)
    return `
    <div class="group-item" data-key="${g.key}">
      <div class="gi-top" title="Click to isolate this group">
        <span class="g-swatch" style="background:${colorForGroup(colorBy, g.key)}"></span>
        <span class="g-name${groupHidden.has(g.key) ? ' off' : ''}">${g.key}</span>
        <span class="g-count">${g.count}</span>
      </div>
      <div class="gi-ctrls">
        <span class="gi-lbl" title="Explode this group">⤢</span>
        <input type="range" class="gi-exp" min="0" max="100" value="${exp}" title="Explode ${g.key}">
        <span class="gi-lbl" title="Opacity / glass">◐</span>
        <input type="range" class="gi-op" min="0" max="100" value="${op}" title="Opacity ${g.key}">
      </div>
    </div>`
  }).join('')
}
function isolateGroup(key) {
  const keys = groupList().map(g => g.key)
  const onlyThis = groupHidden.size === keys.length - 1 && !groupHidden.has(key)
  groupHidden = onlyThis ? new Set() : new Set(keys.filter(k => k !== key))
  applyVisibility(); renderGroups(); renderRegionList()
}

// ───── Region list ─────
// The list mirrors what is actually on screen: regions whose group has been
// isolated away (groupHidden) are excluded, and the count reflects effective
// (group × per-region) visibility — not just the per-region checkbox.
function filtered() {
  return regions.filter(r =>
    (!exSearch || r.meta.displayName.toLowerCase().includes(exSearch)) &&
    !groupHidden.has(groupKeyOf(r)))
}
function renderRegionList() {
  const list = document.getElementById('exRegionList'), cnt = document.getElementById('exCount')
  const shown = filtered()
  const vis = regions.filter(r => r.mesh.visible).length
  cnt.textContent = `${vis}/${regions.length} visible` + (exSearch ? ` — ${shown.length} match` : '')
  if (!shown.length) { list.innerHTML = '<div class="empty-state">No matching regions</div>'; return }
  // Events are delegated from #exRegionList (bound once in setupUI), so re-rendering
  // here doesn't re-bind anything; slider values are re-derived from userData.
  list.innerHTML = shown.map(r => {
    const col = colorForGroup(colorBy, groupKeyOf(r))
    const sel = selected && selected === r.mesh ? ' selected' : ''
    const u = r.mesh.userData
    const exp = Math.round(u.explode * 100), op = Math.round(u.opacity * 100)
    return `<div class="region-item${sel}" data-idx="${r.meta.index}">
      <div class="ri-top">
        <input type="checkbox" ${u.userVisible ? 'checked' : ''} data-vis="${r.meta.index}">
        <span class="g-swatch" style="background:${col}"></span>
        <span class="r-name ${u.userVisible ? '' : 'off'}" title="${escapeHtml(r.meta.displayName)}">${escapeHtml(r.meta.displayName)}</span>
      </div>
      <div class="ri-ctrls">
        <span class="ri-lbl" title="Explode">⤢</span>
        <input type="range" class="ri-exp" min="0" max="100" value="${exp}">
        <span class="ri-lbl" title="Opacity / glass">◐</span>
        <input type="range" class="ri-op" min="0" max="100" value="${op}">
      </div>
    </div>`
  }).join('')
}
function updateListSelection() {
  document.querySelectorAll('#exRegionList .region-item').forEach(row =>
    row.classList.toggle('selected', selected && byIndex.get(+row.dataset.idx)?.mesh === selected))
}

// ───── Learn mode ─────
function setLearnMode(on) {
  if (on && quiz.active) endQuiz()      // the two selection modes can't coexist
  learnMode = on
  const btn = document.getElementById('exLearn')
  btn.classList.toggle('active', on)
  btn.textContent = on ? 'Learn: on' : 'Learn'
  document.getElementById('learnPanel').hidden = !on
  if (on) updateLearnPanel()
  resize()   // viewer width changed as the panel shows/hides
}
function updateLearnPanel() {
  const panel = document.getElementById('learnPanel')
  if (!learnMode) { panel.hidden = true; return }
  panel.hidden = false
  const body  = document.getElementById('learnBody')
  const title = document.getElementById('learnTitle')
  if (!selected) {
    title.textContent = 'Learn mode'
    body.innerHTML = '<div class="learn-empty">Click a brain area — in the 3D view or the region list below — to read what it is and what it does.</div>'
    return
  }
  const meta = selected.userData.meta
  title.textContent = meta.displayName
  const lobeCol = colorForGroup('lobe', meta.lobe)
  const netCol  = colorForGroup('network', meta.network)
  const hemiCol = colorForGroup('hemisphere', meta.hemisphere)
  body.innerHTML = `
    <div class="learn-chips">
      <span class="learn-chip"><span class="dot" style="background:${hemiCol}"></span>${HEMI_NAME[meta.hemisphere] || meta.hemisphere}</span>
      <span class="learn-chip"><span class="dot" style="background:${lobeCol}"></span>${meta.lobe}</span>
      <span class="learn-chip"><span class="dot" style="background:${netCol}"></span>${meta.network}</span>
    </div>
    <div class="learn-section-lbl">What it is &amp; what it does</div>
    <p>${infoFor(meta)}</p>
    <div class="learn-section-lbl">Atlas reference</div>
    <p>${escapeHtml(meta.name)} · region #${meta.index} · AAL3 atlas.</p>
    <div class="netmap-note" style="margin-top:14px;">Functional-network label is approximate (AAL3 to Yeo-style).</div>`
}

// ───── Explode / glass (per-region, with group + global bulk writers) ─────
function applyExplode() {
  for (const r of regions) {
    const u = r.mesh.userData
    r.mesh.position.copy(u.base).multiplyScalar(K).addScaledVector(u.dir, PUSH).multiplyScalar(u.explode)
  }
  if (tractOpts.show) buildTractGeometry()   // rebuild wires from moved centroids so they follow
  updateArcs()                               // connection arcs follow the regions' moved centroids
  needsRender = true
}

// Members of a group (for the current grouping) and the group's average of a
// per-region attribute — used to position the group sliders.
function membersOf(key) { return regions.filter(r => groupKeyOf(r) === key) }
function groupAvg(key, prop) {
  const m = membersOf(key)
  return m.length ? m.reduce((s, r) => s + r.mesh.userData[prop], 0) / m.length : 0
}
function setGroupExplode(key, amt) { membersOf(key).forEach(r => (r.mesh.userData.explode = amt)); applyExplode() }
function setGroupOpacity(key, op)  { membersOf(key).forEach(r => (r.mesh.userData.opacity = op));  applyHighlight() }

// The global slider / buttons are bulk writers over every region.
function setAllExplode(amt) { for (const r of regions) r.mesh.userData.explode = amt; applyExplode() }
function globalExplodeAvg() {
  return regions.length ? regions.reduce((s, r) => s + r.mesh.userData.explode, 0) / regions.length : 0
}
function setGlobalExplodeReadout() {
  const p = Math.round(globalExplodeAvg() * 100)
  document.getElementById('exExplode').value = p
  document.getElementById('exExplodeRd').textContent = p + '%'
}

// Reflect current per-region values back into the group / region slider DOM
// (after a bulk change) without re-rendering the lists.
function syncGroupSliders() {
  document.querySelectorAll('#exGroupList .group-item').forEach(it => {
    const k = it.dataset.key
    const e = it.querySelector('.gi-exp'); if (e) e.value = Math.round(groupAvg(k, 'explode') * 100)
    const o = it.querySelector('.gi-op');  if (o) o.value = Math.round(groupAvg(k, 'opacity') * 100)
  })
}
function syncRegionSliders() {
  document.querySelectorAll('#exRegionList .region-item').forEach(row => {
    const rec = byIndex.get(+row.dataset.idx); if (!rec) return
    const u = rec.mesh.userData
    const e = row.querySelector('.ri-exp'); if (e) e.value = Math.round(u.explode * 100)
    const o = row.querySelector('.ri-op');  if (o) o.value = Math.round(u.opacity * 100)
  })
}

// Per-region tween (Explode / Reassemble buttons): each region eases from its
// current amount to the shared target, so groups already moved stay coherent.
function tweenExplode(target) {
  for (const r of regions) { const u = r.mesh.userData; u.expFrom = u.explode; u.expTo = target }
  tweenStart = performance.now(); tweening = true
}

// ───── White-matter tracts ─────
function stripHemi(name) { return /_(L|R)$/.test(name) ? name.slice(0, -2) : name }
function isSubcortical(meta) {
  return meta.lobe === 'Subcortical' || meta.lobe === 'Cerebellum' ||
         meta.network === 'Subcortical' || meta.network === 'Brainstem'
}

// Build the (one-time) edge list from region geometry + metadata. Four classes:
//   commissural — homotopic L↔R pair of the same region
//   association — k-nearest same-network, same-hemisphere cortical regions
//   local       — k-nearest same-lobe, short-range U-fibres
//   projection  — subcortical hubs to their nearest cortical regions
function buildConnectome() {
  tractEdges = []
  const seen = new Set()
  const keyOf = (a, b) => (a < b ? a + '_' + b : b + '_' + a)
  const vec = r => new THREE.Vector3(r.meta.centroid[0], r.meta.centroid[1], r.meta.centroid[2])
  const pos = new Map(regions.map(r => [r, vec(r)]))
  const dist = (a, b) => pos.get(a).distanceTo(pos.get(b))
  const sharedNet = (a, b) =>
    (a.meta.network === b.meta.network && a.meta.network !== 'Other') ? a.meta.network : 'mixed'
  const SCALE = 1.0
  const add = (a, b, type, weight) => {
    const k = keyOf(a.meta.index, b.meta.index)
    if (seen.has(k)) return
    seen.add(k)
    tractEdges.push({
      i: a.meta.index, j: b.meta.index, type, network: sharedNet(a, b),
      weight, a: pos.get(a).clone(), b: pos.get(b).clone(),
    })
  }

  // 1) Commissural — homotopic L↔R of the same base region.
  const rightByBase = new Map()
  for (const r of regions) if (r.meta.hemisphere === 'R') rightByBase.set(stripHemi(r.meta.name), r)
  for (const r of regions) if (r.meta.hemisphere === 'L') {
    const partner = rightByBase.get(stripHemi(r.meta.name))
    if (partner) add(r, partner, 'commissural', 0.95)
  }

  // 2/3) Association + local U-fibres — k-nearest within the same hemisphere.
  const cortical = regions.filter(r => !isSubcortical(r.meta))
  for (const r of cortical) {
    const near = cortical
      .filter(o => o !== r && o.meta.hemisphere === r.meta.hemisphere)
      .sort((x, y) => dist(r, x) - dist(r, y))
    let assoc = 0, local = 0
    for (const o of near) {
      const d = dist(r, o)
      if (d > 2.2) break
      const w = Math.exp(-d / SCALE)
      if (o.meta.network === r.meta.network && r.meta.network !== 'Other' && assoc < 3) {
        add(r, o, 'association', w); assoc++
      } else if (o.meta.lobe === r.meta.lobe && d < 1.0 && local < 3) {
        add(r, o, 'local', w); local++
      }
    }
  }

  // 4) Projection — subcortical hubs (not cerebellum) to nearest cortex, same hemi.
  const hubs = regions.filter(r => isSubcortical(r.meta) && r.meta.lobe !== 'Cerebellum')
  for (const h of hubs) {
    const near = cortical
      .filter(o => o.meta.hemisphere === h.meta.hemisphere || h.meta.hemisphere === 'M')
      .sort((x, y) => dist(h, x) - dist(h, y))
    let n = 0
    for (const o of near) {
      const d = dist(h, o)
      if (d > 1.8 || n >= 3) break
      add(h, o, 'projection', Math.exp(-d / SCALE) * 0.85); n++
    }
  }
}

function tractColor(e) {
  if (tractOpts.colorBy === 'single') return '#9fb3c8'
  if (tractOpts.colorBy === 'network') return NETWORK_COLORS[e.network] || '#8c8c8c'
  return TRACT_TYPE_COLORS[e.type] || '#8c8c8c'
}

// Filter predicate: type toggles, density (min weight), endpoint visibility,
// and the Show mode (all / selected region / within a network).
function tractPasses(e) {
  if (!tractOpts.types[e.type]) return false
  if (e.weight < (1 - tractOpts.density) * 0.9) return false   // higher density ⇒ more wires
  const ra = byIndex.get(e.i), rb = byIndex.get(e.j)
  if (!ra || !rb || !ra.mesh.visible || !rb.mesh.visible) return false
  if (tractOpts.filter === 'selected') {
    if (!selected) return false
    const si = selected.userData.meta.index
    if (e.i !== si && e.j !== si) return false
  } else if (tractOpts.filter === 'network') {
    if (tractOpts.network !== 'all' && e.network !== tractOpts.network) return false
  }
  return true
}

// Recursively free GPU resources (geometry, material(s), and any textures held
// by those materials) for an Object3D before it's discarded, so repeated
// rebuilds — tracts, connection arcs, gizmo faces — don't leak GPU memory over
// a long session (issues.md B3).
function disposeObject3D(root) {
  if (!root) return
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose() }
      m.dispose()
    }
  })
}

function disposeTracts() {
  if (!tractGroup) return
  disposeObject3D(tractGroup)
  brain.remove(tractGroup)
  tractGroup = null
}

function buildTractGeometry() {
  disposeTracts()
  tractGroup = new THREE.Group()
  brain.add(tractGroup)
  const radius = 0.004 + tractOpts.thickness * 0.03
  let count = 0
  for (const e of tractEdges) {
    if (!tractPasses(e)) continue
    // Live endpoints (region centroid + current explode offset) so wires stretch
    // and follow the regions as the brain explodes; fall back to the assembled
    // centroids if a region is missing.
    const a = arcEndpoint(e.i) || e.a
    const b = arcEndpoint(e.j) || e.b
    // Route under the cortex: pull the midpoint toward the brain interior.
    const ctrl = a.clone().add(b).multiplyScalar(0.5 * 0.55)
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b)
    const segs = e.type === 'local' ? 10 : 18
    const geo = new THREE.TubeGeometry(curve, segs, radius, 6, false)
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tractColor(e)),
      transparent: true, opacity: tractOpts.opacity, depthWrite: false,
    })
    tractGroup.add(new THREE.Mesh(geo, mat))
    count++
  }
  updateTractFade()
  const cnt = document.getElementById('exTractCount')
  if (cnt) cnt.textContent = `${count} tract${count === 1 ? '' : 's'} shown`
  needsRender = true
}

// Apply the current tract opacity to all wires (used by the opacity slider and
// after a rebuild). Wires now follow the exploded regions rather than fading.
function updateTractFade() {
  if (!tractGroup) return
  for (const t of tractGroup.children) t.material.opacity = tractOpts.opacity
  needsRender = true
}

// Single entry point: build or tear down to match tractOpts.show.
function updateTracts() {
  if (!THREE || !brain) return
  if (!tractOpts.show) {
    disposeTracts()
    const cnt = document.getElementById('exTractCount'); if (cnt) cnt.textContent = ''
    needsRender = true
    return
  }
  buildTractGeometry()
}

// ───── Connections (user-defined arc arrows between regions) ─────
// Each arc's endpoints are the live world centroids of two regions (base centroid
// + the region's current explode offset), so arcs re-bend as regions move.
function arcEndpoint(idx) {
  const rec = byIndex.get(idx)
  return rec ? rec.mesh.userData.base.clone().add(rec.mesh.position) : null
}
function disposeArcObj(o) {
  // Also frees the per-arc materials (the old version leaked them) — B3.
  disposeObject3D(o)
}
function makeArcObject(arc) {
  const g = new THREE.Group()
  const pA = arcEndpoint(arc.fromIdx), pB = arcEndpoint(arc.toIdx)
  if (!pA || !pB) return g
  const dist = Math.max(pA.distanceTo(pB), 1e-3)
  // A CUBIC Bézier whose two control points both pull toward ONE shared apex
  // above the midpoint, so the whole connection is a single clean arch. (Lifting
  // each endpoint independently along its own radial broke down for far-apart
  // regions on opposite sides — e.g. precentral ↔ cerebellum — where the two
  // radials point opposite ways, producing an S-shaped curve whose arrowhead
  // ended up aimed at the wrong region.) The apex sits outside the cortex so the
  // arch clears the brain; a small radial nudge at each endpoint makes the tube
  // peel cleanly off the surface instead of staying buried in the mesh.
  //   outward — arches up and out of the brain surface (default, "out of brain")
  //   over    — arches straight up over the top
  //   inward  — dips toward the brain centre (under the cortex)
  const surf  = brainRadius || 2
  const route = arc.route || 'outward'
  const bulge = dist * arc.height
  const up    = new THREE.Vector3(0, 0, 1)
  const mid   = pA.clone().add(pB).multiplyScalar(0.5)
  const dirA  = pA.lengthSq() > 1e-6 ? pA.clone().normalize() : up.clone()
  const dirB  = pB.lengthSq() > 1e-6 ? pB.clone().normalize() : up.clone()
  let apex, edgeLift
  if (route === 'over') {
    // single apex straight above the midpoint
    const lift = Math.max(surf - mid.z, 0) + surf * 0.30 + bulge * 0.6
    apex = mid.clone().addScaledVector(up, lift)
    edgeLift = up
  } else if (route === 'inward') {
    // a shared nadir pulled toward (but not past) the brain centre
    const mDir = mid.lengthSq() > 1e-6 ? mid.clone().normalize() : up.clone()
    const dip  = Math.min(mid.length() * 0.7 + surf * 0.1, surf * 0.55)
    apex = mid.clone().addScaledVector(mDir, -dip)
    edgeLift = null
  } else { // 'outward' (default)
    // apex radially outside the cortex, above the midpoint of the two regions
    const mDir = mid.lengthSq() > 1e-6 ? mid.clone().normalize() : up.clone()
    const lift = Math.max(surf - mid.length(), 0) + surf * 0.30 + bulge * 0.6
    apex = mid.clone().addScaledVector(mDir, lift)
    edgeLift = null   // use each endpoint's own radial for the peel-off nudge
  }
  // Control points: halfway from each endpoint toward the shared apex, plus a
  // small lift along the surface normal so the tube leaves the cortex cleanly.
  const nudge = surf * 0.12
  const c1 = pA.clone().lerp(apex, 0.5).addScaledVector(edgeLift || dirA, route === 'inward' ? 0 : nudge)
  const c2 = pB.clone().lerp(apex, 0.5).addScaledVector(edgeLift || dirB, route === 'inward' ? 0 : nudge)
  const curve = new THREE.CubicBezierCurve3(pA, c1, c2, pB)
  const col = new THREE.Color(arc.color)
  const sel = arc.id === selectedArc
  const mat = new THREE.MeshPhongMaterial({
    color: col, emissive: col.clone().multiplyScalar(sel ? 0.6 : 0.22), shininess: 50,
    transparent: arc.opacity < 1, opacity: arc.opacity, depthWrite: arc.opacity >= 1,
  })
  arc._mat = mat
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, arc.thickness, 10, false), mat))
  const addHead = (t, sign) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(arc.headSize, arc.headSize * 2.2, 16), mat)
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      curve.getTangent(t).multiplyScalar(sign).normalize())
    cone.position.copy(curve.getPoint(t))
    g.add(cone)
  }
  if (arc.mode === 'one' || arc.mode === 'two') addHead(1, 1)    // head at target
  if (arc.mode === 'two') addHead(0, -1)                          // head at source
  return g
}
function rebuildArc(arc) {
  if (arc._obj) { arcGroup.remove(arc._obj); disposeArcObj(arc._obj) }
  if (arc._mat) arc._mat.dispose()
  arc._obj = makeArcObject(arc)
  arcGroup.add(arc._obj)
}
function updateArcs() {
  if (!arcGroup) return
  for (const a of arcs) rebuildArc(a)
  needsRender = true
}
function addArc(fromIdx, toIdx) {
  fromIdx = +fromIdx; toIdx = +toIdx
  if (!Number.isFinite(fromIdx) || !Number.isFinite(toIdx) || fromIdx === toIdx) {
    exToast('Pick two different regions', 'err'); return
  }
  const arc = {
    id: ++arcSeq, fromIdx, toIdx,
    color: '#ffd24a', height: 0.45, thickness: 0.02, headSize: 0.06,
    mode: 'one', route: 'outward', opacity: 1,
  }
  arcs.push(arc); selectedArc = arc.id
  rebuildArc(arc); needsRender = true
  renderArcList()
}
function removeArc(id) {
  const i = arcs.findIndex(a => a.id === id)
  if (i < 0) return
  const a = arcs[i]
  if (a._obj) { arcGroup.remove(a._obj); disposeArcObj(a._obj) }
  if (a._mat) a._mat.dispose()
  arcs.splice(i, 1)
  if (selectedArc === id) selectedArc = arcs.length ? arcs[Math.min(i, arcs.length - 1)].id : null
  needsRender = true
  renderArcList()
}
function selectArc(id) { selectedArc = id; updateArcs(); renderArcList() }

// ── Connect mode (click a source region, then a target) ──
function setConnectHint(txt) {
  const el = document.getElementById('exConnectHint'); if (el) el.textContent = txt || ''
}
function enterConnectMode() {
  connectMode = true; connectSrc = null
  document.getElementById('exConnect').classList.add('active')
  setConnectHint('Click source…')
  document.getElementById('exploreHover').textContent = 'Connect mode: click a source region, then a target (Esc to cancel)'
}
function exitConnectMode() {
  connectMode = false; connectSrc = null
  document.getElementById('exConnect').classList.remove('active')
  setConnectHint('')
}
function toggleConnectMode() { connectMode ? exitConnectMode() : enterConnectMode() }
function handleConnectClick(e) {
  const m = pick(e)
  if (!m) return
  const idx = m.userData.meta.index
  if (connectSrc == null) {
    connectSrc = idx
    setConnectHint(`Source: ${m.userData.meta.displayName} — click target`)
  } else {
    addArc(connectSrc, idx)
    exitConnectMode()
  }
}

// ── Region <select> options + arc list / editor rendering ──
function regionOptions(selIdx) {
  return regions.slice().sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName))
    .map(r => `<option value="${r.meta.index}"${r.meta.index === selIdx ? ' selected' : ''}>${escapeHtml(r.meta.displayName)}</option>`)
    .join('')
}
function populateArcDropdowns() {
  const from = document.getElementById('exArcFrom'), to = document.getElementById('exArcTo')
  if (!from || !to) return
  from.innerHTML = regionOptions(); to.innerHTML = regionOptions()
  if (to.options.length > 1) to.selectedIndex = 1   // default From ≠ To
}
function renderArcList() {
  const el = document.getElementById('exArcList')
  if (!el) return
  if (!arcs.length) {
    el.innerHTML = '<div class="file-hint">No connections yet — press “+ Connect” and click two regions, or pick From/To above.</div>'
    renderArcEditor(); return
  }
  el.innerHTML = arcs.map(a => {
    const A = byIndex.get(a.fromIdx)?.meta.displayName || ('#' + a.fromIdx)
    const B = byIndex.get(a.toIdx)?.meta.displayName || ('#' + a.toIdx)
    const sym = a.mode === 'two' ? '↔' : a.mode === 'one' ? '→' : '—'
    return `<div class="arc-item${a.id === selectedArc ? ' selected' : ''}" data-id="${a.id}">
      <span class="arc-dot" style="background:${a.color}"></span>
      <span class="arc-label" title="${A} ${sym} ${B}">${A} ${sym} ${B}</span>
      <button class="arc-del" data-del="${a.id}" title="Delete connection">×</button>
    </div>`
  }).join('')
  renderArcEditor()
}
function renderArcEditor() {
  const ed = document.getElementById('exArcEditor')
  if (!ed) return
  const a = arcs.find(x => x.id === selectedArc)
  if (!a) { ed.style.display = 'none'; ed.innerHTML = ''; return }
  ed.style.display = ''
  ed.innerHTML = `
    <div class="label-xs">Edit connection</div>
    <div class="ctrl-row"><span class="ctrl-lbl">Color</span>
      <input type="color" id="arcColor" value="${a.color}"></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Heads</span>
      <select id="arcMode">
        <option value="one"${a.mode === 'one' ? ' selected' : ''}>One-way →</option>
        <option value="two"${a.mode === 'two' ? ' selected' : ''}>Two-way ↔</option>
        <option value="none"${a.mode === 'none' ? ' selected' : ''}>None —</option>
      </select></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Route</span>
      <select id="arcRoute">
        <option value="outward"${(a.route || 'outward') === 'outward' ? ' selected' : ''}>Outward (out of brain)</option>
        <option value="over"${a.route === 'over' ? ' selected' : ''}>Over the top</option>
        <option value="inward"${a.route === 'inward' ? ' selected' : ''}>Inward (under cortex)</option>
      </select></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Arc</span>
      <input type="range" id="arcHeight" min="0" max="120" value="${Math.round(a.height * 100)}">
      <span class="mm-readout" id="arcHeightRd">${Math.round(a.height * 100)}</span></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Width</span>
      <input type="range" id="arcWidth" min="5" max="80" value="${Math.round(a.thickness * 1000)}">
      <span class="mm-readout" id="arcWidthRd">${Math.round(a.thickness * 1000)}</span></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Head</span>
      <input type="range" id="arcHead" min="20" max="200" value="${Math.round(a.headSize * 1000)}">
      <span class="mm-readout" id="arcHeadRd">${Math.round(a.headSize * 1000)}</span></div>
    <div class="ctrl-row"><span class="ctrl-lbl">Opacity</span>
      <input type="range" id="arcOpacity" min="10" max="100" value="${Math.round(a.opacity * 100)}">
      <span class="mm-readout" id="arcOpacityRd">${Math.round(a.opacity * 100)}%</span></div>
    <div class="btn-row" style="margin-top:6px;"><button id="arcDelete">Delete connection</button></div>`
  // Sliders update in place (no editor re-render) so dragging stays smooth.
  const live = (id, rd, fn, fmt) => {
    const el = document.getElementById(id)
    el.oninput = () => { fn(+el.value); document.getElementById(rd).textContent = fmt ? fmt(el.value) : el.value; rebuildArc(a); needsRender = true }
  }
  document.getElementById('arcColor').oninput = ev => {
    a.color = ev.target.value; rebuildArc(a); needsRender = true
    const dot = document.querySelector(`.arc-item[data-id="${a.id}"] .arc-dot`); if (dot) dot.style.background = a.color
  }
  document.getElementById('arcMode').onchange = ev => { a.mode = ev.target.value; rebuildArc(a); needsRender = true; renderArcList() }
  document.getElementById('arcRoute').onchange = ev => { a.route = ev.target.value; rebuildArc(a); needsRender = true }
  live('arcHeight', 'arcHeightRd', v => (a.height = v / 100))
  live('arcWidth', 'arcWidthRd', v => (a.thickness = v / 1000))
  live('arcHead', 'arcHeadRd', v => (a.headSize = v / 1000))
  live('arcOpacity', 'arcOpacityRd', v => (a.opacity = v / 100), v => v + '%')
  document.getElementById('arcDelete').onclick = () => removeArc(a.id)
}

// ───── UI wiring ─────
function setupUI() {
  // The global slider/buttons set every region uniformly (bulk); group and
  // per-region sliders then let you deviate. After a bulk change we sync the
  // group/region slider DOM so they all agree.
  const sl = document.getElementById('exExplode')
  sl.oninput = () => {
    tweening = false
    document.getElementById('exExplodeRd').textContent = sl.value + '%'
    setAllExplode(+sl.value / 100)
    syncGroupSliders(); syncRegionSliders()
  }
  // "Whole" snaps instantly to assembled; "Reassemble" animates back; "Explode" animates out
  document.getElementById('exWhole').onclick      = () => {
    tweening = false
    setAllExplode(0)
    setGlobalExplodeReadout(); syncGroupSliders(); syncRegionSliders()
  }
  document.getElementById('exExplodeBtn').onclick = () => tweenExplode(1)
  document.getElementById('exReassemble').onclick = () => tweenExplode(0)
  document.getElementById('exSpin').onchange = e => { spin = e.target.checked; needsRender = true }

  const cb = document.getElementById('exColorBy')
  cb.onchange = () => {
    colorBy = cb.value; groupHidden.clear()
    document.getElementById('exNetNote').style.display = colorBy === 'network' ? '' : 'none'
    applyColors(); applyVisibility(); renderGroups(); renderRegionList()
  }
  document.getElementById('exSearch').oninput = e => { exSearch = e.target.value.toLowerCase(); renderRegionList() }
  document.getElementById('exAll').onclick  = () => { filtered().forEach(r => (r.mesh.userData.userVisible = true));  applyVisibility(); renderRegionList() }
  document.getElementById('exNone').onclick = () => { filtered().forEach(r => (r.mesh.userData.userVisible = false)); applyVisibility(); renderRegionList() }
  document.getElementById('exClearSel').onclick = () => selectMesh(null)
  document.getElementById('exReset').onclick = () => resetView()
  const back = document.getElementById('exBackToAtlas')
  if (back) back.onclick = () => backToAtlas()
  document.getElementById('exScreenshot').onclick = () => savePNG()
  document.getElementById('exLearn').onclick = () => setLearnMode(!learnMode)
  document.getElementById('learnClose').onclick = () => setLearnMode(false)

  // ── Quiz mode ──
  document.getElementById('exQuiz').onclick   = () => quiz.active ? endQuiz() : startQuiz()
  document.getElementById('quizEnd').onclick  = () => endQuiz()
  document.getElementById('quizSkip').onclick = () => skipQuestion()
  document.getElementById('quizNext').onclick = () => nextQuestion()

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('view-explore').hidden) {
      if (quiz.active) endQuiz()
      else if (connectMode) exitConnectMode()
      else selectMesh(null)
    }
  })

  // ── Group list (delegated): isolate on header click, explode/opacity sliders ──
  const groupEl = document.getElementById('exGroupList')
  groupEl.addEventListener('click', e => {
    if (e.target.closest('.gi-ctrls')) return            // sliders handle themselves
    const top = e.target.closest('.gi-top'); if (!top) return
    isolateGroup(top.closest('.group-item').dataset.key)
  })
  groupEl.addEventListener('input', e => {
    const item = e.target.closest('.group-item'); if (!item) return
    const key = item.dataset.key
    if (e.target.classList.contains('gi-exp')) setGroupExplode(key, +e.target.value / 100)
    else if (e.target.classList.contains('gi-op')) setGroupOpacity(key, +e.target.value / 100)
    else return
    syncRegionSliders(); setGlobalExplodeReadout()
  })

  // ── Region list (delegated): survives innerHTML re-renders ──
  const regionEl = document.getElementById('exRegionList')
  regionEl.addEventListener('input', e => {
    const row = e.target.closest('.region-item'); if (!row) return
    const rec = byIndex.get(+row.dataset.idx); if (!rec) return
    if (e.target.classList.contains('ri-exp')) { rec.mesh.userData.explode = +e.target.value / 100; applyExplode() }
    else if (e.target.classList.contains('ri-op')) { rec.mesh.userData.opacity = +e.target.value / 100; applyHighlight() }
    else return
    syncGroupSliders(); setGlobalExplodeReadout()
  })
  regionEl.addEventListener('change', e => {
    if (!e.target.matches('input[data-vis]')) return
    const rec = byIndex.get(+e.target.dataset.vis); if (!rec) return
    rec.mesh.userData.userVisible = e.target.checked
    applyVisibility(); renderRegionList()
  })
  regionEl.addEventListener('click', e => {
    if (!e.target.closest('.r-name')) return
    const row = e.target.closest('.region-item'); if (!row) return
    const rec = byIndex.get(+row.dataset.idx); if (rec) selectMesh(rec.mesh)
  })
  regionEl.addEventListener('mouseover', e => {
    const row = e.target.closest('.region-item'); if (!row) return
    const rec = byIndex.get(+row.dataset.idx); if (rec && rec.mesh !== hovered) { hovered = rec.mesh; applyHighlight() }
  })
  regionEl.addEventListener('mouseout', e => {
    const row = e.target.closest('.region-item'); if (!row || row.contains(e.relatedTarget)) return
    hovered = null; applyHighlight()
  })

  // ── White-matter tracts ──
  const tShow = document.getElementById('exTractShow')
  tShow.onchange = () => {
    tractOpts.show = tShow.checked
    document.getElementById('exTractPanel').hidden = !tShow.checked
    updateTracts()
  }
  const tFilter = document.getElementById('exTractFilter')
  const tNet = document.getElementById('exTractNetwork')
  tNet.innerHTML = '<option value="all">All networks</option>' +
    Object.keys(NETWORK_COLORS).filter(k => k !== 'Other')
      .map(k => `<option value="${k}">${k}</option>`).join('')
  tFilter.onchange = () => {
    tractOpts.filter = tFilter.value
    tNet.hidden = tFilter.value !== 'network'
    updateTracts()
  }
  tNet.onchange = () => { tractOpts.network = tNet.value; updateTracts() }
  ;[['exTractCommissural', 'commissural'], ['exTractAssociation', 'association'],
    ['exTractLocal', 'local'], ['exTractProjection', 'projection']].forEach(([id, type]) => {
    document.getElementById(id).onchange = e => { tractOpts.types[type] = e.target.checked; updateTracts() }
  })
  const tDens = document.getElementById('exTractDensity')
  tDens.oninput = () => { tractOpts.density = +tDens.value / 100; if (tractOpts.show) buildTractGeometry() }
  const tThick = document.getElementById('exTractThick')
  tThick.oninput = () => { tractOpts.thickness = +tThick.value / 100; if (tractOpts.show) buildTractGeometry() }
  const tOp = document.getElementById('exTractOpacity')
  tOp.oninput = () => { tractOpts.opacity = +tOp.value / 100; updateTractFade() }
  const tCol = document.getElementById('exTractColor')
  tCol.onchange = () => { tractOpts.colorBy = tCol.value; if (tractOpts.show) buildTractGeometry() }

  // ── Connections (arc arrows) ──
  populateArcDropdowns()
  document.getElementById('exConnect').onclick = () => toggleConnectMode()
  document.getElementById('exArcAdd').onclick = () =>
    addArc(document.getElementById('exArcFrom').value, document.getElementById('exArcTo').value)
  const arcListEl = document.getElementById('exArcList')
  arcListEl.addEventListener('click', e => {
    const del = e.target.closest('.arc-del')
    if (del) { removeArc(+del.dataset.del); return }
    const row = e.target.closest('.arc-item')
    if (row) selectArc(+row.dataset.id)
  })
  renderArcList()

  renderGroups(); renderRegionList()
}

function savePNG() {
  renderer.render(scene, camera)
  const a = document.createElement('a')
  a.href = renderer.domElement.toDataURL('image/png')
  a.download = `brain_explore_${Date.now()}.png`
  a.click()
  exToast('PNG saved')
}
function exToast(msg, type) {
  const el = document.getElementById('exploreToast')
  el.textContent = msg; el.className = type === 'err' ? 'show err' : 'show'
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000)
}

// ───── Anatomy quiz ─────
// A click-to-identify game built on the same picking + highlight machinery as
// Learn mode. Three question styles keep it fresh: pinpoint a named region, or
// click *any* region belonging to a given lobe / functional network. Only the
// regions currently on screen are in play, so isolating a group scopes the quiz
// (e.g. drill just the temporal lobe).
const quiz = {
  active: false, awaiting: false, mode: 'find',
  target: null, groupKey: '', lastIdx: -1,
  correct: 0, total: 0, streak: 0, best: 0,
}

function quizPool() { return regions.filter(r => r.mesh.visible) }

function startQuiz() {
  const pool = quizPool()
  if (pool.length < 4) { exToast('Show at least 4 regions to start a quiz', 'err'); return }
  if (connectMode) exitConnectMode()
  if (learnMode) setLearnMode(false)
  quiz.active = true
  quiz.correct = quiz.total = quiz.streak = quiz.best = 0
  quiz.lastIdx = -1
  const btn = document.getElementById('exQuiz')
  btn.classList.add('active'); btn.textContent = 'Quiz: on'
  document.getElementById('quizPanel').hidden = false
  updateQuizScore()
  nextQuestion()
}

function endQuiz() {
  if (!quiz.active) return
  quiz.active = quiz.awaiting = false
  const btn = document.getElementById('exQuiz')
  btn.classList.remove('active'); btn.textContent = 'Quiz'
  document.getElementById('quizPanel').hidden = true
  selectMesh(null)
  document.getElementById('exploreHover').textContent =
    'Hover a region to identify · drag to orbit · scroll to zoom'
}

function nextQuestion() {
  const pool = quizPool()
  if (pool.length < 2) { endQuiz(); return }
  selectMesh(null)                       // clear any reveal highlight

  // Only offer group questions when the visible set spans ≥2 lobes/networks,
  // otherwise "click any region in X" is trivially the whole brain.
  const lobes    = new Set(pool.map(r => r.meta.lobe))
  const networks = new Set(pool.map(r => r.meta.network))
  const styles = ['find', 'find', 'find']
  if (lobes.size    >= 2) styles.push('lobe')
  if (networks.size >= 2) styles.push('network')
  quiz.mode = styles[Math.floor(Math.random() * styles.length)]

  const promptEl = document.getElementById('quizPrompt')
  if (quiz.mode === 'find') {
    // Pick a region, avoiding an immediate repeat of the previous target.
    let pick
    do { pick = pool[Math.floor(Math.random() * pool.length)] }
    while (pool.length > 1 && pick.meta.index === quiz.lastIdx)
    quiz.target = pick; quiz.lastIdx = pick.meta.index
    promptEl.innerHTML = `Find <b>${escapeHtml(pick.meta.displayName)}</b> in the 3-D brain.`
  } else {
    const key = quiz.mode === 'lobe'
      ? [...lobes][Math.floor(Math.random() * lobes.size)]
      : [...networks][Math.floor(Math.random() * networks.size)]
    quiz.target = null; quiz.groupKey = key
    const label = quiz.mode === 'lobe' ? 'lobe' : 'network'
    promptEl.innerHTML = `Click any region in the <b>${escapeHtml(key)}</b> ${label}.`
  }

  const fb = document.getElementById('quizFeedback')
  fb.className = 'quiz-feedback'; fb.innerHTML = ''
  document.getElementById('quizNext').hidden = true
  document.getElementById('quizSkip').hidden = false
  quiz.awaiting = true
}

function handleQuizAnswer(m) {
  if (!m) return                          // clicked empty space — let them retry
  const meta = m.userData.meta
  let correct
  if (quiz.mode === 'find')        correct = (m === quiz.target.mesh)
  else if (quiz.mode === 'lobe')   correct = (meta.lobe === quiz.groupKey)
  else                             correct = (meta.network === quiz.groupKey)

  quiz.awaiting = false
  quiz.total++
  if (correct) { quiz.correct++; quiz.streak++; quiz.best = Math.max(quiz.best, quiz.streak) }
  else quiz.streak = 0

  // Reveal: on a wrong "find" show the region they *should* have clicked;
  // otherwise highlight what they clicked.
  selectMesh(quiz.mode === 'find' && !correct ? quiz.target.mesh : m)
  showQuizFeedback(correct, meta, false)
  updateQuizScore()
}

function skipQuestion() {
  if (!quiz.awaiting) return
  quiz.streak = 0
  quiz.awaiting = false
  if (quiz.mode === 'find') selectMesh(quiz.target.mesh)
  showQuizFeedback(false, null, true)
  updateQuizScore()
}

function showQuizFeedback(correct, clickedMeta, skipped) {
  const fb = document.getElementById('quizFeedback')
  let html
  if (skipped) {
    fb.className = 'quiz-feedback show wrong'
    html = quiz.mode === 'find'
      ? `Skipped — this is <b>${escapeHtml(quiz.target.meta.displayName)}</b>.`
      : `Skipped.`
    if (quiz.mode === 'find') html += `<span class="qf-info">${escapeHtml(infoFor(quiz.target.meta))}</span>`
  } else if (correct) {
    fb.className = 'quiz-feedback show right'
    html = `✓ Correct — <b>${escapeHtml(clickedMeta.displayName)}</b>.`
    if (quiz.mode === 'find') html += `<span class="qf-info">${escapeHtml(infoFor(clickedMeta))}</span>`
    else html += `<span class="qf-info">It belongs to the ${escapeHtml(quiz.groupKey)} ${quiz.mode}.</span>`
  } else {
    fb.className = 'quiz-feedback show wrong'
    if (quiz.mode === 'find') {
      html = `✗ You clicked <b>${escapeHtml(clickedMeta.displayName)}</b>. The correct region is highlighted.`
      html += `<span class="qf-info">${escapeHtml(infoFor(quiz.target.meta))}</span>`
    } else {
      const clickedGroup = quiz.mode === 'lobe' ? clickedMeta.lobe : clickedMeta.network
      html = `✗ <b>${escapeHtml(clickedMeta.displayName)}</b> is ${escapeHtml(clickedGroup)}, not ${escapeHtml(quiz.groupKey)}.`
    }
  }
  fb.innerHTML = html
  document.getElementById('quizNext').hidden = false
  document.getElementById('quizSkip').hidden = true
}

function updateQuizScore() {
  document.getElementById('quizScore').textContent =
    `${quiz.correct} / ${quiz.total} correct`
  const s = document.getElementById('quizStreak')
  s.textContent = quiz.streak >= 2 ? `🔥 ${quiz.streak} streak` : (quiz.best >= 2 ? `best ${quiz.best}` : '')
}

// ───── Render loop ─────
// The loop only runs while the Explore tab is visible: when the tab is hidden
// it stops scheduling frames (saving CPU/GPU/battery) and switchTab() restarts
// it via startAnim() on the way back.
let animRunning = false
function startAnim() {
  if (animRunning) return
  animRunning = true
  needsRender = true   // force a redraw on resume (buffer isn't preserved while hidden)
  requestAnimationFrame(animate)
}
function animate() {
  if (document.getElementById('view-explore').hidden) { animRunning = false; return }
  requestAnimationFrame(animate)
  if (tweening) {
    const t = Math.min(1, (performance.now() - tweenStart) / TWEEN_DUR)
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2   // easeInOutQuad
    for (const r of regions) { const u = r.mesh.userData; u.explode = u.expFrom + (u.expTo - u.expFrom) * e }
    applyExplode(); setGlobalExplodeReadout()
    if (t >= 1) { tweening = false; syncGroupSliders(); syncRegionSliders() }
  }
  if (spin) { orb.theta += 0.0035; syncCam() }
  if (needsRender) { renderer.render(scene, camera); syncGizmo(); needsRender = false }
}

/* ═══════════════════════════════════════════════════════════════════════
   fMRI TAB — activation time-course playback on the AAL3 brain
   Its own Three.js scene (sharing the cached bundle + Three import). A time ×
   region activation matrix colours each region per frame; a transport "feeds"
   the current timepoint and a reference signal is plotted alongside. Ships with
   a synthetic block-design dummy; the user can drop in their own CSVs.
   ═══════════════════════════════════════════════════════════════════════ */
const F = {
  renderer: null, scene: null, camera: null, brain: null,
  raycaster: null, pointer: null, tmp: null,
  orb: { target: null, radius: 11, theta: 0, phi: 1.1 }, initOrb: null,
  regions: [], byIndex: new Map(), N: 0, T: 0, TR: 2,
  act: null, feeder: null, feederT: null, feederName: 'Feeder · task design',
  t: 0, idx: -1, playing: false, speed: 4, loop: true, lastNow: 0,
  vmaxRaw: 1, vmax: 1, gain: 1, thresh: 0.2, cmap: 'hot', feedSel: false, source: 'dummy',
  hovered: null, selected: null, need: true,
  compare: new Set(),   // region columns plotted alongside the seed on the time-course graph
  conn: null,           // ranked co-activation results for the current seed (see fmriComputeConn)
  // Association-analysis settings (driven by the top-right dropdown). Defaults
  // reproduce the original behaviour: α=0.05, no correction, top-5, both signs.
  alpha: 0.05,          // significance cutoff on the (corrected) p-value
  correction: 'none',   // 'none' | 'bonferroni' | 'fdr' — multiple-comparison adjustment
  topN: 5,              // how many top significant regions auto-plot on selection
  signFilter: 'both',   // 'both' | 'pos' | 'neg' — which correlation sign counts as associated
  showFeeder: true,     // draw the feeder reference line on the bottom graph
}

// Distinct colours for the comparison time-course lines (seed = #f6c744, feeder = #58a6ff).
const FM_LINE_COLORS = ['#e15759', '#59a14f', '#af7aa1', '#76b7b2', '#ff9da7', '#9c755f', '#edc948', '#8cd17d']

// NiiVue triple-slice strip (axial / sagittal / coronal). Built lazily once the
// fMRI tab opens; the AAL atlas overlay is recoloured by activation each frame.
const FS = { nv: null, ready: false, labels: [], labelToCol: null, failed: false, atlasImg: null }

async function fmriInit() {
  const msg = document.getElementById('fmriLoadingMsg')
  try {
    msg.textContent = 'Loading 3D engine…'
    if (!THREE) THREE = await importThree()
    msg.textContent = 'Fetching brain meshes…'
    const bundle = await getBundle()
    fmriBuildScene(bundle)
    fmriGenerateDummy()
    fmriSetupUI()
    fmriApplyData()
    document.getElementById('fmriLoading').classList.remove('active')
    fmriStartAnim()
    fmriInitSlices()   // builds the NiiVue slice strip in the background

  } catch (e) {
    console.error(e)
    msg.style.color = 'var(--danger)'; msg.style.whiteSpace = 'pre-wrap'
    msg.style.textAlign = 'center'; msg.style.padding = '0 24px'; msg.style.fontFamily = 'monospace'
    msg.textContent = 'Error: ' + (e.message || e)
  }
}

function fmriBuildScene(bundle) {
  const canvas = document.getElementById('glFmri')
  F.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  F.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  F.scene = new THREE.Scene(); F.scene.background = new THREE.Color('#06080d')
  F.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200)
  F.camera.up.set(0, 0, 1); F.camera.position.set(6, -8, 5)
  F.scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const d1 = new THREE.DirectionalLight(0xffffff, 0.7); d1.position.set(5, -6, 8); F.scene.add(d1)
  const d2 = new THREE.DirectionalLight(0x8899bb, 0.35); d2.position.set(-6, 5, -3); F.scene.add(d2)
  F.brain = new THREE.Group(); F.scene.add(F.brain)
  F.raycaster = new THREE.Raycaster(); F.pointer = new THREE.Vector2(); F.tmp = new THREE.Vector3()
  F.orb.target = new THREE.Vector3(0, 0, 0)
  F.regions = []; F.byIndex = new Map()
  bundle.regions.forEach((r, i) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(b64decode(r.positions, Float32Array), 3))
    geo.setIndex(new THREE.BufferAttribute(b64decode(r.indices, Uint32Array), 1))
    geo.computeVertexNormals()
    const mat = new THREE.MeshPhongMaterial({ color: 0x20242e, emissive: 0x000000, shininess: 18, specular: 0x222222 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.userData = { meta: r, col: i, fullGeo: geo }
    F.brain.add(mesh)
    const rec = { meta: r, mesh, col: i }
    F.regions.push(rec); F.byIndex.set(r.index, rec)
  })
  F.N = F.regions.length
  applyMeshLOD(F.regions, MESH_QFRAC[meshQuality])
  fmriInitOrbit(canvas)
  new ResizeObserver(() => fmriResize()).observe(document.getElementById('fmriRender'))
  fmriResize()
}

// ── Orbit (shared Z-up controls, wired to the `F` state object) ──
const fmriOrbit = makeOrbitController({
  getCamera: () => F.camera,
  orb: F.orb,
  getTmp: () => F.tmp,
  onChange: () => { F.need = true },
  onHover: e => fmriHover(e),
  onClick: e => fmriClick(e),
  setInitOrb: o => { F.initOrb = o },
})
function fmriSyncCam() { fmriOrbit.syncCam() }
function fmriInitOrbit(canvas) { fmriOrbit.attach(canvas) }
function fmriResetView() { Object.assign(F.orb, F.initOrb); F.orb.target.set(0, 0, 0); fmriSyncCam() }
function fmriResize() {
  if (!F.renderer) return
  const v = document.getElementById('fmriRender'); const w = v.clientWidth || 1, h = v.clientHeight || 1
  F.renderer.setSize(w, h, false); F.camera.aspect = w / h; F.camera.updateProjectionMatrix(); F.need = true
  fmriDrawPlot()
  try { if (FS.nv) FS.nv.resizeListener() } catch (_) {}
}

// ── Picking ──
function fmriPick(e) {
  return raycastPick(F.renderer, F.raycaster, F.pointer, F.camera, F.brain.children, e)
}
function fmriValue(idx, col) { return (F.act && idx >= 0) ? F.act[idx * F.N + col] : 0 }
function fmriHover(e) {
  const m = fmriPick(e); if (m === F.hovered) return; F.hovered = m
  const el = document.getElementById('fmriHover')
  if (m) {
    const meta = m.userData.meta, v = fmriValue(F.idx, m.userData.col)
    el.textContent = `${meta.displayName} · ${meta.network} · value ${v >= 0 ? '+' : ''}${v.toFixed(2)}`
  } else el.textContent = 'Press ▶ Play · hover a region to identify · drag to orbit'
}
// Plain click re-seeds (recomputes co-activation). Shift-click toggles a region
// onto the comparison graph without changing the seed.
function fmriClick(e) {
  const m = fmriPick(e)
  if (e && e.shiftKey && m && F.selected && m !== F.selected) { fmriToggleCompare(m.userData.col); return }
  fmriSelect(m)
}
function fmriSelect(m) {
  F.selected = m
  document.getElementById('fmriSel').textContent = m ? `Selected: ${m.userData.meta.displayName}` : ''
  const sl = document.getElementById('fmSelLegend')
  if (m) { sl.hidden = false; document.getElementById('fmSelName').textContent = m.userData.meta.displayName }
  else sl.hidden = true
  fmriComputeConn()   // rebuilds F.conn + auto-selects the top-5 co-activated regions
  fmriRebuildFeederT(); fmriDrawPlot()
}

// Toggle a region's time-course line on the comparison graph (seed stays put).
function fmriToggleCompare(col) {
  if (F.selected && col === F.selected.userData.col) return
  if (F.compare.has(col)) F.compare.delete(col); else F.compare.add(col)
  fmriRenderConnList(); fmriRenderAssoc(); fmriDrawPlot()
}

// ── Dummy data: a synthetic block design ──
// Functional networks switch on in turn; each region follows its network's
// HRF-convolved boxcar, plus Gaussian noise. The feeder is the task design.
function fmriGenerateDummy() {
  const N = F.N, T = 160, TR = 2
  const act = new Float32Array(T * N)
  const nets = ['Visual', 'Somatomotor', 'DorsalAttention', 'Salience', 'Frontoparietal', 'Limbic', 'DefaultMode']
  const blockLen = 14, restLen = 6, cycle = blockLen + restLen
  const activeNet = new Array(T).fill(null)
  const design = new Float32Array(T)
  for (let t = 0; t < T; t++) {
    if (t % cycle < blockLen) { activeNet[t] = nets[Math.floor(t / cycle) % nets.length]; design[t] = 1 }
  }
  const hrf = [0, 0.04, 0.18, 0.45, 0.78, 1.0, 0.92, 0.66, 0.38, 0.16, 0.02, -0.06, -0.08, -0.05, -0.02]
  const conv = box => {
    const out = new Float32Array(T)
    for (let t = 0; t < T; t++) { let s = 0; for (let k = 0; k < hrf.length; k++) if (t - k >= 0) s += box[t - k] * hrf[k]; out[t] = s }
    return out
  }
  const feeder = conv(design)
  const netResp = {}
  for (const nt of nets) {
    const box = new Float32Array(T)
    for (let t = 0; t < T; t++) box[t] = activeNet[t] === nt ? 1 : 0
    netResp[nt] = conv(box)
  }
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  for (let p = 0; p < N; p++) {
    const net = F.regions[p].meta.network
    const resp = netResp[net]
    for (let t = 0; t < T; t++) {
      let v = 0.18 * randn()
      if (resp) v += resp[t] * 1.6
      act[t * N + p] = v
    }
  }
  F.act = act; F.T = T; F.TR = TR; F.feeder = feeder; F.feederName = 'Feeder · task design'; F.source = 'dummy'
}

// ── CSV ingest ──
function fmriParseMatrix(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length && !l.startsWith('#'))
  const split = l => l.split(/[,\t]+/).map(s => s.trim()).filter(s => s.length)
  if (!lines.length) return { header: null, rows: [] }
  const first = split(lines[0])
  const numeric = first.length && first.every(t => t !== '' && !isNaN(Number(t)))
  const header = numeric ? null : first
  const body = numeric ? lines : lines.slice(1)
  const rows = body.map(l => split(l).map(Number)).filter(r => r.length && r.every(v => !isNaN(v)))
  return { header, rows }
}
function fmriBuildActFromCSV(text) {
  const { header, rows } = fmriParseMatrix(text)
  if (!rows.length) throw new Error('No numeric rows found in the file.')
  const T = rows.length, cols = rows[0].length, N = F.N
  let colOf = null
  if (header) {
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    const map = new Map(header.map((h, i) => [norm(h), i]))
    let hit = 0
    colOf = F.regions.map(r => {
      for (const c of [norm(r.meta.name), norm(r.meta.displayName), norm(String(r.meta.index))])
        if (map.has(c)) { hit++; return map.get(c) }
      return -1
    })
    if (hit < N * 0.5) colOf = null   // too few matched — fall back to column order
  }
  if (!colOf) {
    if (cols !== N) throw new Error(`Expected ${N} columns (one per region) but found ${cols}.\nAdd a header row of region names to map by name.`)
    colOf = F.regions.map((_, i) => i)
  }
  const act = new Float32Array(T * N)
  for (let t = 0; t < T; t++) {
    const row = rows[t]
    for (let p = 0; p < N; p++) { const c = colOf[p]; act[t * N + p] = (c >= 0 && c < row.length) ? row[c] : 0 }
  }
  return { act, T, N }
}
function fmriParseFeeder(text) {
  return Float32Array.from(
    text.split(/[\s,\t\r\n]+/).map(s => s.trim()).filter(s => s.length && !isNaN(Number(s))).map(Number))
}
function fmriIsNifti(file) {
  return /\.nii(\.gz)?$/i.test(file.name) || /\.gz$/i.test(file.name)
}
async function fmriLoadAct(file) {
  if (!file) return
  try {
    let act, T, N
    if (fmriIsNifti(file)) {
      fmriToast('Parcellating fMRI volume…');
      ({ act, T, N } = await fmriBuildActFromNifti(file))
    } else {
      ({ act, T, N } = fmriBuildActFromCSV(await file.text()))
    }
    F.act = act; F.T = T; F.source = 'user'; F.feeder = null; F.feederName = 'Feeder · global mean'
    document.getElementById('fmSrcTag').textContent = file.name
    fmriApplyData()
    fmriToast(`Loaded ${T} × ${N} activations`)
  } catch (err) { console.error(err); fmriToast(String(err.message || err), 'err') }
}

// ── 4-D NIfTI ingest ──────────────────────────────────────────────────────
// A BOLD time series (X×Y×Z×T) is parcellated against the bundled AAL atlas:
// every fMRI voxel is mapped through world (MNI) coordinates to an atlas label,
// and each region's signal is the spatial mean of its voxels per timepoint.
// Means are then z-scored per region so the (signed, ~unit) colour scale and the
// dummy/CSV pipeline behave identically.
function fmriAffineOf(img) {
  // NVImage exposes the voxel→world (mm) affine as hdr.affine (4×4, row-major).
  const a = img.hdr && img.hdr.affine
  if (!a) throw new Error('NIfTI has no spatial affine (qform/sform).')
  return a.length === 4 ? [a[0].slice(), a[1].slice(), a[2].slice(), a[3].slice()]
                        : [a.slice(0, 4), a.slice(4, 8), a.slice(8, 12), a.slice(12, 16)]
}
function fmriInvAffine(m) {
  // Inverse of an affine 4×4 (3×3 linear block + translation).
  const a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2],
        g = m[2][0], h = m[2][1], i = m[2][2]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!det) throw new Error('Singular NIfTI affine.')
  const id = 1 / det
  const inv3 = [
    [A * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [C * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ]
  const tx = m[0][3], ty = m[1][3], tz = m[2][3]
  const t = [
    -(inv3[0][0] * tx + inv3[0][1] * ty + inv3[0][2] * tz),
    -(inv3[1][0] * tx + inv3[1][1] * ty + inv3[1][2] * tz),
    -(inv3[2][0] * tx + inv3[2][1] * ty + inv3[2][2] * tz),
  ]
  return [[...inv3[0], t[0]], [...inv3[1], t[1]], [...inv3[2], t[2]], [0, 0, 0, 1]]
}
// Load the AAL atlas volume + label→region-column map once, lazily. Reuses the
// slice strip's mapping (FS.labelToCol) when it has already been built.
async function fmriEnsureAtlas() {
  const lib = await fmriWaitNiivue()
  if (!FS.atlasImg) FS.atlasImg = await lib.NVImage.loadFromUrl({ url: './cache/aal.nii.gz' })
  if (!FS.labelToCol) {
    const txt = await (await fetch('./labels/aal.txt')).text()
    FS.labels = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(/\s+/); return { index: parseInt(p[0]), name: p[1] }
    }).filter(r => !isNaN(r.index) && r.name)
    fmriBuildLabelToCol()
  }
  return FS.atlasImg
}
async function fmriBuildActFromNifti(file) {
  const lib = await fmriWaitNiivue()
  const img = await lib.NVImage.loadFromFile({ file, name: file.name })
  const atlas = await fmriEnsureAtlas()

  const dims = img.hdr.dims
  const nx = dims[1], ny = dims[2], nz = dims[3], T = Math.max(1, dims[4] | 0)
  const nvox = nx * ny * nz
  if (!nvox) throw new Error('NIfTI has no spatial dimensions.')
  const slope = img.hdr.scl_slope || 1, inter = img.hdr.scl_inter || 0
  const data = img.img   // raw voxels, on-disk order (i fastest … then j, k, t)
  if (data.length < nvox * T) throw new Error('NIfTI data shorter than its header dimensions.')

  // Atlas lookup setup
  const aDims = atlas.hdr.dims, anx = aDims[1], any = aDims[2], anz = aDims[3]
  const aData = atlas.img
  const vox2mm = fmriAffineOf(img)        // fMRI voxel → MNI mm
  const mm2avox = fmriInvAffine(fmriAffineOf(atlas))   // MNI mm → atlas voxel

  // Map every fMRI voxel to a region column via its atlas label (-1 = none).
  const N = F.N
  const colMap = new Int32Array(nvox).fill(-1)
  let labelled = 0
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const wx = vox2mm[0][0] * i + vox2mm[0][1] * j + vox2mm[0][2] * k + vox2mm[0][3]
    const wy = vox2mm[1][0] * i + vox2mm[1][1] * j + vox2mm[1][2] * k + vox2mm[1][3]
    const wz = vox2mm[2][0] * i + vox2mm[2][1] * j + vox2mm[2][2] * k + vox2mm[2][3]
    const ai = Math.round(mm2avox[0][0] * wx + mm2avox[0][1] * wy + mm2avox[0][2] * wz + mm2avox[0][3])
    const aj = Math.round(mm2avox[1][0] * wx + mm2avox[1][1] * wy + mm2avox[1][2] * wz + mm2avox[1][3])
    const ak = Math.round(mm2avox[2][0] * wx + mm2avox[2][1] * wy + mm2avox[2][2] * wz + mm2avox[2][3])
    if (ai < 0 || ai >= anx || aj < 0 || aj >= any || ak < 0 || ak >= anz) continue
    const lab = aData[ai + anx * (aj + any * ak)]
    if (!lab) continue
    const col = FS.labelToCol[lab]
    if (col == null || col < 0) continue
    colMap[i + nx * (j + ny * k)] = col
    labelled++
  }
  if (!labelled) throw new Error('No fMRI voxels fell inside the AAL atlas. Is the volume in MNI space?')

  // Spatial mean per region per timepoint (contiguous reads of img over voxels).
  const counts = new Int32Array(N)
  for (let v = 0; v < nvox; v++) { const c = colMap[v]; if (c >= 0) counts[c]++ }
  const sums = new Float64Array(T * N)
  for (let t = 0; t < T; t++) {
    const base = t * nvox, out = t * N
    for (let v = 0; v < nvox; v++) {
      const c = colMap[v]
      if (c >= 0) sums[out + c] += data[base + v] * slope + inter
    }
  }
  // z-score each region's time course so values are signed and ~unit scale.
  const act = new Float32Array(T * N)
  for (let c = 0; c < N; c++) {
    const n = counts[c]; if (!n) continue
    let mean = 0
    for (let t = 0; t < T; t++) mean += sums[t * N + c] / n
    mean /= T
    let varr = 0
    for (let t = 0; t < T; t++) { const x = sums[t * N + c] / n - mean; varr += x * x }
    const sd = Math.sqrt(varr / Math.max(1, T)) || 1
    for (let t = 0; t < T; t++) act[t * N + c] = (sums[t * N + c] / n - mean) / sd
  }

  // TR from pixdim[4] when present (seconds).
  const tr = img.hdr.pixDims ? img.hdr.pixDims[4] : (img.hdr.pixdim && img.hdr.pixdim[4])
  if (tr && tr > 0 && tr < 100) F.TR = tr
  const matched = counts.reduce((a, n) => a + (n > 0 ? 1 : 0), 0)
  if (window.diag) window.diag('info', `fMRI NIfTI: ${T}×${N}, ${labelled} voxels in atlas, ${matched}/${N} regions covered`)
  return { act, T, N }
}
async function fmriLoadFeeder(file) {
  if (!file) return
  try {
    const f = fmriParseFeeder(await file.text())
    if (!f.length) throw new Error('No numeric values found in the feeder file.')
    F.feeder = f; F.feederName = 'Feeder · uploaded'
    fmriRebuildFeederT(); fmriDrawPlot()
    fmriToast(`Loaded feeder (${f.length} values)`)
  } catch (err) { console.error(err); fmriToast(String(err.message || err), 'err') }
}

// ── Apply a freshly-set activation matrix (dummy or user) ──
function fmriApplyData() {
  F.t = 0; F.idx = -1; F.playing = false; fmriPlayLabel()
  let mx = 1e-6
  for (let i = 0; i < F.act.length; i++) { const a = Math.abs(F.act[i]); if (a > mx) mx = a }
  F.vmaxRaw = mx; fmriUpdateGain()
  const scrub = document.getElementById('fmScrub'); scrub.max = Math.max(0, F.T - 1); scrub.value = 0
  document.getElementById('fmDataInfo').textContent = `${F.T} timepoints · ${F.N} regions · TR ${F.TR}s`
  fmriRebuildFeederT(); fmriUpdateLegend(); fmriRecolor(0, true); fmriUpdateTime()
  fmriComputeConn()   // re-rank co-activation against the new data (no-op if nothing selected)
  fmriDrawPlot()
}
function fmriUpdateGain() { F.vmax = F.vmaxRaw / (F.gain || 1) }

// ── Colour mapping (per frame) ──
function fmriColor(mat, v) {
  const n = Math.max(-1, Math.min(1, v / F.vmax)), m = Math.abs(n)
  if (m < F.thresh) { mat.color.setRGB(0.11, 0.12, 0.15); mat.emissive.setRGB(0, 0, 0); return }
  let r, g, b
  if (F.cmap === 'coolwarm') {
    if (n >= 0) { r = 0.5 + 0.5 * m; g = 0.12 + 0.6 * m; b = 0.08 }
    else { r = 0.08; g = 0.22 + 0.45 * m; b = 0.55 + 0.45 * m }
  } else {
    r = Math.min(1, 1.4 * m); g = Math.max(0, Math.min(1, 1.4 * m - 0.45)); b = Math.max(0, Math.min(1, 1.4 * m - 1.0))
  }
  mat.color.setRGB(r, g, b)
  const ei = 0.25 + 0.7 * m
  mat.emissive.setRGB(r * ei, g * ei, b * ei)
}
function fmriRecolor(idx, force) {
  if (!F.act) return
  if (idx === F.idx && !force) return
  F.idx = idx
  const base = idx * F.N
  for (let p = 0; p < F.N; p++) fmriColor(F.regions[p].mesh.material, F.act[base + p])
  fmriUpdateSlices()   // recolour the NiiVue atlas overlay to match
  F.need = true
}
function fmriUpdateLegend() {
  const bar = document.getElementById('fmLegendBar')
  const lo = document.getElementById('fmLegendLo'), hi = document.getElementById('fmLegendHi')
  const title = document.getElementById('fmLegendTitle'), vm = F.vmax
  if (F.cmap === 'coolwarm') {
    bar.style.background = 'linear-gradient(90deg,#1aa0ff,#0a3a66,#15181f,#7a1f10,#ffd400)'
    lo.textContent = '−' + vm.toFixed(1); hi.textContent = '+' + vm.toFixed(1); title.textContent = 'Activation (signed)'
  } else {
    bar.style.background = 'linear-gradient(90deg,#1c1f27,#b30000,#ff6a00,#ffd400,#ffffe0)'
    lo.textContent = '0'; hi.textContent = '+' + vm.toFixed(1); title.textContent = 'Activation (magnitude)'
  }
}

// ── Feeder / reference trace ──
function fmriActiveFeeder() {
  if (F.feedSel && F.selected) {
    const col = F.selected.userData.col, a = new Float32Array(F.T)
    for (let t = 0; t < F.T; t++) a[t] = F.act[t * F.N + col]
    return a
  }
  const f = F.feeder
  if (f && f.length === F.T) return f
  if (f && f.length > 1) {
    const a = new Float32Array(F.T)
    for (let t = 0; t < F.T; t++) a[t] = f[Math.round(t / (F.T - 1) * (f.length - 1))]
    return a
  }
  const a = new Float32Array(F.T)   // fallback: global mean |activation|
  for (let t = 0; t < F.T; t++) { let s = 0; for (let p = 0; p < F.N; p++) s += Math.abs(F.act[t * F.N + p]); a[t] = s / F.N }
  return a
}
function fmriRebuildFeederT() {
  F.feederT = fmriActiveFeeder()
  const nm = (F.feedSel && F.selected) ? `Feeder · ${F.selected.userData.meta.displayName}` : F.feederName
  document.getElementById('fmFeedName').textContent = nm
}

// ── Co-activation analysis ──────────────────────────────────────────────
// "Which regions activate along with the selected one?" — Pearson correlation
// of each region's time course against the seed's, ranked by strength. r is
// turned into a two-tailed p-value (t-test, df = T−2); the significance cutoff
// (F.alpha), multiple-comparison correction (F.correction) and sign filter
// (F.signFilter) are all live-adjustable from the top-right Associations panel.

// Pearson r between two region columns of the T×N activation matrix.
function fmriPearson(colA, colB) {
  const T = F.T, N = F.N, act = F.act
  let sa = 0, sb = 0
  for (let t = 0; t < T; t++) { sa += act[t * N + colA]; sb += act[t * N + colB] }
  const ma = sa / T, mb = sb / T
  let num = 0, da = 0, db = 0
  for (let t = 0; t < T; t++) {
    const x = act[t * N + colA] - ma, y = act[t * N + colB] - mb
    num += x * y; da += x * x; db += y * y
  }
  const den = Math.sqrt(da * db)
  return den < 1e-12 ? 0 : num / den
}

// Regularized incomplete beta I_x(a,b) — Numerical Recipes betacf/betai. Used
// for the Student-t tail so the p-values are exact rather than a normal approx.
function fmriBetacf(a, b, x) {
  const FPMIN = 1e-30
  let qab = a + b, qap = a + 1, qam = a - 1
  let c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c; h *= del
    if (Math.abs(del - 1) < 3e-7) break
  }
  return h
}
function fmriIncBeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbeta = fmriLnGamma(a + b) - fmriLnGamma(a) - fmriLnGamma(b)
  const bt = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? bt * fmriBetacf(a, b, x) / a
                                   : 1 - bt * fmriBetacf(b, a, 1 - x) / b
}
function fmriLnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let x = z, y = z, tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) { y += 1; ser += g[j] / y }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
// Two-tailed p-value for a Pearson r with df = T−2.
function fmriPvalue(r, T) {
  const df = T - 2
  if (df <= 0) return 1
  if (r <= -1 || r >= 1) return 0
  const t2 = r * r * df / (1 - r * r)
  return fmriIncBeta(df / (df + t2), df / 2, 0.5)   // = P(|T| > |t|)
}

// Correlate every region against the seed (the expensive pass), then score +
// render via fmriRescore. Splitting the two lets stat-setting changes re-derive
// significance without recomputing every correlation.
function fmriComputeConn() {
  F.conn = null; F.compare = new Set()
  if (!F.selected || !F.act || F.T < 3) { fmriRescore(true); return }
  const seed = F.selected.userData.col, rows = []
  for (let p = 0; p < F.N; p++) {
    if (p === seed) continue
    const r = fmriPearson(seed, p), pv = fmriPvalue(r, F.T)
    rows.push({ col: p, meta: F.regions[p].meta, r, p: pv })
  }
  F.conn = rows
  fmriRescore(true)
}

// Apply the current α / correction / sign settings to F.conn, mark each row's
// significance, re-rank by |r|, optionally re-seed the auto-plotted top-N, and
// refresh both the sidebar list and the top-right panel. Cheap: no correlations.
function fmriRescore(resetCompare) {
  if (F.conn) {
    fmriApplyCorrection(F.conn)   // sets row.padj + row.sig against F.alpha (sign-agnostic)
    F.conn.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    if (resetCompare) {
      F.compare = new Set()
      fmriAssociated().slice(0, F.topN).forEach(x => F.compare.add(x.col))
    }
  }
  fmriRenderConnList(); fmriRenderAssoc(); fmriDrawPlot()
}

// Significant rows that also pass the sign filter — what the top-right panel
// lists and what auto-plots. Kept separate from row.sig so the sidebar's
// statistical (sign-agnostic) significance groups stay correct.
function fmriAssociated() {
  if (!F.conn) return []
  return F.conn.filter(x => x.sig &&
    !((F.signFilter === 'pos' && x.r < 0) || (F.signFilter === 'neg' && x.r > 0)))
}

// Multiple-comparison correction over the N−1 region tests. Writes row.padj and
// sets row.sig = padj < α. 'none' leaves raw p; Bonferroni scales by the test
// count; FDR uses Benjamini-Hochberg step-up.
function fmriApplyCorrection(rows) {
  const m = rows.length, alpha = F.alpha
  if (F.correction === 'bonferroni') {
    rows.forEach(x => { x.padj = Math.min(1, x.p * m); x.sig = x.padj < alpha })
  } else if (F.correction === 'fdr') {
    const order = rows.map((_, i) => i).sort((a, b) => rows[a].p - rows[b].p)
    let prev = 1
    for (let k = m; k >= 1; k--) {
      const idx = order[k - 1]
      prev = Math.min(prev, Math.min(1, rows[idx].p * m / k))
      rows[idx].padj = prev
    }
    rows.forEach(x => { x.sig = x.padj < alpha })
  } else {
    rows.forEach(x => { x.padj = x.p; x.sig = x.p < alpha })
  }
}

// Compact p-value formatter for the association rows (e.g. "p<.001", "p=.032").
function fmriFmtP(p) {
  return p < 0.001 ? 'p<.001' : 'p=' + p.toFixed(3).replace(/^0/, '')
}

// Stable line colour for a comparison region (by its position in F.compare).
function fmriCompareColor(col) {
  const i = [...F.compare].indexOf(col)
  return i < 0 ? '#888' : FM_LINE_COLORS[i % FM_LINE_COLORS.length]
}

// Build the sidebar co-activation panel: top-5 toggle rows + two dropdowns.
function fmriRenderConnList() {
  const sec = document.getElementById('fmConnSection')
  if (!sec) return
  if (!F.conn || !F.selected) { sec.hidden = true; return }
  sec.hidden = false
  document.getElementById('fmConnSeed').textContent = F.selected.userData.meta.displayName
  const sig = F.conn.filter(x => x.sig), non = F.conn.filter(x => !x.sig)
  const top = sig.slice(0, 5), more = sig.slice(5)

  const topEl = document.getElementById('fmConnTop'); topEl.textContent = ''
  if (!top.length) {
    const empty = document.createElement('div'); empty.className = 'fm-conn-empty'
    empty.textContent = 'No significantly co-activated regions.'; topEl.appendChild(empty)
  }
  top.forEach(x => {
    const on = F.compare.has(x.col)
    const row = document.createElement('div')
    row.className = 'fm-conn-row' + (on ? ' on' : '')
    const dot = document.createElement('span'); dot.className = 'fm-conn-dot'
    dot.style.background = on ? fmriCompareColor(x.col) : 'transparent'
    const sign = document.createElement('span')
    sign.className = 'fm-conn-sign ' + (x.r >= 0 ? 'pos' : 'neg')
    sign.textContent = x.r >= 0 ? '▲' : '▼'
    sign.title = x.r >= 0 ? 'co-activation (positive correlation)' : 'anti-correlation (negative correlation)'
    const name = document.createElement('span'); name.className = 'fm-conn-name'
    name.textContent = x.meta.displayName
    const rv = document.createElement('span'); rv.className = 'fm-conn-r'
    rv.textContent = (x.r >= 0 ? '+' : '') + x.r.toFixed(2)
    row.append(dot, sign, name, rv)
    row.onclick = () => fmriToggleCompare(x.col)
    topEl.appendChild(row)
  })

  const fill = (sel, list, label) => {
    sel.textContent = ''
    const o0 = document.createElement('option')
    o0.value = ''; o0.textContent = `${label} (${list.length})`
    sel.appendChild(o0)
    list.forEach(x => {
      const o = document.createElement('option')
      o.value = String(x.col)
      const mark = F.compare.has(x.col) ? '✓ ' : ''
      o.textContent = `${mark}${x.r >= 0 ? '▲' : '▼'} ${x.meta.displayName}  ${x.r >= 0 ? '+' : ''}${x.r.toFixed(2)}`
      sel.appendChild(o)
    })
  }
  fill(document.getElementById('fmConnMore'), more, 'significant beyond top 5')
  fill(document.getElementById('fmConnNon'), non, 'non-significant')
}

// Top-right dropdown: the full list of significantly associated regions (with r
// and corrected p), each a toggle onto the comparison graph. Also refreshes the
// count badge on the toolbar button so it's useful even while collapsed.
function fmriRenderAssoc() {
  const listEl = document.getElementById('fmAssocList')
  if (!listEl) return
  const btn = document.getElementById('fmAssocToggle')
  const seedEl = document.getElementById('fmAssocSeed')
  const has = !!(F.conn && F.selected)
  const sig = has ? fmriAssociated() : []
  if (seedEl) seedEl.textContent = has ? F.selected.userData.meta.displayName : '—'
  if (btn) btn.textContent = `Associations${sig.length ? ' (' + sig.length + ')' : ''} ▾`

  listEl.textContent = ''
  if (!has || !sig.length) {
    const empty = document.createElement('div'); empty.className = 'fm-assoc-empty'
    empty.textContent = has
      ? 'No significantly associated regions at the current settings.'
      : 'Click a region in the 3-D view to compute its associations.'
    listEl.appendChild(empty); return
  }
  sig.forEach(x => {
    const on = F.compare.has(x.col)
    const row = document.createElement('div')
    row.className = 'fm-assoc-row' + (on ? ' on' : '')
    const dot = document.createElement('span'); dot.className = 'fm-assoc-dot'
    dot.style.background = on ? fmriCompareColor(x.col) : 'transparent'
    const sign = document.createElement('span')
    sign.className = 'fm-assoc-sign ' + (x.r >= 0 ? 'pos' : 'neg')
    sign.textContent = x.r >= 0 ? '▲' : '▼'
    sign.title = x.r >= 0 ? 'co-activation (positive correlation)' : 'anti-correlation (negative correlation)'
    const name = document.createElement('span'); name.className = 'fm-assoc-name'
    name.textContent = x.meta.displayName
    const rv = document.createElement('span'); rv.className = 'fm-assoc-r'
    rv.textContent = (x.r >= 0 ? '+' : '') + x.r.toFixed(2)
    const pv = document.createElement('span'); pv.className = 'fm-assoc-p'
    pv.textContent = fmriFmtP(x.padj)
    row.append(dot, sign, name, rv, pv)
    row.onclick = () => fmriToggleCompare(x.col)
    listEl.appendChild(row)
  })
}

function fmriDrawPlot() {
  const cv = document.getElementById('fmriPlot'); if (!cv || !F.feederT) return
  const dpr = Math.min(devicePixelRatio, 2)
  const w = cv.clientWidth || 300, h = cv.clientHeight || 92
  cv.width = w * dpr; cv.height = h * dpr
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
  const T = F.T, N = F.N, pad = 4
  // Draw an array against an explicit [mn,mx] range (shared across region traces
  // so amplitudes are comparable); the feeder passes its own auto range.
  const line = (arr, color, lw, mn, mx) => {
    if (mn == null) {
      mn = Infinity; mx = -Infinity
      for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v }
    }
    if (mx - mn < 1e-6) mx = mn + 1
    g.beginPath(); g.strokeStyle = color; g.lineWidth = lw
    for (let t = 0; t < T; t++) {
      const x = pad + (w - 2 * pad) * (T < 2 ? 0 : t / (T - 1))
      const y = h - pad - (h - 2 * pad) * ((arr[t] - mn) / (mx - mn))
      t ? g.lineTo(x, y) : g.moveTo(x, y)
    }
    g.stroke()
  }
  const colTrace = col => { const a = new Float32Array(T); for (let t = 0; t < T; t++) a[t] = F.act[t * N + col]; return a }

  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1
  g.beginPath(); g.moveTo(pad, h / 2); g.lineTo(w - pad, h / 2); g.stroke()

  // Region traces (seed + comparisons) share one amplitude scale so the lines
  // can be compared directly. Feeder stays on its own scale as a reference.
  const traces = []
  if (F.selected && !F.feedSel) traces.push({ col: F.selected.userData.col, color: '#f6c744', lw: 1.6 })
  ;[...F.compare].forEach(col => { if (F.act) traces.push({ col, color: fmriCompareColor(col), lw: 1.2 }) })
  if (traces.length) {
    let mn = Infinity, mx = -Infinity
    for (const tr of traces) for (let t = 0; t < T; t++) { const v = F.act[t * N + tr.col]; if (v < mn) mn = v; if (v > mx) mx = v }
    for (const tr of traces) line(colTrace(tr.col), tr.color, tr.lw, mn, mx)
  }
  if (F.showFeeder) line(F.feederT, '#58a6ff', 1.8)
  const xh = pad + (w - 2 * pad) * (T < 2 ? 0 : F.idx / (T - 1))
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5
  g.beginPath(); g.moveTo(xh, 0); g.lineTo(xh, h); g.stroke()
}

// ── Transport ──
function fmriPlayLabel() { document.getElementById('fmPlay').textContent = F.playing ? '⏸ Pause' : '▶ Play' }
function fmriSetPlaying(on) { F.playing = on; F.lastNow = performance.now(); fmriPlayLabel() }
function fmriSeek(idx) {
  idx = Math.max(0, Math.min(F.T - 1, idx)); F.t = idx
  fmriRecolor(idx); document.getElementById('fmScrub').value = idx; fmriUpdateTime(); fmriDrawPlot()
}
function fmriUpdateTime() {
  document.getElementById('fmTime').textContent =
    `TR ${Math.max(0, F.idx)} / ${Math.max(0, F.T - 1)} · ${(Math.max(0, F.idx) * F.TR).toFixed(1)} s`
}
function fmriToast(msg, type) {
  const el = document.getElementById('fmriToast')
  el.textContent = msg; el.className = type === 'err' ? 'modality-toast show err' : 'modality-toast show'
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3200)
}
function fmriSavePNG() {
  F.renderer.render(F.scene, F.camera)
  const a = document.createElement('a')
  a.href = F.renderer.domElement.toDataURL('image/png')
  a.download = `brain_fmri_TR${Math.max(0, F.idx)}_${Date.now()}.png`
  a.click(); fmriToast('PNG saved')
}

function fmriSetupUI() {
  document.getElementById('fmReset').onclick = () => fmriResetView()
  document.getElementById('fmScreenshot').onclick = () => fmriSavePNG()
  document.getElementById('fmPlay').onclick = () => fmriSetPlaying(!F.playing)
  document.getElementById('fmStop').onclick = () => { F.playing = false; fmriPlayLabel(); fmriSeek(0) }
  document.getElementById('fmLoop').onchange = e => (F.loop = e.target.checked)
  const scrub = document.getElementById('fmScrub')
  scrub.oninput = () => fmriSeek(+scrub.value)
  document.getElementById('fmSpeed').onchange = e => (F.speed = +e.target.value)
  const cmap = document.getElementById('fmCmap')
  cmap.onchange = () => { F.cmap = cmap.value; fmriUpdateLegend(); fmriRecolor(F.idx, true) }
  const thr = document.getElementById('fmThresh')
  thr.oninput = () => { F.thresh = +thr.value / 100; document.getElementById('fmThreshRd').textContent = F.thresh.toFixed(2); fmriRecolor(F.idx, true) }
  const gain = document.getElementById('fmGain')
  gain.oninput = () => { F.gain = +gain.value / 100; fmriUpdateGain(); fmriUpdateLegend(); fmriRecolor(F.idx, true) }
  const fs = document.getElementById('fmFeedSel')
  fs.onchange = () => { F.feedSel = fs.checked; fmriRebuildFeederT(); fmriDrawPlot() }
  const more = document.getElementById('fmConnMore')
  more.onchange = () => { if (more.value !== '') fmriToggleCompare(+more.value); more.value = '' }
  const non = document.getElementById('fmConnNon')
  non.onchange = () => { if (non.value !== '') fmriToggleCompare(+non.value); non.value = '' }

  // ── Top-right Associations dropdown: list + stats/graph settings ──
  const assocToggle = document.getElementById('fmAssocToggle')
  const assocPanel = document.getElementById('fmAssocPanel')
  assocToggle.onclick = () => {
    const show = assocPanel.hidden
    assocPanel.hidden = !show
    assocToggle.setAttribute('aria-expanded', String(show))
    if (show) fmriRenderAssoc()
  }
  document.getElementById('fmAssocClose').onclick = () => {
    assocPanel.hidden = true; assocToggle.setAttribute('aria-expanded', 'false')
  }
  const alphaSel = document.getElementById('fmAlpha')
  alphaSel.value = String(F.alpha)
  alphaSel.onchange = () => { F.alpha = +alphaSel.value; fmriRescore(true) }
  const corrSel = document.getElementById('fmCorrection')
  corrSel.value = F.correction
  corrSel.onchange = () => { F.correction = corrSel.value; fmriRescore(true) }
  const topNSel = document.getElementById('fmTopN')
  topNSel.value = String(F.topN)
  topNSel.onchange = () => { F.topN = +topNSel.value; fmriRescore(true) }
  const signSel = document.getElementById('fmSignFilter')
  signSel.value = F.signFilter
  signSel.onchange = () => { F.signFilter = signSel.value; fmriRescore(true) }
  const showFeeder = document.getElementById('fmShowFeeder')
  showFeeder.checked = F.showFeeder
  showFeeder.onchange = () => { F.showFeeder = showFeeder.checked; fmriDrawPlot() }
  document.getElementById('fmClearLines').onclick = () => {
    F.compare = new Set(); fmriRenderConnList(); fmriRenderAssoc(); fmriDrawPlot()
  }
  document.getElementById('fmActFile').onchange = e => fmriLoadAct(e.target.files[0])
  document.getElementById('fmFeedFile').onchange = e => fmriLoadFeeder(e.target.files[0])
  document.getElementById('fmResetData').onclick = () => {
    fmriGenerateDummy(); document.getElementById('fmSrcTag').textContent = 'Dummy (block design)'
    document.getElementById('fmFeedSel').checked = false; F.feedSel = false
    fmriApplyData(); fmriToast('Reset to dummy data')
  }
  const cv = document.getElementById('fmriPlot')
  cv.addEventListener('pointerdown', e => {
    const rect = cv.getBoundingClientRect()
    fmriSeek(Math.round((e.clientX - rect.left) / rect.width * (F.T - 1)))
  })
  window.addEventListener('keydown', e => {
    if (document.getElementById('view-fmri').hidden) return
    if (e.code === 'Space') { e.preventDefault(); fmriSetPlaying(!F.playing) }
  })
  document.getElementById('fmThreshRd').textContent = F.thresh.toFixed(2)
}

// ── NiiVue triple-slice strip ──
// Real axial/sagittal/coronal MRI slices (like the Figure tab): MNI152 anatomy
// with the AAL atlas overlaid, recoloured per timepoint by activation. Because
// the meshes are AAL3 but the bundled volume is AAL(116), the activation is
// mapped onto the atlas labels by region name (≈108/116 match; the rest stay
// transparent, showing bare anatomy).
function fmriWaitNiivue(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const tick = () => {
      if (window.NiivueLib) return resolve(window.NiivueLib)
      if (performance.now() - t0 > timeoutMs) return reject(new Error('NiiVue not available'))
      setTimeout(tick, 120)
    }
    tick()
  })
}
function fmriNormName(s) {
  s = String(s).toLowerCase()
    .replace(/cerebelum|cerebellum/g, 'cereb')   // AAL vs AAL3 spelling
    .replace(/cingulum|cingulate/g, 'cingul')
  return s.replace(/[^a-z0-9]/g, '').replace(/[0-9]/g, '')
}
function fmriBuildLabelToCol() {
  const colByName = new Map()
  F.regions.forEach((r, i) => colByName.set(fmriNormName(r.meta.name), i))
  FS.labelToCol = {}
  let hit = 0
  for (const lab of FS.labels) {
    const c = colByName.has(fmriNormName(lab.name)) ? colByName.get(fmriNormName(lab.name)) : -1
    FS.labelToCol[lab.index] = c
    if (c >= 0) hit++
  }
  if (window.diag) window.diag('info', `fMRI slices: ${hit}/${FS.labels.length} AAL labels matched to AAL3 regions`)
}
// Activation → RGBA bytes (same colour ramp as the 3-D meshes; A=0 below threshold).
function fmriRGBA(v) {
  const n = Math.max(-1, Math.min(1, v / F.vmax)), m = Math.abs(n)
  if (m < F.thresh) return [0, 0, 0, 0]
  let r, g, b
  if (F.cmap === 'coolwarm') {
    if (n >= 0) { r = 0.5 + 0.5 * m; g = 0.12 + 0.6 * m; b = 0.08 }
    else { r = 0.08; g = 0.22 + 0.45 * m; b = 0.55 + 0.45 * m }
  } else {
    r = Math.min(1, 1.4 * m); g = Math.max(0, Math.min(1, 1.4 * m - 0.45)); b = Math.max(0, Math.min(1, 1.4 * m - 1.0))
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round((0.55 + 0.45 * m) * 255)]
}
function fmriBuildSliceLUT() {
  const R = [0], G = [0], B = [0], A = [0], I = [0], labels = ['Background']
  const base = Math.max(0, F.idx) * F.N
  for (const lab of FS.labels) {
    const col = FS.labelToCol[lab.index]
    const c = (col >= 0 && F.idx >= 0) ? fmriRGBA(F.act[base + col]) : [0, 0, 0, 0]
    R.push(c[0]); G.push(c[1]); B.push(c[2]); A.push(c[3]); I.push(lab.index); labels.push(lab.name)
  }
  return { R, G, B, A, I, labels }
}
function fmriUpdateSlices() {
  if (!FS.ready || !FS.nv || FS.nv.volumes.length < 2) return
  FS.nv.volumes[1].setColormapLabel(fmriBuildSliceLUT())
  FS.nv.updateGLVolume()
}
async function fmriInitSlices() {
  const strip = document.getElementById('fmriSliceStrip')
  const msgEl = document.getElementById('fmriSliceMsg')
  try {
    const lib = await fmriWaitNiivue()
    msgEl.style.display = 'flex'
    FS.nv = new lib.Niivue({
      show3Dcrosshair: false, backColor: [0.02, 0.03, 0.05, 1],
      crosshairColor: [0.95, 0.55, 0.15, 1], logging: false,
    })
    await FS.nv.attachTo('fmriSlices')
    FS.nv.opts.multiplanarShowRender = lib.SHOW_RENDER.NEVER
    FS.nv.opts.crosshairGap = 6
    FS.nv.setMultiplanarPadPixels(4)
    await FS.nv.loadVolumes([{ url: './cache/mni152.nii.gz' }, { url: './cache/aal.nii.gz' }])
    // AAL label table (index → name), same file the Figure tab uses.
    const txt = await (await fetch('./labels/aal.txt')).text()
    FS.labels = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(/\s+/); return { index: parseInt(p[0]), name: p[1] }
    }).filter(r => !isNaN(r.index) && r.name)
    fmriBuildLabelToCol()
    FS.ready = true
    msgEl.style.display = 'none'
    fmriUpdateSlices()
  } catch (e) {
    console.error('fMRI slice strip failed', e)
    FS.failed = true
    msgEl.style.display = 'flex'
    msgEl.textContent = 'Triple-slice view unavailable (NiiVue could not load). The 3-D view still works.'
  }
}

// ── Render loop (only runs while the fMRI tab is visible) ──
let fmriAnimRunning = false
function fmriStartAnim() {
  if (fmriAnimRunning) return
  fmriAnimRunning = true; F.need = true; F.lastNow = performance.now()
  requestAnimationFrame(fmriAnimate)
}
function fmriAnimate() {
  if (document.getElementById('view-fmri').hidden) { fmriAnimRunning = false; return }
  requestAnimationFrame(fmriAnimate)
  const now = performance.now(), dt = (now - F.lastNow) / 1000; F.lastNow = now
  if (F.playing && F.T > 0) {
    F.t += dt * F.speed
    if (F.t >= F.T) { if (F.loop) F.t = F.t % F.T; else { F.t = F.T - 1; F.playing = false; fmriPlayLabel() } }
    const idx = Math.floor(F.t) % Math.max(1, F.T)
    if (idx !== F.idx) {
      fmriRecolor(idx); document.getElementById('fmScrub').value = idx; fmriUpdateTime(); fmriDrawPlot()
    }
  }
  if (F.need) { F.renderer.render(F.scene, F.camera); F.need = false }
}

// ═══════════════════════════════════════════════════════════════════════
//  COLLECTION PANEL  — floating, cross-tab gallery of captured brain views
// ═══════════════════════════════════════════════════════════════════════
// Each tab renders to its own WebGL canvas with no preserveDrawingBuffer, so we
// must redraw synchronously immediately before toDataURL or the buffer reads blank.
// Mesh-quality selectors (Explore + fMRI stay in sync via the shared setter)
;['exMeshQuality', 'fmMeshQuality'].forEach(id => {
  const el = document.getElementById(id)
  if (el) el.onchange = () => setMeshQuality(el.value)
})

window.__captureExplore = function () {
  if (!renderer || !scene || !camera) return null
  renderer.render(scene, camera)
  const url = document.getElementById('glExplore').toDataURL('image/png')
  if (!url || url.length < 200) return null
  return { url, tab: 'explore', label: 'Advanced 3-D view' }
}

// fMRI tab has three separate views: the 3-D brain (glFmri), the time-series
// graph (fmriPlot, a 2-D canvas), and the axial/coronal/sagittal slice strip
// (its own NiiVue instance FS.nv). `pane` picks one.
window.__captureFmriPane = function (pane) {
  const tlabel = (F.T > 0) ? ' · t=' + (F.idx || 0) : ''
  if (pane === 'brain') {
    if (!F.renderer) return null
    F.renderer.render(F.scene, F.camera)
    const url = document.getElementById('glFmri').toDataURL('image/png')
    if (!url || url.length < 200) return null
    return { url, tab: 'fmri', label: 'fMRI · 3D brain' + tlabel }
  }
  if (pane === 'graph') {
    const cv = document.getElementById('fmriPlot')
    if (!cv) return null
    const url = cv.toDataURL('image/png')       // 2-D canvas — always readable
    if (!url || url.length < 200) return null
    return { url, tab: 'fmri', label: 'fMRI · time-series' + tlabel }
  }
  // slice panes — switch FS.nv to a single slice type, capture, restore.
  const TYPE = { axial: 0, coronal: 1, sagittal: 2 }
  const NAME = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' }
  const t = TYPE[pane]
  if (t == null || !FS.nv || !FS.ready) return null
  const prev = FS.nv.opts.sliceType
  try {
    FS.nv.setSliceType(t); FS.nv.drawScene()
    const url = document.getElementById('fmriSlices').toDataURL('image/png')
    if (!url || url.length < 200) return null
    return { url, tab: 'fmri', label: 'fMRI · ' + NAME[pane] + ' slice' + tlabel }
  } catch (e) {
    console.error(e); return null
  } finally {
    FS.nv.setSliceType(prev); FS.nv.drawScene()
  }
}
// Back-compat: plain fMRI capture = the 3-D brain.
window.__captureFmri = function () { return window.__captureFmriPane('brain') }

const VP = (() => {
  const items = []                       // { id, url, tab, label }
  const TAB_NAMES = { figure: 'Figure', explore: 'Advanced', fmri: 'fMRI', dti: 'DTI' }
  let dragId = null, statusTimer = null

  const $ = id => document.getElementById(id)
  const els = {
    panel: $('viewPanel'), header: $('vpHeader'), collapse: $('vpCollapse'),
    list: $('vpList'), empty: $('vpEmpty'), count: $('vpCount'),
    add: $('vpAdd'), menu: $('vpMenu'), save: $('vpSave'), clear: $('vpClear'),
    cols: $('vpCols'), labels: $('vpLabels'), status: $('vpStatus'),
    arrangeBtn: $('vpArrangeBtn'), arrange: $('vpArrange'), aGrid: $('vpaGrid'),
    aCols: $('vpaCols'), aLabels: $('vpaLabels'), aClose: $('vpaClose'), aSave: $('vpaSave'),
  }

  function status(msg, kind = '') {
    els.status.textContent = msg
    els.status.className = 'vp-status ' + kind
    clearTimeout(statusTimer)
    if (msg) statusTimer = setTimeout(() => { els.status.textContent = ''; els.status.className = 'vp-status' }, 3000)
  }

  function activeTab() {
    const b = document.querySelector('.tab-btn.active')
    return b ? b.dataset.tab : 'figure'
  }

  // Which individual views can be picked off each tab. Each entry is
  // [menu label, () => shot]; the getter returns { url, tab, label } or null.
  const VIEW_MENU = {
    figure: [
      ['All four views', () => window.__captureFigurePane('multi')],
      ['Axial slice',    () => window.__captureFigurePane('axial')],
      ['Sagittal slice', () => window.__captureFigurePane('sagittal')],
      ['Coronal slice',  () => window.__captureFigurePane('coronal')],
      ['3D render',      () => window.__captureFigurePane('render')],
    ],
    explore: [
      ['Advanced 3-D view', () => window.__captureExplore()],
    ],
    fmri: [
      ['3D brain',          () => window.__captureFmriPane('brain')],
      ['Time-series graph', () => window.__captureFmriPane('graph')],
      ['Axial slice',       () => window.__captureFmriPane('axial')],
      ['Sagittal slice',    () => window.__captureFmriPane('sagittal')],
      ['Coronal slice',     () => window.__captureFmriPane('coronal')],
    ],
    dti: [
      ['All DTI views', () => window.__captureDtiPane('multi')],
      ['Axial slice',   () => window.__captureDtiPane('axial')],
      ['Sagittal slice',() => window.__captureDtiPane('sagittal')],
      ['Coronal slice', () => window.__captureDtiPane('coronal')],
      ['3D render',     () => window.__captureDtiPane('render')],
    ],
  }

  function addShot(getShot, name) {
    let shot
    try { shot = getShot() } catch (e) { console.error(e); shot = null }
    if (!shot || !shot.url) { status('Couldn’t capture ' + name + ' — let the view finish loading', 'err'); return }
    items.push({ id: 'v' + Date.now() + Math.random().toString(36).slice(2, 6), ...shot })
    render()
    status('Added ' + name, 'ok')
    els.list.lastElementChild && els.list.lastElementChild.scrollIntoView({ block: 'nearest' })
  }

  // ── "Add view ▾" menu: lists the views available on the current tab ──
  function onDocDownForMenu(e) {
    if (!els.menu.contains(e.target) && e.target !== els.add) closeAddMenu()
  }
  function closeAddMenu() {
    els.menu.hidden = true
    document.removeEventListener('mousedown', onDocDownForMenu)
  }
  function toggleAddMenu() {
    if (!els.menu.hidden) { closeAddMenu(); return }
    const views = VIEW_MENU[activeTab()] || VIEW_MENU.figure
    els.menu.innerHTML = ''
    views.forEach(([label, getShot]) => {
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'vp-menu-item'; b.textContent = label
      b.onclick = () => { closeAddMenu(); addShot(getShot, label) }
      els.menu.appendChild(b)
    })
    els.menu.hidden = false
    setTimeout(() => document.addEventListener('mousedown', onDocDownForMenu), 0)
  }

  function removeItem(id) {
    const i = items.findIndex(x => x.id === id)
    if (i >= 0) { items.splice(i, 1); render() }
  }

  function render() {
    els.count.textContent = '(' + items.length + ')'
    els.empty.style.display = items.length ? 'none' : ''
    els.save.disabled = els.clear.disabled = items.length === 0
    if (els.arrangeBtn) els.arrangeBtn.disabled = items.length === 0
    els.list.innerHTML = ''
    items.forEach(it => els.list.appendChild(itemEl(it)))
    if (els.arrange && els.arrange.classList.contains('active')) renderArrange()
  }

  function itemEl(it) {
    const row = document.createElement('div')
    row.className = 'vp-item'; row.dataset.id = it.id; row.draggable = true

    const img = document.createElement('img')
    img.className = 'vp-thumb'; img.src = it.url; img.alt = it.label; img.draggable = false

    const info = document.createElement('div'); info.className = 'vp-info'
    const badge = document.createElement('span'); badge.className = 'vp-badge'
    badge.textContent = TAB_NAMES[it.tab] || it.tab
    const cap = document.createElement('div')
    cap.className = 'vp-cap'; cap.contentEditable = 'true'; cap.spellcheck = false
    cap.textContent = it.label; cap.title = 'Click to rename'
    cap.addEventListener('input', () => { it.label = cap.textContent.trim() || (TAB_NAMES[it.tab] || it.tab) })
    cap.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cap.blur() } })
    cap.addEventListener('mousedown', e => e.stopPropagation())  // don't start a drag while editing
    const sub = document.createElement('div'); sub.className = 'vp-sub'
    info.append(badge, cap, sub)

    const rm = document.createElement('button')
    rm.className = 'vp-remove'; rm.textContent = '×'; rm.title = 'Remove'
    rm.onclick = () => removeItem(it.id)

    row.append(img, info, rm)

    // ── drag to reorder ──
    row.addEventListener('dragstart', e => {
      dragId = it.id; row.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      dragId = null; row.classList.remove('dragging')
      els.list.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over'))
    })
    row.addEventListener('dragover', e => {
      e.preventDefault()
      if (dragId && dragId !== it.id) row.classList.add('drag-over')
    })
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'))
    row.addEventListener('drop', e => {
      e.preventDefault(); row.classList.remove('drag-over')
      if (!dragId || dragId === it.id) return
      const from = items.findIndex(x => x.id === dragId)
      const to = items.findIndex(x => x.id === it.id)
      if (from < 0 || to < 0) return
      items.splice(to, 0, items.splice(from, 1)[0])
      render()
    })
    return row
  }

  // ── Compose all captured views into one grid PNG at full source resolution ──
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image()
      im.onload = () => res(im); im.onerror = rej; im.src = src
    })
  }

  async function save() {
    if (!items.length) return
    status('Building panel…')
    let imgs
    try { imgs = await Promise.all(items.map(it => loadImg(it.url))) }
    catch (e) { console.error(e); status('Could not read images', 'err'); return }

    const n = imgs.length
    let cols = els.cols.value === 'auto' ? Math.ceil(Math.sqrt(n)) : parseInt(els.cols.value, 10)
    cols = Math.max(1, Math.min(cols, n))
    const rows = Math.ceil(n / cols)

    // Cell sized to the largest capture so nothing is upscaled (capped for memory).
    const CAP = 1600
    const cellW = Math.min(CAP, Math.max(...imgs.map(im => im.naturalWidth || 800)))
    const cellH = Math.min(CAP, Math.max(...imgs.map(im => im.naturalHeight || 600)))
    const withLabels = els.labels.checked
    const gap = Math.round(cellW * 0.018)
    const capH = withLabels ? Math.round(cellW * 0.052) : 0
    const fontPx = Math.round(cellW * 0.034)
    const margin = gap

    let W = margin * 2 + cols * cellW + (cols - 1) * gap
    let H = margin * 2 + rows * (cellH + capH) + (rows - 1) * gap

    // Clamp very large panels so the browser doesn't refuse the canvas.
    const MAXDIM = 8000, scale = Math.min(1, MAXDIM / Math.max(W, H))

    const cv = document.createElement('canvas')
    cv.width = Math.round(W * scale); cv.height = Math.round(H * scale)
    const ctx = cv.getContext('2d')
    ctx.scale(scale, scale)
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H)
    ctx.imageSmoothingQuality = 'high'

    imgs.forEach((im, i) => {
      const c = i % cols, r = Math.floor(i / cols)
      const x = margin + c * (cellW + gap)
      const y = margin + r * (cellH + capH + gap)
      ctx.fillStyle = '#000'; ctx.fillRect(x, y, cellW, cellH)
      // contain-fit, centered
      const s = Math.min(cellW / im.naturalWidth, cellH / im.naturalHeight)
      const dw = im.naturalWidth * s, dh = im.naturalHeight * s
      ctx.drawImage(im, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh)
      if (withLabels) {
        ctx.fillStyle = '#0d1117'; ctx.fillRect(x, y + cellH, cellW, capH)
        ctx.fillStyle = '#c9d1d9'; ctx.font = `600 ${fontPx}px system-ui, sans-serif`
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
        let txt = items[i].label || ''
        const max = cellW - gap * 2
        while (txt.length > 4 && ctx.measureText(txt).width > max) txt = txt.slice(0, -2)
        if (txt !== (items[i].label || '')) txt = txt.replace(/…?$/, '…')
        ctx.fillText(txt, x + cellW / 2, y + cellH + capH / 2)
      }
    })

    const a = document.createElement('a')
    a.href = cv.toDataURL('image/png')
    a.download = `brain_panel_${cols}x${rows}_${Date.now()}.png`
    a.click()
    status('Saved ' + cols + '×' + rows + ' panel', 'ok')
  }

  // ══ Arrange view — WYSIWYG grid of the final panel, drag tiles to reorder ══
  function colsValue() {
    const n = items.length || 1
    let c = els.cols.value === 'auto' ? Math.ceil(Math.sqrt(n)) : parseInt(els.cols.value, 10)
    return Math.max(1, Math.min(c, n))
  }
  function renderArrange() {
    if (!els.aGrid) return
    const cols = colsValue()
    els.aGrid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)'
    els.aGrid.innerHTML = ''
    items.forEach((it, i) => els.aGrid.appendChild(arrangeTile(it, i)))
  }
  function arrangeTile(it, i) {
    const cell = document.createElement('div')
    cell.className = 'vpa-cell'; cell.dataset.id = it.id; cell.draggable = true
    const img = document.createElement('img'); img.src = it.url; img.alt = it.label; img.draggable = false
    cell.appendChild(img)
    if (els.aLabels.checked) {
      const cap = document.createElement('div'); cap.className = 'vpa-cap'; cap.textContent = it.label
      cell.appendChild(cap)
    }
    const num = document.createElement('span'); num.className = 'vpa-num'; num.textContent = i + 1
    cell.appendChild(num)
    cell.addEventListener('dragstart', e => { dragId = it.id; cell.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' })
    cell.addEventListener('dragend', () => { dragId = null; cell.classList.remove('dragging'); els.aGrid.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over')) })
    cell.addEventListener('dragover', e => { e.preventDefault(); if (dragId && dragId !== it.id) cell.classList.add('drag-over') })
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'))
    cell.addEventListener('drop', e => {
      e.preventDefault(); cell.classList.remove('drag-over')
      if (!dragId || dragId === it.id) return
      const from = items.findIndex(x => x.id === dragId)
      const to = items.findIndex(x => x.id === it.id)
      if (from < 0 || to < 0) return
      items.splice(to, 0, items.splice(from, 1)[0])
      render(); renderArrange()
    })
    return cell
  }
  function openArrange() {
    if (!items.length) { status('Add some views first', 'err'); return }
    els.aCols.value = els.cols.value
    els.aLabels.checked = els.labels.checked
    renderArrange()
    els.arrange.classList.add('active')
  }
  function closeArrange() { els.arrange.classList.remove('active') }

  // ── Wire up controls ──
  els.add.onclick = toggleAddMenu
  els.save.onclick = save
  if (els.arrangeBtn) els.arrangeBtn.onclick = openArrange
  if (els.arrange) {
    els.aClose.onclick = closeArrange
    els.aSave.onclick = save                       // save() reads the (synced) panel cols/labels
    els.aCols.onchange = () => { els.cols.value = els.aCols.value; renderArrange() }
    els.aLabels.onchange = () => { els.labels.checked = els.aLabels.checked; renderArrange() }
    els.arrange.addEventListener('mousedown', e => { if (e.target === els.arrange) closeArrange() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && els.arrange.classList.contains('active')) closeArrange() })
  }
  els.clear.onclick = () => { if (items.length && confirm('Clear all captured views?')) { items.length = 0; render() } }
  els.collapse.onclick = () => {
    const c = els.panel.classList.toggle('collapsed')
    els.collapse.textContent = c ? '▸' : '▾'
  }

  // ── Drag the panel itself by its header ──
  ;(() => {
    let down = false, ox = 0, oy = 0
    els.header.addEventListener('mousedown', e => {
      if (e.target.closest('.vp-collapse')) return
      down = true
      const r = els.panel.getBoundingClientRect()
      ox = e.clientX - r.left; oy = e.clientY - r.top
      els.panel.style.right = 'auto'
      document.body.style.userSelect = 'none'
    })
    window.addEventListener('mousemove', e => {
      if (!down) return
      const w = els.panel.offsetWidth, h = els.panel.offsetHeight
      let x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - ox))
      let y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - oy))
      els.panel.style.left = x + 'px'; els.panel.style.top = y + 'px'
    })
    window.addEventListener('mouseup', () => { down = false; document.body.style.userSelect = '' })
  })()

  render()
  return { addMenu: toggleAddMenu, arrange: openArrange }
})()
