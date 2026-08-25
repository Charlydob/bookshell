-- Bookshell reminders: recurrence and automation support.
-- Safe to run more than once against the existing bookshell database.

BEGIN;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS schedule_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'bookshell',
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE reminder_alerts
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

DO $$
DECLARE
  recurrence_column_name text;
BEGIN
  SELECT column_name
    INTO recurrence_column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reminders'
    AND column_name IN ('recurrence_type', 'recurrence')
  ORDER BY CASE column_name WHEN 'recurrence_type' THEN 0 ELSE 1 END
  LIMIT 1;

  IF recurrence_column_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_%I_check',
      recurrence_column_name
    );
    EXECUTE format(
      'ALTER TABLE reminders ADD CONSTRAINT reminders_%I_check CHECK (%I IN (''none'', ''daily'', ''weekly'', ''monthly'', ''yearly'', ''custom''))',
      recurrence_column_name,
      recurrence_column_name
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminders'
      AND column_name IN ('user_id', 'source_type', 'source_external_id')
    GROUP BY table_name
    HAVING count(*) = 3
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'reminders_user_source_external_unique'
  ) THEN
    CREATE UNIQUE INDEX reminders_user_source_external_unique
      ON reminders (user_id, source_type, source_external_id)
      WHERE source_external_id IS NOT NULL AND source_external_id <> '';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminders'
      AND column_name IN ('user_id', 'status', 'target_date', 'target_time')
    GROUP BY table_name
    HAVING count(*) = 4
  ) THEN
    CREATE INDEX IF NOT EXISTS reminders_user_status_target_idx
      ON reminders (user_id, status, target_date, target_time);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminder_alerts'
      AND column_name IN ('status', 'notify_at')
    GROUP BY table_name
    HAVING count(*) = 2
  ) THEN
    CREATE INDEX IF NOT EXISTS reminder_alerts_due_pending_idx
      ON reminder_alerts (status, notify_at)
      WHERE status = 'pending';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminder_alerts'
      AND column_name IN ('reminder_id', 'status')
    GROUP BY table_name
    HAVING count(*) = 2
  ) THEN
    CREATE INDEX IF NOT EXISTS reminder_alerts_reminder_status_idx
      ON reminder_alerts (reminder_id, status);
  END IF;
END $$;

COMMIT;
