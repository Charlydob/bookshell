# JARVIS / Bookshell MCP 2.1

This release extends the existing OAuth MCP and canonical PostgreSQL JSON projection. It does not create a second user database, re-enable local JARVIS, Ollama or Telegram, or make banking transfers.

## Module coverage

| Module | Native persistence | MCP coverage in this release | Remaining work |
| --- | --- | --- | --- |
| Projects/tasks/purchases/inventory/project notes/events/reminders | Existing project tables | Existing 23 tools preserved | Recover/restore operations and additional completeness audit remain separate work |
| Habits | `habits` native projection | Existing CRUD, history, targets, reminder plan | No claim of new native sleep/device sources |
| Activity sessions | `habits.activitySessions` and `habitSessions` | Query/start/pause/resume/stop/manual; new update/reassign/split/delete/restore | Active sessions must be stopped before correction; ambiguous legacy projections are rejected |
| People | Native Notes `noteKind=persona` | Search/cards, create/update fields, birthdays, append personal notes, explicit native relationship links | Automatic birthday reminder materialization, person deletion/reminder cleanup, typed relationship provenance and merges remain pending |
| Recipes | `recipes.items`, legacy recipe entries, nutrition product links | Search/detail/create/update/recoverable delete/restore, scaling preview | Missing nutrition/cost values remain unknown; full consumption side effects are not implemented |
| Nutrition | `recipes.nutrition` | Products, daily meal logs, stored macro targets and known-macro summaries | Consumption CRUD must reconcile habit/product/financial effects before exposure |
| Library | `books.books` and `books.readingLog` | Search/create/metadata update; atomic progress/status/daily reading log | Book deletion/restore and temporal reading sessions remain pending; progress decrease needs the contributing date |
| Gym | `gym.gym` | Exercises, workouts, templates, body records and cardio queries | Workout/set/routine CRUD and personal-record computation remain pending |
| Finance | `finance.finance`, native and legacy transaction branches | Accounts, deduplicated transactions, native categories, budgets, goals, snapshots and recurring records | Financial writes, balance reconciliation, investment valuations and richer summaries remain pending; no conversions inferred |
| Notes/folders | `notes.notes` and `notes.folders` | Search/create/update/move, recoverable note delete/restore, folder create/update with cycle protection | Global reminder/checklist CRUD, archive UI, folder delete/restore remain pending; person cards cannot be deleted through the generic note operation |
| World | `world` | Geography, places, saved places, stays and watch queries | Mutations remain pending |
| Calendar/global reminders | Existing reminders tables / project events | Existing project agenda/events/reminders preserved | Canonical global reminders, yearly birthdays, work schedules and structured checklist CRUD need a user-scoped semantic adapter |

The existence of an old `/jarvis/*` HTTP endpoint does not establish ChatGPT support. Legacy helpers include singleton-user assumptions and independent transactions; this release does not bypass OAuth by calling them directly.

## Activity corrections

All correction operations use the existing per-user advisory lock, `FOR UPDATE` canonical row lock, SHA-256 revisions, idempotency ledger and operation audit in a single transaction. They remove only session-owned projection entries, preserve unstructured legacy credit and unrelated sessions, then credit the corrected intervals split at local midnight. Negative or ambiguous projections fail with `SESSION_PROJECTION_CONFLICT` and roll back. Corrections store previous session snapshots and revisions. A split must exactly partition the old interval union, without overlap or gaps. Deleted sessions remain recoverable and are excluded from normal totals.

`activity_update` accepts label, timezone, project, explicit ISO intervals, or duration seconds for a single interval. It does not infer timing from conversational delays. `activity_query` adds session ID, duration bounds, deleted-session inclusion and correct range filtering. Simultaneous sessions remain independent; elapsed time is the interval union, while activity time is the sum.

The YouTube production correction is executed separately through the authenticated public MCP after QA. Its evidence records unchanged intervals, exactly −7200/+7200 seconds, unchanged other sessions/modules and an audit snapshot. It is never embedded as an automatic data migration.

## Permissions, discovery and pairing

`jarvis_capabilities` reports the server version, all registered project and JARVIS operations, their scopes, connection authorization, module names and limitations. The host must still refresh its tool catalogue; a server response cannot add callable tools to an already-running chat.

New modules have independent read scopes: recipes, people, notes, books, nutrition, gym, finance and world. Write scopes are currently exposed only for recipes, people, notes and books. Existing seven-scope grants are unchanged. Ordinary unauthenticated/legacy pairing cannot escalate permissions. A valid native authenticated session may generate a single-use code covering the server's current supported scopes; OAuth consent still displays and approves the scopes requested by the client. Codes expire after ten minutes. No refresh/access tokens are copied into plugins or reports.

To activate in ChatGPT: refresh the existing Bookshell Proyectos app's tools using its connector management screen, then reconnect/authorize the additional scopes if requested. Generate the pairing code from the authenticated Bookshell Projects → ChatGPT connection screen and complete consent. If the host has no catalogue refresh control, its app configuration owner must refresh the published catalogue. Do not reinstall JARVIS as a workaround or duplicate the connection. Start a fresh chat and inspect the offered capabilities before claiming new operations are callable.

## Interface and deployment

The Habits module no longer imports or mounts `activities.js`. The internal file and server APIs remain. No replacement panel or placeholder is added. The PWA release marker changes to `2026-10-30-jarvis21` so normal update handling refreshes the frontend.

`projects/update-bookshell-safe.sh` preserves the running container's Compose project and every active override; checks authentication/feature flag consistency without printing environment secrets; refuses implicit rollbacks and changed migrations; backs up the database and prior commit; conditionally updates dependencies; recreates only the API; verifies health. It never restores an old dump over later writes. New migrations require explicit review and application, rather than replaying all historical SQL on every deploy.

Rollback: retain the backup's previous commit and Compose-file list, stop new deployment work, switch the code to that commit and recreate only the API using those same files. Keep the current database and additive schema. Do not use a stale base-only Compose command or reset production to a stale `main` branch.

## Verification boundaries

Automated tests use a separate `bookshell_qa` PostgreSQL container, synthetic users and disposable schemas. Browser QA verifies desktop/mobile panel absence, usable native tabs, MCP recording/reassignment with the panel absent, native aggregate read-back and native Notes/Recipes compatibility. Production tests perform the specifically authorized YouTube correction and read-only module probes; they create no permanent synthetic personal records. A successful public SDK probe is reported separately from invocation through the ChatGPT host connection.
