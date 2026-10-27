BEGIN;
CREATE TABLE IF NOT EXISTS project_workspaces (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_workspaces_owner ON project_workspaces(user_id);
CREATE TABLE IF NOT EXISTS project_entries (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project_workspaces(id),
  kind text NOT NULL CHECK(kind IN ('task','note','document','event','reminder','purchase','inventory')),
  data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_entries_project ON project_entries(project_id,kind) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS project_activity (
  seq bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES project_workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, entity_id uuid,
  before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS project_oauth_clients (
  id text PRIMARY KEY, redirect_uris jsonb NOT NULL, secret_hash text,
  auth_method text NOT NULL DEFAULT 'none', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_oauth_requests (
  id text PRIMARY KEY, nonce_hash text NOT NULL, data jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS project_oauth_codes (
  code_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), client_id text NOT NULL,
  redirect_uri text NOT NULL, challenge text NOT NULL, resource text NOT NULL, scope text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS project_oauth_tokens (
  token_hash text PRIMARY KEY, refresh_hash text UNIQUE, user_id uuid NOT NULL REFERENCES users(id),
  client_id text NOT NULL, resource text NOT NULL, scope text NOT NULL, expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS project_deliveries (
  entry_id uuid NOT NULL REFERENCES project_entries(id), schedule_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, error text,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entry_id,schedule_key)
);
COMMIT;
