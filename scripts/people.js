import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue, push, set, update, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1oqRk7GpYX854RfcGrYHt6iRun5TfuYE",
  authDomain: "bookshell-59703.firebaseapp.com",
  databaseURL: "https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bookshell-59703",
  storageBucket: "bookshell-59703.appspot.com",
  messagingSenderId: "554557230752",
  appId: "1:554557230752:web:37c24e287210433cf883c5"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);
const uid = String(window.__bookshellUid || localStorage.getItem("bookshell.uid") || "default");
const base = `users/${uid}/people`;

const state = {
  tags: {},
  linkTypes: {},
  persons: {},
  links: {},
  notes: {},
  selectedTagIds: new Set(),
  selectedPersonId: null,
  drag: null,
  thicknessByIntensity: localStorage.getItem("bookshell.people.thickness") !== "0"
};

const els = {
  view: document.getElementById("view-people"),
  toolbarTags: document.getElementById("people-toolbar-tags"),
  graph: document.getElementById("people-graph"),
  addPerson: document.getElementById("people-add-person"),
  radar: document.getElementById("people-radar"),
  leaderboard: document.getElementById("people-leaderboard"),
  settings: document.getElementById("people-settings"),
  personModal: document.getElementById("people-person-modal"),
  personBody: document.getElementById("people-person-body"),
  personClose: document.getElementById("people-person-close"),
  tagsModal: document.getElementById("people-tags-modal"),
  tagsBody: document.getElementById("people-tags-body"),
  tagsClose: document.getElementById("people-tags-close"),
  typesModal: document.getElementById("people-types-modal"),
  typesBody: document.getElementById("people-types-body"),
  typesClose: document.getElementById("people-types-close"),
  radarModal: document.getElementById("people-radar-modal"),
  radarBody: document.getElementById("people-radar-body"),
  radarClose: document.getElementById("people-radar-close"),
  leaderModal: document.getElementById("people-leader-modal"),
  leaderBody: document.getElementById("people-leader-body"),
  leaderClose: document.getElementById("people-leader-close")
};

