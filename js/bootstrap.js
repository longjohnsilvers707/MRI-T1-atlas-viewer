// ═══════════════════════════════════════════════════════════════════════
//  GLOBAL ERROR VISIBILITY
//  (Surface ANY error in the loading overlay so silent failures are seen)
// ═══════════════════════════════════════════════════════════════════════
function showFatalError(msg) {
  const ov = document.getElementById('loadingOverlay')
  const sp = ov ? ov.querySelector('.spinner') : null
  const lm = document.getElementById('loadingMsg')
  if (ov) ov.classList.add('active')
  if (sp) sp.style.display = 'none'
  if (lm) {
    lm.style.color   = '#f85149'
    lm.style.maxWidth= '70%'
    lm.style.textAlign='center'
    lm.style.fontFamily='monospace'
    lm.style.fontSize='12px'
    lm.style.lineHeight='1.5'
    lm.style.whiteSpace='pre-wrap'
    lm.innerHTML = '<b>Error</b>\n\n' + String(msg).replace(/</g, '&lt;')
  }
}

// ── HTML-escape helper for values interpolated into innerHTML (issues.md A4).
//    Defined early + on window so every script block can reach it. Use this on
//    any user-controllable string (uploaded file names, etc.) before it reaches
//    an innerHTML template.
window.escapeHtml = function (s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// ── Diagnostics / error log (defined early so it captures startup errors too) ──
window.__diag = []
window.diag = function (level, ...args) {
  const msg = args.map(a => {
    if (a instanceof Error) return (a.stack || a.message || String(a))
    if (a && typeof a === 'object') { try { return JSON.stringify(a) } catch (_) { return String(a) } }
    return String(a)
  }).join(' ')
  const entry = { t: new Date().toISOString(), level: level || 'info', msg }
  window.__diag.push(entry)
  if (window.__diag.length > 1000) window.__diag.shift()   // bounded ring buffer
  try { (level === 'error' ? console.error : console.log)('[diag ' + entry.level + '] ' + msg) } catch (_) {}
  return entry
}

// Set true once init() resolves. Before that, an uncaught error means the app
// never came up → the full-screen fatal overlay is appropriate. After that, a
// stray rejection (e.g. an optional async path) must NOT nuke a working UI; it
// goes to the diag ring buffer + a toast instead (issues.md E1).
window.__appReady = false
function reportRuntimeError(label, full) {
  window.diag('error', label, full)
  if (window.__appReady) {
    const first = String(full).split('\n')[0]
    if (typeof window.toast === 'function') window.toast(first + ' — see Diagnostics', 'err')
  } else {
    showFatalError(full)
  }
}
window.addEventListener('error', e => {
  reportRuntimeError('window.error:', e.message + '\n' + (e.filename || '') + ':' + (e.lineno || ''))
})
window.addEventListener('unhandledrejection', e => {
  const r = e.reason
  reportRuntimeError('unhandledrejection:', (r && r.stack) || (r && r.message) || r || 'unhandled rejection')
})
