BEGIN;
ALTER TABLE project_entries ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES project_entries(id);
ALTER TABLE project_entries ADD COLUMN IF NOT EXISTS offset_minutes integer;
ALTER TABLE project_entries ADD COLUMN IF NOT EXISTS suspension_reason text;
CREATE INDEX IF NOT EXISTS project_reminders_task ON project_entries(task_id) WHERE task_id IS NOT NULL AND deleted_at IS NULL;
CREATE OR REPLACE FUNCTION bookshell_validate_reminder_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.task_id IS NOT NULL AND (NEW.kind<>'reminder' OR NOT EXISTS(SELECT 1 FROM project_entries t WHERE t.id=NEW.task_id AND t.kind='task' AND t.project_id=NEW.project_id)) THEN RAISE EXCEPTION 'Reminder task must belong to the same project' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_reminder_task_guard ON project_entries;
CREATE TRIGGER project_reminder_task_guard BEFORE INSERT OR UPDATE OF task_id,project_id,kind ON project_entries FOR EACH ROW EXECUTE FUNCTION bookshell_validate_reminder_task();
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id), daily_enabled boolean NOT NULL DEFAULT true,
 daily_time time NOT NULL DEFAULT '09:00', timezone text NOT NULL DEFAULT 'Europe/Zurich',
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS device_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device ON push_subscriptions(user_id,device_id) WHERE disabled_at IS NULL AND device_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS notification_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL, schedule_key text NOT NULL, source_entry_id uuid REFERENCES project_entries(id),
 obligation_id uuid REFERENCES project_entries(id), target_subscription_id uuid REFERENCES push_subscriptions(id), project_id uuid REFERENCES project_workspaces(id),
 local_date date, timezone text, scheduled_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending', error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,kind,schedule_key)
);
CREATE INDEX IF NOT EXISTS notification_runs_pending ON notification_runs(status,deadline_at);
CREATE TABLE IF NOT EXISTS notification_device_deliveries (
 run_id uuid NOT NULL REFERENCES notification_runs(id), subscription_id uuid NOT NULL REFERENCES push_subscriptions(id),
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, provider_status integer,
 error text, next_attempt_at timestamptz NOT NULL DEFAULT now(), receipt_hash text,
 attempted_at timestamptz, accepted_at timestamptz, display_reported_at timestamptz, opened_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,subscription_id)
);
CREATE TABLE IF NOT EXISTS notification_migration_reviews (
 reminder_id uuid PRIMARY KEY REFERENCES project_entries(id), candidate_ids uuid[] NOT NULL DEFAULT '{}',
 reason text NOT NULL, status text NOT NULL DEFAULT 'review', created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
-- Existing accounts that already granted push permission receive the default daily digest.
INSERT INTO notification_preferences(user_id) SELECT DISTINCT user_id FROM push_subscriptions WHERE disabled_at IS NULL AND user_id IN(SELECT id FROM users) ON CONFLICT DO NOTHING;
-- Preserve already accepted historical digests; skipped/empty old digests do not consume a new delivery.
INSERT INTO notification_runs(user_id,kind,schedule_key,local_date,timezone,scheduled_at,deadline_at,payload,status)
 SELECT user_id,'daily-summary',target_date::text,target_date,timezone,COALESCE(target_at,created_at),COALESCE(target_at,created_at)+interval '15 minutes',payload,'sent'
 FROM reminder_notification_deliveries WHERE delivery_type='daily_summary' AND status='sent' AND target_date IS NOT NULL AND user_id IN(SELECT id FROM users)
 ON CONFLICT DO NOTHING;
COMMIT;
