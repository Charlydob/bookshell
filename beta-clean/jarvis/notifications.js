"use strict";
const { parts, wallInstant } = require("../projects/notification-time");
const { revision, valueFor } = require("./domain");
const planSchema = require("./contracts").schemas.habits_reminders.shape.plan;
function due(h, plan, date) {
  return (
    h &&
    !h.archived &&
    plan?.enabled &&
    date >= plan.startDate &&
    (!plan.endDate || date <= plan.endDate) &&
    (h.schedule?.type !== "days" ||
      h.schedule.days.includes(new Date(date + "T12:00:00Z").getUTCDay()))
  );
}
function achieved(root, h, date) {
  const goal =
    h.goal === "check"
      ? 1
      : h.goal === "time"
        ? h.goalsByRange?.day
        : h.jarvisTargets?.day;
  if (!goal) return false;
  return valueFor(root, h, date) >= goal * (h.goal === "time" ? 60 : 1);
}
function createHabitNotices() {
  async function enqueue(c, now, onlyUser, put) {
    const users = (
      await c.query(
        "SELECT DISTINCT ON (f.user_id) f.user_id,f.data FROM firebase_import_raw f JOIN users u ON u.id=f.user_id WHERE u.disabled=false AND ($1::uuid IS NULL OR f.user_id=$1) ORDER BY f.user_id,f.imported_at DESC,f.id DESC",
        [onlyUser],
      )
    ).rows;
    for (const user of users) {
      const root = user.data.habits || {};
      for (const [habitId, h] of Object.entries(root.habits || {})) {
        const parsed = planSchema.safeParse(h?.jarvisReminderPlan);
        if (!parsed.success || !parsed.data.enabled) continue;
        const plan = parsed.data;
        const date = parts(now, plan.timezone).date;
        if (!due(h, plan, date) || achieved(root, { ...h, id: habitId }, date))
          continue;
        for (const time of plan.times) {
          const at = wallInstant(date, time, plan.timezone);
          if (at > now) continue;
          const deadline = new Date(at.getTime() + 15 * 60000);
          await put(c, {
            user: user.user_id,
            kind: "habit-reminder",
            key: habitId + ":" + revision(plan) + ":" + date + ":" + time,
            date,
            zone: plan.timezone,
            at,
            deadline,
            status: deadline < now ? "expired" : "pending",
            payload: {
              title: "Bookshell · Hábito",
              body: h.name,
              url: "https://bookshell.charlydob.com/#view-habits",
              type: "habit-reminder",
              habitId,
              planRevision: revision(plan),
              date,
              tag: "bookshell-habit:" + habitId + ":" + date + ":" + time,
            },
          });
        }
      }
    }
  }
  async function validate(c, run) {
    if (run.kind !== "habit-reminder") return null;
    const row = (
        await c.query(
          "SELECT f.data FROM firebase_import_raw f JOIN users u ON u.id=f.user_id WHERE f.user_id=$1 AND u.disabled=false ORDER BY f.imported_at DESC,f.id DESC LIMIT 1 FOR UPDATE OF f",
          [run.user_id],
        )
      ).rows[0],
      root = row?.data.habits || {},
      h = root.habits?.[run.payload.habitId],
      plan = h?.jarvisReminderPlan;
    if (
      !due(h, plan, run.payload.date) ||
      revision(plan) !== run.payload.planRevision
    )
      return "habit_plan_changed";
    if (achieved(root, { ...h, id: run.payload.habitId }, run.payload.date))
      return "habit_goal_completed";
    return null;
  }
  return { enqueue, validate };
}
module.exports = { createHabitNotices, due, achieved };
