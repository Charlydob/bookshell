"use strict";
// Explicit maintenance helper. Dry-run by default. Never deletes workflows or credentials.
async function plan(db) {
  const result = await db.query(
    `SELECT a.channel,a.status,count(*)::int AS alerts,count(*) FILTER(WHERE a.locked_at IS NOT NULL)::int AS locked FROM reminder_alerts a GROUP BY a.channel,a.status ORDER BY a.channel,a.status`,
  );
  const ready = await db.query(
    `SELECT count(*)::int AS devices FROM push_subscriptions WHERE disabled_at IS NULL`,
  );
  const unserved = await db.query(
    `SELECT count(*)::int AS alerts FROM reminder_alerts a JOIN reminders r ON r.id=a.reminder_id WHERE a.status='pending' AND a.channel='telegram' AND NOT EXISTS(SELECT 1 FROM firebase_import_raw f JOIN users u ON u.id=f.user_id JOIN push_subscriptions s ON s.user_id=f.user_id AND s.disabled_at IS NULL WHERE f.firebase_uid=r.firebase_uid AND u.disabled=false)`,
  );
  return {
    alerts: result.rows,
    activePushDevices: ready.rows[0].devices,
    pendingWithoutOwnedPush: unserved.rows[0].alerts,
    ready:
      ready.rows[0].devices > 0 &&
      unserved.rows[0].alerts === 0 &&
      !result.rows.some(
        (r) =>
          r.status === "pending" && r.channel === "telegram" && r.locked > 0,
      ),
  };
}
async function migrate(
  db,
  { confirmed = false, workflowInactive = false, pushVerified = false } = {},
) {
  if (!confirmed || !workflowInactive || !pushVerified)
    throw new Error(
      "Explicit authorization, inactive workflow and verified Web Push required",
    );
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("LOCK TABLE reminder_alerts IN SHARE ROW EXCLUSIVE MODE");
    const status = await plan(c);
    if (!status.ready)
      throw new Error("Push subscription missing or alerts still claimed");
    await c.query(
      `CREATE TABLE IF NOT EXISTS jarvis_retired_alert_channels(alert_id uuid PRIMARY KEY REFERENCES reminder_alerts(id),previous_channel text NOT NULL,migrated_at timestamptz NOT NULL DEFAULT now())`,
    );
    await c.query(
      `INSERT INTO jarvis_retired_alert_channels(alert_id,previous_channel) SELECT id,channel FROM reminder_alerts WHERE status='pending' AND channel='telegram' ON CONFLICT DO NOTHING`,
    );
    const r = await c.query(
      `UPDATE reminder_alerts SET channel='webpush',updated_at=now() WHERE status='pending' AND channel='telegram' AND locked_at IS NULL RETURNING id`,
    );
    await c.query("COMMIT");
    return { changed: r.rowCount, preservedHistorical: true, deleted: 0 };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { plan, migrate };
