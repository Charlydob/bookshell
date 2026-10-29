(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-10-29-jarvis2-secure-candidate",
    build: "jarvis2-secure-candidate",
    releasedAt: "2026-10-29",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
