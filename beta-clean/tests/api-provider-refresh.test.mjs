import assert from "node:assert/strict";
import test from "node:test";

const providerUrl = new URL("../scripts/shared/data/api-provider.js", import.meta.url);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function waitFor(predicate, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for provider refresh"));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test("a confirmed descendant write refreshes an active parent listener immediately", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const requests = [];
  let currentPage = 12;

  globalThis.window = {
    setTimeout,
    clearTimeout,
    requestIdleCallback() {
      return 1;
    },
  };
  globalThis.document = { visibilityState: "visible" };
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = String(options.method || "GET").toUpperCase();
    requests.push({ method, path: parsed.pathname });

    if (parsed.pathname === "/data/books" && method === "GET") {
      return jsonResponse({ ok: true, data: { bookA: { currentPage } } });
    }
    if (parsed.pathname === "/data/books/bookA" && method === "PATCH") {
      currentPage = JSON.parse(String(options.body || "{}")).currentPage;
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: true });
  };

  let unsubscribe = null;
  try {
    const provider = await import(`${providerUrl.href}?refresh-test=${Date.now()}`);
    const observedPages = [];
    unsubscribe = provider.onValue(provider.ref(provider.db, "books"), (snapshot) => {
      observedPages.push(snapshot.val()?.bookA?.currentPage ?? null);
    });

    await waitFor(() => observedPages.includes(12));
    await provider.patchValue("books/bookA", { currentPage: 24 });
    await waitFor(() => observedPages.includes(24));

    assert.deepEqual(observedPages, [12, 24]);
    assert.equal(
      requests.filter((request) => request.method === "GET" && request.path === "/data/books").length,
      2,
    );
  } finally {
    unsubscribe?.();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