function nowTs() { return Date.now(); }
function esc(s) { return String(s ?? "").replace(/[&<>'"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[m])); }
function clamp(v, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
function sortByOrder(obj) { return Object.entries(obj || {}).sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0)); }

function score(person, mode = "global") {
  const r = person?.ratings || {};
  if (mode === "int") return Number.isFinite(r.int) ? r.int : null;
  if (mode === "cha") return Number.isFinite(r.cha) ? r.cha : null;
  if (mode === "looks") return Number.isFinite(r.looks) ? r.looks : null;
  if (Number.isFinite(r.overall)) return r.overall;
  const vals = [r.int, r.cha, r.looks].filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function daysSinceMet(p) {
  const ts = Number(p?.metAt?.ts) || 0;
  if (!ts) return "—";
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function personMainTag(person) {
  const ids = Object.keys(person?.tagIds || {});
  const ordered = sortByOrder(state.tags).map(([id]) => id);
  return ordered.find((id) => ids.includes(id)) || ids[0] || null;
}

function personVisible(person) {
  if (!state.selectedTagIds.size) return true;
  const own = new Set(Object.keys(person?.tagIds || {}));
  for (const t of state.selectedTagIds) if (!own.has(t)) return false;
  return true;
}

function subscribe() {
  onValue(ref(db, `${base}/tags`), (s) => { state.tags = s.val() || {}; renderAll(); });
  onValue(ref(db, `${base}/linkTypes`), (s) => { state.linkTypes = s.val() || {}; renderAll(); });
  onValue(ref(db, `${base}/persons`), (s) => { state.persons = s.val() || {}; renderAll(); });
  onValue(ref(db, `${base}/links`), (s) => { state.links = s.val() || {}; renderAll(); });
  onValue(ref(db, `${base}/notes`), (s) => { state.notes = s.val() || {}; if (!els.personModal.classList.contains("hidden")) openPerson(state.selectedPersonId); });
}

function renderTagToolbar() {
  const tags = sortByOrder(state.tags);
  const chips = tags.map(([id, tag]) => {
    const active = state.selectedTagIds.has(id) ? "is-active" : "";
    return `<button class="people-chip ${active}" data-tag="${id}" style="--chip:${esc(tag.color || "#7f5dff")}">${esc(tag.emoji || "🏷️")} ${esc(tag.name || "Tag")}</button>`;
  }).join("");
  els.toolbarTags.innerHTML = `${chips}<button class="people-chip" id="people-manage-tags">✏️ Tags</button><button class="people-chip" id="people-manage-types">🔗 Tipos</button>`;
  els.toolbarTags.querySelectorAll("[data-tag]").forEach((b) => b.onclick = () => {
    const id = b.dataset.tag;
    if (state.selectedTagIds.has(id)) state.selectedTagIds.delete(id); else state.selectedTagIds.add(id);
    renderAll();
  });
  const mt = document.getElementById("people-manage-tags");
  if (mt) mt.onclick = openTagsModal;
  const mty = document.getElementById("people-manage-types");
  if (mty) mty.onclick = openTypesModal;
}

let savePosTimer = null;
function savePosition(id, x, y) {
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => update(ref(db, `${base}/persons/${id}`), { graph: { x, y }, updatedAt: nowTs() }), 250);
}

function renderGraph() {
  if (!els.graph) return;
  const persons = Object.entries(state.persons).filter(([, p]) => personVisible(p));
  const idSet = new Set(persons.map(([id]) => id));
  const links = Object.entries(state.links).filter(([, l]) => idSet.has(l.a) && idSet.has(l.b));
  const linkMarkup = links.map(([, l]) => {
    const a = state.persons[l.a], b = state.persons[l.b];
    if (!a || !b) return "";
    const t = state.linkTypes[l.typeId] || {};
    const ia = clamp(l.intensity || 1, 1, 5);
    const sw = state.thicknessByIntensity ? 0.8 + ia * 0.9 : 1.8;
    const op = state.thicknessByIntensity ? 0.12 + ia * 0.14 : 0.5;
    const ax = Number(a.graph?.x) || 180, ay = Number(a.graph?.y) || 210;
    const bx = Number(b.graph?.x) || 180, by = Number(b.graph?.y) || 210;
    return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${esc(t.color || "#5f6b87")}" stroke-width="${sw}" stroke-opacity="${op}" />`;
  }).join("");

  const nodeMarkup = persons.map(([id, p], idx) => {
    const x = Number(p.graph?.x) || (70 + (idx % 3) * 110);
    const y = Number(p.graph?.y) || (80 + Math.floor(idx / 3) * 90);
    const tag = state.tags[personMainTag(p)] || {};
    return `<g class="people-node" data-id="${id}" transform="translate(${x},${y})"><circle r="26" fill="rgba(255,255,255,.08)" stroke="${esc(tag.color || "#7f5dff")}" stroke-width="2"></circle><text y="-5" text-anchor="middle" class="people-node-emoji">${esc(p.emoji || "🙂")}</text><text y="13" text-anchor="middle" class="people-node-name">${esc((p.name || "Sin nombre").slice(0, 10))}</text></g>`;
  }).join("");

  els.graph.innerHTML = `<g>${linkMarkup}</g><g>${nodeMarkup}</g>`;
  els.graph.querySelectorAll(".people-node").forEach((node) => {
    const id = node.dataset.id;
    node.addEventListener("click", () => openPerson(id));
    node.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      node.setPointerCapture(ev.pointerId);
      const tr = node.getAttribute("transform").match(/translate\(([^,]+),([^\)]+)\)/);
      state.drag = { id, node, sx: Number(tr?.[1]) || 0, sy: Number(tr?.[2]) || 0, px: ev.clientX, py: ev.clientY };
    });
    node.addEventListener("pointermove", (ev) => {
      if (!state.drag || state.drag.id !== id) return;
      const nx = clamp(state.drag.sx + (ev.clientX - state.drag.px), 24, 336);
      const ny = clamp(state.drag.sy + (ev.clientY - state.drag.py), 28, 392);
      window.requestAnimationFrame(() => {
        node.setAttribute("transform", `translate(${nx},${ny})`);
      });
      savePosition(id, nx, ny);
    });
    node.addEventListener("pointerup", () => { state.drag = null; });
  });
}

