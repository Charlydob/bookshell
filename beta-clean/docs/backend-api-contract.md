# Bookshell Backend API Contract

## API Data Provider Runtime

Bookshell production data runtime is `DATA_PROVIDER = "api"`.

All private data calls are sent to `https://api-bookshell.charlydob.com` with `credentials: "include"`.

The frontend keeps accepting legacy app paths such as `v2/users/{anyUid}/books/books`, but the API provider strips the `v2/users/{anyUid}` prefix before calling `/data`, because PostgreSQL stores the authenticated user's JSON tree without that Firebase root prefix.

Current data endpoints used by the provider:

- `GET /data` and `GET /data/{path}`
- `PUT /data/{path}`
- `PATCH /data` and `PATCH /data/{path}`
- `DELETE /data/{path}`
- `POST /data/push/{path}`

Temporary listeners use safe polling against `GET /data/{path}` every 15 seconds while visible and every 30 seconds while hidden. Replace this with SSE/WebSocket when the backend supports it.

### Transaction Contract

The app has real transaction usages in:

- notes link visit increments
- books reading-log/book progress updates
- public catalog usage counters

For true atomicity the backend should expose:

`POST /data/transaction/{path}`

Request body:

```json
{
  "currentValue": {},
  "nextValue": {}
}
```

Required backend behavior:

- derive the owner from the session cookie, not from the path
- run inside a PostgreSQL transaction
- lock the user JSON row, or the addressed JSON branch if the storage model supports it
- compare the current stored branch with `currentValue`
- if equal, write `nextValue` and return the committed value
- if different, return `409 Conflict` with the latest value, preferably as `{ "latestValue": ... }`, so the frontend can retry

Until that endpoint exists, the frontend falls back to read-then-write and logs that the operation is non-atomic.

These endpoints are the contract for the external Bookshell backend at `https://api-bookshell.charlydob.com`; do not trust frontend-sent `userId` as authorization. The backend should derive the user from a session or verified token.

## Auth Session Contract

Bookshell can authenticate with the backend while data still lives in Firebase Realtime Database. During this dual-auth phase, `GET /auth/me` and preferably `POST /auth/login` must return both the canonical PostgreSQL identity and the linked Firebase data root.

Required normalized shape:

```json
{
  "id": "postgres-user-uuid",
  "email": "charlydob99@gmail.com",
  "displayName": "Charly",
  "legacyFirebaseUid": "firebase-auth-uid-that-owns-v2-users-data"
}
```

Accepted compatibility shapes:

- `legacy_firebase_uid`
- `firebaseUid` / `firebase_uid`
- `legacyUserId` / `legacy_user_id`
- `legacyIdentities: [{ "provider": "firebase", "legacy_user_id": "..." }]`

Frontend rule: never use the PostgreSQL UUID as a Firebase path key. If an API session is valid but has no Firebase legacy UID, Bookshell ignores that API identity for Firebase data and falls back to Firebase Auth in `AUTH_PROVIDER = "dual"`.

Cookie requirements:

- Session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.
- Frontend calls auth endpoints with `credentials: "include"`.
- No token is stored in `localStorage` or `sessionStorage`.

## Data Usage Telemetry

`POST /data-usage`

Body:

```json
{
  "userId": "firebase-uid-or-empty",
  "path": "v2/users/{uid}/notes/reminders",
  "operation": "READ",
  "createdAt": "2026-08-23T10:00:00.000Z"
}
```

Validation:

- `operation` must be one of `READ`, `LISTEN`, `CREATE`, `WRITE`, `UPDATE`, `DELETE`, `TRANSACTION`.
- `path` is required, trimmed, and should be capped to a reasonable length such as 640 chars.
- `userId` is optional for telemetry, capped to a reasonable length such as 180 chars.
- Insert with parameterized SQL only:

```sql
INSERT INTO data_usage_log (user_id, path, operation, created_at)
VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()));
```

## iPhone Shortcuts API

Base URL: `https://api-bookshell.charlydob.com`

All Shortcuts endpoints require:

```http
Authorization: Bearer <shortcut-token>
Accept: application/json
```

Movement creation should also send:

```http
Idempotency-Key: <unique-key-from-shortcuts>
Content-Type: application/json
```

