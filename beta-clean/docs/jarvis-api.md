# Private JARVIS API

`/jarvis/*` is a server-to-server API for JARVIS Core. It is independent from browser sessions, iPhone Shortcuts tokens, and the automation secret.

Authentication is `Authorization: Bearer <token>`. Only SHA-256 hashes are persisted in `jarvis_api_tokens`; every token has revocable domain scopes. The migration seeds a hash without storing the raw credential.

Routes:

- `GET /jarvis/capabilities`
- `GET /jarvis/books`; `PATCH /jarvis/books/progress`
- `POST /jarvis/gym/sessions`
- `POST /jarvis/habits/mark`
- `GET /jarvis/finance/options`; `POST /jarvis/finance/movements`
- `GET|POST /jarvis/reminders`
- `GET|PATCH|DELETE /jarvis/reminders/:id`; `POST /jarvis/reminders/:id/complete`
- scoped `GET|PUT|PATCH|DELETE /jarvis/data/{domain}/...` where the stored tree is the canonical model

Progress, habit, gym, finance, and reminder writes run module business rules. Clients must perform read-back before reporting success.

Reminder ranges use `Europe/Zurich`. `today` means the complete local calendar date, including earlier times. Search supports `q`, `eventType`, `subject`, `from`, `until`, and `status`; legacy guardias remain searchable through title/description fallback.

Revoke a credential:

```sql
UPDATE jarvis_api_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE id = '<token-id>';
```
