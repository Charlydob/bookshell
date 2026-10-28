# Bookshell mobile redesign — 2026-10-28

Release: `2026-10-28-mobile-redesign-v7`. Existing application and backend contracts are retained.

## Changes

- Monthly calendar: 42 fixed-height day cells, at most two previews (one at widths <=400px), exact hidden-item count, ellipsis, type colors, today/month navigation, and full daily agenda with edit/complete actions. Multi-day events use local dates and an exclusive end. Day detail includes every item of the selected project/date, independently of a text search.
- All project and entry editors: full-width title/content, real two-column short fields, grouped dates, collapsed advanced options, and explicit override of inherited global label/select centering. The dialog header/footer stay outside its single scrolling body. Native date/select controls, close focus, error visibility, submit locking, body scroll lock, and visualViewport resize/offset handling are shared.
- Mobile overview: compact metrics and a Hoy/Semana/Bloqueos/Agenda switch, with visible access to all tasks. The closed quick-action globe is accessed through More on mobile so it cannot cover calendar cells. Horizontal view navigation has a scroll indicator and preserves its horizontal position without jumping the document. Task and verified physical progress remain separate; project scoping remains shared by every view.
- The shared shell owns the iOS top inset via body padding and an opaque fixed status-area surface. Per-view top insets were removed from the shell, Gym, and Finance to avoid duplication. Bottom navigation reserves the home-indicator inset. Existing modal/navigation blur effects remain. Viewport zoom is enabled.
- Dates remain ISO UTC instants in the existing API/database. Display and editing follow the device zone. Unchanged dates preserve the exact original instant, including seconds/milliseconds and the repeated hour during the autumn transition. Nonexistent spring-transition times produce an actionable error. No existing timestamps are migrated.
- The service-worker release and precache include the new scheduling utility; browser storage is preserved during updates.

## Files

`index.html`, `scripts/modules/projects/index.js`, `scripts/modules/projects/schedule.js`, `scripts/shared/config/release.js`, `service-worker.js`, `styles/core/shell.css`, `styles/modules/projects.css`, `styles/modules/gym.css`, `styles/modules/finance.css`.

Regression sources: `tests/projects-schedule.test.mjs` and `tests/projects-mobile-browser.cjs`.

## Reproduce verification

Run `node --test tests/*.test.mjs` from `beta-clean`. Browser verification additionally requires Playwright with Chromium/WebKit installed: `node tests/projects-mobile-browser.cjs`. An external installation can be selected through `PLAYWRIGHT_NODE_PATH`; screenshots can be redirected through `BOOKSHELL_QA_OUTPUT`.

The browser suite serves this repository locally and intercepts the Projects API with isolated in-memory fixtures validated by the existing domain schemas. It never writes to production. It covers 320, 390, 430, 768, 844 landscape and 1440px in both engines; all seven entry editors plus project creation/editing; 0/1/2/3/12 daily entries; counts/height limits; month navigation; project isolation; filters; required-title validation; completion; unchanged timestamps; reduced viewport; and simulated 47px/34px safe-area insets. The clock is fixed to 28 October 2026.

The existing container integration test separately exercises persistent PostgreSQL records and HTTPS API/MCP behavior using temporary owners, then removes only its own records.

## Limits and recovery

WebKit on Windows is browser-engine emulation, not a physical iPhone/Safari installation. Safe areas are simulated through CSS inset values; reduced visual viewport tests are not a real iOS software keyboard. Physical iPhone confirmation remains outstanding. No user screenshots were supplied with the pasted brief; before/after captures were obtained from the live application.

Predeployment recovery copy: `/opt/backups/bookshell-mobile-20261028T235739Z`, with Git bundle, source archive, Caddy/compose configuration, PostgreSQL custom dump, checked dump table of contents, checksums and business-data hashes. Prior commit: `730f0692706f6b83a33d1dcc2975f869c48956a4`.

For normal rollback, revert this release commit in Git and publish through the existing deployment. Preserve current database contents. Do not restore the database dump over newer user data for a frontend rollback.
