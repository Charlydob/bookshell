-- Dedicated, revocable server-to-server credential for JARVIS.
-- The repository contains only the SHA-256 hash; the bearer token stays on the PC Core.

CREATE TABLE IF NOT EXISTS jarvis_api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'JARVIS Core',
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS jarvis_api_tokens_active_user_idx
  ON jarvis_api_tokens (user_id)
  WHERE revoked_at IS NULL;

INSERT INTO jarvis_api_tokens (user_id, name, token_hash, scopes)
VALUES (
  'b403663c-3675-48fb-a82e-b921d78404b0',
  'JARVIS Core',
  'f323ba6f8d6a956b4c8ba8f227aa923e4aca062a01269d29c4ad3117bf180278',
  ARRAY[
    'books:read', 'books:write',
    'gym:read', 'gym:write',
    'habits:read', 'habits:write',
    'finance:read', 'finance:write',
    'reminders:read', 'reminders:write',
    'notes:read', 'notes:write',
    'world:read', 'world:write',
    'recipes:read', 'recipes:write'
  ]
)
ON CONFLICT (token_hash) DO NOTHING;