Tokens are managed from Bookshell web settings with `GET /shortcuts/status`,
`POST /shortcuts/token`, and `DELETE /shortcuts/token`. The full token is
returned only by `POST /shortcuts/token` as `tokenValue`; the backend stores a
SHA-256 hash plus display prefix/last four characters.

### Get Finance Options

`GET /shortcuts/finance/options`

Optional category filter: `GET /shortcuts/finance/options?type=expense`

Response:

```json
{
  "ok": true,
  "financePath": "finance/finance",
  "accounts": [
    { "id": "acc_1", "name": "PostFinance", "currency": "CHF", "assetType": "cash" }
  ],
  "categories": [
    { "id": "cat_food", "name": "Comida" }
  ],
  "currencies": ["EUR", "PEN", "BTC", "USD", "GBP", "CHF"],
  "movementTypes": ["expense", "income", "transfer"]
}
```

### Get Accounts

`GET /shortcuts/finance/accounts`

Response:

```json
{
  "ok": true,
  "accounts": [
    { "id": "acc_1", "name": "PostFinance", "currency": "CHF", "assetType": "cash" }
  ]
}
```

### Get Categories

`GET /shortcuts/finance/categories`

Optional filter: `GET /shortcuts/finance/categories?type=expense`

Response:

```json
{
  "ok": true,
  "categories": [
    { "id": "cat_food", "name": "Comida" }
  ]
}
```

### Create Movement

`POST /shortcuts/finance/movements`

Expense/income body:

```json
{
  "amount": 12.5,
  "currency": "CHF",
  "accountId": "acc_1",
  "type": "expense",
  "categoryId": "cat_food",
  "description": "Migros",
  "date": "2026-08-28T10:00:00+02:00"
}
```

Transfer body:

```json
{
  "amount": 20,
  "currency": "EUR",
  "fromAccountId": "acc_eur",
  "toAccountId": "acc_chf",
  "type": "transfer",
  "date": "2026-08-28T10:00:00+02:00"
}
```

Response:

```json
{
  "ok": true,
  "movementId": "uuid",
  "financePath": "finance/finance",
  "movement": {},
  "balance": {
    "currency": "EUR",
    "expensesEUR": 12.875,
    "incomeEUR": 0,
    "netEUR": -12.875
  }
}
```

Errors use the existing `{ "ok": false, "error": "CODE" }` shape, for example
`INVALID_SHORTCUT_TOKEN`, `INVALID_AMOUNT`, `ACCOUNT_NOT_FOUND`,
`CATEGORY_NOT_FOUND`, `INVALID_CURRENCY`, and `IDEMPOTENCY_CONFLICT`.

### Today Pending Reminders

`POST /shortcuts/reminders/today`

Optional body:

```json
{ "timezone": "Europe/Zurich" }
```

Response:

```json
{
  "ok": true,
  "accepted": true,
  "count": 3,
  "targetDate": "2026-08-28",
  "timezone": "Europe/Zurich"
}
```

If there are no pending reminders today, the backend returns `count: 0`,
`skipped: true`, and does not send an empty push.

## Canonical Reminder

```json
{
  "id": "",
  "userId": "",
  "title": "Amazon package",
  "description": "",
  "emoji": "box",
  "type": "event",
  "category": "Compras",
  "targetDate": "2026-08-28",
  "targetTime": "10:30",
  "timezone": "Europe/Zurich",
  "source": {
    "type": "gmail",
    "externalId": "gmail-message-id",
    "metadata": {}
  },
  "alerts": [
    {
      "id": "morning",
      "mode": "absolute",
      "minutesBefore": null,
      "notifyAt": "2026-08-28T08:00:00+02:00",
      "channel": "telegram",
      "status": "pending"
    },
    {
      "id": "two-hours",
      "mode": "relative",
      "minutesBefore": 120,
      "notifyAt": "",
      "channel": "telegram",
      "status": "pending"
    }
  ],
  "recurrence": {
    "type": "none",
    "startDate": "2026-08-28",
    "endDate": "",
    "dailyTargetCount": 1
  },
  "status": "pending",
  "completedAt": "",
  "createdAt": "2026-08-23T10:00:00.000Z",
  "updatedAt": "2026-08-23T10:00:00.000Z"
}
```

