import { auth } from "../auth/index.js";
import {
  listOfflineOperations,
  deleteOfflineOperation,
  updateOfflineOperation,
} from "../storage/offline-queue.js";
import {
  prepareVersionedWrite,
  applyVersionedWrite,
  rememberObserved,
} from "./versioned-web.js";
import { API_BASE_URL } from "./config.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let panel;
export async function showConflicts() {
  if (!auth.currentUser?.uid) {
    panel?.remove();
    panel = null;
    return;
  }
  const items = await listOfflineOperations({
    uid: auth.currentUser.uid,
    statuses: ["conflict"],
  });
  if (!items.length) {
    panel?.remove();
    panel = null;
    return;
  }
  panel?.remove();
  panel = document.createElement("aside");
  panel.id = "bookshell-conflicts";
  panel.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:99990;max-width:min(440px,94vw);max-height:70vh;overflow:auto;background:#15211e;color:white;padding:18px;border:1px solid #aac6b0;border-radius:14px";
  panel.innerHTML = `<h2>Cambios pendientes de revisión</h2><p>Se conservan en este dispositivo. No han reemplazado los cambios de otro dispositivo.</p>${items.map((o) => `<details><summary>${esc(o.actionType || "Cambio pendiente")}</summary><p>${esc(o.lastError)}</p><pre style="white-space:pre-wrap">${esc(JSON.stringify(o.payload, null, 2))}</pre><button data-review="${o.opId}">Comparar con lo guardado</button><button data-discard="${o.opId}">Descartar este cambio local</button></details>`).join("")}`;
  document.body.append(panel);
  panel.onclick = async (e) => {
    const discard = e.target.dataset.discard,
      review = e.target.dataset.review;
    if (discard) {
      await deleteOfflineOperation(discard);
      await showConflicts();
    }
    if (review) {
      const op = items.find((x) => x.opId === review),
        path = String(op.backendPath).replace(/^v2\/users\/[^/]+\/?/, "");
      const r = await fetch(API_BASE_URL + "/data/" + path, {
        credentials: "include",
      });
      if (!r.ok) return;
      const b = await r.json(),
        details = e.target.closest("details");
      details.querySelector("[data-compare]")?.remove();
      const compare = document.createElement("div");
      compare.dataset.compare = "true";
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.textContent =
        "Guardado actualmente:\n" + JSON.stringify(b.data, null, 2);
      compare.append(pre);
      const apply = document.createElement("button");
      apply.textContent = "Confirmar reemplazo por mi cambio local";
      apply.onclick = async () => {
        apply.disabled = true;
        try {
          rememberObserved(path, b.data);
          const mutation = await prepareVersionedWrite(
            op.writeType === "update"
              ? "PATCH"
              : op.payload == null
                ? "DELETE"
                : "PUT",
            path,
            op.payload,
            { useCurrent: true },
          );
          await applyVersionedWrite(mutation);
          await deleteOfflineOperation(op.opId);
          await showConflicts();
        } catch (err) {
          await updateOfflineOperation(op.opId, { lastError: err.message });
          apply.textContent = "No se pudo guardar: vuelve a comparar";
          apply.disabled = false;
        }
      };
      compare.append(apply);
      details.append(compare);
    }
  };
}
globalThis.addEventListener?.("bookshell:write-conflict", () =>
  setTimeout(() => void showConflicts(), 500),
);
globalThis.addEventListener?.(
  "bookshell:offline-conflicts",
  () => void showConflicts(),
);
