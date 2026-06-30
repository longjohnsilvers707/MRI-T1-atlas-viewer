# vendor/ — locally vendored third-party libraries

These are the exact upstream builds the viewer depends on, served from this
repo's own server (`/vendor/...`) so the app has **no runtime CDN trust** and
works offline (issues.md A3/A5). `index.html` loads each of these first and only
falls back to a public CDN if the local copy is missing.

Regenerate everything with:

    bash scripts/fetch_vendor.sh

`SHA256SUMS` is the integrity manifest for the files here; verify with:

    (cd vendor && sha256sum -c SHA256SUMS)

## Pinned versions

| Library | Version / ref | Files |
|---------|---------------|-------|
| NiiVue | `0.69.0` (ESM) | `niivue/index.js` |
| three.js | `0.160.0` (ESM) | `three/three.module.js` |
| TensorFlow.js core | `4.22.0` (UMD) | `tfjs/tf.min.js` |
| TensorFlow.js WASM backend | `4.22.0` | `tfjs/tf-backend-wasm*.{js,wasm}` |
| brainchop model `model5_gw_ae` | commit `4c87885f3a2a8835e260d521dcec922b58d91d41` | `brainchop/model5_gw_ae/*` |

The brainchop commit SHA and the version constants are duplicated in
`index.html` (`BC_MODEL_BASE`, `TFJS_VER`) and `scripts/fetch_vendor.sh`; keep
them in lockstep.
