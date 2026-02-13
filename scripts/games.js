import { db } from "./firebase-shared.js";
import { ref, onValue, set, update, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getRangeBounds, dateFromKey } from "./range-helpers.js";
import { buildCsv, downloadZip, sanitizeFileToken, triggerDownload } from "./export-utils.js";

const GROUPS_PATH = "gameGroups";
const MODES_PATH = "gameModes";
const DAILY_PATH = "gameModeDaily";
const HABITS_PATH = "habits";
const CACHE_KEY = "bookshell-games-cache:v2";
const OPEN_KEY = "bookshell-games-open-groups";
const HABIT_RUNNING_KEY = "bookshell-habit-running-session";

let groups = {};
let modes = {};
let habits = {};
let dailyByMode = {};
const openGroups = new Set();
let sessionTick = null;
let currentModeId = null;
let detailMonth = { year: new Date().getFullYear(), month: new Date().getMonth() };
let detailRange = "total";
let selectedDonutKey = "wins";
let gamesPanel = "counters";
let statsRange = localStorage.getItem("bookshell-games-stats-range") || "total";
let statsDonutKey = "wins";

let statsLineChart = null;
let detailLineChart = null;
let statsDonutChart = null;
let detailDonutChart = null;

const $groupsList = document.getElementById("games-groups-list");
const $empty = document.getElementById("games-empty");
const $addMode = document.getElementById("game-add-mode");
const $modeModal = document.getElementById("game-mode-modal");
const $modeForm = document.getElementById("game-mode-form");
const $modeTitle = document.getElementById("game-mode-modal-title");
const $modeClose = document.getElementById("game-mode-close");
const $modeCancel = document.getElementById("game-mode-cancel");
const $groupChoice = document.getElementById("game-group-choice");
const $existingWrap = document.getElementById("game-group-existing-wrap");
const $existingGroup = document.getElementById("game-existing-group");
const $newWrap = document.getElementById("game-group-new-wrap");
const $groupName = document.getElementById("game-group-name");
const $groupEmoji = document.getElementById("game-group-emoji");
const $groupHabit = document.getElementById("game-group-linked-habit");
const $groupHabitWrap = document.getElementById("game-group-habit-wrap");
const $modeName = document.getElementById("game-mode-name");
const $modeEmoji = document.getElementById("game-mode-emoji");

const $groupModal = document.getElementById("game-group-modal");
const $groupForm = document.getElementById("game-group-form");
const $groupClose = document.getElementById("game-group-close");
const $groupCancel = document.getElementById("game-group-cancel");
const $groupId = document.getElementById("game-group-id");
const $groupEditName = document.getElementById("game-group-edit-name");
const $groupEditEmoji = document.getElementById("game-group-edit-emoji");
const $groupEditHabit = document.getElementById("game-group-edit-habit");

const $detailModal = document.getElementById("game-detail-modal");
const $detailBody = document.getElementById("game-detail-body");
const $detailTitle = document.getElementById("game-detail-title");
const $detailClose = document.getElementById("game-detail-close");
const $detailCancel = document.getElementById("game-detail-cancel");

const $statsFilter = document.getElementById("game-stats-group-filter");
const $statsTotals = document.getElementById("game-stats-totals");
const $statsDonut = document.getElementById("game-stats-donut");
const $statsLine = document.getElementById("game-stats-line");
const $statsSub = document.getElementById("game-stats-sub");
const $statsBreakdown = document.getElementById("game-stats-breakdown");
const $statsCard = document.getElementById("game-stats-card");
const $gamesExportBtn = document.getElementById("games-export-btn");
const $tabCounters = document.getElementById("game-tab-counters");
const $tabStats = document.getElementById("game-tab-stats");

let editingModeId = null;

function nowTs() { return Date.now(); }
const clamp = (n, min = 0) => Math.max(min, n);
function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function todayKey() { return dateKeyLocal(new Date()); }

function saveCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ groups, modes, dailyByMode }));
  localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(openGroups)));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      groups = parsed.groups || {};
      modes = parsed.modes || {};
      dailyByMode = parsed.dailyByMode || {};
    }
    const openRaw = localStorage.getItem(OPEN_KEY);
    if (openRaw) JSON.parse(openRaw).forEach((id) => openGroups.add(id));
  } catch (_) {}
}

function ensurePct(wins, losses, ties = 0) {
  const total = wins + losses + ties;
  if (!total) return { winPct: 0, lossPct: 0, tiePct: 0, total: 0 };
  return {
    total,
    winPct: Math.round((wins / total) * 100),
    lossPct: Math.round((losses / total) * 100),
    tiePct: Math.round((ties / total) * 100)
  };
}

function pctWidths(wins, losses, ties = 0) {
  const total = wins + losses + ties;
  if (!total) return { lossW: 33.34, tieW: 33.33, winW: 33.33 };
  const lossW = (losses / total) * 100;
  const tieW = (ties / total) * 100;
  const winW = Math.max(0, 100 - lossW - tieW);
  return { lossW, tieW, winW };
}

