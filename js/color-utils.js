// ═══════════════════════════════════════════════════════════════════════
//  COLOUR UTILITIES
// ═══════════════════════════════════════════════════════════════════════
export function hsl2rgb(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)]
}

export function genColors(n) {
  // Golden-angle spread for maximal perceptual distinctness
  return Array.from({ length: n }, (_, i) => {
    const h = (i * 137.508) % 360
    const s = 72 + (i % 5) * 4
    const l = 52 + (i % 3) * 8
    return hsl2rgb(h, s, l)
  })
}

export function rgb2hex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function hex2rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}
