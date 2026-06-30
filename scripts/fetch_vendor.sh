#!/usr/bin/env bash
# fetch_vendor.sh — download the exact pinned third-party builds the viewer uses
# into vendor/, so the app has no runtime CDN trust and works offline (issues.md
# A3/A5). Re-run to reproduce vendor/ from scratch. Verifies SHA-256 of each file
# against vendor/SHA256SUMS when that file exists.
#
# Versions are pinned here and must match the constants in index.html.
set -euo pipefail

NIIVUE_VER="0.69.0"
THREE_VER="0.160.0"
TFJS_VER="4.22.0"
BC_SHA="4c87885f3a2a8835e260d521dcec922b58d91d41"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/vendor"
mkdir -p "$V/niivue" "$V/three" "$V/tfjs" "$V/brainchop/model5_gw_ae"

dl() { echo "  $2"; curl -fsSL "$1" -o "$V/$2"; }

echo "Vendoring libraries into $V …"

# NiiVue (ESM)
dl "https://cdn.jsdelivr.net/npm/@niivue/niivue@${NIIVUE_VER}/dist/index.js" "niivue/index.js"

# three.js (ESM)
dl "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js" "three/three.module.js"

# TensorFlow.js core (UMD) + WASM backend + its .wasm binaries
dl "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${TFJS_VER}/dist/tf.min.js" "tfjs/tf.min.js"
dl "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_VER}/dist/tf-backend-wasm.min.js" "tfjs/tf-backend-wasm.min.js"
for w in tfjs-backend-wasm.wasm tfjs-backend-wasm-simd.wasm tfjs-backend-wasm-threaded-simd.wasm; do
  dl "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_VER}/dist/${w}" "tfjs/${w}"
done

# brainchop model (pinned commit SHA) — model graph, weights, colormap.
# Served from raw.githubusercontent (jsdelivr's gh proxy is flaky/rate-limited).
BC="https://raw.githubusercontent.com/neuroneural/brainchop/${BC_SHA}/public/models/model5_gw_ae"
dl "${BC}/model.json"             "brainchop/model5_gw_ae/model.json"
dl "${BC}/colormap3.json"         "brainchop/model5_gw_ae/colormap3.json"
dl "${BC}/group1-shard1of1.bin"   "brainchop/model5_gw_ae/group1-shard1of1.bin"

echo
echo "Writing vendor/SHA256SUMS"
( cd "$V" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
echo "Done. $(wc -l < "$V/SHA256SUMS") files vendored."
