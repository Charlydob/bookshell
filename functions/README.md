# Bookshell Apple Shortcuts Finance API

Bookshell is a static GitHub Pages app, so Apple Shortcuts cannot safely write directly to Firebase without exposing credentials or weakening database rules. This directory adds a native HTTPS Firebase Cloud Function that runs server-side with Firebase Admin and writes the same Realtime Database records used by the Finance UI.

## Endpoints

After deploying project `bookshell-59703` in region `europe-west1`:

- `GET https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/config`
- `POST https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/movements`
- `POST https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/transfers`

If Firebase Hosting is deployed too, the same function is also reachable at:

- `https://bookshell-59703.web.app/api/shortcuts/finance/config`
- `https://bookshell-59703.web.app/api/shortcuts/finance/movements`
- `https://bookshell-59703.web.app/api/shortcuts/finance/transfers`

## Authentication

Send `Authorization: Bearer <token>` from Apple Shortcuts. Configure the token only in Firebase Functions environment variables or secrets; do not commit it.

Supported configuration options:

```bash
firebase functions:secrets:set SHORTCUTS_TOKEN
firebase functions:secrets:set SHORTCUTS_UID
```

or, for multiple users/tokens, set runtime environment variable `SHORTCUTS_TOKEN_MAP` to JSON:

```json
{"token-a":"firebase-auth-uid-a","token-b":"firebase-auth-uid-b"}
```

The function reads Cloud Functions v2 params named `SHORTCUTS_TOKEN`, `SHORTCUTS_UID`, and optional `SHORTCUTS_TOKEN_MAP`. Set them with the Firebase CLI prompt during deploy, a `.env` file for local emulation, or Google Cloud/Firebase environment configuration. Generate a token with `openssl rand -hex 32`.

## Example requests

```bash
curl -H "Authorization: Bearer $BOOKSHELL_SHORTCUTS_TOKEN" \
  https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/config
```

```bash
curl -X POST -H "Authorization: Bearer $BOOKSHELL_SHORTCUTS_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"expense","amount":12.5,"currency":"EUR","accountId":"ACCOUNT_ID","category":"Comida","note":"Atajo iOS"}' \
  https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/movements
```

```bash
curl -X POST -H "Authorization: Bearer $BOOKSHELL_SHORTCUTS_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"income","amount":100,"currency":"EUR","accountId":"ACCOUNT_ID","category":"Salario","note":"Atajo iOS"}' \
  https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/movements
```

```bash
curl -X POST -H "Authorization: Bearer $BOOKSHELL_SHORTCUTS_TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":50,"currency":"EUR","fromAccountId":"SOURCE_ACCOUNT_ID","toAccountId":"TARGET_ACCOUNT_ID","note":"Atajo iOS"}' \
  https://europe-west1-bookshell-59703.cloudfunctions.net/shortcutsApi/finance/transfers
```
