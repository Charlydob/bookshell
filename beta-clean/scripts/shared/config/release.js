(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-10-27-projects-mobile-v4",
    build: "projects-mobile-v4",
    releasedAt: "2026-10-27",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