function renderAll() {
  if (!els.view) return;
  renderTagToolbar();
  renderGraph();
}

function openPerson(id) {
  if (!id || !state.persons[id]) return;
  state.selectedPersonId = id;
  const p = state.persons[id];
  const links = Object.entries(state.links).filter(([, l]) => l.a === id || l.b === id);
  const notes = Object.entries(state.notes[id] || {}).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
  const avg = score(p, "global");
  const tagRows = sortByOrder(state.tags).map(([tagId, tag]) => {
    const checked = p.tagIds?.[tagId] ? "checked" : "";
    return `<label class="people-mini-chip"><input type="checkbox" data-tag-check="${tagId}" ${checked}/> ${esc(tag.emoji || "🏷️")} ${esc(tag.name)}</label>`;
  }).join("");
  els.personBody.innerHTML = `
    <div class="people-person-top"><div class="emoji">${esc(p.emoji || "🙂")}</div><div><input id="pp-name" value="${esc(p.name || "")}" placeholder="Nombre"/><div class="meta">Días desde que lo conoces: <b>${daysSinceMet(p)}</b></div></div></div>
    <div class="people-grid-2"><label>Día<input id="pp-bday-d" type="number" min="1" max="31" value="${p.birthday?.day || ""}"/></label><label>Mes<input id="pp-bday-m" type="number" min="1" max="12" value="${p.birthday?.month || ""}"/></label></div>
    <label>Emoji<input id="pp-emoji" value="${esc(p.emoji || "")}"/></label>
    <div class="people-chip-wrap">${tagRows}</div>
    <div class="people-grid-2"><label>Global<input id="pp-overall" type="number" min="0" max="10" step="1" value="${Number.isFinite(p.ratings?.overall) ? p.ratings.overall : ""}"/></label><label>Promedio: <b>${avg == null ? "—" : avg.toFixed(1)}</b></label></div>
    <div class="people-grid-3"><label>Int<input id="pp-int" type="number" min="0" max="10" step="1" value="${Number.isFinite(p.ratings?.int) ? p.ratings.int : ""}"/></label><label>Car<input id="pp-cha" type="number" min="0" max="10" step="1" value="${Number.isFinite(p.ratings?.cha) ? p.ratings.cha : ""}"/></label><label>Asp<input id="pp-looks" type="number" min="0" max="10" step="1" value="${Number.isFinite(p.ratings?.looks) ? p.ratings.looks : ""}"/></label></div>
    <label>Apreciación<textarea id="pp-app">${esc(p.appreciation || "")}</textarea></label>
    <label>Gustos (coma separado, max 10)<input id="pp-likes" value="${esc((p.likes || []).join(", "))}"/></label>
    <div class="people-subtitle">Vínculos</div>
    <div>${links.map(([lid, l]) => {
      const other = state.persons[l.a === id ? l.b : l.a];
      const typ = state.linkTypes[l.typeId] || {};
      return `<div class="people-row"><span>${esc(typ.emoji || "🔗")} ${esc(other?.name || "?")} · ${clamp(l.intensity || 1, 1, 5)}</span><button class="icon-btn" data-del-link="${lid}">🗑️</button></div>`;
    }).join("") || '<div class="people-empty">Sin vínculos</div>'}<button class="btn" id="pp-add-link" type="button">+ vínculo</button></div>
    <div class="people-subtitle">Timeline</div>
    <div>${notes.map(([nid, n]) => `<div class="people-note-row"><span>${esc(n.text || "")}</span><button class="icon-btn" data-del-note="${nid}">✕</button></div>`).join("") || '<div class="people-empty">Sin notas</div>'}</div>
    <div class="people-row"><input id="pp-note-input" placeholder="Añadir nota"/><button class="btn" id="pp-note-add" type="button">Guardar</button></div>
    <div class="people-row"><button class="btn primary" id="pp-save" type="button">Guardar cambios</button><button class="btn ghost danger" id="pp-delete" type="button">Eliminar</button></div>
  `;
  els.personModal.classList.remove("hidden");

  els.personBody.querySelectorAll("[data-del-link]").forEach((b) => b.onclick = () => remove(ref(db, `${base}/links/${b.dataset.delLink}`)));
  els.personBody.querySelectorAll("[data-del-note]").forEach((b) => b.onclick = () => remove(ref(db, `${base}/notes/${id}/${b.dataset.delNote}`)));
  document.getElementById("pp-note-add").onclick = async () => {
    const txt = document.getElementById("pp-note-input").value.trim();
    if (!txt) return;
    const nr = push(ref(db, `${base}/notes/${id}`));
    await set(nr, { text: txt, ts: nowTs(), createdAt: nowTs() });
    document.getElementById("pp-note-input").value = "";
  };

  document.getElementById("pp-add-link").onclick = addLinkFromModal;
  document.getElementById("pp-save").onclick = async () => {
    const likes = String(document.getElementById("pp-likes").value || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10);
    const tagIds = {};
    els.personBody.querySelectorAll("[data-tag-check]").forEach((input) => { if (input.checked) tagIds[input.dataset.tagCheck] = true; });
    await update(ref(db, `${base}/persons/${id}`), {
      name: document.getElementById("pp-name").value.trim() || "Sin nombre",
      emoji: document.getElementById("pp-emoji").value.trim() || "🙂",
      birthday: {
        day: clamp(document.getElementById("pp-bday-d").value || 0, 1, 31),
        month: clamp(document.getElementById("pp-bday-m").value || 0, 1, 12)
      },
      tagIds,
      likes,
      appreciation: document.getElementById("pp-app").value.trim().slice(0, 180),
      ratings: {
        overall: parseRating(document.getElementById("pp-overall").value),
        int: parseRating(document.getElementById("pp-int").value),
        cha: parseRating(document.getElementById("pp-cha").value),
        looks: parseRating(document.getElementById("pp-looks").value)
      },
      updatedAt: nowTs()
    });
  };
  document.getElementById("pp-delete").onclick = deletePersonCascade;
}

