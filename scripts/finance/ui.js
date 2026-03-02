// scripts/finance/ui.js

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[s]));
}

// $opt: querySelector opcional (p.ej. wrapper), $req: querySelector "estricto" opcional
export function resolveFinanceRoot($opt, $req) {
  const opt = (typeof $opt === 'function')
    ? $opt
    : (sel, root = document) => (root || document).querySelector(sel);

  const req = (typeof $req === 'function')
    ? $req
    : (sel, root = document) => {
        const el = (root || document).querySelector(sel);
        if (!el) throw new Error(`[finance] Missing required element: ${sel}`);
        return el;
      };

  return (
    opt('#finance-root') ||
    opt('[data-tab="finance"]') ||
    opt('#finance, #financeTab, .finance-tab, [data-view="finance"]') ||
    opt('#tab-finance') ||
    opt('#view-finance') ||
    // último recurso (si existe alguno de los dos)
    (opt('#tab-finance') || opt('#view-finance')) ||
    // y si quieres “estricto”, que sea lo último:
    (() => { try { return req('#view-finance'); } catch { return null; } })()
  );
}

export function ensureFinanceHost($opt, $req) {
  const opt = (typeof $opt === 'function')
    ? $opt
    : (sel, root = document) => (root || document).querySelector(sel);

  const current = opt('#finance-content');
  if (current) return current;

  const root = resolveFinanceRoot($opt, $req);
  if (!root) throw new Error('[finance] Cannot mount: finance root not found');

  const host = document.createElement('div');
  host.id = 'finance-content';

  const mountTarget = opt('#finance-main', root) || root;
  mountTarget.append(host);

  console.warn('[finance] #finance-content not found, created fallback container inside finance root');
  return host;
}

export function showFinanceBootError($opt, err) {
  const opt = (typeof $opt === 'function')
    ? $opt
    : (sel, root = document) => (root || document).querySelector(sel);

  const message = String(err?.message || err || 'Error desconocido');
  const safe = escapeHtml(message);

  const host = opt('#finance-content');
  if (host) host.innerHTML = `
    <h3>Error JS (BOOT)</h3>
    <pre>${safe}</pre>
  `;

  const overlay = opt('#finance-modalOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `
      <div class="finance-modal">
        <h3>Error JS (BOOT)</h3>
        <pre>${safe}</pre>
      </div>
    `;
  }
}