"use strict";
const { z } = require("zod/v3");
const { revision } = require("./domain");
const fail = (s, status = 400) => {
  throw Object.assign(new Error(s), { status });
};
const path = z
  .string()
  .max(1500)
  .refine(
    (v) =>
      v === "" ||
      v
        .split("/")
        .every(
          (k) =>
            k &&
            !["__proto__", "prototype", "constructor"].includes(k) &&
            !/[.#$\[\]]/.test(k),
        ),
  );
const request = z
  .object({
    method: z.enum(["PUT", "PATCH", "DELETE"]),
    path,
    body: z.unknown().optional(),
    expected: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
    idempotencyKey: z.string().min(8).max(180),
  })
  .strict();
function read(data, p) {
  let value = data;
  for (const k of p.split("/").filter(Boolean)) value = value?.[k];
  return value ?? null;
}
function set(data, p, value) {
  const keys = p.split("/");
  let n = data;
  for (const k of keys.slice(0, -1)) {
    if (n[k] != null && typeof n[k] !== "object") fail("INVALID_PATH_PARENT");
    if (n[k] == null) n[k] = {};
    n = n[k];
  }
  if (value === null || value === undefined) delete n[keys.at(-1)];
  else n[keys.at(-1)] = value;
}
function targets(b) {
  if (b.method === "PATCH") {
    if (!b.body || typeof b.body !== "object" || Array.isArray(b.body))
      fail("INVALID_PATCH");
    return Object.keys(b.body).map((k) => {
      path.parse(k);
      return b.path ? b.path + "/" + k : k;
    });
  }
  return [b.path];
}
function createWebData({ pool }) {
  return {
    async write(actor, input) {
      const b = request.parse(input),
        paths = targets(b);
      if (paths.length > 100 || !paths.length) fail("INVALID_PATCH");
      if (
        paths.some(
          (p) =>
            !p ||
            p === "habits" ||
            p === "habits/habits" ||
            p.startsWith("habits/activitySessions") ||
            (p.startsWith("habits/habits/activeSessions") &&
              p.split("/").length < 4),
        )
      )
        fail("SEMANTIC_OPERATION_REQUIRED", 409);
      if (
        Object.keys(b.expected).length !== paths.length ||
        paths.some((p) => !Object.hasOwn(b.expected, p))
      )
        fail("PRECONDITION_REQUIRED", 428);
      for (let i = 0; i < paths.length; i++)
        for (let j = i + 1; j < paths.length; j++)
          if (
            paths[i].startsWith(paths[j] + "/") ||
            paths[j].startsWith(paths[i] + "/")
          )
            fail("OVERLAPPING_PATCH");
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        if (
          !(
            await c.query(
              "SELECT id FROM users WHERE id=$1 AND disabled=false",
              [actor.userId],
            )
          ).rowCount
        )
          fail("AUTH_REQUIRED", 401);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,291029))",
          [actor.userId],
        );
        const h = revision(b),
          old = (
            await c.query(
              "SELECT * FROM web_mutations WHERE user_id=$1 AND mutation_key=$2",
              [actor.userId, b.idempotencyKey],
            )
          ).rows[0];
        if (old) {
          if (old.input_hash !== h) fail("IDEMPOTENCY_CONFLICT", 409);
          await c.query("COMMIT");
          return { ...old.result, replayed: true };
        }
        const row = (
          await c.query(
            "SELECT id,data FROM firebase_import_raw WHERE user_id=$1 ORDER BY imported_at DESC,id DESC LIMIT 1 FOR UPDATE",
            [actor.userId],
          )
        ).rows[0];
        if (!row) fail("DATA_NOT_FOUND", 404);
        const previous = structuredClone(row.data);
        if (paths.some((p) => revision(read(row.data, p)) !== b.expected[p]))
          fail("REVISION_CONFLICT", 409);
        for (const p of paths) {
          let value =
            b.method === "DELETE"
              ? null
              : b.method === "PATCH"
                ? b.body[b.path ? p.slice(b.path.length + 1) : p]
                : b.body;
          set(row.data, p, value);
        }
        await require("./web-invariants").validateWebChanges(
          c,
          actor.userId,
          previous,
          row.data,
        );
        await c.query("UPDATE firebase_import_raw SET data=$1 WHERE id=$2", [
          JSON.stringify(row.data),
          row.id,
        ]);
        const result = {
          ok: true,
          values: Object.fromEntries(paths.map((p) => [p, read(row.data, p)])),
        };
        await c.query(
          "INSERT INTO web_mutations(user_id,mutation_key,input_hash,result) VALUES($1,$2,$3,$4)",
          [actor.userId, b.idempotencyKey, h, JSON.stringify(result)],
        );
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
module.exports = { createWebData, read, targets };
