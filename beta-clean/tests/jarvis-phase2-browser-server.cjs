"use strict";
const { createFixture } = require("./qa-phase2-fixture.cjs"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
(async () => {
  const f = await createFixture(),
    { client } = await f.mcp(),
    root = path.resolve(__dirname, ".."),
    socket = "/qa/browser.sock";
  if (fs.existsSync(socket)) fs.unlinkSync(socket);
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/qa/bootstrap") {
        const code = await f.app.__test.webSecurity.issueDeviceCode(f.owner);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ code }));
        return;
      }
      if (url.pathname === "/qa/mcp") {
        let text = "";
        for await (const chunk of req) text += chunk;
        const b = JSON.parse(text),
          result = await client.callTool({
            name: b.name,
            arguments: b.arguments,
          });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
        return;
      }
      if (
        /^\/(auth|data|web|projects|push|mcp|health)(\/|$)/.test(
          url.pathname,
        ) ||
        url.pathname.startsWith("/.well-known/")
      ) {
        f.app.server.emit("request", req, res);
        return;
      }
      const file = path.resolve(
        root,
        "." +
          (url.pathname === "/"
            ? "/index.html"
            : decodeURIComponent(url.pathname)),
      );
      if (
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      const types = {
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      };
      res.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      if (file.endsWith("/scripts/shared/data/config.js")) {
        res.end(
          `export const DATA_PROVIDER="api";export const API_BASE_URL="http://${req.headers.host}";`,
        );
        return;
      }
      res.end(fs.readFileSync(file));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end("QA server error");
    }
  };
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((r) => server.listen(socket, r));
  fs.chmodSync(socket, 0o600);
  console.log("QA_BROWSER_READY");
  process.on("SIGTERM", async () => {
    server.close();
    await f.close();
    process.exit(0);
  });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
