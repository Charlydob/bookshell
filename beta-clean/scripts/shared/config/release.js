(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-08-29-pwa-release-update-v1",
    build: "pwa-release-update-v1",
    releasedAt: "2026-08-29",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
