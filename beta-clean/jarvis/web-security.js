"use strict";
const crypto = require("node:crypto"),
  bcrypt = require("bcryptjs");
const { body, json } = require("../projects/auth");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const webScopes = [
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

];
function createWebSecurity({
  pool,
  ownerId,
  mode = "legacy",
  origins = ["https://bookshell.charlydob.com"],
  secureCookies = true,
  nowFn = () => new Date(),
}) {
  if (!["legacy", "observe", "required"].includes(mode))
    throw new Error("Invalid web auth mode");
  const attempts = new Map();
  const cookie = (token, age = 90 * 86400) =>
    `bookshell_session=${token}; HttpOnly; ${secureCookies ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${age}`;
  function origin(req) {
    if (
      !(typeof origins === "function"
        ? origins(req.headers.origin)
        : origins.includes(req.headers.origin))
    )
      throw Object.assign(new Error("ORIGIN_DENIED"), { status: 403 });
  }
  function rate(req) {
    const k = req.socket.remoteAddress,
      now = nowFn().getTime(),
      old = attempts.get(k),
      entry = old && old.until > now ? old : { n: 0, until: now + 600000 };
    if (++entry.n > 15)
      throw Object.assign(new Error("TOO_MANY_ATTEMPTS"), { status: 429 });
    attempts.set(k, entry);
    if (attempts.size > 5000)
      for (const [key, v] of attempts) if (v.until < now) attempts.delete(key);
  }
  async function identity(userId) {
    if (userId !== ownerId) return null;
    const r = (
      await pool.query(
        "SELECT u.id,u.email,u.display_name,f.firebase_uid FROM users u JOIN LATERAL(SELECT firebase_uid FROM firebase_import_raw WHERE user_id=u.id ORDER BY imported_at DESC,id DESC LIMIT 1) f ON true WHERE u.id=$1 AND u.disabled=false",
        [userId],
      )
    ).rows[0];
    return r
      ? {
          id: r.id,
          email: r.email,
          displayName: r.display_name,
          legacyFirebaseUid: r.firebase_uid,
        }
      : null;
  }
  async function authenticate(req) {
    const token = String(req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("bookshell_session="))
      ?.slice(18);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = (
      await pool.query(
        "SELECT s.user_id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND s.revoked_at IS NULL AND u.disabled=false",
        [hash(token), nowFn()],
      )
    ).rows[0];
    if (!row) return null;
    const user = await identity(row.user_id);
    return user ? { userId: user.id, scopes: webScopes, user } : null;
  }
  async function requireUser(req) {
    const a = await authenticate(req);
    if (!a) throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
    return a;
  }
  async function session(res, userId, req, label) {
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO user_sessions(id,user_id,token_hash,expires_at,device_label,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
      [
        crypto.randomUUID(),
        userId,
        hash(token),
        new Date(nowFn().getTime() + 90 * 86400000),
        String(label || "Bookshell").slice(0, 100),
        String(req.headers["user-agent"] || "").slice(0, 500),
      ],
    );
    return { "Set-Cookie": cookie(token), "Cache-Control": "no-store" };
  }
  async function issueDeviceCode(userId) {
    if (!(await identity(userId))) throw new Error("USER_UNAVAILABLE");
    const code = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO project_access_tickets(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'web',$3)",
      [hash(code), userId, new Date(nowFn().getTime() + 10 * 60000)],
    );
    return code;
  }
  async function handle(req, res, url) {
    if (mode === "legacy") return false;
    if (
      ![
        "/auth/me",
        "/auth/login",
        "/auth/logout",
        "/auth/device",
        "/auth/status",
        "/auth/register",
      ].includes(url.pathname)
    )
      return false;
    try {
      if (url.pathname === "/auth/status" && req.method === "GET") {
        json(res, 200, {
          mode,
          devicePairing: true,
          paired: !!(await authenticate(req)),
        });
        return true;
      }
      if (url.pathname === "/auth/me" && req.method === "GET") {
        const a = await authenticate(req);
        if (!a && mode === "observe") {
          json(res, 200, {
            ok: true,
            user: await identity(ownerId),
            transition: true,
          });
          return true;
        }
        json(
          res,
          a ? 200 : 401,
          a ? { ok: true, user: a.user } : { error: "AUTH_REQUIRED" },
        );
        return true;
      }
      if (req.method !== "POST") {
        json(res, 405, { error: "METHOD_NOT_ALLOWED" });
        return true;
      }
      origin(req);
      rate(req);
      if (url.pathname === "/auth/logout") {
        const a = await authenticate(req);
        if (a) {
          const token = String(req.headers.cookie)
            .split(";")
            .map((v) => v.trim())
            .find((v) => v.startsWith("bookshell_session="))
            ?.slice(18);
          await pool.query(
            "UPDATE user_sessions SET revoked_at=$2 WHERE token_hash=$1",
            [hash(token), nowFn()],
          );
        }
        json(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
        return true;
      }
      const b = await body(req);
      let userId;
      if (url.pathname === "/auth/device") {
        if (typeof b.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.code))
          throw Object.assign(new Error("INVALID_DEVICE_CODE"), {
            status: 401,
          });
        const r = (
          await pool.query(
            "UPDATE project_access_tickets SET used_at=$2 WHERE token_hash=$1 AND purpose='web' AND used_at IS NULL AND expires_at>$2 AND user_id=$3 AND user_id IN(SELECT id FROM users WHERE disabled=false) RETURNING user_id",
            [hash(b.code), nowFn(), ownerId],
          )
        ).rows[0];
        if (!r)
          throw Object.assign(new Error("INVALID_DEVICE_CODE"), {
            status: 401,
          });
        userId = r.user_id;
      } else if (url.pathname === "/auth/login") {
        const u = (
          await pool.query(
            "SELECT id,password_hash FROM users WHERE lower(email)=lower($1) AND id=$2 AND disabled=false",
            [String(b.email || "").slice(0, 300), ownerId],
          )
        ).rows[0];
        if (
          typeof b.password !== "string" ||
          b.password.length > 1024 ||
          !u ||
          !(await bcrypt.compare(b.password, u.password_hash || ""))
        )
          throw Object.assign(new Error("INVALID_CREDENTIALS"), {
            status: 401,
          });
        userId = u.id;
      } else {
        json(res, 403, { error: "REGISTRATION_DISABLED" });
        return true;
      }
      json(
        res,
        200,
        { ok: true, user: await identity(userId) },
        await session(res, userId, req, b.label),
      );
      return true;
    } catch (e) {
      json(res, e.status || 500, {
        error: e.status ? e.message : "AUTH_FAILED",
      });
      return true;
    }
  }
  return { mode, handle, authenticate, requireUser, origin, issueDeviceCode };
}
module.exports = { createWebSecurity, webScopes };
