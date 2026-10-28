# Task-linked notices and server daily digest

Release `2026-10-28-task-alerts-digest-v8`.

## Canonical state and lifecycle

Tasks remain `project_entries(kind=task)`. Notice records remain existing `project_entries(kind=reminder)` and reference their task through the persistent foreign key `task_id`. A database trigger rejects cross-project or non-task links. No title matching is used at runtime. A task exposes its linked notices as computed `reminders`; it does not store another copy of their schedule/state.

Task create/update accepts an optional `reminders` array, up to 20 entries:

```json
{
  "title": "Verify the assembly",
  "dueAt": "2026-11-02T09:00:00.000Z",
  "reminders": [{"offsetMinutes": 15}, {"at": "2026-11-02T08:00:00.000Z"}]
}
```

An existing notice can include its `id`; `enabled:false` disables it. Missing notice configurations in an explicitly supplied array are disabled, never deleted. Omitting `reminders` leaves the configuration unchanged. A reminder can also be linked explicitly using `taskId` and optional `offsetMinutes` through the existing API/MCP reminder tools.

All web, PWA, internal API and MCP entry writes use the same transaction in `projects/domain.js`. Completion, task archive (`archived:true`), soft deletion and project archive suspend pending linked notices and cancel pending runs. Reopening only restores automatically suspended notices in the future. Manual cancellation, disabled configuration, completed notices and past alerts are preserved. Relative notices follow the due time; custom notices shift by the same due-date delta. Clearing a due date suspends relative notices. A linked reminder completed through the API completes its parent task, with dependency validation.

Changing a linked notice also increments the task version, so a stale open task editor cannot silently remove a newly added MCP notice. Independent reminders keep their own state and delivery behavior. Archived tasks remain recoverable in the archive filter and do not count toward active task progress.

The calendar and agenda count a linked task once per relevant date. Its notice details are available from the task editor.

## Durable sending

`notification_runs` has a unique `(user_id,kind,schedule_key)` key. A task notice key is `taskId:UTC-instant`, so equivalent notices at the same instant are coalesced. Independent reminders use their own IDs. The daily key is the local date, without a timezone suffix, so changing timezone cannot send the same local-date digest twice.

`notification_device_deliveries` persists each device attempt. Accepted devices are never retried. Explicit provider rejections may retry at bounded intervals (maximum three attempts). A timeout, lost response or process crash after a durable claim becomes `unknown`; it is not blindly retried. A stable Web Push topic and notification tag further coalesce equivalent queued/displayed messages. A provider acknowledgement is labelled accepted, not physically displayed.

The scheduler holds the project lock for the final task/status/schedule check and provider submission. Completion committed before submission always wins, including if an old outbox item exists. Task deletion, archived projects and disabled notices are rechecked at that boundary. A notification already accepted by the external service before completion cannot be recalled by this application.

New Project notices have a 15-minute delivery window. Older missed items are recorded as expired; fresh notices take priority over backlog. Daily digests have the same 15-minute window and never replay missed previous dates. Existing legacy independent reminders retain their existing bounded scheduler policy.

The server starts the scheduler independently of browser visibility. PostgreSQL advisory locking prevents competing processes from processing concurrently. Docker's existing restart policy and persistent PostgreSQL retain schedules/claims across API restarts. Polling is once per minute, so 09:00 means delivery in that minute plus provider/network delay.

## Daily digest and settings

The account preference defaults to enabled, 09:00, `Europe/Zurich` once a push subscription exists. Existing granted installations are seeded by the additive migration. The digest includes active pending tasks due today, overdue tasks (including elapsed times today), relevant linked notices without double counting, independent reminders and today's events. It includes a greeting even when nothing is pending. Legacy independent reminders are read without modifying their records.

The obsolete 08:00 legacy digest is retired. It no longer runs alongside the new scheduler. Manual legacy reminder shortcuts remain compatible.

Same-origin endpoints under `/projects-api/projects/notifications/`:

- GET/PATCH `settings`: enabled/time/timezone and next scheduled instant.
- GET `agenda`: current user's actual Today agenda.
- GET `status`: settings, scheduler health, active device count and recent outcomes.
- POST `preview`: calculate the actual digest without sending or consuming a daily key.
- POST `test`: independent idempotent test run, optionally targeted to the current endpoint.
- POST `receipts`: authenticated-by-random-receipt-token browser display/open reports.

The notification opens `/?agenda=today#view-projects`. The service worker focuses and navigates an existing Bookshell window when available. The Today screen shows tasks, overdue tasks, independent reminders and events; selecting a project restricts it to that project.

## Push and iOS

Existing VAPID keys and subscriptions are reused. A stable installation UUID and a partial unique index prevent old endpoints for the same known installation from staying active after renewal. Unidentified legacy installations are preserved; they are not deduplicated by similar user agents. Provider 404/410 responses disable expired endpoints. Renewal is attempted on application startup and `pushsubscriptionchange`.

Permission is requested directly from the activation button gesture. On iOS, Web Push requires a Home Screen web app and user permission. Notifications are shown immediately on receipt; network reporting happens afterwards. Browser `showNotification` resolution is recorded as a browser display report; it is not proof that a human saw an iPhone banner. Focus, system notification settings and connectivity remain controlled by the device. See [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) and [WebKit Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Migration and recovery

`20261028_task_notifications.sql` adds columns/tables/indexes without dropping current user data. `projects/migrate-task-alerts.js` can be run without arguments for a dry run, or with `--apply`. It also runs idempotently before the first new scheduler tick.

Only explicit user-identified pairs, exact unique long descriptions, or exact unique title/date matches are linked automatically. Possible semantic matches are stored in `notification_migration_reviews` and marked in the reminder UI; they remain independent until reviewed. Linking increments both notice and task versions. Delivery history and original content remain.

Recovery point before this work: `/opt/backups/bookshell-notifications-20261028T081204Z`, previous commit `5550be4`. It contains code/Git, full PostgreSQL dump, configuration, checksums and business-data fingerprints. For a UI rollback retain the new backend and tables; do not re-enable the retired scheduler. For an emergency backend rollback, suspend outbound push first and recover forward against the retained database rather than overwriting subsequent user data with a full dump.

## Verification

- `node --test tests/*.test.mjs`
- `BOOKSHELL_TEST_DATABASE_URL=... node --test tests/notifications-postgres.integration.cjs`
- `BOOKSHELL_TEST_DATABASE_URL=... node tests/notifications-browser.integration.cjs`
- `node tests/projects-mobile-browser.cjs`
- In the deployed API container: `node projects/integration-test.js` (temporary owners, includes real MCP completion and notice cancellation).

Browser tests need Playwright Chromium and WebKit; `PLAYWRIGHT_NODE_PATH` can select an external installation. Database tests create/drop only their randomly named private schemas in an explicitly supplied test database. They must not be pointed at production. UI test requests are routed to the isolated backend and never mutate the real owner's projects.
