"use strict";
const { Pool } = require("pg"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
async function createFixture() {
  const url = process.env.BOOKSHELL_TEST_DATABASE_URL;
  if (!url) throw new Error("Isolated QA URL required");
  const admin = new Pool({ connectionString: url });
  if (
    (await admin.query("SELECT current_database() AS db")).rows[0].db !==
    "bookshell_qa"
  )
    throw new Error("Refusing non-QA database");
  const schema = "web_qa_" + crypto.randomBytes(5).toString("hex");
  await admin.query("CREATE SCHEMA " + schema);
  const pool = new Pool({
    connectionString: url,
    options: "-c search_path=" + schema + ",public",
  });
  await pool.query(
    `CREATE TABLE users(id uuid PRIMARY KEY,email text,display_name text,password_hash text,disabled boolean DEFAULT false);CREATE TABLE user_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),token_hash text,created_at timestamptz DEFAULT now(),expires_at timestamptz,revoked_at timestamptz);CREATE TABLE firebase_import_raw(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id),firebase_uid text,data jsonb,imported_at timestamptz DEFAULT now());CREATE TABLE reminders(id uuid PRIMARY KEY,firebase_uid text,title text,status text,target_date date,target_time time,timezone text);CREATE TABLE reminder_notification_deliveries(user_id uuid,delivery_type text,delivery_key text,target_date date,timezone text,target_at timestamptz,created_at timestamptz DEFAULT now(),payload jsonb,status text)`,
  );
  for (const file of [
    "20261027_projects.sql",
    "20260827_web_push_base.sql",
    "20261028_task_notifications.sql",
    "20261029_jarvis_v2.sql",
    "20261029_jarvis_web.sql",
  ])
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../db/migrations", file), "utf8"),
    );
  const source = fs.readFileSync(
      path.join(__dirname, "../deploy-bookshell-api-server.js"),
      "utf8",
    ),
    owner = /const SINGLE_USER_ID = "([^"]+)"/.exec(source)[1],
    other = crypto.randomUUID(),
    password = "qa-" + crypto.randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)",
    [
      owner,
      "qa@example.invalid",
      "QA Owner",
      await require("bcryptjs").hash(password, 4),
    ],
  );
  await pool.query(
    "INSERT INTO users(id,email,display_name,disabled) VALUES($1,$2,$3,false)",
    [other, "other@example.invalid", "Other"],
  );
  await pool.query(
    "INSERT INTO firebase_import_raw(user_id,firebase_uid,data) VALUES($1,$2,$3)",
    [
      owner,
      "qa-owner",
      JSON.stringify({
        books: { books: {} },
        habits: {
          habits: {},
          habitCounts: {},
          habitChecks: {},
          habitSessions: {},
        },
        notes: { notes: {}, folders: {} },
        meta: {},
      }),
    ],
  );
  await pool.query(
    "INSERT INTO firebase_import_raw(user_id,firebase_uid,data) VALUES($1,$2,$3)",
    [other, "qa-other", JSON.stringify({ habits: { habits: {} } })],
  );
  const parsed = new URL(url);
  parsed.searchParams.set("options", "-c search_path=" + schema + ",public");
  process.env.DATABASE_URL = parsed.href;
  process.env.BOOKSHELL_WEB_AUTH_MODE = process.env.BOOKSHELL_QA_WEB_MODE || "required";
  process.env.BOOKSHELL_JARVIS_V2_ENABLED = "1";
  const app = require("../deploy-bookshell-api-server");
  const server = http.createServer((req, res) =>
    app.server.emit("request", req, res),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const scopes = [
    "projects:read",
    "projects:write",
    "habits:read",
    "habits:write",
    "time:read",
    "time:write",
    "notifications:write",
  ];
  async function token(grants = scopes, userId = owner) {
    const value = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO project_oauth_tokens(token_hash,user_id,client_id,resource,scope,expires_at,refresh_expires_at) VALUES($1,$2,'qa','https://mcp-bookshell.charlydob.com/mcp',$3,now()+interval '1 hour','infinity')",
      [
        crypto.createHash("sha256").update(value).digest("hex"),
        userId,
        grants.join(" "),
      ],
    );
    return value;
  }
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js"),
    {
      StreamableHTTPClientTransport,
    } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const clients = [];
  async function mcp(grants = scopes, userId = owner) {
    const t = await token(grants, userId),
      client = new Client({ name: "phase2-qa", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + t } },
      }),
    );
    clients.push(client);
    return { client, token: t };
  }
  async function login() {
    const code = await app.__test.webSecurity.issueDeviceCode(owner),
      r = await fetch(base + "/auth/device", {
        method: "POST",
        headers: {
          Origin: "https://bookshell.charlydob.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
    if (!r.ok) throw new Error("QA pairing failed");
    return r.headers.get("set-cookie").split(";")[0];
  }
  return {
    admin,
    pool,
    app,
    server,
    base,
    owner,
    other,
    password,
    scopes,
    token,
    mcp,
    login,
    async close() {
      for (const c of clients) await c.close();
      await new Promise((r) => server.close(r));
      await app.__test.pool.end();
      await pool.end();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
    },
  };
}
module.exports = { createFixture };
