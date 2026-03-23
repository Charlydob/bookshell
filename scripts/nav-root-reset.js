const ROOT_FALLBACK_SELECTORS = [
  '.modal-backdrop:not(.hidden)',
  '.video-sheet-backdrop:not(.hidden)',
  '.media-modal-shell:not(.hidden)',
  '.world-map-sheet:not(.hidden)',
  '[aria-modal="true"]:not(.hidden)'
];

function hideElement(el) {
  if (!el) return;
  el.classList?.add('hidden');
  el.setAttribute?.('aria-hidden', 'true');
}

function clickIfVisible(el) {
  if (!el) return false;
  const rects = el.getClientRects?.() || [];
  if (!rects.length) return false;
  el.click();
  return true;
}

function forceMainView(viewId) {
  if (!viewId) return;
  if (typeof window.__bookshellSetView === 'function') {
    window.__bookshellSetView(viewId);
    return;
  }
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('view-active', view.id === viewId);
  });
}

function closeScopedOverlays(scope) {
  if (!scope) return;
  ROOT_FALLBACK_SELECTORS.forEach((selector) => {
    scope.querySelectorAll(selector).forEach(hideElement);
  });
}

function closeByIds(ids = []) {
  ids.forEach((id) => hideElement(document.getElementById(id)));
}

function clickByIds(ids = []) {
  ids.forEach((id) => clickIfVisible(document.getElementById(id)));
}

const TAB_RESETTERS = {
  'view-books': () => {
    closeByIds(['book-modal-backdrop', 'book-detail-backdrop']);
    forceMainView('view-books');
  },
  'view-videos': () => {
    forceMainView('view-videos');
    closeByIds(['video-count-sheet-backdrop', 'video-link-picker-backdrop']);
  },
  'view-recipes': () => {
    closeByIds([
      'recipe-modal-backdrop',
      'recipe-detail-backdrop',
      'macro-integration-modal-backdrop',
      'macro-add-modal-backdrop',
      'macro-product-modal-backdrop'
    ]);
  },
  'view-habits': () => {
    closeByIds(['habit-modal-backdrop', 'habit-entry-modal-backdrop', 'habit-session-overlay']);
    const todayTab = document.querySelector('.habit-subtab[data-tab="today"]');
    if (todayTab) todayTab.click();
  },
  'view-games': () => {
    document.querySelectorAll('#view-games .modal-backdrop:not(.hidden)').forEach(hideElement);
    hideElement(document.getElementById('game-detail-modal'));
  },
  'view-media': () => {
    document.querySelectorAll('.media-modal-shell:not(.hidden)').forEach(hideElement);
    clickByIds(['media-add-close', 'media-country-close']);
  },
  'view-world': () => {
    clickByIds(['world-go-back']);
    closeByIds(['world-map-sheet']);
  },
  'view-finance': () => {
    const backdrop = document.getElementById('finance-modalOverlay');
    if (backdrop) {
      backdrop.classList.remove('is-open');
      hideElement(backdrop);
      backdrop.innerHTML = '';
    }
    document.body.classList.remove('finance-modal-open');
  },
  'view-gym': () => {
    clickByIds(['gym-back', 'gym-stats-back']);
    closeByIds([
      'gym-exercise-modal',
      'gym-create-modal',
      'gym-template-modal',
      'gym-cardio-modal',
      'gym-exercise-detail-modal'
    ]);
    forceMainView('view-gym');
  }
};

export function isActiveTabReselect(viewId) {
  const activeBtn = document.querySelector('.bottom-nav .nav-btn.nav-btn-active');
  const activeViewId = activeBtn?.dataset?.view || '';
  return !!viewId && activeViewId === viewId;
}

export async function resetTabToRoot(viewId, context = {}) {
  if (!viewId) return;
  const { module } = context;

  forceMainView(viewId);

  const moduleReset = module?.resetToMainView || module?.goToRoot;
  if (typeof moduleReset === 'function') {
    await moduleReset();
  }

  const tabResetter = TAB_RESETTERS[viewId];
  if (typeof tabResetter === 'function') {
    tabResetter();
  }

  const root = document.getElementById(viewId);
  closeScopedOverlays(root);
  if (root) root.scrollTop = 0;
}

export function getTabResetterMap() {
  return { ...TAB_RESETTERS };
}