Recommended enums:

- `source.type`: `bookshell`, `gmail`, `telegram`, `shortcut`, `webhook`, `manual`, `amazon`, `n8n`
- `type`: `normal`, `birthday`, `task`, `event`, `paperwork`, `checklist`, `custom`
- `recurrence.type`: `none`, `daily`, `weekly`, `monthly`, `yearly`, `custom`
- `status`: `pending`, `completed`, `expired`, `cancelled`
- `alerts.mode`: `absolute`, `relative`
- `alerts.channel`: `telegram` initially
- `alerts.status`: `pending`, `sent`, `failed`, `cancelled`

## Reminder REST Endpoints

`POST /reminders`

- Creates a reminder.
- Optional idempotency: if `source.externalId` is present, enforce uniqueness on `(user_id, source.type, source.external_id)` and return the existing reminder on retry.
- Accept ISO dates and explicit `timezone`.

`GET /reminders`

- Lists reminders for the authenticated user.
- Suggested filters: `status`, `type`, `category`, `sourceType`, `from`, `until`.

`GET /reminders/:id`

- Returns one reminder owned by the authenticated user.

`PATCH /reminders/:id`

- Applies a partial update.
- Must not allow changing ownership by trusting `userId`.

`DELETE /reminders/:id`

- Prefer soft-delete/status `cancelled` if auditability matters.

`POST /reminders/:id/complete`

- Marks completed or records one daily completion.
- Suggested body: `{ "completedAt": "ISO", "date": "YYYY-MM-DD", "count": 1 }`.

## Automation Reminder Endpoints

All automation routes are server-to-server only and must require
`X-Bookshell-Automation-Secret` equal to `BOOKSHELL_AUTOMATION_SECRET`.

`GET /automation/reminders/due?limit=50`

- Returns pending alert rows where `reminder_alerts.status = pending`,
  `notify_at <= NOW()`, and the parent reminder is `pending`.
- Maximum `limit` is 100.
- Claim rows transactionally with row locks, for example
  `FOR UPDATE SKIP LOCKED`, and set `locked_at`/`locked_by` to avoid duplicate
  n8n processing.
- Response rows should include `alertId`, `reminderId`, `title`,
  `description` or `message`, `targetDate`, `targetTime`, `timezone`,
  `minutesBefore`, and `sourceType`.

`POST /automation/reminder-alerts/:alertId/sent`

- Marks the claimed alert as `sent`, stores `sent_at`, clears any lock/error,
  and advances recurring reminders by creating only the next due alert set.
- Body should include the schedule version received from `/due`:
  `{ "scheduleVersion": 3 }`.
- If `scheduleVersion` is older than the reminder's current
  `schedule_version`, the ACK is ignored and must not advance or mutate the
  new occurrence.

`POST /automation/reminder-alerts/:alertId/failed`

- Stores `error_message`, increments `attempt_count`, clears the lock, and
  leaves the alert retryable while attempts remain reasonable.
- Body may include `{ "scheduleVersion": 3, "error": "telegram_failed" }`.
- Once retries are exhausted, `failed` is terminal for the current occurrence;
  recurring reminders may advance when no `pending` alerts remain.

`GET /automation/reminders/search`

- Generic query endpoint for future and historical automation lookups.
- Requires `X-Bookshell-Automation-Secret`.
- Optional query params:
  - `q`: free-text match against title, description, source external id, and
    metadata.
  - `eventType`: canonical metadata event type, for example `guardia`.
  - `subject`: canonical metadata subject, for example `Laura`.
  - `from` / `until`: `YYYY-MM-DD` inclusive bounds.
  - `temporalScope`: `today`, `future`, `past`, or `all`.
  - `status`: `pending`, `completed`, `expired`, `cancelled`, or `all`.
  - `limit`: default 50, max 100.
- `eventType` and `subject` prefer `source.metadata.eventType` and
  `source.metadata.subject`. For older reminders without metadata, the backend
  falls back to title/description text matching.
- Results are chronological by `targetDate`, `targetTime`, then creation time.
- Historical `past` queries exclude `cancelled` by default unless
  `status=all` or `status=cancelled` is explicitly supplied.

Example:

```http
GET /automation/reminders/search?eventType=guardia&subject=Laura&temporalScope=future&status=pending&limit=2
X-Bookshell-Automation-Secret: ***
```

