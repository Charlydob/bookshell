import { API_BASE_URL } from "../../shared/data/config.js";
import { webMode } from "../../shared/data/versioned-web.js";
const zone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let host,
  timer,
  busy = false,
  generation = 0;
export async function callActivity(name, args) {
  const r = await fetch(API_BASE_URL + "/web/jarvis/" + name, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
    b = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(b.error || "No se pudo guardar"), {
      status: r.status,
    });
  return b;
}
async function refresh() {
  if (busy || !host) return;
  const requestGeneration = ++generation;
  try {
    const now = new Date(),
      from = new Date(now.getTime() - 7 * 86400000).toISOString(),
      query = await callActivity("activity_query", {
        from,
        to: new Date(now.getTime() + 60000).toISOString(),
        timezone: zone,
      });
    if (busy || requestGeneration !== generation) return;
    const rows = query.sessions.filter((s) => s.status !== "stopped");
    host.querySelector("[data-activity-list]").innerHTML = rows.length
      ? rows
          .map(
            (s) =>
              `<div class="pr-task"><div><strong>${esc(s.label)}</strong><small> ${s.status === "paused" ? "En pausa" : "En curso"} · ${Math.floor(s.durationSec / 60)} min</small></div><button type="button" data-session="${s.id}" data-revision="${s.revision}" data-operation="${s.status === "paused" ? "resume" : "pause"}">${s.status === "paused" ? "Reanudar" : "Pausar"}</button><button type="button" data-session="${s.id}" data-revision="${s.revision}" data-operation="stop">Finalizar</button></div>`,
          )
          .join("")
      : "<p>No hay actividades en curso.</p>";
    host.querySelector("[data-activity-summary]").textContent =
      `Últimos siete días: ${Math.round(query.totals.elapsedSec / 60)} min transcurridos · ${Math.round(query.totals.activitySec / 60)} min de actividades · ${Math.round(query.totals.overlapSec / 60)} min simultáneos.`;
  } catch (e) {
    host.querySelector("[data-activity-error]").textContent = e.message;
  }
}
export async function showActivities() {
  if ((await webMode()) !== "required") return;
  if (!host) {
    host = document.createElement("section");
    host.id = "bookshell-activities";
    host.className = "pr-card";
    host.innerHTML = `<style>#bookshell-activities{margin:12px 0 22px;padding:18px;border:1px solid #ffffff24;border-radius:18px;background:#ffffff06}#bookshell-activities h2{margin:0 0 16px;font-size:22px}#bookshell-activities form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end}#bookshell-activities label{display:grid;gap:6px;min-width:0;font-size:13px}#bookshell-activities input,#bookshell-activities select{box-sizing:border-box;width:100%;padding:11px;border-radius:10px;border:1px solid #ffffff38;background:#19172c;color:white}#bookshell-activities button{padding:10px 14px;border-radius:10px;border:1px solid #a896e878;background:#8a6dd926;color:white;cursor:pointer}#bookshell-activities button:disabled{opacity:.5}#bookshell-activities [data-activity-list]>div{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid #ffffff20}#bookshell-activities small{display:block;opacity:.7}#bookshell-activities [data-activity-summary]{font-size:13px;line-height:1.6;opacity:.8}</style><h2>Actividades</h2><form data-activity-start><label>Actividad <input name="label" required maxlength="200" placeholder="Por ejemplo, diseñar el cuenco"></label><label>Hábito de tiempo <select name="habit"><option value="">Sin asociación</option></select></label><label>Proyecto <select name="project"><option value="">Sin asociación</option></select></label><button type="submit">Empezar</button></form><p data-activity-error role="status"></p><div data-activity-list></div><p data-activity-summary></p>`;
    document.getElementById("view-habits")?.prepend(host);
    host.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.target),
        args = {
          label: String(form.get("label")),
          timezone: zone,
          idempotencyKey: crypto.randomUUID(),
        };
      if (form.get("habit")) args.habitId = String(form.get("habit"));
      if (form.get("project")) args.projectId = String(form.get("project"));
      await change("activity_start", args);
    });
    host.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-session]");
      if (b)
        await change("activity_change", {
          sessionId: b.dataset.session,
          action: b.dataset.operation,
          expectedRevision: b.dataset.revision,
          idempotencyKey: crypto.randomUUID(),
        });
    });
  }
  const habits = await callActivity("habits_list", {});
  host.querySelector("select[name=habit]").innerHTML =
    '<option value="">Sin asociación</option>' +
    habits.items
      .filter((h) => h.goal === "time")
      .map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`)
      .join("");
  const r = await fetch(API_BASE_URL + "/projects", { credentials: "include" });
  if (r.ok) {
    const { projects } = await r.json();
    host.querySelector("select[name=project]").innerHTML =
      '<option value="">Sin asociación</option>' +
      projects
        .map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`)
        .join("");
  }
  await refresh();
  clearInterval(timer);
  timer = setInterval(refresh, 15000);
}
async function change(name, args) {
  if (busy) return;
  busy = true;
  generation++;
  host.querySelector("[data-activity-error]").textContent = "Guardando…";
  host.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await callActivity(name, args);
    host.querySelector("[data-activity-error]").textContent = "Guardado.";
    globalThis.dispatchEvent(new Event("focus"));
  } catch (e) {
    host.querySelector("[data-activity-error]").textContent =
      e.status === 409
        ? "La sesión ha cambiado. Se ha actualizado la vista; revisa el estado antes de repetir."
        : e.message;
  } finally {
    busy = false;
    await refresh();
    host.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
export function hideActivities() {
  clearInterval(timer);
}
