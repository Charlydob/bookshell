"use strict";
// Operator-only offline pairing. No web endpoint can mint additional scopes.
const { Pool } = require("pg"),
  crypto = require("node:crypto");
const allowed = new Set([
  "projects:read",
  "projects:write",
  "habits:read",
  "habits:write",
  "time:read",
  "time:write",
  "notifications:write",
  "recipes:read",
  "people:read",
  "notes:read",
  "books:read",
  "nutrition:read",
  "gym:read",
  "finance:read",
  "world:read",
  "recipes:write",
  "people:write",
  "notes:write",
  "books:write",

]);
async function main() {
  if (process.argv[2] !== "--issue-approved-grant")
    throw new Error("Requires --issue-approved-grant after operator approval");
  const user = process.argv[3],
    scopes = (process.argv[4] || "").split(",");
  if (
    !/^[0-9a-f-]{36}$/i.test(user || "") ||
    !scopes.length ||
    scopes.some((s) => !allowed.has(s))
  )
    throw new Error("Invalid user or scopes");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const found = await pool.query(
      "SELECT id FROM users WHERE id=$1 AND disabled=false",
      [user],
    );
    if (!found.rowCount) throw new Error("User unavailable");
    const code = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO project_access_tickets(token_hash,user_id,purpose,expires_at,allowed_scopes) VALUES($1,$2,'oauth',now()+interval '10 minutes',$3)",
      [crypto.createHash("sha256").update(code).digest("hex"), user, scopes],
    );
    process.stdout.write(code + "\n");
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exitCode = 1;
});
