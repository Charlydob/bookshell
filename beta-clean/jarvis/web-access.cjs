"use strict";
const { Pool } = require("pg");
const { createWebSecurity } = require("./web-security");
(async () => {
  const [command, owner] = process.argv.slice(2);
  if (
    !["--issue-device-code", "--readiness"].includes(command) ||
    !/^[0-9a-f-]{36}$/i.test(owner || "")
  )
    throw new Error(
      "Use --issue-device-code or --readiness and the verified owner UUID",
    );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (command === "--issue-device-code") {
      const security = createWebSecurity({
        pool,
        ownerId: owner,
        mode: "required",
      });
      process.stdout.write((await security.issueDeviceCode(owner)) + "\n");
    } else {
      const sessions = (
        await pool.query(
          "SELECT device_label,user_agent,expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",
          [owner],
        )
      ).rows;
      process.stdout.write(
        JSON.stringify({
          enrolledDevices: sessions,
          readyForReview: sessions.length > 0,
        }) + "\n",
      );
    }
  } finally {
    await pool.end();
  }
})().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exitCode = 1;
});