function parseRating(v) {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, 0, 10) : null;
}

async function deletePersonCascade() {
  const id = state.selectedPersonId;
  if (!id || !confirm("¿Eliminar persona y limpiar vínculos/notas?")) return;
  const updates = { [`${base}/persons/${id}`]: null, [`${base}/notes/${id}`]: null };
  Object.entries(state.links).forEach(([lid, l]) => { if (l.a === id || l.b === id) updates[`${base}/links/${lid}`] = null; });
  await update(ref(db), updates);
  closeModal(els.personModal);
}

async function addLinkFromModal() {
  const from = state.selectedPersonId;
  const others = Object.entries(state.persons).filter(([id]) => id !== from);
  if (!others.length) return;
  const targetName = prompt(`Destino (${others.map(([, p]) => p.name).join(", ")})`);
  const target = others.find(([, p]) => p.name?.toLowerCase() === String(targetName || "").trim().toLowerCase());
  if (!target) return;
  const types = sortByOrder(state.linkTypes);
  if (!types.length) return alert("Crea un tipo de vínculo primero.");
  const typeName = prompt(`Tipo (${types.map(([, t]) => t.name).join(", ")})`, types[0][1].name);
  const type = types.find(([, t]) => t.name?.toLowerCase() === String(typeName || "").trim().toLowerCase()) || types[0];
  const intensity = clamp(prompt("Intensidad 1..5", "3"), 1, 5);
  const note = prompt("Nota (opcional)", "") || "";
  const lr = push(ref(db, `${base}/links`));
  await set(lr, { a: from, b: target[0], typeId: type[0], intensity, note: note.slice(0, 120), createdAt: nowTs(), updatedAt: nowTs() });
}

