const ROOT_FALLBACK_SELECTORS = [
  ".modal-backdrop:not(.hidden)",
  ".video-sheet-backdrop:not(.hidden)",
  ".media-modal-shell:not(.hidden)",
  ".world-map-sheet:not(.hidden)",
  '[aria-modal="true"]:not(.hidden)'
];

function hideElement(el) {
  if (!el) return;
  el.classList?.add("hidden");
  el.classList?.remove?.("is-open");
  el.setAttribute?.("aria-hidden", "true");
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
  document.querySelectorAll(".view").forEach((view) => {
    const isActive = view.id === viewId;
    view.classList.toggle("view-active", isActive);
    view.setAttribute("aria-hidden", String(!isActive));
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
  "view-books": () => {
    closeByIds(["book-modal-backdrop", "book-detail-backdrop"]);
  },
  "view-videos-hub": () => {
    clickByIds(["videos-hub-back-btn"]);
    const listTab = document.querySelector('#view-videos-hub .videosHub__tab[data-hub-tab="list"]');
    if (listTab) listTab.click();
  },
  "view-recipes": () => {
    closeByIds([
      "recipe-modal-backdrop",
      "recipe-detail-backdrop",
      "macro-integration-modal-backdrop",
      "macro-add-modal-backdrop",
      "macro-product-modal-backdrop"
    ]);
    const libraryTab = document.getElementById("recipes-subtab-library");
    if (libraryTab) libraryTab.click();
  },
  "view-habits": () => {
    closeByIds(["habit-modal-backdrop", "habit-entry-modal-backdrop", "habit-session-overlay"]);
    const todayTab = document.querySelector('#view-habits .habit-subtab[data-tab="today"]');
    if (todayTab) todayTab.click();
  },
  "view-games": () => {
    document.querySelectorAll("#view-games .modal-backdrop:not(.hidden)").forEach(hideElement);
    hideElement(document.getElementById("game-detail-modal"));
    const countersTab = document.getElementById("game-tab-counters");
    if (countersTab) countersTab.click();
  },
  "view-media": () => {
    document.querySelectorAll("#view-media .media-modal-shell:not(.hidden)").forEach(hideElement);
    clickByIds(["media-add-close", "media-country-close"]);
  },
  "view-world": () => {
    const mainTab = document.querySelector('#view-world .world-window-tab[data-window="main"]');
    if (mainTab) mainTab.click();
    clickByIds(["world-go-back", "world-map-sheet-close"]);
    const addToggle = document.getElementById("world-add-toggle");
    if (addToggle) addToggle.checked = false;
    closeByIds(["world-map-sheet"]);
  },
  "view-finance": () => {
    const backdrop = document.getElementById("finance-modalOverlay");
    if (backdrop) {
      backdrop.classList.remove("is-open");
      hideElement(backdrop);
      backdrop.innerHTML = "";
    }
    document.body.classList.remove("finance-modal-open");
  },
  "view-gym": () => {
    clickByIds(["gym-back", "gym-stats-back"]);
    closeByIds([
      "gym-exercise-modal",
      "gym-create-modal",
      "gym-template-modal",
      "gym-cardio-modal",
      "gym-exercise-detail-modal"
    ]);
  }
};

export function isActiveTabReselect(viewId) {
  const activeBtn = document.querySelector(".bottom-nav .nav-btn.nav-btn-active");
  const activeViewId = activeBtn?.dataset?.view || "";
  return Boolean(viewId) && activeViewId === viewId;
}

export async function resetTabToRoot(viewId) {
  if (!viewId) return;

  forceMainView(viewId);

  const tabResetter = TAB_RESETTERS[viewId];
  if (typeof tabResetter === "function") {
    tabResetter();
  }

  const root = document.getElementById(viewId);
  closeScopedOverlays(root);
  if (root) root.scrollTop = 0;
}
