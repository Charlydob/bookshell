BEGIN;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_label text;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent text;
CREATE TABLE IF NOT EXISTS web_mutations (
 user_id uuid NOT NULL REFERENCES users(id), mutation_key text NOT NULL,
 input_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,mutation_key)
);
COMMIT;
