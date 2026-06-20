const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { pathToFileURL } = require("node:url");

const workspaceRoot = process.cwd();
const entryArg = process.argv[2] || "beta-clean/scripts/modules/finance/index.js";
const entryFile = path.resolve(workspaceRoot, entryArg);

const importPatterns = [
  /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function normalizeSpecifier(specifier = "") {
  return String(specifier || "").split("?")[0].split("#")[0];
}

function isRelativeSpecifier(specifier = "") {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function tryResolveLocalSpecifier(fromFile, specifier) {
  const normalized = normalizeSpecifier(specifier);
  if (!isRelativeSpecifier(normalized)) return null;

  const basePath = normalized.startsWith("/")
    ? path.resolve(workspaceRoot, normalized.slice(1))
    : path.resolve(path.dirname(fromFile), normalized);

  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, "index.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }
  return path.resolve(basePath);
}

function extractSpecifiers(sourceText = "") {
  const results = [];
  for (const pattern of importPatterns) {
    pattern.lastIndex = 0;
    let match = null;
    while ((match = pattern.exec(sourceText))) {
      results.push(match[1]);
    }
  }
  return results;
}

function gatherTree(entryPath) {
  const queue = [entryPath];
  const visited = new Set();
  const nodes = new Map();
  const edges = [];

  while (queue.length) {
    const currentFile = queue.shift();
    if (visited.has(currentFile)) continue;
    visited.add(currentFile);

    const sourceText = fs.readFileSync(currentFile, "utf8");
    const specifiers = extractSpecifiers(sourceText);
    const imports = specifiers.map((specifier) => {
      const resolved = tryResolveLocalSpecifier(currentFile, specifier);
      const exists = resolved ? fs.existsSync(resolved) : false;
      return {
        specifier,
        resolved,
        exists,
        kind: resolved ? "local" : (/^(https?:)?\/\//.test(specifier) ? "remote" : "bare"),
      };
    });

    nodes.set(currentFile, { file: currentFile, imports });

    for (const item of imports) {
      edges.push({ from: currentFile, ...item });
      if (item.kind === "local" && item.exists) {
        queue.push(item.resolved);
      }
    }
  }

  return { nodes, edges };
}

function runNodeCheck(filePath) {
  const result = cp.spawnSync(process.execPath, ["--check", filePath], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  return {
    filePath,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function installBrowserShims() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    clear() {
      storage.clear();
    },
  };

  const noop = () => {};
  const documentStub = {
    body: { appendChild: noop },
    head: { appendChild: noop },
    createElement() {
      return {
        setAttribute: noop,
        appendChild: noop,
        addEventListener: noop,
        removeEventListener: noop,
        style: {},
        dataset: {},
      };
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  globalThis.window = globalThis.window || {};
  globalThis.window.console = console;
  globalThis.window.localStorage = localStorage;
  globalThis.window.setTimeout = setTimeout;
  globalThis.window.clearTimeout = clearTimeout;
  globalThis.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.window.cancelAnimationFrame = clearTimeout;
  globalThis.window.document = documentStub;
  globalThis.window.performance = globalThis.performance || { now: () => Date.now() };
  globalThis.localStorage = localStorage;
  globalThis.document = documentStub;
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
  globalThis.fetch = globalThis.fetch || (async () => {
    throw new Error("fetch not available in parse-finance-tree");
  });
  globalThis.navigator = globalThis.navigator || { userAgent: "node" };
}

async function importSequentially(files = []) {
  installBrowserShims();
  const failures = [];
  for (const filePath of files) {
    const href = pathToFileURL(filePath).href;
    try {
      console.info("[importing]", path.relative(workspaceRoot, filePath));
      await import(href);
      console.info("[ok]", path.relative(workspaceRoot, filePath));
    } catch (error) {
      console.error("[FAILED MODULE]", path.relative(workspaceRoot, filePath));
      console.error(error && error.stack ? error.stack : error);
      failures.push({ filePath, error });
      if (error instanceof SyntaxError) break;
    }
  }
  return failures;
}

async function main() {
  if (!fs.existsSync(entryFile)) {
    console.error(`Entry file not found: ${entryFile}`);
    process.exitCode = 1;
    return;
  }

  const { nodes, edges } = gatherTree(entryFile);
  const localFiles = Array.from(nodes.keys());
  const checkResults = localFiles.map(runNodeCheck);
  const syntaxFailures = checkResults.filter((result) => !result.ok);

  console.log("== Finance dependency tree ==");
  for (const [filePath, node] of nodes.entries()) {
    console.log(path.relative(workspaceRoot, filePath));
    for (const item of node.imports) {
      const target = item.resolved ? path.relative(workspaceRoot, item.resolved) : item.specifier;
      console.log(`  -> ${item.specifier} :: ${item.kind}${item.exists === false ? " [missing]" : ""} :: ${target}`);
    }
  }

  console.log("\n== node --check results ==");
  checkResults.forEach((result) => {
    console.log(`${result.ok ? "[ok]" : "[FAIL]"} ${path.relative(workspaceRoot, result.filePath)}`);
    if (!result.ok) {
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.log(result.stderr.trim());
    }
  });

  console.log("\n== Missing local imports ==");
  const missing = edges.filter((edge) => edge.kind === "local" && !edge.exists);
  if (!missing.length) {
    console.log("[ok] none");
  } else {
    missing.forEach((edge) => {
      console.log(`[missing] ${path.relative(workspaceRoot, edge.from)} -> ${edge.specifier} :: ${path.relative(workspaceRoot, edge.resolved)}`);
    });
  }

  if (!syntaxFailures.length) {
    console.log("\n== Sequential import probe ==");
    await importSequentially(localFiles);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
