"use strict";
const crypto = require("node:crypto");
const { schemas, scopes, outputSchemas } = require("./contracts");
const { parts, wallInstant } = require("../projects/notification-time");
function fail(code, status = 400) {
  throw Object.assign(new Error(code), { status });
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const revision = (v) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const fold = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const dayAdd = (d, n) =>
  new Date(Date.parse(d + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
function days(from, to) {
  if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000)
    fail("INVALID_RANGE");
  const out = [];
  for (let d = from; d <= to; d = dayAdd(d, 1)) out.push(d);
  return out;
}
function total(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object")
    return Number(v.totalSec ?? Number(v.min || 0) * 60) || 0;
  return 0;
}
function union(intervals) {
  const sorted = intervals
      .filter((i) => i[1] > i[0])
      .sort((a, b) => a[0] - b[0]),
    out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(e, last[1]);
    else out.push([s, e]);
  }
  return out;
}
function totals(intervals) {
  const events = intervals
    .flatMap(([s, e]) => [
      [s, 1],
      [e, -1],
    ])
    .sort((a, b) => a[0] - b[0]);
  let count = 0,
    prev = null,
    exclusiveMs = 0;
  for (const [t, d] of events) {
    if (prev !== null && count === 1) exclusiveMs += t - prev;
    count += d;
    prev = t;
  }
  const elapsedMs = union(intervals).reduce((n, [s, e]) => n + e - s, 0),
    activityMs = intervals.reduce((n, [s, e]) => n + e - s, 0);
  return {
    elapsedSec: elapsedMs / 1000,
    activitySec: activityMs / 1000,
    exclusiveSec: exclusiveMs / 1000,
    overlapSec: (elapsedMs - exclusiveMs) / 1000,
  };
}
function splitInterval(start, end, zone) {
  const out = [];
  let cursor = start;
  while (cursor < end) {
    const date = parts(cursor, zone).date,
      next = wallInstant(dayAdd(date, 1), "00:00", zone).getTime(),
      stop = Math.min(end, next);
    if (stop <= cursor) fail("INVALID_DAY_BOUNDARY");
    out.push({ date, start: cursor, end: stop });
    cursor = stop;
  }
  return out;
}
function habitsRoot(data) {
  data.habits ??= {};
  data.habits.habits ??= {};
  return data.habits;
}
function findHabit(root, id, mutating = false) {
  const h = root.habits[id];
  if (!h || !h.name || h.archived) fail("HABIT_NOT_FOUND", 404);
  if (mutating && h.system) fail("SYSTEM_HABIT_READ_ONLY", 403);
  h.id ??= id;
  return h;
}
function checkRevision(value, expected) {
  if (revision(value) !== expected) fail("REVISION_CONFLICT", 409);
}
function publicHabit(h) {
  return {
    ...h,
    targetsByRange:
      h.goal === "time" ? h.goalsByRange || {} : h.jarvisTargets || {},
    revision: revision(h),
  };
}
function habitPayload(input, goal = input.goal) {
  const { targetsByRange, ...rest } = input;
  if (targetsByRange) {
    if (
      goal !== "time" &&
      Object.values(targetsByRange).some(
        (v) => v !== null && !Number.isInteger(v),
      )
    )
      fail("INTEGER_TARGET_REQUIRED");
    rest[goal === "time" ? "goalsByRange" : "jarvisTargets"] = targetsByRange;
  }
  return rest;
}
function valueFor(root, h, date) {
  if (h.goal === "time") return total(root.habitSessions?.[h.id]?.[date]);
  if (h.goal === "count") return Number(root.habitCounts?.[h.id]?.[date] || 0);
  return root.habitChecks?.[h.id]?.[date] ? 1 : 0;
}
function writeTime(root, h, date, amount, entry) {
  root.habitSessions ??= {};
  root.habitSessions[h.id] ??= {};
  const old = root.habitSessions[h.id][date],
    payload = {
      ...(old && typeof old === "object" ? old : {}),
      totalSec: total(old) + amount,
    };
  if (entry) payload.sessions = [...(payload.sessions || []), entry];
  root.habitSessions[h.id][date] = payload;
}
function createJarvis({ pool, nowFn = () => new Date() }) {
  async function run(actor, name, input) {
    if (!schemas[name]) fail("UNKNOWN_OPERATION");
    const b = schemas[name].parse(input);
    const required = [...scopes[name]];
    if (b.reminderPlan) required.push("notifications:write");
    if (b.habitId && name.startsWith("activity_"))
      required.push("habits:write");
    if (b.projectId && name.startsWith("activity_"))
      required.push("projects:read");
    if (!actor?.userId || required.some((s) => !actor.scopes?.includes(s)))
      fail("INSUFFICIENT_SCOPE", 403);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const u = (
        await c.query(
          "SELECT id FROM users WHERE id=$1 AND disabled=false FOR SHARE",
          [actor.userId],
        )
      ).rows[0];
      if (!u) fail("USER_DISABLED", 403);
      // Serialize user operations, including idempotency checks and JSON projection writes.
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,291029))",
        [actor.userId],
      );
      const hash = revision({ name, input: b });
      if (b.idempotencyKey) {
        const prev = (
          await c.query(
            "SELECT * FROM jarvis_operations WHERE user_id=$1 AND idempotency_key=$2",
            [actor.userId, b.idempotencyKey],
          )
        ).rows[0];
        if (prev) {
          if (prev.operation !== name || prev.input_hash !== hash)
            fail("IDEMPOTENCY_CONFLICT", 409);
          await c.query("COMMIT");
          return { ...prev.result, replayed: true };
        }
      }
      const row = (
        await c.query(
          "SELECT id,data FROM firebase_import_raw WHERE user_id=$1 ORDER BY imported_at DESC,id DESC LIMIT 1 FOR UPDATE",
          [actor.userId],
        )
      ).rows[0];
      if (!row) fail("DATA_NOT_FOUND", 404);
      const root = habitsRoot(row.data),
        now = nowFn(),
        write = !!b.idempotencyKey;
      let result;
      if (name === "jarvis_context")
        result = {
          timezone:
            (
              await c.query(
                "SELECT timezone FROM notification_preferences WHERE user_id=$1",
                [actor.userId],
              )
            ).rows[0]?.timezone || null,
          workSchedules: root.workSchedules || {},
          habitPrefs: root.habitPrefs || {},
          availableOperations: Object.keys(schemas).filter((n) =>
            scopes[n].every((s) => actor.scopes.includes(s)),
          ),
        };
      if (name === "habits_list")
        result = {
          items: Object.entries(root.habits)
            .filter(
              ([, h]) =>
                h?.name &&
                (b.includeArchived || !h.archived) &&
                (!b.query || fold(h.name).includes(fold(b.query))),
            )
            .map(([id, h]) => publicHabit({ ...h, id })),
        };
      if (name === "habits_create") {
        if (
          Object.values(root.habits).some(
            (h) =>
              h?.name && fold(h.name) === fold(b.habit.name) && !h.archived,
          )
        )
          fail("HABIT_ALREADY_EXISTS", 409);
        const id = "h-" + crypto.randomUUID(),
          h = {
            ...habitPayload(b.habit),
            id,
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
            archived: false,
          };
        if (b.reminderPlan) h.jarvisReminderPlan = b.reminderPlan;
        root.habits[id] = h;
        result = { habit: publicHabit(h) };
      }
      if (
        ["habits_update", "habits_archive", "habits_reminders"].includes(name)
      ) {
        const h = findHabit(root, b.habitId, true);
        checkRevision(h, b.expectedRevision);
        if (name === "habits_update") {
          if (b.patch.goal && b.patch.goal !== h.goal)
            fail("HABIT_TYPE_IMMUTABLE");
          if (
            b.patch.name &&
            Object.values(root.habits).some(
              (x) =>
                x?.id !== h.id &&
                !x.archived &&
                fold(x?.name) === fold(b.patch.name),
            )
          )
            fail("HABIT_ALREADY_EXISTS", 409);
          Object.assign(h, habitPayload(b.patch, h.goal));
        }
        if (name === "habits_archive") {
          if (
            Object.values(root.activitySessions || {}).some(
              (s) => s.habitId === h.id && s.status !== "stopped",
            )
          )
            fail("HABIT_HAS_ACTIVE_SESSION", 409);
          h.archived = true;
        }
        if (name === "habits_reminders") h.jarvisReminderPlan = b.plan;
        h.updatedAt = now.getTime();
        await c.query(
          "UPDATE notification_runs SET status='cancelled',error='habit_changed',updated_at=now() WHERE user_id=$1 AND kind='habit-reminder' AND payload->>'habitId'=$2 AND status IN ('pending','retry','no_subscription')",
          [actor.userId, h.id],
        );
        result = { habit: publicHabit(h) };
      }
      if (name === "habits_record") {
        const h = findHabit(root, b.habitId, true),
          old = valueFor(root, h, b.date),
          currentRevision = revision({
            habitId: h.id,
            date: b.date,
            value: old,
          });
        if (b.mode === "set") {
          if (!b.expectedRevision) fail("EXPECTED_REVISION_REQUIRED");
          checkRevision(
            { habitId: h.id, date: b.date, value: old },
            b.expectedRevision,
          );
          if (
            (b.unit === "minutes" ? b.value * 60 : b.value) < old &&
            b.confirmed !== true
          )
            fail("CONFIRM_DECREASE", 409);
        }
        const compatible =
          h.goal === "time"
            ? ["minutes", "seconds"]
            : h.goal === "count"
              ? ["count"]
              : ["check"];
        if (!compatible.includes(b.unit)) fail("UNIT_MISMATCH");
        if (h.goal !== "time" && !Number.isInteger(b.value))
          fail("INTEGER_REQUIRED");
        if (h.goal === "check" && (b.value > 1 || b.mode !== "set"))
          fail("CHECK_REQUIRES_SET");
        const delta = b.unit === "minutes" ? b.value * 60 : b.value,
          next = b.mode === "increment" ? old + delta : delta;
        if (next > 1e8) fail("VALUE_TOO_LARGE");
        if (
          h.goal === "time" &&
          b.mode === "set" &&
          next !== old &&
          root.habitSessions?.[h.id]?.[b.date]?.sessions?.length
        )
          fail("SESSION_CORRECTION_REQUIRED", 409);
        if (h.goal === "time") writeTime(root, h, b.date, next - old);
        else {
          const key = h.goal === "count" ? "habitCounts" : "habitChecks";
          root[key] ??= {};
          root[key][h.id] ??= {};
          root[key][h.id][b.date] = h.goal === "check" ? !!next : next;
        }
        result = {
          habitId: h.id,
          date: b.date,
          value: next,
          unit: h.goal === "time" ? "seconds" : h.goal,
          revision: revision({ habitId: h.id, date: b.date, value: next }),
          previousRevision: currentRevision,
        };
      }
      if (name === "habits_history") {
        const h = findHabit(root, b.habitId),
          rows = days(b.from, b.to).map((date) => ({
            date,
            value: valueFor(root, h, date),
            revision: revision({
              habitId: h.id,
              date,
              value: valueFor(root, h, date),
            }),
          }));
        result = {
          habit: publicHabit(h),
          unit: h.goal === "time" ? "seconds" : h.goal,
          days: rows,
          total: rows.reduce((n, x) => n + x.value, 0),
          timingEvidence:
            "Daily aggregates do not establish completion time or sleep.",
        };
      }
      if (["activity_start", "activity_manual"].includes(name)) {
        if (b.habitId) {
          const h = findHabit(root, b.habitId, true);
          if (h.goal !== "time") fail("TIME_HABIT_REQUIRED");
        }
        if (
          b.projectId &&
          !(
            await c.query(
              "SELECT id FROM project_workspaces WHERE id=$1 AND user_id=$2",
              [b.projectId, actor.userId],
            )
          ).rowCount
        )
          fail("PROJECT_NOT_FOUND", 404);
        root.activitySessions ??= {};
        if (
          name === "activity_start" &&
          Object.values(root.activitySessions).some(
            (s) =>
              s.status !== "stopped" &&
              fold(s.label) === fold(b.label) &&
              s.habitId === (b.habitId || null) &&
              s.projectId === (b.projectId || null),
          )
        )
          fail("ACTIVITY_ALREADY_RUNNING", 409);
        const id = crypto.randomUUID(),
          s = {
            id,
            label: b.label,
            habitId: b.habitId || null,
            projectId: b.projectId || null,
            timezone: b.timezone,
            status: name === "activity_start" ? "running" : "stopped",
            openAt: name === "activity_start" ? now.getTime() : null,
            intervals:
              name === "activity_manual"
                ? b.intervals.map((i) => [
                    Date.parse(i.start),
                    Date.parse(i.end),
                  ])
                : [],
            createdAt: now.getTime(),
          };
        if (
          s.intervals.some(
            ([start, end]) => end <= start || end > now.getTime(),
          ) ||
          s.intervals.some(([start, end]) => end - start > 366 * 86400000)
        )
          fail("INVALID_INTERVAL");
        s.intervals.sort((a, b) => a[0] - b[0]);
        if (s.intervals.some((x, i) => i && x[0] < s.intervals[i - 1][1]))
          fail("SELF_OVERLAP");
        root.activitySessions[id] = s;
        if (s.status === "stopped") credit(root, s);
        result = { session: { ...s, revision: revision(s) } };
      }
      if (name === "activity_change") {
        const s = root.activitySessions?.[b.sessionId];
        if (!s) fail("SESSION_NOT_FOUND", 404);
        checkRevision(s, b.expectedRevision);
        if (s.habitId && !actor.scopes.includes("habits:write"))
          fail("INSUFFICIENT_SCOPE", 403);
        if (s.status === "stopped") fail("SESSION_ALREADY_STOPPED", 409);
        if (b.action === "pause") {
          if (s.status !== "running") fail("SESSION_NOT_RUNNING", 409);
          close(s, now);
          s.status = "paused";
        }
        if (b.action === "resume") {
          if (s.status !== "paused") fail("SESSION_NOT_PAUSED", 409);
          s.openAt = now.getTime();
          s.status = "running";
        }
        if (b.action === "stop") {
          if (s.status === "running") close(s, now);
          s.status = "stopped";
          credit(root, s);
        }
        result = { session: { ...s, revision: revision(s) } };
      }
      if (name === "activity_query") {
        const from = Date.parse(b.from),
          to = Date.parse(b.to);
        if (to <= from || to - from > 366 * 86400000) fail("INVALID_RANGE");
        const all = Object.values(root.activitySessions || {}).filter(
          (s) =>
            (!b.habitId || s.habitId === b.habitId) &&
            (!b.projectId || s.projectId === b.projectId),
        );
        const intervals = (s) =>
          [
            ...s.intervals,
            ...(s.status === "running" ? [[s.openAt, now.getTime()]] : []),
          ]
            .map(([a, z]) => [
              Math.max(a, from),
              Math.min(z, to, now.getTime()),
            ])
            .filter(([a, z]) => z > a);
        result = {
          sessions: all.map((s) => ({
            ...s,
            revision: revision(s),
            durationSec: intervals(s).reduce(
              (n, [a, z]) => n + (z - a) / 1000,
              0,
            ),
          })),
          totals: totals(all.flatMap(intervals)),
          timezone: b.timezone,
          scope:
            "Explicit JARVIS sessions only; legacy daily totals have no recoverable overlap.",
          byDate: {},
        };
        for (const s of all)
          for (const [a, z] of intervals(s))
            for (const chunk of splitInterval(a, z, b.timezone)) {
              result.byDate[chunk.date] ??= [];
              result.byDate[chunk.date].push([chunk.start, chunk.end]);
            }
        result.byDate = Object.fromEntries(
          Object.entries(result.byDate).map(([date, ranges]) => [
            date,
            totals(ranges),
          ]),
        );
      }
      result = outputSchemas[name].parse(result);
      if (write) {
        await c.query(
          "UPDATE firebase_import_raw SET data=$1::jsonb WHERE id=$2",
          [JSON.stringify(row.data), row.id],
        );
        await c.query(
          "INSERT INTO jarvis_operations(user_id,idempotency_key,operation,input_hash,result) VALUES($1,$2,$3,$4,$5)",
          [actor.userId, b.idempotencyKey, name, hash, JSON.stringify(result)],
        );
        await c.query(
          "INSERT INTO jarvis_operation_audit(user_id,operation,entity_id) VALUES($1,$2,$3)",
          [
            actor.userId,
            name,
            result.habit?.id || result.habitId || result.session?.id || null,
          ],
        );
      }
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  function close(s, now) {
    if (now.getTime() < s.openAt) fail("CLOCK_BEFORE_START", 409);
    if (now.getTime() > s.openAt) s.intervals.push([s.openAt, now.getTime()]);
    s.openAt = null;
  }
  function credit(root, s) {
    if (!s.habitId) return;
    const h = findHabit(root, s.habitId, true);
    for (const [start, end] of s.intervals)
      for (const ch of splitInterval(start, end, s.timezone)) {
        const entry = {
          id: s.id + "-" + ch.start,
          sessionId: s.id,
          habitId: h.id,
          habitNameSnapshot: h.name,
          startTs: ch.start,
          endTs: ch.end,
          startedAt: ch.start,
          endedAt: ch.end,
          durationSec: (ch.end - ch.start) / 1000,
          durationMs: ch.end - ch.start,
          dateKey: ch.date,
          source: "jarvis",
          projectId: s.projectId,
        };
        writeTime(root, h, ch.date, entry.durationSec, entry);
      }
  }
  return { run };
}
module.exports = {
  createJarvis,
  revision,
  fold,
  union,
  totals,
  splitInterval,
  valueFor,
  days,
};
