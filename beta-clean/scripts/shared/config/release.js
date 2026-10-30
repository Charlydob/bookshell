(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-10-30-jarvis21",
    build: "jarvis21",
    releasedAt: "2026-10-30",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
