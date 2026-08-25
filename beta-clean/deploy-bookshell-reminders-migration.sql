-- Bookshell reminders v2: PostgreSQL source of truth + n8n automation.
-- Safe/idempotent for the actual /opt/bookshell-api schema seen on 2026-08-25.

BEGIN;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS schedule_version integer NOT NULL DEFAULT 1;

ALTER TABLE reminder_alerts
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

-- The actual schema already has error_message/sent_at/failed_at.
ALTER TABLE reminder_alerts
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

-- Actual existing constraint is reminders_recurrence_check.
ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS reminders_recurrence_check;

ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS reminders_recurrence_type_check;

ALTER TABLE reminders
  ADD CONSTRAINT reminders_recurrence_check
  CHECK (
    recurrence_type IN (
      'none',
      'daily',
      'weekly',
      'monthly',
      'yearly',
      'custom'
    )
  );

-- Keep the existing firebase_uid isolation model.
CREATE INDEX IF NOT EXISTS idx_reminders_user_status_target
  ON reminders (firebase_uid, status, target_date, target_time);

CREATE INDEX IF NOT EXISTS idx_reminder_alerts_due_pending_v2
  ON reminder_alerts (notify_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reminder_alerts_reminder_status_v2
  ON reminder_alerts (reminder_id, status);

COMMIT;
