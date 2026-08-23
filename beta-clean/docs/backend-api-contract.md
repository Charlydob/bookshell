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
  "timezone": "Europe/Madrid",
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
- `recurrence.type`: `none`, `yearly`, `daily`, `custom`
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

`GET /reminders/due?until=2026-08-28T08:00:00Z`

- Returns alert rows where `alert.status = pending` and resolved `notifyAt <= until`.
- For relative alerts, compute `notifyAt` from `targetDate`, `targetTime`, `timezone`, and `minutesBefore`.
- n8n can poll this endpoint, send Telegram later, then call a future alert status endpoint or `PATCH /reminders/:id` to mark alert status.