```json
{
  "ok": true,
  "total": 2,
  "limit": 2,
  "filters": {
    "q": "",
    "eventType": "guardia",
    "subject": "Laura",
    "from": "",
    "until": "",
    "temporalScope": "future",
    "status": "pending"
  },
  "results": [
    {
      "id": "7a6c0000-0000-4000-9000-000000000001",
      "title": "Guardia Laura",
      "type": "event",
      "status": "pending",
      "targetDate": "2026-09-14",
      "targetTime": "09:00",
      "source": {
        "type": "telegram",
        "externalId": "guardia-laura-2026-09-3",
        "metadata": {
          "groupId": "batch_guardia_laura_sep_2026",
          "seriesKey": "guardia:laura",
          "eventType": "guardia",
          "subject": "Laura",
          "groupIndex": 3,
          "groupSize": 4
        }
      },
      "recurrence": {
        "type": "none",
        "startDate": "2026-09-14",
        "endDate": "",
        "dailyTargetCount": 1,
        "rule": {}
      },
      "alerts": []
    }
  ]
}
```

`GET /automation/reminders?range=today`
`GET /automation/reminders?range=tomorrow`
`GET /automation/reminders?range=this_week`
`GET /automation/reminders?range=next_week`
`GET /automation/reminders?range=all&limit=20`

- Returns reminders for Telegram/n8n queries using `Europe/Zurich` as the
  fallback timezone when a reminder has none.
- `range=all` is capped at 20 by default and 100 as a hard maximum.

`GET /reminders/due?until=2026-08-28T08:00:00Z`

- Returns alert rows where `alert.status = pending` and resolved `notifyAt <= until`.
- For relative alerts, compute `notifyAt` from `targetDate`, `targetTime`, `timezone`, and `minutesBefore`.
- n8n can poll this endpoint, send Telegram later, then call a future alert status endpoint or `PATCH /reminders/:id` to mark alert status.

## n8n Reminder Webhook Contract

These routes must be implemented in the real Bookshell backend that serves
`https://api-bookshell.charlydob.com`. Do not create a parallel reminder backend
inside the frontend.

### Reminder Shape

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "title": "Pagar seguro",
  "message": "Revisar recibo y pagar antes del vencimiento",
  "remindAt": "2026-08-28T08:00:00+02:00",
  "status": "active",
  "source": "bookshell",
  "scheduleVersion": 1,
  "createdAt": "2026-08-23T20:55:00.000Z",
  "updatedAt": "2026-08-23T20:55:00.000Z"
}
```

Required fields:

- `id`: server-generated stable reminder id.
- `title`: short notification title.
- `message`: notification body.
- `remindAt`: ISO-8601 timestamp with explicit offset or `Z`.
- `status`: one of `active`, `cancelled`, `sent`.
- `source`: origin string, for example `bookshell`, `telegram`, `n8n`, `webhook`.
- `scheduleVersion`: integer used to invalidate stale n8n Wait executions.
- `createdAt`: ISO-8601 UTC timestamp.
- `updatedAt`: ISO-8601 UTC timestamp.

### Schedule Version Rules

- On create, set `scheduleVersion = 1`.
- If `remindAt` changes, increment `scheduleVersion` by 1.
- Changes to `title` or `message` that do not alter scheduling do not need to increment `scheduleVersion`.
- Every webhook sent to n8n must include the current `scheduleVersion`.
- `GET /api/reminders/:id` must return the current `scheduleVersion`.
- n8n may send the Telegram notification only when both checks pass:
  - `current.status === "active"`
  - `current.scheduleVersion === webhook.scheduleVersion`

### Create Reminder

`POST /api/reminders`

Request:

```json
{
  "title": "Pagar seguro",
  "message": "Revisar recibo y pagar antes del vencimiento",
  "remindAt": "2026-08-28T08:00:00+02:00",
  "source": "bookshell"
}
```

Response:

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "title": "Pagar seguro",
  "message": "Revisar recibo y pagar antes del vencimiento",
  "remindAt": "2026-08-28T08:00:00+02:00",
  "status": "active",
  "source": "bookshell",
  "scheduleVersion": 1,
  "createdAt": "2026-08-23T20:55:00.000Z",
  "updatedAt": "2026-08-23T20:55:00.000Z"
}
```

