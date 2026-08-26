#!/usr/bin/env bash
set -euo pipefail

APP=/opt/bookshell-api
SERVER="$APP/server.js"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$APP/server.js.before-v42-$STAMP"

if [ ! -f "$SERVER" ]; then
  echo "ERROR: no existe $SERVER"
  exit 1
fi

cp "$SERVER" "$BACKUP"
echo "Backup: $BACKUP"

python3 - "$SERVER" <<'PY'
from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()

if "expired_before_delivery" not in s:
    old='''    await client.query("BEGIN");\n\n    const picked = await client.query(\n      `\n        SELECT a.id\n'''
    new='''    await client.query("BEGIN");\n\n    // Do not resurrect notifications that are already far too late.\n    await client.query(\n      `\n        UPDATE reminder_alerts a\n        SET\n          status = 'failed',\n          failed_at = NOW(),\n          error_message = 'expired_before_delivery',\n          locked_at = NULL,\n          locked_by = NULL,\n          updated_at = NOW()\n        FROM reminders r\n        WHERE r.id = a.reminder_id\n          AND a.status = 'pending'\n          AND a.notify_at IS NOT NULL\n          AND a.notify_at < NOW() - INTERVAL '30 minutes'\n          AND r.firebase_uid = $1\n      `,\n      [LEGACY_FIREBASE_UID]\n    );\n\n    const picked = await client.query(\n      `\n        SELECT a.id\n'''
    if old not in s:
        raise SystemExit('ERROR: no encuentro claimDueReminderAlerts esperado')
    s=s.replace(old,new,1)

if "expectedScheduleVersion = null" not in s:
    start=s.find('async function markReminderAlertSent(alertId) {')
    end=s.find('\nasync function markReminderAlertFailed(', start)
    if start<0 or end<0:
        raise SystemExit('ERROR: no encuentro markReminderAlertSent')

    replacement=r'''async function markReminderAlertSent(alertId, expectedScheduleVersion = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query(
      `
        SELECT
          a.status AS alert_status,
          a.reminder_id,
          r.schedule_version
        FROM reminder_alerts a
        INNER JOIN reminders r
          ON r.id = a.reminder_id
        WHERE a.id = $1
        FOR UPDATE OF a, r
      `,
      [alertId]
    );

    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const row = current.rows[0];
    const reminderId = row.reminder_id;
    const currentVersion = Number(row.schedule_version || 1);
    const expectedVersion =
      expectedScheduleVersion === null || expectedScheduleVersion === undefined
        ? null
        : Number(expectedScheduleVersion);

    if (
      expectedVersion !== null &&
      Number.isFinite(expectedVersion) &&
      expectedVersion !== currentVersion
    ) {
      await client.query("COMMIT");
      return { alertId, reminderId, status: row.alert_status, duplicate: true, staleAck: true };
    }

    if (row.alert_status === "sent") {
      await client.query("COMMIT");
      return { alertId, reminderId, status: "sent", duplicate: true };
    }

    if (row.alert_status !== "pending") {
      await client.query("COMMIT");
      return { alertId, reminderId, status: row.alert_status, duplicate: true };
    }

    await client.query(
      `
        UPDATE reminder_alerts
        SET
          status = 'sent',
          sent_at = NOW(),
          failed_at = NULL,
          error_message = NULL,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [alertId]
    );

    await client.query("COMMIT");
    await advanceRecurringReminderIfFinished(reminderId);

    return { alertId, reminderId, status: "sent", duplicate: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
'''
    s=s[:start]+replacement+s[end:]

if "body?.scheduleVersion" not in s:
    old_route='''    try {\n      const result = await markReminderAlertSent(\n        alertSentMatch[1]\n      );\n'''
    new_route='''    try {\n      const body = await readJson(req);\n      const result = await markReminderAlertSent(\n        alertSentMatch[1],\n        body?.scheduleVersion\n      );\n'''
    if old_route not in s:
        raise SystemExit('ERROR: no encuentro route /sent esperada')
    s=s.replace(old_route,new_route,1)

p.write_text(s)
print('Backend v4.2 aplicado/idempotente')
PY

# Validate with Node from the existing Bookshell container, not from the host.
docker exec bookshell-api-api-1 node --check /app/server.js

cd "$APP"
docker compose up -d --force-recreate api
sleep 3

curl -fsS http://127.0.0.1:3002/health
echo
echo "BOOKSHELL REMINDER DELIVERY V4.2 BACKEND PATCHED"
echo "Stale pending alerts >30 min will no longer be delivered."
echo "Sent acknowledgements are idempotent and schedule-version safe."
