-- Bookshell reminders: server-side Web Push scheduler support.
-- Safe to run more than once against the existing bookshell database.

BEGIN;

CREATE TABLE IF NOT EXISTS reminder_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delivery_type text NOT NULL,
  delivery_key text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Zurich',
  target_date date,
  target_at timestamptz,
  reminder_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'sending',
  attempt_count integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_notification_deliveries_status_check
    CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  CONSTRAINT reminder_notification_deliveries_type_key_unique
    UNIQUE (user_id, delivery_type, delivery_key)
);

CREATE INDEX IF NOT EXISTS reminder_notification_deliveries_lookup_idx
  ON reminder_notification_deliveries (user_id, delivery_type, target_date, status);

ALTER TABLE reminder_alerts
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_lateness_ms bigint;

WITH legacy_relative_alerts AS (
  SELECT
    r.id AS reminder_id,
    CASE lower(alert_row.alert->>'unit')
      WHEN 'days' THEN alert_row.amount * 1440
      WHEN 'hours' THEN alert_row.amount * 60
      WHEN 'minutes' THEN alert_row.amount
      ELSE NULL
    END AS minutes_before,
    ((r.target_date::date + COALESCE(r.target_time::time, TIME '09:00')) AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'Europe/Zurich')) AS target_at
  FROM reminders r
  CROSS JOIN LATERAL (
    SELECT
      alert,
      CASE
        WHEN alert->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
          THEN GREATEST(0, round((alert->>'amount')::numeric)::integer)
        ELSE 0
      END AS amount
    FROM jsonb_array_elements(
      COALESCE(
        r.source_metadata #> '{bookshellLegacy,remindBefore}',
        r.source_metadata #> '{bookshell_legacy,remindBefore}',
        '[]'::jsonb
      )
    ) AS source_alert(alert)
  ) AS alert_row
  WHERE r.status = 'pending'
    AND r.target_date IS NOT NULL
)
INSERT INTO reminder_alerts (
  reminder_id,
  mode,
  minutes_before,
  notify_at,
  channel,
  status,
  created_at,
  updated_at
)
SELECT
  legacy.reminder_id,
  'relative',
  legacy.minutes_before,
  legacy.target_at - (legacy.minutes_before * INTERVAL '1 minute'),
  'telegram',
  'pending',
  now(),
  now()
FROM legacy_relative_alerts legacy
WHERE legacy.minutes_before IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM reminder_alerts a
    WHERE a.reminder_id = legacy.reminder_id
      AND a.mode = 'relative'
      AND COALESCE(a.minutes_before, -1) = legacy.minutes_before
      AND a.status <> 'cancelled'
  );

INSERT INTO reminder_alerts (
  reminder_id,
  mode,
  minutes_before,
  notify_at,
  channel,
  status,
  created_at,
  updated_at
)
SELECT
  r.id,
  'relative',
  0,
  ((r.target_date::date + COALESCE(r.target_time::time, TIME '09:00')) AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'Europe/Zurich')),
  'telegram',
  'pending',
  now(),
  now()
FROM reminders r
WHERE r.status = 'pending'
  AND r.target_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM reminder_alerts a
    WHERE a.reminder_id = r.id
      AND a.mode = 'relative'
      AND COALESCE(a.minutes_before, -1) = 0
      AND a.status <> 'cancelled'
  );

COMMIT;
