// ═══════════════════════════════════════════════════════════════════════
//  IMPORT NIIVUE  (with CDN fallback)
// ═══════════════════════════════════════════════════════════════════════
export async function importNiivue() {
  // Local vendored copy first (no runtime CDN trust, works offline — A3/A5);
  // public CDNs remain only as a last-resort fallback.
  const cdns = [
    '../vendor/niivue/index.js',
    'https://unpkg.com/@niivue/niivue@0.69.0/dist/index.js',
    'https://cdn.jsdelivr.net/npm/@niivue/niivue@0.69.0/dist/index.js',
    'https://unpkg.com/@niivue/niivue@0.69.0/build/niivue/index.js',
  ]
  let lastErr
  for (const url of cdns) {
    try {
      const local = url.startsWith('../vendor/')
      document.getElementById('loadingMsg').textContent =
        local ? 'Loading NiiVue…' : 'Loading NiiVue from CDN…'
      const mod = await import(url)
      if (mod && mod.Niivue && mod.SHOW_RENDER && mod.NVImage) return mod
      lastErr = new Error('module missing Niivue / SHOW_RENDER exports')
    } catch (e) {
      lastErr = e
      console.warn(`CDN failed: ${url}`, e)
    }
  }
  throw new Error(`All CDNs failed.\nLast error: ${lastErr?.message || lastErr}`)
}
