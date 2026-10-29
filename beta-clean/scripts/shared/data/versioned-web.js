import { API_BASE_URL } from "./config.js";
const observations = new Map();
let modePromise,
  editing = null;
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const normalize = (p) =>
  String(p || "")
    .replace(/^v2\/users\/[^/]+\/?/, "")
    .replace(/^\/+|\/+$/g, "");
export function rememberObserved(path, value) {
  const p = normalize(path);
  for (const key of observations.keys())
    if (key.startsWith(p + "/") || !p) observations.delete(key);
  for (const [base, stored] of observations) {
    if (base === p || (base && !p.startsWith(base + "/"))) continue;
    const keys = p.slice(base.length).replace(/^\//, "").split("/");
    let n = clone(stored);
    if (!n || typeof n !== "object") continue;
    let cursor = n;
    for (const k of keys.slice(0, -1)) {
      cursor[k] ??= {};
      cursor = cursor[k];
    }
    if (value == null) delete cursor[keys.at(-1)];
    else cursor[keys.at(-1)] = clone(value);
    observations.set(base, n);
  }
  observations.set(p, clone(value));
}
export function beginEditSnapshot() {
  editing = new Map([...observations].map(([k, v]) => [k, clone(v)]));
}
export function clearObserved() {
  observations.clear();
  modePromise = null;
  editing = null;
}
function observed(path, useCurrent = false) {
  const p = normalize(path);
  let best = null;
  for (const [base, value] of useCurrent
    ? observations
    : editing || observations)
    if (
      (p === base || !base || p.startsWith(base + "/")) &&
      (!best || base.length > best.base.length)
    )
      best = { base, value };
  if (!best) return { known: false };
  let value = best.value;
  for (const k of p
    .slice(best.base.length)
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean))
    value = value?.[k];
  return { known: true, value: value ?? null };
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value ?? null))),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function webMode() {
  if (!modePromise)
    modePromise = fetch(API_BASE_URL + "/auth/status", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (r.status === 404) return "legacy";
        if (!r.ok)
          throw new Error("No se pudo comprobar la protección de Bookshell");
        const status = await r.json();
        if (!["legacy", "observe", "required"].includes(status.mode))
          throw new Error("Estado de protecci�n desconocido");
        return status.mode === "observe" && !status.paired
          ? "legacy"
          : status.mode;
      })
      .catch((e) => {
        modePromise = null;
        throw e;
      });
  return modePromise;
}
export async function prepareVersionedWrite(
  method,
  path,
  body,
  { createOnly = false, useCurrent = false } = {},
) {
  path = normalize(path);
  const targets =
      method === "PATCH"
        ? Object.keys(body || {}).map((k) => (path ? path + "/" + k : k))
        : [path],
    expected = {};
  for (const target of targets) {
    const snapshot = observed(target, useCurrent);
    if (!snapshot.known && !createOnly)
      throw Object.assign(
        new Error(
          "Actualiza esta vista antes de guardar. No se ha sobrescrito el cambio.",
        ),
        { status: 428 },
      );
    expected[target] = await digest(createOnly ? null : snapshot.value);
  }
  return { method, path, body, expected, idempotencyKey: crypto.randomUUID() };
}
export async function applyVersionedWrite(mutation) {
  const r = await fetch(API_BASE_URL + "/web/data", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
  const b = await r.json();
  if (!r.ok) {
    if ([409, 428].includes(r.status))
      globalThis.dispatchEvent?.(
        new CustomEvent("bookshell:write-conflict", {
          detail: { path: mutation.path },
        }),
      );
    throw Object.assign(new Error(b.error || "No se pudo guardar"), {
      status: r.status,
      payload: b,
    });
  }
  for (const [p, v] of Object.entries(b.values || {})) {
    if (b.replayed) {
      const fresh = await fetch(API_BASE_URL + "/data/" + p, {
        credentials: "include",
        cache: "no-store",
      });
      if (!fresh.ok) {
        clearObserved();
        throw new Error(
          "Cambio guardado; actualiza la vista para comprobar el estado actual",
        );
      }
      rememberObserved(p, (await fresh.json()).data);
    } else rememberObserved(p, v);
  }
  editing = null;
  return b;
}
if (typeof document !== "undefined") {
  let editor;
  document.addEventListener("focusin", (e) => {
    if (!e.target.matches("input,textarea,select")) return;
    const next =
      e.target.closest('form,[role="dialog"],dialog,.modal') || e.target;
    if (editor !== next || !editing) {
      editor = next;
      beginEditSnapshot();
    }
  });
}
export async function ensureSystemHabit(habit) {
  const path = "habits/habits/" + habit.id,
    mode = await webMode();
  if (mode === "legacy") {
    const r = await fetch(API_BASE_URL + "/data/" + path, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(habit),
    });
    if (!r.ok) throw new Error("No se pudo preparar el hábito de sistema");
    return;
  }
  const r = await fetch(API_BASE_URL + "/data/" + path, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("No se pudo comprobar el hábito de sistema");
  const b = await r.json();
  if (b.data != null) return;
  try {
    await applyVersionedWrite(
      await prepareVersionedWrite("PUT", path, habit, { createOnly: true }),
    );
  } catch (e) {
    if (e.status !== 409) throw e;
  }
}
