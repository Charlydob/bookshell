-- Bookshell shortcuts API: personal bearer tokens and persistent idempotency.

CREATE TABLE IF NOT EXISTS shortcut_api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'iPhone Shortcuts',
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL DEFAULT '',
  token_last_four text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS shortcut_api_tokens_active_user_idx
  ON shortcut_api_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS shortcut_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shortcut_idempotency_keys_unique UNIQUE (user_id, scope, idempotency_key)
);