Webhook emitted after commit:

```json
{
  "event": "reminder.created",
  "reminder": {
    "id": "rem_01J9ABCDEF1234567890",
    "title": "Pagar seguro",
    "message": "Revisar recibo y pagar antes del vencimiento",
    "remindAt": "2026-08-28T08:00:00+02:00",
    "status": "active",
    "source": "bookshell",
    "scheduleVersion": 1,
    "createdAt": "2026-08-23T20:55:00.000Z",
    "updatedAt": "2026-08-23T20:55:00.000Z"
  }
}
```

### Read Reminder

`GET /api/reminders/:id`

Response:

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "title": "Pagar seguro",
  "message": "Revisar recibo y pagar antes del vencimiento",
  "remindAt": "2026-08-28T08:00:00+02:00",
  "status": "active",
  "source": "bookshell",
  "scheduleVersion": 1,
  "createdAt": "2026-08-23T20:55:00.000Z",
  "updatedAt": "2026-08-23T20:55:00.000Z"
}
```

### Update Reminder

`PATCH /api/reminders/:id`

Request when `remindAt` changes:

```json
{
  "remindAt": "2026-08-29T09:00:00+02:00"
}
```

Response:

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "title": "Pagar seguro",
  "message": "Revisar recibo y pagar antes del vencimiento",
  "remindAt": "2026-08-29T09:00:00+02:00",
  "status": "active",
  "source": "bookshell",
  "scheduleVersion": 2,
  "createdAt": "2026-08-23T20:55:00.000Z",
  "updatedAt": "2026-08-23T21:10:00.000Z"
}
```

Webhook emitted after a scheduling change:

```json
{
  "event": "reminder.updated",
  "reminder": {
    "id": "rem_01J9ABCDEF1234567890",
    "title": "Pagar seguro",
    "message": "Revisar recibo y pagar antes del vencimiento",
    "remindAt": "2026-08-29T09:00:00+02:00",
    "status": "active",
    "source": "bookshell",
    "scheduleVersion": 2,
    "createdAt": "2026-08-23T20:55:00.000Z",
    "updatedAt": "2026-08-23T21:10:00.000Z"
  }
}
```

Request when only copy changes:

```json
{
  "title": "Pagar seguro del coche",
  "message": "Revisar recibo y pagar hoy"
}
```

Response keeps the same `scheduleVersion` unless `remindAt` changed.

### Cancel Reminder

`DELETE /api/reminders/:id`

Prefer soft cancellation instead of physical deletion.

Response:

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "status": "cancelled",
  "scheduleVersion": 2,
  "updatedAt": "2026-08-23T21:20:00.000Z"
}
```

Webhook emitted after cancellation:

```json
{
  "event": "reminder.cancelled",
  "reminder": {
    "id": "rem_01J9ABCDEF1234567890",
    "status": "cancelled",
    "scheduleVersion": 2,
    "updatedAt": "2026-08-23T21:20:00.000Z"
  }
}
```

### Mark Reminder As Sent

`POST /api/reminders/:id/sent`

Request:

```json
{
  "sentAt": "2026-08-29T07:00:10.000Z",
  "channel": "telegram",
  "scheduleVersion": 2
}
```

Required backend behavior:

- Authenticate n8n with a machine-to-machine credential, not a browser session cookie.
- Load the reminder by `id`.
- Only mark as `sent` if `status === "active"` and stored `scheduleVersion` equals request `scheduleVersion`.
- Return `409 Conflict` if the version is stale.

Successful response:

```json
{
  "id": "rem_01J9ABCDEF1234567890",
  "status": "sent",
  "scheduleVersion": 2,
  "sentAt": "2026-08-29T07:00:10.000Z",
  "updatedAt": "2026-08-29T07:00:10.000Z"
}
```

Stale version response:

```json
{
  "error": "stale_schedule_version",
  "message": "Reminder schedule changed after this n8n execution was scheduled.",
  "current": {
    "id": "rem_01J9ABCDEF1234567890",
    "status": "active",
    "scheduleVersion": 3,
    "remindAt": "2026-08-30T09:00:00+02:00"
  }
}
```
