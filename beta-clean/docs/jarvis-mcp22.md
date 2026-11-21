# JARVIS MCP 2.2: retroactive sessions and audit

## Compatible activity contract

`activity_start` accepts optional `startedAt`, an ISO 8601 timestamp with `Z` or a numeric offset. Omission retains server time. The session stays running with the same habit/project association. Reject future starts or starts older than the existing 366-day interval bound. Explicit offsets resolve repeated DST hours; `timezone` determines calendar-day attribution, not a reinterpretation of the instant.

`activity_update.patch.startedAt` corrects the first interval's start, or `openAt` before any pause. Running, paused and stopped sessions are supported. Pauses and later intervals remain intact. The same revision, ownership, conditional `habits:write` permission, transaction, correction history and idempotency ledger apply. Do not combine `startedAt` with `intervals` or `durationSec`. Replacing complete intervals or duration still requires a stopped session. Self overlap, reversed/empty closed intervals and future dates are rejected; overlap with a different session remains valid.

`activity_change.endedAt` optionally specifies a past end for pause/stop of a running session. It must lie between `openAt` and server time. It is not accepted for resume or a paused session. Omission retains server time.

Open/paused corrections do not materialize habit credits. Queries calculate elapsed duration from intervals and `openAt`; closing credits the existing native daily aggregate once. Stopped corrections debit the exact old session projection and credit its replacement atomically. An inconsistent old projection fails with `SESSION_PROJECTION_CONFLICT` and rolls back.

## Examples

```json
{"tool":"activity_start","arguments":{"label":"Trabajo","habitId":"h-mk607gdd","timezone":"Europe/Zurich","startedAt":"2026-10-31T08:00:00+01:00","idempotencyKey":"work-start-20261031-0800"}}
```

To correct an existing session, first query it and use its current `revision` as `expectedRevision`; provide `patch: {"startedAt":"2026-10-31T08:00:00+01:00"}` and a new intent-specific idempotency key. Retry the identical request using the same key. To stop twenty minutes ago, resolve the declared time to an offset-aware instant and use `activity_change` with `action: "stop"` and `endedAt`.

Errors: malformed/missing-offset timestamps → `INVALID_ARGUMENT`; future/bounded start → `INVALID_STARTED_AT`; invalid close → `INVALID_ENDED_AT` or `CLOCK_BEFORE_START`; stale revision → `REVISION_CONFLICT`; changed retry payload → `IDEMPOTENCY_CONFLICT`; missing permission → 403; missing/foreign entity → 404. Internal errors now report status 500 in the MCP error payload instead of validation status 400. A JSON-RPC/HTTP success alone is not a successful tool result: inspect `isError` and read back persisted state.

## Additional audit fix

Project tasks previously accepted `completedAt` in their schema but silently replaced explicit historical values with server time. Explicit historical completion and subsequent correction now persist; reopening clears the completion time; future completion facts are rejected. Existing callers omitting the field retain server-time completion.

## Test and deployment contract

Run `node --test tests/jarvis-retroactive.integration.cjs tests/jarvis-modules-mcp.integration.cjs` with `BOOKSHELL_TEST_DATABASE_URL` pointing to a disposable PostgreSQL database named `bookshell_qa`. Tests refuse another database, use synthetic users/disposable schemas, call the actual MCP SDK and verify stored JSON/rows. Include the existing v2, phase2, permissions, projects and notification regressions.

No migration/dependency change is required. Use `projects/update-bookshell-safe.sh --ref <reviewed-commit>`: clean tree, descendant check, migration check, preserved active Compose files/flags, verified database dump, rollback ref, API-only recreation and authenticated health check. Roll back code with the same active Compose configuration; preserve the current database and later writes. Never deploy a test fixture to production.

## Published plugin and host catalogue

The separately hosted MCP repository owns tool contracts and descriptions. JARVIS's existing dynamic-discovery skill has no frozen tool catalogue and requires no package identity or connection change. The release changes the server version to 2.2.0 and publishes updated schemas through `tools/list`. An already open host chat can retain the old schemas. Refresh the existing connector catalogue/start a fresh chat and verify the `startedAt`/`endedAt` properties; do not create a second connection or store tokens in the plugin. Report server publication separately from host availability.

## Important remaining scope

The full operation inventory and per-operation audit matrix accompany the delivery. Nutrition, gym, finance and world are read-only MCP integrations; their web editors contain browser-side business logic (consumption snapshots and habit/inventory effects; exercise snapshots and derived totals; financial movements and transfers) rather than a reusable tested server write service. Adding a generic JSON writer would bypass those invariants. Their write flows require extracting those existing services and isolated persistence/security tests before exposing new scopes. Read success does not establish write support.

Global reminders/recurrences and birthday synchronization remain absent. Project reminders retain their existing task synchronization. Project-generation tools still lack an idempotency key and `reschedule_dependencies` lacks an expected version; they must not be blindly retried. Recovery of soft-deleted project entries, people deletion with reminder reconciliation, book ratings and a cooking/batch event are not exposed. These are documented gaps, not verified operations. This release does not claim the whole requested integration programme is complete.
