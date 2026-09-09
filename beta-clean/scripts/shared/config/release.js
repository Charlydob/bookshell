(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-09-09-data-refresh-v1",
    build: "data-refresh-v1",
    releasedAt: "2026-09-09",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
