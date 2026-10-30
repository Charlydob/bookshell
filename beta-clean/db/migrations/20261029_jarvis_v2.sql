-- Additive; run explicitly during an authorized deployment, never at startup.
BEGIN;
ALTER TABLE project_access_tickets ADD COLUMN IF NOT EXISTS allowed_scopes text[]
 NOT NULL DEFAULT ARRAY['projects:read','projects:write'];
CREATE TABLE IF NOT EXISTS jarvis_operations (
 user_id uuid NOT NULL REFERENCES users(id), idempotency_key text NOT NULL,
 operation text NOT NULL, input_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS jarvis_operation_audit (
 id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 operation text NOT NULL, entity_id text, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