function openTagsModal() {
  els.tagsModal.classList.remove("hidden");
  const rows = sortByOrder(state.tags);
  els.tagsBody.innerHTML = `<button class="btn primary" id="pt-add" type="button">+ Tag</button>${rows.map(([id, t], i) => `<div class="people-row"><span>${esc(t.emoji || "🏷️")} ${esc(t.name)}</span><input type="color" data-color="${id}" value="${esc(t.color || "#7f5dff")}"/><button class="icon-btn" data-up="${id}" ${i === 0 ? "disabled" : ""}>↑</button><button class="icon-btn" data-down="${id}" ${i === rows.length - 1 ? "disabled" : ""}>↓</button><button class="icon-btn" data-edit="${id}">✏️</button><button class="icon-btn" data-del="${id}">🗑️</button></div>`).join("")}`;
  document.getElementById("pt-add").onclick = async () => {
    const name = prompt("Nombre del tag");
    if (!name) return;
    const nr = push(ref(db, `${base}/tags`));
    await set(nr, { name: name.trim(), emoji: "🏷️", color: "#7f5dff", order: Object.keys(state.tags).length, createdAt: nowTs(), updatedAt: nowTs() });
  };
  els.tagsBody.querySelectorAll("[data-color]").forEach((i) => i.oninput = () => update(ref(db, `${base}/tags/${i.dataset.color}`), { color: i.value, updatedAt: nowTs() }));
  els.tagsBody.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.edit;
    const old = state.tags[id];
    const name = prompt("Nombre", old.name || "");
    if (!name) return;
    const emoji = prompt("Emoji", old.emoji || "🏷️") || "🏷️";
    await update(ref(db, `${base}/tags/${id}`), { name, emoji, updatedAt: nowTs() });
  });
  els.tagsBody.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => remove(ref(db, `${base}/tags/${b.dataset.del}`)));
  bindReorder(els.tagsBody, "up", state.tags, `${base}/tags`);
  bindReorder(els.tagsBody, "down", state.tags, `${base}/tags`);
}

function openTypesModal() {
  els.typesModal.classList.remove("hidden");
  const rows = sortByOrder(state.linkTypes);
  els.typesBody.innerHTML = `<button class="btn primary" id="plt-add" type="button">+ Tipo</button>${rows.map(([id, t], i) => `<div class="people-row"><span>${esc(t.emoji || "🔗")} ${esc(t.name)}</span><input type="color" data-color="${id}" value="${esc(t.color || "#56b9ff")}"/><button class="icon-btn" data-up="${id}" ${i === 0 ? "disabled" : ""}>↑</button><button class="icon-btn" data-down="${id}" ${i === rows.length - 1 ? "disabled" : ""}>↓</button><button class="icon-btn" data-edit="${id}">✏️</button><button class="icon-btn" data-del="${id}">🗑️</button></div>`).join("")}`;
  document.getElementById("plt-add").onclick = async () => {
    const name = prompt("Nombre del tipo");
    if (!name) return;
    const nr = push(ref(db, `${base}/linkTypes`));
    await set(nr, { name: name.trim(), emoji: "🔗", color: "#56b9ff", order: Object.keys(state.linkTypes).length, createdAt: nowTs(), updatedAt: nowTs() });
  };
  els.typesBody.querySelectorAll("[data-color]").forEach((i) => i.oninput = () => update(ref(db, `${base}/linkTypes/${i.dataset.color}`), { color: i.value, updatedAt: nowTs() }));
  els.typesBody.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.edit;
    const old = state.linkTypes[id];
    const name = prompt("Nombre", old.name || "");
    if (!name) return;
    const emoji = prompt("Emoji", old.emoji || "🔗") || "🔗";
    await update(ref(db, `${base}/linkTypes/${id}`), { name, emoji, updatedAt: nowTs() });
  });
  els.typesBody.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => remove(ref(db, `${base}/linkTypes/${b.dataset.del}`)));
  bindReorder(els.typesBody, "up", state.linkTypes, `${base}/linkTypes`);
  bindReorder(els.typesBody, "down", state.linkTypes, `${base}/linkTypes`);
}

function bindReorder(host, dir, sourceObj, rootPath) {
  host.querySelectorAll(`[data-${dir}]`).forEach((b) => b.onclick = async () => {
    const id = b.dataset[dir];
    const rows = sortByOrder(sourceObj).map(([k]) => k);
    const idx = rows.indexOf(id);
    const to = dir === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || to < 0 || to >= rows.length) return;
    const updates = {};
    updates[`${rootPath}/${rows[idx]}/order`] = to;
    updates[`${rootPath}/${rows[to]}/order`] = idx;
    updates[`${rootPath}/${rows[idx]}/updatedAt`] = nowTs();
    updates[`${rootPath}/${rows[to]}/updatedAt`] = nowTs();
    await update(ref(db), updates);
  });
}

