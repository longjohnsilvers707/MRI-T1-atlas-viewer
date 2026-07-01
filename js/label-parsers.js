// ═══════════════════════════════════════════════════════════════════════
//  LABEL PARSERS
//  Space-delimited format:   "idx  name  [extra]"
//  Pipe-delimited format:    "idx|short|long|category"
// ═══════════════════════════════════════════════════════════════════════
export function parseSpace(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const p = l.split(/\s+/)
      return { index: parseInt(p[0]), name: p[1] ?? '' }
    })
    .filter(r => !isNaN(r.index) && r.name)
}

export function parsePipe(text) {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('|'))
    .map(l => {
      const p = l.split('|')
      return {
        index:    parseInt(p[0]),
        name:     (p[2] || p[1] || '').trim(),
        short:    (p[1] || '').trim(),
        category: parseInt(p[3] ?? '1') || 1,
      }
    })
    .filter(r => !isNaN(r.index) && r.name)
}
