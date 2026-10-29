"use strict";
// Reviewed data contracts only. Not exposed through MCP until private web access is secured.
const { z } = require("zod/v3");
const { union } = require("./domain");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
  );
const sleepObservation = z
  .object({
    kind: z.enum(["in_bed", "asleep"]),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    source: z.enum(["user_declared", "authorized_provider"]),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    providerRecordId: z.string().max(200).optional(),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 48 * 3600000,
    "Invalid rest interval",
  );
const personExtension = z
  .object({
    aliases: z.array(z.string().trim().min(1).max(150)).max(30),
    firstMet: z
      .object({
        date: date.optional(),
        place: z.string().max(300).optional(),
        contextNoteId: z.string().max(150).optional(),
        source: z.literal("user"),
      })
      .strict()
      .optional(),
    relationships: z
      .array(
        z
          .object({
            targetNoteId: z.string().min(1).max(150),
            label: z.string().min(1).max(100),
            status: z.enum(["confirmed", "hypothesis"]),
            source: z.literal("user"),
            sourceNoteId: z.string().max(150).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
function summarizeRest(observations) {
  const parsed = observations.map((v) => sleepObservation.parse(v));
  const sum = (kind) =>
    union(
      parsed
        .filter((v) => v.kind === kind)
        .map((v) => [Date.parse(v.start), Date.parse(v.end)]),
    ).reduce((n, [s, e]) => n + (e - s) / 1000, 0);
  return {
    declaredSleepSec: parsed.some((v) => v.kind === "asleep")
      ? sum("asleep")
      : null,
    inBedSec: parsed.some((v) => v.kind === "in_bed") ? sum("in_bed") : null,
    inferredFromMessages: false,
  };
}
module.exports = { sleepObservation, personExtension, summarizeRest };
