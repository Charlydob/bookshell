"use strict";
const { revision, fold, valueFor } = require("./domain");
const bad = (code, status = 409) => {
  throw Object.assign(new Error(code), { status });
};
async function validateWebChanges(c, user, before, after) {
  const oldRoot = before.habits || {},
    root = after.habits || {},
    oldHabits = oldRoot.habits || {},
    habits = root.habits || {};
  for (const id of new Set([
    ...Object.keys(oldHabits),
    ...Object.keys(habits),
  ])) {
    const old = oldHabits[id],
      h = habits[id];
    if (!old?.name && !h?.name) continue;
    if (revision(old ?? null) !== revision(h ?? null)) {
      if (old?.system) bad("SYSTEM_HABIT_READ_ONLY", 403);
      if (h) {
        if (
          !["check", "count", "time"].includes(h.goal) ||
          typeof h.name !== "string" ||
          !h.name.trim() ||
          h.name.length > 200 ||
          h.id !== id
        )
          bad("INVALID_HABIT_CONFIG", 400);
        if (old && old.goal !== h.goal) bad("HABIT_TYPE_IMMUTABLE");
        for (const field of ["jarvisReminderPlan", "jarvisTargets"])
          if (revision(old?.[field] ?? null) !== revision(h[field] ?? null))
            bad("USE_SEMANTIC_HABIT_CONFIGURATION");
        if (
          Object.entries(habits).some(
            ([other, v]) =>
              other !== id &&
              !v?.archived &&
              v?.name &&
              fold(v.name) === fold(h.name),
          )
        )
          bad("HABIT_ALREADY_EXISTS");
      }
      if (
        (!h || h.archived) &&
        Object.values(root.activitySessions || {}).some(
          (s) => s.habitId === id && s.status !== "stopped",
        )
      )
        bad("HABIT_HAS_ACTIVE_SESSION");
      await c.query(
        "UPDATE notification_runs SET status='cancelled',error='habit_changed',updated_at=now() WHERE user_id=$1 AND kind='habit-reminder' AND payload->>'habitId'=$2 AND status IN ('pending','retry','no_subscription')",
        [user, id],
      );
    }
    if (!h?.name) continue;
    for (const date of new Set([
      ...Object.keys(oldRoot.habitSessions?.[id] || {}),
      ...Object.keys(root.habitSessions?.[id] || {}),
      ...Object.keys(oldRoot.habitCounts?.[id] || {}),
      ...Object.keys(root.habitCounts?.[id] || {}),
      ...Object.keys(oldRoot.habitChecks?.[id] || {}),
      ...Object.keys(root.habitChecks?.[id] || {}),
    ])) {
      const old = valueFor(oldRoot, { ...h, id }, date),
        next = valueFor(root, { ...h, id }, date);
      if (h.goal === "time") {
        const entries = oldRoot.habitSessions?.[id]?.[date]?.sessions?.filter(s => s.source === "jarvis") || [];
        const fresh = root.habitSessions?.[id]?.[date]?.sessions?.filter(s => s.source === "jarvis") || [];
        if (revision(entries) !== revision(fresh) || next < entries.reduce((sum,s) => sum + s.durationSec, 0)) bad("SESSION_CORRECTION_REQUIRED");
      }
      if (old === next) continue;
      if (!Number.isFinite(next) || next < 0 || next > 1e8 || h.goal === "count" && !Number.isInteger(next)) bad("INVALID_HABIT_VALUE", 400);
      const target =
        h.goal === "check"
          ? 1
          : h.goal === "time"
            ? h.goalsByRange?.day
            : h.jarvisTargets?.day;
      if (target && next >= target * (h.goal === "time" ? 60 : 1))
        await c.query(
          "UPDATE notification_runs SET status='cancelled',error='habit_goal_completed',updated_at=now() WHERE user_id=$1 AND kind='habit-reminder' AND payload->>'habitId'=$2 AND payload->>'date'=$3 AND status IN ('pending','retry','no_subscription')",
          [user, id, date],
        );
    }
  }
}
module.exports = { validateWebChanges };
