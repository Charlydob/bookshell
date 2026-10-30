"use strict";
const { z } = require("zod/v3");
const { validZone } = require("../projects/notification-time");
const id = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[A-Za-z0-9_-]+$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
    "Fecha no válida",
  );
const zone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      validZone(v);
      return true;
    } catch {
      return false;
    }
  }, "Zona no válida");
const instant = z.string().datetime({ offset: true });
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(8).max(180);
const schedule = z
  .object({
    type: z.enum(["daily", "days"]),
    days: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .strict()
  .refine((v) => v.type === "daily" || v.days.length > 0, "Selecciona días");
const goals = z
  .object(
    Object.fromEntries(
      ["day", "week", "month", "year", "total"].map((k) => [
        k,
        z.number().positive().max(1e7).nullable().optional(),
      ]),
    ),
  )
  .strict();
const plan = z
  .object({
    enabled: z.boolean(),
    times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(6),
    timezone: zone,
    startDate: date,
    endDate: date.nullable().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.enabled && !v.times.length)
      c.addIssue({ code: "custom", message: "Indica una hora" });
    if (new Set(v.times).size !== v.times.length)
      c.addIssue({ code: "custom", message: "Horas duplicadas" });
    if (v.endDate && v.endDate < v.startDate)
      c.addIssue({ code: "custom", message: "Fin anterior al inicio" });
  });
const habit = z
  .object({
    name: z.string().trim().min(1).max(200),
    goal: z.enum(["check", "count", "time"]),
    emoji: z.string().max(16).optional(),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
    schedule,
    targetsByRange: goals.optional(),
    targetMinutes: z.number().positive().max(1440).nullable().optional(),
  })
  .strict();
const schemas = {
  habits_list: z
    .object({
      query: z.string().max(200).optional(),
      includeArchived: z.boolean().optional(),
    })
    .strict(),
  habits_create: z
    .object({ habit, reminderPlan: plan.optional(), idempotencyKey: key })
    .strict(),
  habits_update: z
    .object({
      habitId: id,
      expectedRevision: revision,
      patch: habit.partial(),
      idempotencyKey: key,
    })
    .strict(),
  habits_archive: z
    .object({
      habitId: id,
      expectedRevision: revision,
      confirmed: z.literal(true),
      idempotencyKey: key,
    })
    .strict(),
  habits_record: z
    .object({
      habitId: id,
      date,
      mode: z.enum(["increment", "set"]),
      value: z.number().min(0).max(1e7),
      unit: z.enum(["check", "count", "minutes", "seconds"]),
      expectedRevision: revision.optional(),
      confirmed: z.boolean().optional(),
      idempotencyKey: key,
    })
    .strict(),
  habits_history: z.object({ habitId: id, from: date, to: date }).strict(),
  habits_reminders: z
    .object({
      habitId: id,
      expectedRevision: revision,
      plan,
      idempotencyKey: key,
    })
    .strict(),
  activity_start: z
    .object({
      label: z.string().trim().min(1).max(200),
      habitId: id.optional(),
      projectId: z.string().uuid().optional(),
      timezone: zone,
      idempotencyKey: key,
    })
    .strict(),
  activity_change: z
    .object({
      sessionId: z.string().uuid(),
      action: z.enum(["pause", "resume", "stop"]),
      expectedRevision: revision,
      idempotencyKey: key,
    })
    .strict(),
  activity_manual: z
    .object({
      label: z.string().trim().min(1).max(200),
      habitId: id.optional(),
      projectId: z.string().uuid().optional(),
      timezone: zone,
      intervals: z
        .array(z.object({ start: instant, end: instant }).strict())
        .min(1)
        .max(100),
      idempotencyKey: key,
    })
    .strict(),
  activity_query: z
    .object({
      sessionId: z.string().uuid().optional(),
      includeDeleted:z.boolean().optional(),
      minDurationSec:z.number().nonnegative().optional(),
      maxDurationSec:z.number().nonnegative().optional(),
      from: instant,
      to: instant,
      timezone: zone,
      habitId: id.optional(),
      projectId: z.string().uuid().optional(),
    })
    .strict(),
  activity_update: z.object({sessionId:z.string().uuid(),expectedRevision:revision,idempotencyKey:key,patch:z.object({label:z.string().trim().min(1).max(200).optional(),timezone:zone.optional(),projectId:z.string().uuid().nullable().optional(),intervals:z.array(z.object({start:instant,end:instant}).strict()).min(1).max(100).optional(),durationSec:z.number().positive().max(31622400).optional()}).strict()}).strict(),
  activity_reassign: z.object({sessionId:z.string().uuid(),habitId:id,expectedRevision:revision,idempotencyKey:key}).strict(),
  activity_delete: z.object({sessionId:z.string().uuid(),expectedRevision:revision,idempotencyKey:key,confirmed:z.literal(true)}).strict(),
  activity_restore: z.object({sessionId:z.string().uuid(),expectedRevision:revision,idempotencyKey:key}).strict(),
  activity_split: z.object({sessionId:z.string().uuid(),expectedRevision:revision,idempotencyKey:key,parts:z.array(z.object({habitId:id,label:z.string().trim().min(1).max(200).optional(),intervals:z.array(z.object({start:instant,end:instant}).strict()).min(1).max(100)}).strict()).min(2).max(20)}).strict(),
  jarvis_capabilities: z.object({}).strict(),
  jarvis_context: z.object({}).strict(),
};
const scopes = {
  habits_list: ["habits:read"],
  habits_history: ["habits:read"],
  habits_create: ["habits:write"],
  habits_update: ["habits:write"],
  habits_archive: ["habits:write"],
  habits_record: ["habits:write"],
  habits_reminders: ["habits:write", "notifications:write"],
  activity_start: ["time:write"],
  activity_change: ["time:write"],
  activity_manual: ["time:write"],
  activity_query: ["time:read"],
  activity_update:["time:write"],activity_reassign:["time:write","habits:write"],activity_delete:["time:write"],activity_restore:["time:write"],activity_split:["time:write","habits:write"],
  jarvis_capabilities:["projects:read"],
  jarvis_context: ["habits:read"],
};
const habitResult = z
  .object({
    id,
    name: z.string(),
    goal: z.enum(["check", "count", "time"]),
    revision,
  })
  .passthrough();
const sessionResult = z
  .object({
    id: z.string().uuid(),
    label: z.string(),
    status: z.enum(["running", "paused", "stopped"]),
    timezone: zone,
    openAt: z.number().nullable(),
    intervals: z.array(z.tuple([z.number(), z.number()])),
    revision,
  })
  .passthrough();
const timeTotals = z
  .object({
    elapsedSec: z.number().nonnegative(),
    activitySec: z.number().nonnegative(),
    exclusiveSec: z.number().nonnegative(),
    overlapSec: z.number().nonnegative(),
  })
  .strict();
const outputSchemas = {
  habits_list: z.object({ items: z.array(habitResult) }).strict(),
  habits_create: z.object({ habit: habitResult }).strict(),
  habits_update: z.object({ habit: habitResult }).strict(),
  habits_archive: z.object({ habit: habitResult }).strict(),
  habits_reminders: z.object({ habit: habitResult }).strict(),
  habits_record: z
    .object({
      habitId: id,
      date,
      value: z.number().nonnegative(),
      unit: z.enum(["check", "count", "seconds"]),
      revision,
      previousRevision: revision,
    })
    .strict(),
  habits_history: z
    .object({
      habit: habitResult,
      unit: z.enum(["check", "count", "seconds"]),
      days: z.array(
        z.object({ date, value: z.number().nonnegative(), revision }).strict(),
      ),
      total: z.number().nonnegative(),
      timingEvidence: z.string(),
    })
    .strict(),
  activity_start: z.object({ session: sessionResult }).strict(),
  activity_change: z.object({ session: sessionResult }).strict(),
  activity_manual: z.object({ session: sessionResult }).strict(),
  activity_update:z.object({session:sessionResult}).strict(),
  activity_reassign:z.object({session:sessionResult}).strict(),
  activity_delete:z.object({session:sessionResult}).strict(),
  activity_restore:z.object({session:sessionResult}).strict(),
  activity_split:z.object({session:sessionResult,sessions:z.array(sessionResult)}).strict(),
  jarvis_capabilities:z.object({version:z.string(),operations:z.array(z.object({name:z.string(),scopes:z.array(z.string()),authorized:z.boolean()})),modules:z.array(z.string()),limitations:z.array(z.string())}).strict(),
  activity_query: z
    .object({
      sessions: z.array(
        sessionResult.extend({ durationSec: z.number().nonnegative() }),
      ),
      totals: timeTotals,
      timezone: zone,
      scope: z.string(),
      byDate: z.record(timeTotals),
    })
    .strict(),
  jarvis_context: z
    .object({
      timezone: z.string().nullable(),
      workSchedules: z.unknown(),
      habitPrefs: z.unknown(),
      availableOperations: z.array(z.string()),
    })
    .strict(),
};
for (const name of Object.keys(outputSchemas))
  outputSchemas[name] = outputSchemas[name].extend({
    replayed: z.boolean().optional(),
  });
module.exports = { schemas, scopes, outputSchemas };
