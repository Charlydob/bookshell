function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }

export function resolveFinanceRoot($opt, $req) {
  return $opt('#finance-root')
    || $opt('[data-tab="finance"]')
    || $opt('#finance, #financeTab, .finance-tab, [data-view="finance"]')
    || $opt('#tab-finance')
    || $opt('#view-finance')
    || $req('#tab-finance, #view-finance');
}

export function ensureFinanceHost($opt, $req) {
  const current = $opt('#finance-content');
  if (current) return current;
  const root = resolveFinanceRoot($opt, $req);
  const host = document.createElement('div');
  host.id = 'finance-content';
  const mountTarget = $opt('#finance-main', root) || root;
  mountTarget.append(host);
  console.warn('[finance] #finance-content not found, created fallback container inside finance root');
  return host;
}

export function showFinanceBootError($opt, err) {
  const message = String(err?.message || err || 'Error desconocido');
  const host = $opt('#finance-content');
  if (host) host.innerHTML = `<article class="finance-panel"><h3>Error JS (BOOT)</h3><p>${escapeHtml(message)}</p></article>`;
  const overlay = $opt('#finance-modalOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true"><header><h3>Error JS (BOOT)</h3></header><p>${escapeHtml(message)}</p></div>`;
  }
}