function getRunningSessionState() {
  try {
    const raw = localStorage.getItem(HABIT_RUNNING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.startTs) return null;
    return parsed;
  } catch (_) { return null; }
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function triggerHaptic() { try { navigator.vibrate?.(10); } catch (_) {} }

function habitOptionsHtml() {
  const rows = Object.values(habits || {}).filter((h) => h && h.id && !h.archived).sort((a, b) => (a.name || "").localeCompare(b.name || "es"));
  const opt = ['<option value="">Ninguno</option>'];
  rows.forEach((h) => opt.push(`<option value="${h.id}">${h.emoji || "✅"} ${h.name || h.id}</option>`));
  return opt.join("");
}

function groupModes(groupId) {
  return Object.values(modes || {}).filter((m) => m?.groupId === groupId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function groupTotals(groupId) {
  return groupModes(groupId).reduce((acc, m) => {
    const totals = modeTotalsFromDaily(m.id);
    acc.wins += totals.wins;
    acc.losses += totals.losses;
    acc.ties += totals.ties;
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
}

function modeTotalsFromDaily(modeId) {
  return Object.values(dailyByMode[modeId] || {}).reduce((acc, row) => {
    acc.wins += Number(row?.wins || 0);
    acc.losses += Number(row?.losses || 0);
    acc.ties += Number(row?.ties || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
}

function readDayMinutes(rawValue) {
  if (rawValue == null) return 0;
  if (typeof rawValue === "number") return Math.round(Math.max(0, rawValue) / 60);
  if (typeof rawValue === "object") {
    const minRaw = Number(rawValue.min);
    const secRaw = Number(rawValue.totalSec);
    if (Number.isFinite(minRaw) && minRaw > 0) return Math.round(minRaw);
    if (Number.isFinite(secRaw) && secRaw > 0) return Math.round(secRaw / 60);
  }
  return 0;
}

function getModePlayedMinutes(mode) {
  const group = groups[mode.groupId];
  const habit = group?.linkedHabitId ? habits[group.linkedHabitId] : null;
  if (!habit?.log) return 0;
  return Object.values(habit.log).reduce((acc, val) => acc + readDayMinutes(val), 0);
}

function buildModeCard(mode, groupEmoji) {
  const dailyTotals = modeTotalsFromDaily(mode.id);
  const wins = clamp(Number(dailyTotals.wins || 0));
  const losses = clamp(Number(dailyTotals.losses || 0));
  const ties = clamp(Number(dailyTotals.ties || 0));
  const { winPct, lossPct, tiePct, total } = ensurePct(wins, losses, ties);
  const emoji = (mode.modeEmoji || "").trim() || groupEmoji || "🎮";
  const { lossW, tieW, winW } = pctWidths(wins, losses, ties);
  return `
  <article class="game-card" data-mode-id="${mode.id}" role="button" tabindex="0">
    <div class="game-split-bg">
      <div class="game-split-loss" style="width:${lossW}%"></div>
      <div class="game-split-tie" style="width:${tieW}%"></div>
      <div class="game-split-win" style="width:${winW}%"></div>
    </div>
    <div class="game-card-total">${total} TOTAL</div>
    <div class="game-card-content">
      <div class="game-side left">
        <button class="game-thumb-btn-losses" data-action="loss" title="Derrota">👎</button>
        <div class="game-side-stat-losses">${losses} • ${lossPct}%</div>
      </div>
      <div class="game-center">
        <div class="game-mode-name">${mode.modeName || "Modo"}</div>
        <button class="game-mode-emoji game-mode-emoji-btn" data-action="tie" title="Empate">${emoji}</button>
      </div>
      <div class="game-side right">
        <div class="game-side-stat-wins">${winPct}% • ${wins}</div>
        <button class="game-thumb-btn-wins" data-action="win" title="Victoria">👍</button>
      </div>
    </div>
    <div class="game-bottom-tie">${ties} • ${tiePct}%</div>
  </article>`;
}

function renderStatsFilter() {
  if (!$statsFilter) return;
  const options = ['<option value="all">Global</option>'];
  Object.values(groups || {}).forEach((g) => options.push(`<option value="${g.id}">${g.emoji || "🎮"} ${g.name || "Grupo"}</option>`));
  const current = $statsFilter.value || "all";
  $statsFilter.innerHTML = options.join("");
  $statsFilter.value = options.some((o) => o.includes(`value=\"${current}\"`)) ? current : "all";
}

function getMinDataDate(modeIds) {
  const keys = modeIds.flatMap((modeId) => Object.keys(dailyByMode[modeId] || {})).sort((a, b) => a.localeCompare(b));
  return keys.length ? dateFromKey(keys[0]) : null;
}

function isDateInRange(date, start, endExclusive) {
  if (!date) return false;
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}

function sumInRange(dailyMap, start, endExclusive) {
  return Object.entries(dailyMap || {}).reduce((acc, [key, row]) => {
    if (!isDateInRange(dateFromKey(key), start, endExclusive)) return acc;
    acc.wins += Number(row?.wins || 0);
    acc.losses += Number(row?.losses || 0);
    acc.ties += Number(row?.ties || 0);
    acc.minutes += Number(row?.minutes || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0, minutes: 0 });
}

function mergeDailyMaps(modeIds) {
  return modeIds.reduce((acc, modeId) => {
    Object.entries(dailyByMode[modeId] || {}).forEach(([day, row]) => {
      const prev = acc[day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
      prev.wins += Number(row?.wins || 0);
      prev.losses += Number(row?.losses || 0);
      prev.ties += Number(row?.ties || 0);
      prev.minutes += Number(row?.minutes || 0);
      acc[day] = prev;
    });
    return acc;
  }, {});
}

function buildDailySeries(dailyMap, rangeSpec) {
  const keys = Object.keys(dailyMap || {}).sort((a, b) => a.localeCompare(b));
  let start = rangeSpec.start;
  let end = rangeSpec.endExclusive;
  if (!start && keys.length) start = dateFromKey(keys[0]);
  if (!end && keys.length) {
    end = dateFromKey(keys[keys.length - 1]);
    end?.setDate(end.getDate() + 1);
  }
  if (!start || !end) return [];
  const out = [];
  for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKeyLocal(cursor);
    out.push([key, dailyMap[key] || { wins: 0, losses: 0, ties: 0, minutes: 0 }]);
  }
  return out;
}

function createGamesLineOption(points) {
  return {
    animation: false,
    grid: { left: 34, right: 14, top: 18, bottom: 20 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(6,10,24,.96)", borderColor: "rgba(152,178,255,.3)", textStyle: { color: "#EAF2FF" } },
    xAxis: {
      type: "category",
      data: points.map(([d]) => d.slice(5)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(166,188,255,.25)" } },
      axisLabel: { color: "rgba(225,235,255,.72)", fontSize: 10 }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: { show: false },
      axisLabel: { color: "rgba(225,235,255,.72)", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(154,176,255,.12)" } }
    },
    series: [
      { name: "Derrotas", type: "line", smooth: true, symbol: "none", data: points.map(([, v]) => v.losses || 0), lineStyle: { width: 2.2, color: "rgba(255,90,110,.92)" } },
      { name: "Empates", type: "line", smooth: true, symbol: "none", data: points.map(([, v]) => v.ties || 0), lineStyle: { width: 1.4, color: "rgba(177,190,210,.88)" }, areaStyle: { color: "rgba(177,190,210,.08)" } },
      { name: "Victorias", type: "line", smooth: true, symbol: "none", data: points.map(([, v]) => v.wins || 0), lineStyle: { width: 2.2, color: "rgba(64,235,151,.95)" } }
    ]
  };
}

function renderLineChart($el, points, chartRef = "stats") {
  if (!$el) return;
  const hasData = points.some(([, v]) => Number(v.wins || 0) || Number(v.losses || 0) || Number(v.ties || 0));
  let chart = chartRef === "stats" ? statsLineChart : detailLineChart;
  if (!hasData) {
    chart?.dispose();
    if (chartRef === "stats") statsLineChart = null;
    else detailLineChart = null;
    if (!$el.querySelector('.empty-state')) $el.innerHTML = "<div class='empty-state small'>Sin datos…</div>";
    return;
  }
  if ($el.querySelector('.empty-state')) $el.innerHTML = "";
  if (!chart) {
    chart = echarts.init($el);
    if (chartRef === "stats") statsLineChart = chart;
    else detailLineChart = chart;
  }
  chart.setOption(createGamesLineOption(points), true);
  requestAnimationFrame(() => setTimeout(() => chart.resize(), 50));
}

function renderDonut($el, vals, selectable = false, chartRef = "stats") {
  if (!$el) return;
  const total = vals.wins + vals.losses + vals.ties;
  const labels = { wins: "Victorias", losses: "Derrotas", ties: "Empates" };
  const activeKey = chartRef === "detail" ? selectedDonutKey : statsDonutKey;
  const activeVal = vals[activeKey] || 0;
  const activePct = total ? Math.round((activeVal / total) * 100) : 0;
  const oldChart = chartRef === "detail" ? detailDonutChart : statsDonutChart;
  oldChart?.dispose();
  if (chartRef === "detail") detailDonutChart = null;
  else statsDonutChart = null;

  $el.innerHTML = `<div class="games-donut-echart"></div>
  <div class="games-donut-center">
    <div class="games-donut-total">${total}</div>
    <div>${labels[activeKey]} ${activeVal} (${activePct}%)</div>
  </div>`;
  const host = $el.querySelector(".games-donut-echart");
  const chart = chartRef === "detail"
    ? (detailDonutChart = echarts.init(host))
    : (statsDonutChart = echarts.init(host));
  chart.off("click");
  if (selectable) {
    chart.on("click", (params) => {
      const key = params?.data?.key;
      if (!key) return;
      if (chartRef === "detail") selectedDonutKey = key;
      else statsDonutKey = key;
      renderModeDetail();
      renderGlobalStats();
    });
  }
  chart.setOption({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    series: [{
      type: "pie",
      radius: ["62%", "84%"],
      avoidLabelOverlap: true,
      label: { show: false },
      itemStyle: { borderWidth: 2, borderColor: "rgba(0,0,0,.2)", shadowBlur: 14, shadowColor: "rgba(150,190,255,.2)" },
      data: [
        { key: "losses", name: "Derrotas", value: vals.losses, itemStyle: { color: "rgba(255,90,110,.92)" } },
        { key: "ties", name: "Empates", value: vals.ties, itemStyle: { color: "rgba(177,190,210,.9)" } },
        { key: "wins", name: "Victorias", value: vals.wins, itemStyle: { color: "rgba(64,235,151,.95)" } }
      ]
    }]
  }, true);
  chart.resize();
}

function renderGlobalStats() {
  renderStatsFilter();
  const selected = $statsFilter?.value || "all";
  const modeRows = Object.values(modes || {}).filter((m) => m && (selected === "all" || m.groupId === selected));
  const modeIds = modeRows.map((m) => m.id);
  const minDate = getMinDataDate(modeIds);
  const range = getRangeBounds(statsRange, new Date(), minDate);
  const mergedDaily = mergeDailyMaps(modeIds);
  const points = buildDailySeries(mergedDaily, range);
  const totals = sumInRange(mergedDaily, range.start, range.endExclusive);

  const byGroup = modeRows.reduce((acc, m) => {
    const gId = m.groupId || "none";
    acc[gId] = acc[gId] || { wins: 0, losses: 0, ties: 0 };
    const modeTotals = sumInRange(dailyByMode[m.id] || {}, range.start, range.endExclusive);
    acc[gId].wins += modeTotals.wins;
    acc[gId].losses += modeTotals.losses;
    acc[gId].ties += modeTotals.ties;
    return acc;
  }, {});

  const byMode = modeRows.map((m) => {
    const stats = sumInRange(dailyByMode[m.id] || {}, range.start, range.endExclusive);
    const pct = ensurePct(stats.wins, stats.losses, stats.ties);
    return { mode: m, stats, pct };
  }).sort((a, b) => b.pct.total - a.pct.total);

  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  if ($statsTotals) $statsTotals.textContent = `${pct.total} partidas · ${totals.wins}W / ${totals.losses}L / ${totals.ties}T · ${pct.winPct}%W`;
  if ($statsSub) $statsSub.textContent = selected === "all" ? "Global" : (groups[selected]?.name || "Grupo");
  renderDonut($statsDonut, totals, true, "stats");
  renderLineChart($statsLine, points, "stats");

  if ($statsBreakdown) {
    const topWin = [...byMode].sort((a, b) => b.pct.winPct - a.pct.winPct)[0];
    const topPlays = byMode[0];
    $statsBreakdown.innerHTML = `
      <div class="games-break-card"><strong>Por grupo</strong>${Object.entries(byGroup).map(([gId, v]) => {
        const gp = ensurePct(v.wins, v.losses, v.ties);
        return `<div>${groups[gId]?.name || "Sin grupo"} · ${gp.total} · ${gp.winPct}%W</div>`;
      }).join("") || "<div>Sin datos</div>"}</div>
      <div class="games-break-card"><strong>Por modo</strong>${byMode.slice(0, 4).map((entry) => `<div>${entry.mode.modeName || "Modo"} · ${entry.pct.total} · ${entry.pct.winPct}%W</div>`).join("") || "<div>Sin datos</div>"}</div>
      <div class="games-break-card"><strong>Top</strong><div>Winrate: ${topWin ? `${topWin.mode.modeName || "Modo"} (${topWin.pct.winPct}%)` : "—"}</div><div>Partidas: ${topPlays ? `${topPlays.mode.modeName || "Modo"} (${topPlays.pct.total})` : "—"}</div></div>
      <div class="games-break-card"><strong>Desglose</strong>${byMode.map((entry) => {
        const matches = entry.pct.total;
        const winPct = matches ? ((entry.stats.wins / matches) * 100).toFixed(1) : "0.0";
        return `<div>${entry.mode.modeName || "Modo"} · ${matches} partidas · ${entry.stats.wins}W / ${entry.stats.losses}L / ${entry.stats.ties}T · ${winPct}%W</div>`;
      }).join("") || "<div>Sin datos</div>"}</div>`;
  }
}

function renderGamesPanel() {
  const stats = gamesPanel === "stats";
  $statsCard?.classList.toggle("hidden", !stats);
  $groupsList?.classList.toggle("hidden", stats);
  $empty?.classList.toggle("hidden", stats || Object.values(groups || {}).some((g) => g?.id));
  $tabCounters?.classList.toggle("is-active", !stats);
  $tabStats?.classList.toggle("is-active", stats);
}

function render() {
  if (!$groupsList) return;
  const groupRows = Object.values(groups || {}).filter((g) => g?.id).sort((a, b) => (a.name || "").localeCompare(b.name || "es"));
  $groupsList.innerHTML = "";
  $empty.style.display = groupRows.length ? "none" : "block";
  const running = getRunningSessionState();

  groupRows.forEach((g) => {
    const groupedModes = groupModes(g.id);
    const { wins, losses, ties } = groupTotals(g.id);
    const { winPct, lossPct } = ensurePct(wins, losses, ties);
    const hasRunning = !!(running && g.linkedHabitId && running.targetHabitId === g.linkedHabitId);
    const elapsed = hasRunning ? formatDuration((Date.now() - Number(running.startTs || Date.now())) / 1000) : "";
    if (!openGroups.size) openGroups.add(g.id);
    const detail = document.createElement("details");
    detail.className = "game-group";
    detail.open = openGroups.has(g.id);
    detail.dataset.groupId = g.id;
    detail.innerHTML = `
      <summary>
        <div class="game-group-main">
          <div class="game-group-name">${g.emoji || "🎮"} ${g.name || "Grupo"}</div>
          <div class="game-group-meta">${losses}L / ${wins}W / ${ties}T · ${lossPct}% - ${winPct}%</div>
        </div>
        <div class="game-group-actions">
          <button class="game-session-btn" data-action="toggle-session">${hasRunning ? `■ ${elapsed}` : "▶ Iniciar"}</button>
          <button class="game-menu-btn" data-action="group-menu">…</button>
        </div>
      </summary>
      <div class="game-group-body">${groupedModes.map((m) => buildModeCard(m, g.emoji)).join("")}</div>
    `;
    detail.addEventListener("toggle", () => {
      if (detail.open) openGroups.add(g.id);
      else openGroups.delete(g.id);
      saveCache();
    });
    $groupsList.appendChild(detail);
  });
  renderGamesPanel();
  renderGlobalStats();
}

function openModeModal(mode = null) {
  editingModeId = mode?.id || null;
  $modeTitle.textContent = editingModeId ? "Editar modo" : "Nuevo modo";
  $groupChoice.value = "existing";
  $groupName.value = "";
  $groupEmoji.value = "🎮";
  $modeName.value = mode?.modeName || "";
  $modeEmoji.value = mode?.modeEmoji || "";
  $existingGroup.innerHTML = Object.values(groups).map((g) => `<option value="${g.id}">${g.emoji || "🎮"} ${g.name}</option>`).join("");
  if (mode?.groupId) $existingGroup.value = mode.groupId;
  $groupHabit.innerHTML = habitOptionsHtml();
  $groupHabit.value = "";
  toggleGroupChoice();
  $modeModal.classList.add("modal-centered-mobile");
  $modeModal.classList.remove("hidden");
  syncModalScrollLock();
}

function closeModeModal() { $modeModal.classList.add("hidden"); editingModeId = null; syncModalScrollLock(); }

function openGroupModal(groupIdValue) {
  const g = groups[groupIdValue];
  if (!g) return;
  $groupId.value = g.id;
  $groupEditName.value = g.name || "";
  $groupEditEmoji.value = g.emoji || "🎮";
  $groupEditHabit.innerHTML = habitOptionsHtml();
  $groupEditHabit.value = g.linkedHabitId || "";
  $groupModal.classList.remove("hidden");
  syncModalScrollLock();
}
function closeGroupModal() { $groupModal.classList.add("hidden"); syncModalScrollLock(); }

function syncModalScrollLock() {
  const hasOpen = !!document.querySelector(".modal-backdrop:not(.hidden)");
  document.body.classList.toggle("has-open-modal", hasOpen);
}

function toggleGroupChoice() {
  const isNew = $groupChoice.value === "new";
  $newWrap.style.display = isNew ? "grid" : "none";
  $groupHabitWrap.style.display = isNew ? "block" : "none";
  $existingWrap.style.display = isNew ? "none" : "block";
}

async function createOrUpdateMode() {
  const modeNameValue = $modeName.value.trim();
  if (!modeNameValue) return;
  const modeEmojiValue = $modeEmoji.value.trim();
  let groupIdValue = $existingGroup.value;
  if ($groupChoice.value === "new") {
    const name = $groupName.value.trim();
    if (!name) return;
    const groupIdRef = push(ref(db, GROUPS_PATH));
    const groupPayload = {
      id: groupIdRef.key,
      name,
      emoji: ($groupEmoji.value || "🎮").trim() || "🎮",
      linkedHabitId: $groupHabit.value || null,
      createdAt: nowTs(),
      updatedAt: nowTs()
    };
    groupIdValue = groupPayload.id;
    groups[groupPayload.id] = groupPayload;
    await set(groupIdRef, groupPayload);
  }
  if (!groupIdValue) return;
  const base = { groupId: groupIdValue, modeName: modeNameValue, modeEmoji: modeEmojiValue, updatedAt: nowTs() };
  if (editingModeId && modes[editingModeId]) {
    modes[editingModeId] = { ...modes[editingModeId], ...base };
    await update(ref(db, `${MODES_PATH}/${editingModeId}`), base);
  } else {
    const modeIdRef = push(ref(db, MODES_PATH));
    const payload = { id: modeIdRef.key, wins: 0, losses: 0, ties: 0, createdAt: nowTs(), ...base };
    modes[payload.id] = payload;
    await set(modeIdRef, payload);
  }
  saveCache();
  closeModeModal();
  render();
}

async function patchModeCounter(modeId, key, delta) {
  const mode = modes[modeId];
  if (!mode) return;
  const dailyTotals = modeTotalsFromDaily(modeId);
  const prevTotal = clamp(Number(dailyTotals[key] || 0));
  if (delta < 0 && prevTotal <= 0) return;
  mode.updatedAt = nowTs();

  const day = todayKey();
  dailyByMode[modeId] = dailyByMode[modeId] || {};
  const dayPrev = dailyByMode[modeId][day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
  const dayValue = clamp(Number(dayPrev[key] || 0) + delta);
  dailyByMode[modeId][day] = { ...dayPrev, [key]: dayValue };

  render();
  if (currentModeId === modeId) renderModeDetail();
  triggerHaptic();

  const updates = {
    [`${MODES_PATH}/${modeId}/updatedAt`]: mode.updatedAt,
    [`${DAILY_PATH}/${modeId}/${day}/${key}`]: dayValue
  };
  await update(ref(db), updates);
  saveCache();
}

async function resetMode(modeId) {
  if (!confirm("¿Resetear este modo?")) return;
  const mode = modes[modeId];
  if (!mode) return;
  mode.wins = 0; mode.losses = 0; mode.ties = 0; mode.updatedAt = nowTs();
  dailyByMode[modeId] = {};
  render();
  if (currentModeId === modeId) renderModeDetail();
  await update(ref(db), {
    [`${MODES_PATH}/${modeId}/wins`]: 0,
    [`${MODES_PATH}/${modeId}/losses`]: 0,
    [`${MODES_PATH}/${modeId}/ties`]: 0,
    [`${MODES_PATH}/${modeId}/updatedAt`]: mode.updatedAt,
    [`${DAILY_PATH}/${modeId}`]: null
  });
}

async function deleteMode(modeId) {
  if (!confirm("¿Eliminar modo?")) return;
  delete modes[modeId];
  delete dailyByMode[modeId];
  if (currentModeId === modeId) closeModeDetail();
  render();
  await Promise.all([remove(ref(db, `${MODES_PATH}/${modeId}`)), remove(ref(db, `${DAILY_PATH}/${modeId}`))]);
}

async function handleGroupMenu(groupIdValue) {
  const action = prompt("Acción de grupo: editar | add | reset | delete");
  if (!action) return;
  const cmd = action.trim().toLowerCase();
  if (cmd === "editar" || cmd === "edit") return openGroupModal(groupIdValue);
  if (cmd === "add") return openModeModal({ groupId: groupIdValue });
  if (cmd === "reset") {
    if (!confirm("Resetear todos los modos del grupo?")) return;
    const updates = {};
    groupModes(groupIdValue).forEach((m) => {
      m.wins = 0; m.losses = 0; m.ties = 0; m.updatedAt = nowTs();
      updates[`${MODES_PATH}/${m.id}/wins`] = 0;
      updates[`${MODES_PATH}/${m.id}/losses`] = 0;
      updates[`${MODES_PATH}/${m.id}/ties`] = 0;
      updates[`${MODES_PATH}/${m.id}/updatedAt`] = m.updatedAt;
      updates[`${DAILY_PATH}/${m.id}`] = null;
      dailyByMode[m.id] = {};
    });
    render();
    return update(ref(db), updates);
  }
  if (cmd === "delete") {
    if (!confirm("Eliminar grupo y todos sus modos?")) return;
    const jobs = [remove(ref(db, `${GROUPS_PATH}/${groupIdValue}`))];
    groupModes(groupIdValue).forEach((m) => {
      delete modes[m.id];
      delete dailyByMode[m.id];
      jobs.push(remove(ref(db, `${MODES_PATH}/${m.id}`)));
      jobs.push(remove(ref(db, `${DAILY_PATH}/${m.id}`)));
    });
    delete groups[groupIdValue];
    render();
    return Promise.all(jobs);
  }
}

function toggleGroupSession(groupIdValue) {
  const group = groups[groupIdValue];
  if (!group?.linkedHabitId) return alert("Vincula un hábito al grupo para usar sesiones.");
  const api = window.__bookshellHabits;
  if (!api) return;
  const running = getRunningSessionState();
  if (running) {
    if (running.targetHabitId !== group.linkedHabitId) return alert("Ya hay una sesión activa");
    api.stopSession(group.linkedHabitId, true);
    return;
  }
  api.startSession(group.linkedHabitId);
}

function formatMinutesShort(min) {
  const minutes = Math.max(0, Number(min || 0));
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function getModeDayMinutes(mode, dateKey, rec = null) {
  const group = groups[mode.groupId] || {};
  const habit = group?.linkedHabitId ? habits[group.linkedHabitId] : null;
  if (habit?.log?.[dateKey] != null) return readDayMinutes(habit.log[dateKey]);
  return Number((rec || dailyByMode[mode.id]?.[dateKey] || {}).minutes || 0);
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let i = 0; i < start; i += 1) out.push(null);
  for (let d = 1; d <= days; d += 1) out.push(new Date(year, month, d));
  while (out.length % 7) out.push(null);
  return out;
}

function renderModeDetail() {
  if (!currentModeId || !$detailBody) return;
  const mode = modes[currentModeId];
  if (!mode) return;
  const group = groups[mode.groupId] || {};
  const modeDaily = dailyByMode[mode.id] || {};
  const minDate = getMinDataDate([mode.id]);
  const range = getRangeBounds(detailRange, new Date(), minDate);
  const totals = sumInRange(modeDaily, range.start, range.endExclusive);
  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  const minutes = getModePlayedMinutes(mode);
  const hoursText = `${(minutes / 60).toFixed(1)}h`;
  const points = buildDailySeries(modeDaily, range);

  const rows = monthGrid(detailMonth.year, detailMonth.month).map((dayDate) => {
    if (!dayDate) return '<button type="button" class="habit-heatmap-cell is-out" disabled aria-hidden="true"></button>';
    const key = dateKeyLocal(dayDate);
    const rec = modeDaily[key] || {};
    const min = getModeDayMinutes(mode, key, rec);
    const balance = Number(rec.wins || 0) - Number(rec.losses || 0);
    const tintCls = balance > 0 ? "is-win" : (balance < 0 ? "is-loss" : "is-even");
    const todayCls = key === todayKey() ? "is-active" : "";
    return `<button type="button" class="habit-heatmap-cell ${todayCls} ${tintCls}" data-day="${key}">
      <span class="month-day-num">${dayDate.getDate()}</span>
      <span class="month-day-value month-day-time">${formatMinutesShort(min)}</span>
    </button>`;
  }).join("");

  const modeTotals = modeTotalsFromDaily(mode.id);

  $detailTitle.textContent = `${group.name || "Grupo"} — ${mode.modeName || "Modo"}`;
  $detailBody.innerHTML = `
    <section class="game-detail-head">
      <div class="game-detail-top">
        <div>
          <div class="game-detail-name">${mode.modeEmoji || group.emoji || "🎮"} ${group.name || "Grupo"} — ${mode.modeName || "Modo"}</div>
          <div class="game-detail-sub">${pct.total} partidas · ${pct.winPct}%W / ${pct.lossPct}%L / ${pct.tiePct}%T</div>
        </div>
        <div class="game-detail-actions">
          <button class="game-menu-btn" data-action="edit-mode">Editar</button>
          <button class="game-menu-btn" data-action="reset-mode">Reset</button>
          <button class="game-menu-btn" data-action="delete-mode">Eliminar</button>
        </div>
      </div>
      <div class="game-detail-summary">
        <div>W/L/T: ${totals.wins}/${totals.losses}/${totals.ties}</div>
        <div>Horas jugadas (hábito grupo): ${hoursText}</div>
      </div>
    </section>

    <section class="game-detail-section">
      <strong>Controles</strong>
      <div class="game-controls-grid">
        <div class="game-control-col loss">
          <div>Derrotas</div><div class="game-control-value">${modeTotals.losses}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="loss">+1</button><button class="game-ctrl-btn" data-action="loss-minus">-1</button></div>
        </div>
        <div class="game-control-col tie">
          <div>Empates</div><div class="game-control-value">${modeTotals.ties}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="tie">+1</button><button class="game-ctrl-btn" data-action="tie-minus">-1</button></div>
        </div>
        <div class="game-control-col win">
          <div>Victorias</div><div class="game-control-value">${modeTotals.wins}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="win">+1</button><button class="game-ctrl-btn" data-action="win-minus">-1</button></div>
        </div>
      </div>
    </section>

    <section class="game-detail-section">
      <strong>Rango</strong>
      <div class="game-ranges">
        <button class="game-range-btn ${detailRange === "day" ? "is-active" : ""}" data-range="day">Día</button>
        <button class="game-range-btn ${detailRange === "week" ? "is-active" : ""}" data-range="week">Semana</button>
        <button class="game-range-btn ${detailRange === "month" ? "is-active" : ""}" data-range="month">Mes</button>
        <button class="game-range-btn ${detailRange === "year" ? "is-active" : ""}" data-range="year">Año</button>
        <button class="game-range-btn ${detailRange === "total" ? "is-active" : ""}" data-range="total">Total</button>
      </div>
      <div class="games-stats-grid">
        <div class="games-donut" id="game-detail-donut"></div>
        <div class="games-line" id="games-mode-line-${mode.id}"></div>
      </div>
    </section>

    <section class="game-detail-section habit-detail-section">
  <div class="game-calendar-head habit-detail-section-head">
    <div>
      <div class="game-detail-title habit-detail-section-title">Calendario mensual</div>
      <div class="game-detail-sub habit-detail-section-sub">
        ${new Date(detailMonth.year, detailMonth.month, 1).toLocaleDateString("es-ES",{month:"long",year:"numeric"})}
      </div>
    </div>

    <div class="game-cal-nav">
      <button class="game-menu-btn" data-cal-nav="-1" aria-label="Mes anterior">←</button>
      <button class="game-menu-btn" data-cal-nav="1" aria-label="Mes siguiente">→</button>
    </div>
  </div>

  <div class="habit-month-grid game-calendar-grid">${rows}</div>
</section>`;


  renderDonut(document.getElementById("game-detail-donut"), totals, true, "detail");
  const detailLineEl = document.getElementById(`games-mode-line-${mode.id}`);
  requestAnimationFrame(() => setTimeout(() => renderLineChart(detailLineEl, points, "detail"), 0));
}

async function saveDayRecord(modeId, day, rec) {
  dailyByMode[modeId] = dailyByMode[modeId] || {};
  dailyByMode[modeId][day] = {
    wins: clamp(Number(rec.wins || 0)),
    losses: clamp(Number(rec.losses || 0)),
    ties: clamp(Number(rec.ties || 0)),
    minutes: clamp(Number(rec.minutes || 0))
  };
  render();
  renderGlobalStats();
  if (currentModeId === modeId) renderModeDetail();
  await set(ref(db, `${DAILY_PATH}/${modeId}/${day}`), dailyByMode[modeId][day]);
}

function openDayRecordModal(modeId, day) {
  const mode = modes[modeId];
  if (!mode) return;
  const group = groups[mode.groupId] || {};
  const rec = dailyByMode[modeId]?.[day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
  const linkedHabit = group?.linkedHabitId ? habits[group.linkedHabitId] : null;
  const linkedMinutes = linkedHabit ? readDayMinutes(linkedHabit.log?.[day]) : 0;
  const minutesReadOnly = !!linkedHabit;
  let state = {
    wins: clamp(Number(rec.wins || 0)),
    losses: clamp(Number(rec.losses || 0)),
    ties: clamp(Number(rec.ties || 0)),
    minutes: minutesReadOnly ? linkedMinutes : clamp(Number(rec.minutes || 0))
  };
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal habit-modal game-day-modal">
    <div class="modal-header"><div class="modal-title">Registro del día</div></div>
    <div class="modal-scroll sheet-body">
      <label class="field"><span class="field-label">Fecha</span><input type="text" value="${day}" readonly></label>
      <label class="field"><span class="field-label">Horas / minutos</span><input id="game-day-minutes" type="number" min="0" value="${state.minutes}" ${minutesReadOnly ? "readonly" : ""}></label>
      ${minutesReadOnly ? '<div class="games-subtitle">Minutos vinculados al hábito del grupo.</div>' : ""}
      <div class="game-day-counter" data-k="losses"><span>Derrotas</span><div><button type="button" data-step="-1">-1</button><strong>${state.losses}</strong><button type="button" data-step="1">+1</button></div></div>
      <div class="game-day-counter" data-k="ties"><span>Empates</span><div><button type="button" data-step="-1">-1</button><strong>${state.ties}</strong><button type="button" data-step="1">+1</button></div></div>
      <div class="game-day-counter" data-k="wins"><span>Victorias</span><div><button type="button" data-step="-1">-1</button><strong>${state.wins}</strong><button type="button" data-step="1">+1</button></div></div>
    </div>
    <div class="modal-footer sheet-footer">
      <button class="btn ghost" type="button" data-close>Cancelar</button>
      <button class="btn primary" type="button" data-save>Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  syncModalScrollLock();

  const repaint = () => {
    modal.querySelectorAll(".game-day-counter").forEach((row) => {
      const k = row.dataset.k;
      row.querySelector("strong").textContent = state[k];
    });
  };
  modal.addEventListener("click", async (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) {
      modal.remove();
      syncModalScrollLock();
      return;
    }
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      const k = stepBtn.closest(".game-day-counter")?.dataset.k;
      if (!k) return;
      state[k] = clamp(Number(state[k] || 0) + Number(stepBtn.dataset.step || 0));
      repaint();
      return;
    }
    if (e.target.closest("[data-save]")) {
      if (!minutesReadOnly) {
        const val = Number(modal.querySelector("#game-day-minutes")?.value || 0);
        state.minutes = clamp(val);
      }
      await saveDayRecord(modeId, day, state);
      modal.remove();
      syncModalScrollLock();
    }
  });
}


function toHours(value) {
  return (Number(value || 0) / 60).toFixed(2);
}

function buildGamesExportRows() {
  return Object.values(modes || {}).flatMap((mode) => {
    const group = groups[mode.groupId] || {};
    return Object.entries(dailyByMode[mode.id] || {}).map(([date, row]) => {
      const wins = Number(row?.wins || 0);
      const losses = Number(row?.losses || 0);
      const ties = Number(row?.ties || 0);
      const matches = wins + losses + ties;
      const minutes = Number(row?.minutes || 0);
      return {
        date,
        groupId: group.id || "",
        groupName: group.name || "",
        modeId: mode.id,
        modeName: mode.modeName || "",
        wins,
        losses,
        ties,
        matches,
        minutes,
        hours: toHours(minutes),
        winPct: matches ? ((wins / matches) * 100).toFixed(2) : "0.00"
      };
    }).filter((row) => row.matches || row.minutes);
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function exportGamesCsvSingle() {
  const headers = ["date", "groupId", "groupName", "modeId", "modeName", "wins", "losses", "ties", "matches", "minutes", "hours", "winPct"];
  triggerDownload(buildCsv(buildGamesExportRows(), headers), "bookshell-games-export.csv");
}

async function exportGamesZipByMode() {
  const files = {};
  const groupsRows = Object.values(groups || {}).map((g) => ({
    groupId: g.id || "",
    groupName: g.name || "",
    linkedHabitId: g.linkedHabitId || "",
    createdAt: g.createdAt || ""
  }));
  files["games__groups.csv"] = buildCsv(groupsRows, ["groupId", "groupName", "linkedHabitId", "createdAt"]);
  const modeRows = Object.values(modes || {}).map((m) => ({ modeId: m.id, groupId: m.groupId || "", modeName: m.modeName || "", createdAt: m.createdAt || "" }));
  files["games__modes.csv"] = buildCsv(modeRows, ["modeId", "groupId", "modeName", "createdAt"]);
  Object.values(modes || {}).forEach((mode) => {
    const group = groups[mode.groupId] || {};
    const rows = Object.entries(dailyByMode[mode.id] || {}).map(([date, row]) => {
      const wins = Number(row?.wins || 0);
      const losses = Number(row?.losses || 0);
      const ties = Number(row?.ties || 0);
      const matches = wins + losses + ties;
      const minutes = Number(row?.minutes || 0);
      return { date, wins, losses, ties, matches, minutes, hours: toHours(minutes), winPct: matches ? ((wins / matches) * 100).toFixed(2) : "0.00" };
    }).filter((row) => row.matches || row.minutes).sort((a, b) => a.date.localeCompare(b.date));
    const filename = `mode__${sanitizeFileToken(group.name)}__${sanitizeFileToken(mode.modeName)}__${sanitizeFileToken(mode.id)}.csv`;
    files[filename] = buildCsv(rows, ["date", "wins", "losses", "ties", "matches", "minutes", "hours", "winPct"]);
  });
  await downloadZip(files, "bookshell-games-export.zip");
}

async function onGamesExportClick() {
  const choice = prompt(
    "Exportar Juegos:\n1) CSV único\n2) ZIP (por modo)",
    "1"
  );
  if (!choice) return;
  if (choice.trim() === "2") await exportGamesZipByMode();
  else exportGamesCsvSingle();
}


function openModeDetail(modeId) {
  if (!modes[modeId]) return;
  currentModeId = modeId;
  detailMonth = { year: new Date().getFullYear(), month: new Date().getMonth() };
  detailRange = "total";
  selectedDonutKey = "wins";
  renderModeDetail();
  $detailModal.classList.remove("hidden");
  syncModalScrollLock();
}

function closeModeDetail() {
  $detailModal.classList.add("hidden");
  currentModeId = null;
  syncModalScrollLock();
}

async function onListClick(e) {
  const btn = e.target.closest("button[data-action]");
  const card = e.target.closest(".game-card");
  if (card && !btn) {
    openModeDetail(card.dataset.modeId);
    return;
  }
  if (!btn) return;
  const action = btn.dataset.action;
  const modeId = btn.closest(".game-card")?.dataset.modeId || currentModeId;
  const groupIdValue = btn.closest(".game-group")?.dataset.groupId;
  if (action === "loss" && modeId) return patchModeCounter(modeId, "losses", 1);
  if (action === "win" && modeId) return patchModeCounter(modeId, "wins", 1);
  if (action === "tie" && modeId) return patchModeCounter(modeId, "ties", 1);
  if (action === "loss-minus" && modeId) return patchModeCounter(modeId, "losses", -1);
  if (action === "win-minus" && modeId) return patchModeCounter(modeId, "wins", -1);
  if (action === "tie-minus" && modeId) return patchModeCounter(modeId, "ties", -1);
  if (action === "edit-mode" && modeId) {
    if (currentModeId) closeModeDetail();
    return openModeModal(modes[modeId]);
  }
  if (action === "reset-mode" && modeId) return resetMode(modeId);
  if (action === "delete-mode" && modeId) return deleteMode(modeId);
  if (action === "group-menu" && groupIdValue) return handleGroupMenu(groupIdValue);
  if (action === "toggle-session" && groupIdValue) return toggleGroupSession(groupIdValue);
}

function bind() {
  $addMode?.addEventListener("click", () => openModeModal());
  $groupChoice?.addEventListener("change", toggleGroupChoice);
  $modeClose?.addEventListener("click", closeModeModal);
  $modeCancel?.addEventListener("click", closeModeModal);
  $modeModal?.addEventListener("click", (e) => { if (e.target === $modeModal) closeModeModal(); });
  $groupClose?.addEventListener("click", closeGroupModal);
  $groupCancel?.addEventListener("click", closeGroupModal);
  $groupModal?.addEventListener("click", (e) => { if (e.target === $groupModal) closeGroupModal(); });
  $detailClose?.addEventListener("click", closeModeDetail);
  $detailCancel?.addEventListener("click", closeModeDetail);
  $detailModal?.addEventListener("click", (e) => { if (e.target === $detailModal) closeModeDetail(); });

  $modeForm?.addEventListener("submit", async (e) => { e.preventDefault(); await createOrUpdateMode(); });
  $groupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $groupId.value;
    const group = groups[id];
    if (!group) return;
    const payload = {
      name: $groupEditName.value.trim(),
      emoji: ($groupEditEmoji.value || "🎮").trim() || "🎮",
      linkedHabitId: $groupEditHabit.value || null,
      updatedAt: nowTs()
    };
    groups[id] = { ...group, ...payload };
    render();
    await update(ref(db, `${GROUPS_PATH}/${id}`), payload);
    closeGroupModal();
    saveCache();
  });

  $groupsList?.addEventListener("click", onListClick);
  $statsFilter?.addEventListener("change", renderGlobalStats);
  $tabCounters?.addEventListener("click", () => { gamesPanel = "counters"; renderGamesPanel(); });
  $tabStats?.addEventListener("click", () => { gamesPanel = "stats"; renderGamesPanel(); renderGlobalStats(); });
  $gamesExportBtn?.addEventListener("click", onGamesExportClick);

  document.getElementById("game-stats-ranges")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stats-range]");
    if (!btn) return;
    statsRange = btn.dataset.statsRange;
    localStorage.setItem("bookshell-games-stats-range", statsRange);
    document.querySelectorAll("#game-stats-ranges .game-range-btn").forEach((node) => node.classList.toggle("is-active", node === btn));
    renderGlobalStats();
  });

  $detailBody?.addEventListener("click", async (e) => {
    const rangeBtn = e.target.closest("[data-range]");
    if (rangeBtn) {
      detailRange = rangeBtn.dataset.range;
      renderModeDetail();
      return;
    }
    const calBtn = e.target.closest("[data-cal-nav]");
    if (calBtn) {
      detailMonth.month += Number(calBtn.dataset.calNav);
      if (detailMonth.month < 0) { detailMonth.month = 11; detailMonth.year -= 1; }
      if (detailMonth.month > 11) { detailMonth.month = 0; detailMonth.year += 1; }
      renderModeDetail();
      return;
    }
    const day = e.target.closest("[data-day]")?.dataset.day;
    if (day && currentModeId) {
      openDayRecordModal(currentModeId, day);
      return;
    }
    if (e.target.closest("button[data-action]")) onListClick(e);
  });
}

function listenRemote() {
  onValue(ref(db, GROUPS_PATH), (snap) => {
    groups = snap.val() || {};
    if (!localStorage.getItem(OPEN_KEY)) Object.keys(groups).forEach((id) => openGroups.add(id));
    saveCache();
    render();
  });
  onValue(ref(db, MODES_PATH), (snap) => {
    modes = snap.val() || {};
    saveCache();
    render();
    if (currentModeId) renderModeDetail();
  });
  onValue(ref(db, DAILY_PATH), (snap) => {
    dailyByMode = snap.val() || {};
    saveCache();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });
  onValue(ref(db, HABITS_PATH), (snap) => {
    habits = snap.val() || {};
    $groupHabit.innerHTML = habitOptionsHtml();
    $groupEditHabit.innerHTML = habitOptionsHtml();
    if (currentModeId) renderModeDetail();
  });
}
// ✅ Nuevo: solo actualiza el texto del botón de sesión (sin render completo)
function tickSessionButtons() {
  if (!document.getElementById("view-games")?.classList.contains("view-active")) return;

  const running = getRunningSessionState();
  const details = document.querySelectorAll("#games-groups-list .game-group");

  details.forEach((detail) => {
    const groupId = detail.dataset.groupId;
    const g = groups?.[groupId];
    const btn = detail.querySelector(".game-session-btn");
    if (!btn) return;

    const hasRunning = !!(running && g?.linkedHabitId && running.targetHabitId === g.linkedHabitId);
    if (!hasRunning) {
      // No fuerces estado si no está corriendo
      if (btn.textContent.trim() !== "▶ Iniciar") btn.textContent = "▶ Iniciar";
      return;
    }

    const elapsed = formatDuration((Date.now() - Number(running.startTs || Date.now())) / 1000);
    const next = `■ ${elapsed}`;
    if (btn.textContent !== next) btn.textContent = next;
  });
}

function init() {
  if (!$groupsList) return;
  loadCache();
  bind();
  document.querySelectorAll("#game-stats-ranges .game-range-btn").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.statsRange === statsRange));
  listenRemote();
  render();

  if (sessionTick) clearInterval(sessionTick);
  sessionTick = setInterval(tickSessionButtons, 1000); // ✅ antes: render()
}


init();
