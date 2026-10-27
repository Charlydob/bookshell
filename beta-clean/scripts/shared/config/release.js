(function publishBookshellRelease(root) {
  const release = Object.freeze({
    version: "2026-10-27-projects-v1",
    build: "projects-v1",
    releasedAt: "2026-10-27",
    cachePrefix: "bookshell-",
  });

  root.__BOOKSHELL_RELEASE__ = release;
})(globalThis);