function daysUntilBirthday(person, rangeDays) {
  const m = Number(person?.birthday?.month);
  const d = Number(person?.birthday?.day);
  if (!m || !d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const diff = Math.round((next - today) / 86400000);
  if (diff > rangeDays) return null;
  return { diff, date: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}` };
}

function openRadar() {
  els.radarModal.classList.remove("hidden");
  let range = 14;
  const draw = () => {
    const list = Object.entries(state.persons).map(([id, p]) => ({ id, p, b: daysUntilBirthday(p, range) })).filter((x) => x.b).sort((a, b) => a.b.diff - b.b.diff);
    els.radarBody.innerHTML = `<div class="people-segment">${[7,14,30].map((n)=>`<button class="people-chip ${range===n?"is-active":""}" data-r="${n}">${n} días</button>`).join("")}</div>${list.map(({p,b})=>`<div class="people-row"><span>${esc(p.emoji||"🙂")} ${esc(p.name||"")}</span><span>${b.date} · en ${b.diff} días</span></div>`).join("") || '<div class="people-empty">Nadie cumple pronto</div>'}`;
    els.radarBody.querySelectorAll("[data-r]").forEach((b) => b.onclick = () => { range = Number(b.dataset.r); draw(); });
  };
  draw();
}

function openLeaderboard() {
  els.leaderModal.classList.remove("hidden");
  let mode = "global";
  let q = "";
  const draw = () => {
    const rows = Object.entries(state.persons).map(([id, p]) => ({ id, p, s: score(p, mode === "global" ? "global" : mode) }))
      .filter((x) => x.s != null)
      .filter((x) => !q || x.p.name?.toLowerCase().includes(q))
      .sort((a, b) => b.s - a.s)
      .slice(0, 20);
    els.leaderBody.innerHTML = `<input id="pl-search" placeholder="Buscar" value="${esc(q)}"/><div class="people-segment">${[["global","Global"],["int","Inteligencia"],["cha","Carisma"],["looks","Aspecto"]].map(([k,label])=>`<button class="people-chip ${mode===k?"is-active":""}" data-m="${k}">${label}</button>`).join("")}</div>${rows.map((x,i)=>`<div class="people-row"><span>#${i+1} ${esc(x.p.emoji||"🙂")} ${esc(x.p.name||"")}</span><b>${x.s.toFixed(1)}</b></div>`).join("") || '<div class="people-empty">Sin puntuaciones</div>'}`;
    document.getElementById("pl-search").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
    els.leaderBody.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { mode = b.dataset.m; draw(); });
  };
  draw();
}

function closeModal(el) { if (el) el.classList.add("hidden"); }

function bindTop() {
  if (!els.view) return;
  els.addPerson.onclick = async () => {
    const name = prompt("Nombre de la persona");
    if (!name) return;
    const nr = push(ref(db, `${base}/persons`));
    await set(nr, {
      name: name.trim(),
      emoji: "🙂",
      metAt: { ts: nowTs() },
      birthday: { month: null, day: null },
      tagIds: {},
      likes: [],
      appreciation: "",
      ratings: { overall: null, int: null, cha: null, looks: null },
      createdAt: nowTs(),
      updatedAt: nowTs(),
      graph: { x: 180, y: 210 }
    });
  };
  els.radar.onclick = openRadar;
  els.leaderboard.onclick = openLeaderboard;
  els.settings.onclick = () => {
    state.thicknessByIntensity = !state.thicknessByIntensity;
    localStorage.setItem("bookshell.people.thickness", state.thicknessByIntensity ? "1" : "0");
    renderGraph();
  };
  els.personClose.onclick = () => closeModal(els.personModal);
  els.tagsClose.onclick = () => closeModal(els.tagsModal);
  els.typesClose.onclick = () => closeModal(els.typesModal);
  els.radarClose.onclick = () => closeModal(els.radarModal);
  els.leaderClose.onclick = () => closeModal(els.leaderModal);
}

bindTop();
subscribe();
