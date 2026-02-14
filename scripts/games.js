import { db } from "./firebase-shared.js";
import { ref, onValue, set, update, push, remove, runTransaction, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getRangeBounds, dateFromKey } from "./range-helpers.js";
import { buildCsv, downloadZip, sanitizeFileToken, triggerDownload } from "./export-utils.js";

const VERSION = "2026.02.14.1";
console.log("[games] loaded", VERSION);
window.addEventListener("error", (event) => {
  console.error("[games] runtime error", {
    message: event?.message,
    filename: event?.filename,
    line: event?.lineno,
    column: event?.colno
  });
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[games] unhandled rejection", event?.reason);
});

const GROUPS_PATH = "gameGroups";
const MODES_PATH = "gameModes";
const DAILY_PATH = "gameModeDaily";
const MATCHES_PATH = "gameMatches";
const GAMES_GROUPS_PATH = "games/groups";
const GAMES_MODES_PATH = "games/modes";
const GAMES_MATCHES_PATH = "games/matches";
const AGG_DAY_PATH = "gameAggDay";
const AGG_TOTAL_PATH = "gameAggTotal";
const AGG_RANK_DAY_PATH = "gameAggRankDay";
const AGG_RANK_TOTAL_PATH = "gameAggRankTotal";
const HABITS_PATH = "habits";
const HABIT_SESSIONS_PATH = "habitSessions";
const CACHE_KEY = "bookshell-games-cache:v2";
const OPEN_KEY = "bookshell-games-open-groups";
const HABIT_RUNNING_KEY = "bookshell-habit-running-session";

let groups = {};
let modes = {};
let habits = {};
let habitSessions = {};
let dailyByMode = {};
let aggRankDay = {};
let aggRankTotal = {};
let groupRatings = {};
let modeBases = {};
let matchesByGroup = {};
let matchesByModeId = new Map();
const openGroups = new Set();
let sessionTick = null;
let currentModeId = null;
let detailMonth = { year: new Date().getFullYear(), month: new Date().getMonth() };
let detailRange = "total";
let selectedDonutKey = "wins";
let gamesPanel = "counters";
let statsRange = localStorage.getItem("bookshell-games-stats-range") || "total";
let statsDonutKey = "wins";
const state = {
  gamesRangeKey: "total"
};

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
const $groupEditCategory = document.getElementById("game-group-edit-category");
const $groupEditRankType = document.getElementById("game-group-edit-ranktype");
const $groupEditAccent = document.getElementById("game-group-edit-accent");
const $groupCategory = document.getElementById("game-group-category");
const $groupRankType = document.getElementById("game-group-ranktype");
const $groupAccent = document.getElementById("game-group-accent");

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
const $rankChips = document.getElementById("games-rank-chips");
const $gamesExportBtn = document.getElementById("games-export-btn");
const $tabCounters = document.getElementById("game-tab-counters");
const $tabStats = document.getElementById("game-tab-stats");

let editingModeId = null;

function nowTs() { return Date.now(); }
const clamp = (n, min = 0) => Math.max(min, n);
const MAX_BASE_COUNTER = 1_000_000;
const BASE_COUNTER_FIELDS = ["wins", "losses", "ties", "k", "d", "a", "rf", "ra", "grenades", "throws", "lossesExtra"];
const MATCH_META_FIELDS = new Set(["matchId", "modeId", "groupId", "day", "createdAt", "updatedAt", "result", "resultKey", "ratingDeltaAbs", "ratingDeltaSign", "ratingDeltaFinal"]);

function clampBaseCounter(n, field = "unknown", logClamp = false) {
  const numeric = Number(n);
  const safe = Number.isFinite(numeric) ? Math.round(numeric) : 0;
  const clamped = Math.max(0, Math.min(MAX_BASE_COUNTER, safe));
  if (logClamp && clamped !== safe) console.log("[games] bases:clampHit", { field, input: n, clamped });
  return clamped;
}

const clampStat = (n, field = "stat") => clampBaseCounter(n, field, false);

function normalizeGroupBases(raw = {}, legacy = {}, logClamp = false) {
  const source = { ...legacy, ...raw };
  const normalized = BASE_COUNTER_FIELDS.reduce((acc, field) => {
    acc[field] = clampBaseCounter(source[field], field, logClamp);
    return acc;
  }, {});
  return { ...normalized, updatedAt: Number(source.updatedAt || nowTs()) };
}

function getGroupLegacyBases(groupId) {
  const legacyStatsBase = groups[groupId]?.statsBase || groupRatings[groupId]?.statsBase || {};
  const legacyGroup = groups[groupId] || {};
  return {
    wins: legacyGroup.winsBase,
    losses: legacyGroup.lossesBase,
    ties: legacyGroup.tiesBase,
    k: legacyStatsBase.k,
    d: legacyStatsBase.d,
    a: legacyStatsBase.a,
    rf: legacyGroup.rfBase,
    ra: legacyGroup.raBase,
    grenades: legacyGroup.grenadesBase,
    throws: legacyGroup.throwsBase,
    lossesExtra: legacyGroup.lossesExtraBase,
    updatedAt: legacyStatsBase.updatedAt || legacyGroup.updatedAt
  };
}

function getModeLegacyBases(modeId) {
  const mode = modes[modeId] || {};
  const groupId = mode.groupId;
  const groupLegacy = groupId ? getGroupLegacyBases(groupId) : {};
  return {
    wins: mode.winsBase,
    losses: mode.lossesBase,
    ties: mode.tiesBase,
    k: mode.kBase,
    d: mode.dBase,
    a: mode.aBase,
    rf: mode.rfBase,
    ra: mode.raBase,
    grenades: mode.grenadesBase,
    throws: mode.throwsBase,
    lossesExtra: mode.lossesExtraBase,
    updatedAt: mode.updatedAt || groupLegacy.updatedAt
  };
}

function getModeBases(modeId) {
  const remote = modeBases?.[modeId]?.bases || modeBases?.[modeId] || {};
  return normalizeGroupBases(remote, getModeLegacyBases(modeId));
}

function tsToDay(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return null;
  return dateKeyLocal(d);
}

function normalizeMatchDay(rawDay) {
  if (typeof rawDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDay)) return rawDay;
  if (typeof rawDay === "number" && Number.isFinite(rawDay)) return tsToDay(rawDay);
  if (typeof rawDay === "string") {
    const byTs = Number(rawDay);
    if (Number.isFinite(byTs) && rawDay.trim()) {
      const normalizedTs = tsToDay(byTs);
      if (normalizedTs) return normalizedTs;
    }
    const parsed = new Date(rawDay);
    if (!Number.isNaN(parsed.getTime())) return dateKeyLocal(parsed);
  }
  return null;
}

function normalizeMatchRecord(match, matchId = null, groupId = null) {
  if (!match || typeof match !== "object") return null;
  const normalizedDay = normalizeMatchDay(match.day);
  if (!normalizedDay) {
    console.warn("[games] badDay", { matchId: match?.matchId || matchId || null, originalDay: match.day, modeId: match.modeId, groupId: match.groupId || groupId || null });
    return null;
  }
  const resultKey = String(match.resultKey || "").toLowerCase();
  return {
    ...match,
    matchId: match.matchId || matchId || null,
    groupId: match.groupId || groupId || null,
    day: normalizedDay,
    wins: Number(match.wins ?? (resultKey === "wins" ? 1 : 0)),
    losses: Number(match.losses ?? (resultKey === "losses" ? 1 : 0)),
    ties: Number(match.ties ?? (resultKey === "ties" ? 1 : 0))
  };
}

function rebuildMatchesByModeIndex() {
  matchesByModeId = new Map();
  Object.entries(matchesByGroup || {}).forEach(([groupId, byId]) => {
    Object.entries(byId || {}).forEach(([matchId, rawMatch]) => {
      const match = normalizeMatchRecord(rawMatch, matchId, groupId);
      if (!match?.modeId) return;
      if (!matchesByModeId.has(match.modeId)) matchesByModeId.set(match.modeId, []);
      matchesByModeId.get(match.modeId).push(match);
    });
  });
}

function getMatchesForMode(modeId) {
  return matchesByModeId.get(modeId) || [];
}

function getDayRange(rangeKey, now = new Date()) {
  const today = dateKeyLocal(now);
  if (rangeKey === "total") return { startDay: null, endDay: today };
  const lower = String(rangeKey || "").toLowerCase();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lower === "day") {
    return { startDay: today, endDay: today };
  }
  if (lower === "week") {
    const day = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - day);
    return { startDay: dateKeyLocal(from), endDay: today };
  }
  if (lower === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDay: dateKeyLocal(start), endDay: today };
  }
  if (lower === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { startDay: dateKeyLocal(start), endDay: today };
  }
  return { startDay: null, endDay: today };
}

function getAggregateFieldsForMode(modeId) {
  const fields = new Set(["wins", "losses", "ties", ...BASE_COUNTER_FIELDS, "minutes"]);
  const base = getModeBases(modeId);
  Object.keys(base || {}).forEach((field) => {
    if (field !== "updatedAt") fields.add(field);
  });
  getMatchesForMode(modeId).forEach((match) => {
    Object.entries(match || {}).forEach(([field, value]) => {
      if (MATCH_META_FIELDS.has(field)) return;
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      fields.add(field);
    });
  });
  return Array.from(fields);
}

function computeModeAgg(modeId, rangeKey = "total", now = new Date()) {
  const base = getModeBases(modeId);
  const matchesAll = getMatchesForMode(modeId);
  const includeBase = rangeKey === "total";
  const { startDay, endDay } = getDayRange(rangeKey, now);
  const matches = rangeKey === "total"
    ? matchesAll
    : matchesAll.filter((m) => m?.day && m.day >= startDay && m.day <= endDay);
  const fields = getAggregateFieldsForMode(modeId);
  const out = { gamesCount: matches.length };
  fields.forEach((field) => {
    const sum = matches.reduce((acc, m) => acc + Number(m?.[field] || 0), 0);
    const baseValue = includeBase ? Number(base?.[field] || 0) : 0;
    out[field] = baseValue + sum;
  });
  const mode = modes[modeId];
  const groupRating = normalizeRating(groups[mode?.groupId]?.rating || groupRatings[mode?.groupId]?.rating);
  out.groupRatingValue = Number(groupRating.base || 0) + matches.reduce((acc, m) => acc + Number(m?.ratingDeltaFinal || ((Number(m?.ratingDeltaAbs) || 0) * (Number(m?.ratingDeltaSign) || 0)) || 0), 0);

  console.log("[games] agg:basePolicy", { modeId, rangeKey, includeBase });
  console.log("[games] agg", {
    modeId,
    rangeKey,
    base,
    matchesAll: matchesAll.length,
    matchesInRange: matches.length,
    gamesCount: out.gamesCount,
    sampleDays: matches.slice(0, 3).map((m) => m.day)
  });
  if (!Number.isFinite(out.gamesCount) || out.gamesCount < 0) {
    console.error("[games] agg:invalidGamesCount", { modeId, rangeKey, gamesCount: out.gamesCount });
  }
  if (rangeKey === "year" && matchesAll.length > 0 && matches.length === 0) {
    const uniqueDays = Array.from(new Set(matchesAll.map((m) => m.day))).slice(0, 10);
    console.warn("[games] agg:yearZeroMatches", { modeId, uniqueDays });
  }
  return out;
}

function getCounterTotalsByGroups(groupIds, rangeName = "total", now = new Date()) {
  const modeRows = Object.values(modes || {}).filter((m) => m && (groupIds || []).includes(m.groupId));
  const base = {};
  const sums = {};
  const totals = {};
  modeRows.forEach((mode) => {
    const agg = computeModeAgg(mode.id, rangeName, now);
    const modeBase = getModeBases(mode.id);
    const fields = new Set([...Object.keys(agg), ...Object.keys(modeBase), ...BASE_COUNTER_FIELDS]);
    fields.forEach((field) => {
      if (field === "gamesCount" || field === "groupRatingValue" || field === "updatedAt") return;
      base[field] = Number(base[field] || 0) + Number(modeBase[field] || 0);
      totals[field] = Number(totals[field] || 0) + Number(agg[field] || 0);
      sums[field] = Number(totals[field] || 0) - Number(base[field] || 0);
    });
    totals.gamesCount = Number(totals.gamesCount || 0) + Number(agg.gamesCount || 0);
  });
  return { base, sums, totals };
}
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

function formatWLT({ w = 0, l = 0, t = 0 }) {
  return `${Number(w || 0)}W ${Number(l || 0)}L ${Number(t || 0)}T`;
}

function formatLineRight(matches, w, l, t, wr) {
  const safeWr = Number.isFinite(Number(wr)) ? Number(wr) : 0;
  return `${Number(matches || 0)}  -  ${formatWLT({ w, l, t })}  -  ${safeWr}%`;
}

function getGroupCategory(groupId) {
  const raw = String(groups[groupId]?.category || "other").toLowerCase();
  return raw === "shooter" ? "shooter" : "other";
}

function isShooterMode(modeId) {
  const mode = modes[modeId];
  if (!mode) return false;
  return getGroupCategory(mode.groupId) === "shooter";
}

function getGroupMeta(groupId) {
  return groups[groupId] || {};
}

function getGroupRankType(groupId) {
  const ratingType = String(getGroupMeta(groupId)?.rating?.type || "").toLowerCase();
  if (["elo", "rr"].includes(ratingType)) return ratingType;
  const rankType = String(getGroupMeta(groupId).rankType || "none").toLowerCase();
  return ["elo", "rr"].includes(rankType) ? rankType : "none";
}

function getGroupAccent(groupId) {
  return getGroupMeta(groupId).accent || detectStatsAccent(getGroupMeta(groupId).name || "");
}

function isGroupShooter(groupId) {
  const g = getGroupMeta(groupId);
  if (g?.tags?.shooter) return true;
  return getGroupCategory(groupId) === "shooter";
}

function getRankTypeLabel(rankType) {
  if (rankType === "elo") return "ELO";
  if (rankType === "rr") return "RR";
  return "RANGO";
}

const RR_TIERS = ["Hierro", "Bronce", "Plata", "Oro", "Platino", "Diamante", "Ascendant", "Inmortal", "Radiante"];
const RR_TIER_INDEX = RR_TIERS.reduce((acc, tier, index) => ({ ...acc, [tier.toUpperCase()]: index }), {});

function normalizeRating(raw = {}) {
  const type = ["elo", "rr"].includes(String(raw.type || "none").toLowerCase()) ? String(raw.type).toLowerCase() : "none";
  if (type === "elo") {
    return { type, base: Math.round(Number(raw.base || 0)), tier: null, div: null, updatedAt: Number(raw.updatedAt || nowTs()) };
  }
  if (type === "rr") {
    const tierRaw = String(raw.tier || "Hierro").trim();
    const tier = RR_TIERS.find((t) => t.toUpperCase() === tierRaw.toUpperCase()) || "Hierro";
    const divRaw = Number(raw.div);
    const div = tier === "Radiante" ? null : (Number.isFinite(divRaw) ? Math.max(1, Math.min(3, Math.round(divRaw))) : 1);
    const base = Math.max(0, Math.min(100, Math.round(Number(raw.base || 0))));
    return { type, base, tier, div, updatedAt: Number(raw.updatedAt || nowTs()) };
  }
  return { type: "none", base: 0, tier: null, div: null, updatedAt: Number(raw.updatedAt || nowTs()) };
}

function applyRrDelta(current = {}, delta = 0) {
  const curTier = String(current.tier || "Hierro").toUpperCase();
  let tier =
    RR_TIERS.find((t) => String(t).toUpperCase() === curTier) || "Hierro";

  let div =
    tier === "Radiante"
      ? null
      : (Number.isFinite(Number(current.div))
          ? Math.max(1, Math.min(3, Number(current.div)))
          : 1);

  let rr = Math.max(0, Math.min(100, Math.round(Number((current.rr != null ? current.rr : current.base) || 0))));
  const deltaNum = Math.round(Number(delta || 0));
  const before = { tier, div, rr };

  let idx = RR_TIERS.findIndex((t) => String(t).toUpperCase() === String(tier).toUpperCase());
  if (idx < 0) idx = 0;

  if (deltaNum >= 0) {
    rr += deltaNum;
    while (rr >= 100) {
      if (tier === "Radiante") { rr = 100; break; }
      rr -= 100;

      if (div != null && div < 3) div += 1;
      else {
        idx = Math.min(RR_TIERS.length - 1, idx + 1);
        tier = RR_TIERS[idx];
        if (tier === "Radiante") { div = null; rr = 100; break; }
        div = 1;
      }
    }
  } else {
    const down = Math.abs(deltaNum);

    if (rr > 0) {
      if (down >= rr) {
        rr = 0;
      } else {
        rr -= down;
      }
    } else {
      let x = down;
      while (x > 0) {
        if (tier === "Hierro" && div === 1) {
          rr = 0;
          break;
        }

        if (tier === "Radiante") {
          idx = Math.max(0, idx - 1);
          tier = RR_TIERS[idx];
          div = 3;
        } else if (div != null && div > 1) {
          div -= 1;
        } else {
          idx = Math.max(0, idx - 1);
          tier = RR_TIERS[idx];
          div = tier === "Radiante" ? null : 3;
        }

        if (x >= 100) {
          x -= 100;
          rr = 0;
          continue;
        }

        rr = Math.max(0, Math.min(100, 100 - x));
        x = 0;
      }
    }

    const after = { tier, div, rr: Math.max(0, rr) };
    console.log("[games] rr:down:floorProtection", { before, delta: deltaNum, after });
  }

  if (tier === "Radiante") div = null;
  rr = Math.max(0, Math.min(100, rr));

  return { tier, div, rr, base: rr };
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
function triggerHaptic() {
  try { navigator.vibrate?.(10); } catch (_) {}
}

function habitOptionsHtml() {
  const rows = Object.values(habits || {})
    .filter(h => h && h.id && !h.archived)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

  const opt = ['<option value="">Ninguno</option>'];
  rows.forEach(h => {
    opt.push(`<option value="${h.id}">${h.emoji || "✅"} ${h.name || h.id}</option>`);
  });

  return opt.join("");
}

function groupModes(groupId) {
  return Object.values(modes || {}).filter((m) => m?.groupId === groupId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function groupTotals(groupId) {
  const totals = getCounterTotalsByGroups([groupId], "total").totals;
  return { wins: totals.wins, losses: totals.losses, ties: totals.ties };
}

function groupMinutesTotal(groupId) {
  return groupModes(groupId).reduce((acc, mode) => {
    return acc + Object.values(dailyByMode[mode.id] || {}).reduce((dayAcc, row) => {
      return dayAcc + clamp(Number(row?.minutes || 0));
    }, 0);
  }, 0);
}

function modeTotalsFromDaily(modeId) {
  return Object.values(dailyByMode[modeId] || {}).reduce((acc, row) => {
    acc.wins += Number(row?.wins || 0);
    acc.losses += Number(row?.losses || 0);
    acc.ties += Number(row?.ties || 0);
    acc.k += Number(row?.k || 0);
    acc.d += Number(row?.d || 0);
    acc.a += Number(row?.a || 0);
    acc.rf += Number(row?.rf || 0);
    acc.ra += Number(row?.ra || 0);
    acc.eloDelta += Number(row?.eloDelta || 0);
    acc.rrDelta += Number(row?.rrDelta || 0);
    acc.minutes += clamp(Number(row?.minutes || 0));
    return acc;
  }, { wins: 0, losses: 0, ties: 0, k: 0, d: 0, a: 0, rf: 0, ra: 0, eloDelta: 0, rrDelta: 0, minutes: 0 });
}

function readDayMinutes(rawValue) {
  if (typeof rawValue === "number") return Math.round(Math.max(0, rawValue) / 60);
  if (typeof rawValue === "object") {
    const minRaw = Number(rawValue?.min);
    const secRaw = Number(rawValue?.totalSec);
    if (Number.isFinite(minRaw) && minRaw > 0) return Math.round(minRaw);
    if (Number.isFinite(secRaw) && secRaw > 0) return Math.round(secRaw / 60);
  }
  return 0;
}

function getModePlayedMinutes(mode) {
  return Object.values(dailyByMode[mode.id] || {}).reduce((acc, row) => acc + clamp(Number(row?.minutes || 0)), 0);
}

function buildModeCard(mode, groupEmoji) {
  const rangeKey = state.gamesRangeKey || "total";
  const agg = computeModeAgg(mode.id, rangeKey, new Date());
  console.log("[games] miniCard", { modeId: mode.id, rangeKey, agg });
  const wins = clamp(Number(agg.wins || 0));
  const losses = clamp(Number(agg.losses || 0));
  const ties = clamp(Number(agg.ties || 0));
  const totalGames = wins + losses + ties;
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
    <div class="game-card-total">${formatLineRight(total, wins, losses, ties, winPct)}</div>
    <div class="game-card-content">
      <div class="game-side left">
        <button class="game-thumb-btn-losses" data-action="loss" title="Derrota">👎</button>
        <div class="game-side-stat-losses">${losses} - ${lossPct}%</div>
      </div>
      <div class="game-center">
        <div class="game-mode-name">${mode.modeName || "Modo"}</div>
        <button class="game-mode-emoji game-mode-emoji-btn" data-action="tie" title="Empate">${emoji}</button>
      </div>
      <div class="game-side right">
        <div class="game-side-stat-wins">${winPct}% - ${wins}</div>
        <button class="game-thumb-btn-wins" data-action="win" title="Victoria">👍</button>
      </div>
    </div>
    <div class="game-bottom-tie">${totalGames} - ${wins}W ${losses}L ${ties}T - ${winPct}%</div>
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
    acc.k += Number(row?.k || 0);
    acc.d += Number(row?.d || 0);
    acc.a += Number(row?.a || 0);
    acc.rf += Number(row?.rf || 0);
    acc.ra += Number(row?.ra || 0);
    acc.eloDelta += Number(row?.eloDelta || 0);
    acc.rrDelta += Number(row?.rrDelta || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0, k: 0, d: 0, a: 0, rf: 0, ra: 0, eloDelta: 0, rrDelta: 0 });
}

function mergeDailyMaps(modeIds) {
  return modeIds.reduce((acc, modeId) => {
    Object.entries(dailyByMode[modeId] || {}).forEach(([day, row]) => {
      const prev = acc[day] || { wins: 0, losses: 0, ties: 0 };
      prev.wins += Number(row?.wins || 0);
      prev.losses += Number(row?.losses || 0);
      prev.ties += Number(row?.ties || 0);
      prev.minutes = Number(prev.minutes || 0) + clamp(Number(row?.minutes || 0));
      prev.k = Number(prev.k || 0) + Number(row?.k || 0);
      prev.d = Number(prev.d || 0) + Number(row?.d || 0);
      prev.a = Number(prev.a || 0) + Number(row?.a || 0);
      prev.rf = Number(prev.rf || 0) + Number(row?.rf || 0);
      prev.ra = Number(prev.ra || 0) + Number(row?.ra || 0);
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
    const row = dailyMap[key] || {};
    out.push([key, {
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      ties: Number(row.ties || 0),
      minutes: clamp(Number(row.minutes || 0))
    }]);
  }
  return out;
}

function createGamesLineOption(points) {
  return {
    animation: false,
    grid: { left: 34, right: 14, top: 18, bottom: 20 },

    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6,10,24,.96)",
      borderColor: "rgba(152,178,255,.3)",
      textStyle: { color: "#EAF2FF" }
    },

    xAxis: {
      type: "category",
      data: points.map(([d]) => String(d || "").slice(5)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(166,188,255,.25)" } },
      axisLabel: { color: "rgba(225,235,255,.72)", fontSize: 10 }
    },

    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "rgba(154,176,255,.12)" } }
    },

    series: [
      {
        name: "Derrotas",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map(([, v]) => v.losses || 0),
        lineStyle: { width: 2.2, color: "rgba(255,90,110,.92)" }
      },
      {
        name: "Empates",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map(([, v]) => v.ties || 0),
        lineStyle: { width: 1.4, color: "rgba(177,190,210,.88)" },
        areaStyle: { color: "rgba(177,190,210,.08)" }
      },
      {
        name: "Victorias",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map(([, v]) => v.wins || 0),
        lineStyle: { width: 2.2, color: "rgba(64,235,151,.95)" }
      }
    ]
  };
}

function renderLineChart($el, points, chartRef = "stats") {
  if (!$el) return;
  $el.style.minHeight = "220px";
  const hasData = points.some(([, v]) => Number(v.wins || 0) || Number(v.losses || 0) || Number(v.ties || 0));
  let chart = chartRef === "stats" ? statsLineChart : detailLineChart;
  if (chart && chart.getDom?.() !== $el) {
    chart.dispose();
    chart = null;
    if (chartRef === "stats") statsLineChart = null;
    else detailLineChart = null;
  }
  if (!hasData) {
    chart?.dispose();
    if (chartRef === "stats") statsLineChart = null;
    else detailLineChart = null;
    if (!$el.querySelector('.empty-state')) $el.innerHTML = "<div class='empty-state small'>Sin datos...</div>";
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

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v ?? 0);
}

function renderKpiPanel(tot = {}) {
  setText("kpi-k", tot.k || 0);
  setText("kpi-d", tot.d || 0);
  setText("kpi-a", tot.a || 0);
  setText("kpi-w", tot.w || 0);
  setText("kpi-rf", tot.rf || 0);
  setText("kpi-ra", tot.ra || 0);
}

function getGroupMatchesSorted(groupId) {
  const byId = matchesByGroup[groupId] || {};
  return Object.entries(byId)
    .map(([matchId, m]) => normalizeMatchRecord(m, matchId, groupId))
    .filter(Boolean)
    .sort((a, b) => {
      const dayCmp = String(a.day || "").localeCompare(String(b.day || ""));
      if (dayCmp) return dayCmp;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
}

function getMatchRatingDelta(match) {
  const abs = Number(match?.ratingDeltaAbs);
  const sign = Number(match?.ratingDeltaSign);
  if (!Number.isFinite(abs) || !Number.isFinite(sign)) return 0;
  return Math.round(abs * sign);
}

function formatRrMain(state = {}) {
  const divTxt = state?.div ? ` ${state.div}` : "";
  return `${String(state?.tier || "Hierro").toUpperCase()}${divTxt} · ${Math.max(0, Math.round(Number(state?.base || 0)))}/100`;
}

function rrPeakScore(state = {}) {
  const idx = RR_TIER_INDEX[String(state?.tier || "HIERRO").toUpperCase()] || 0;
  if (String(state?.tier || "").toUpperCase() === "RADIANTE") return (idx * 300) + Number(state?.base || 0);
  const div = Math.max(1, Math.min(3, Number(state?.div || 1)));
  return (idx * 300) + ((div - 1) * 100) + Number(state?.base || 0);
}

function buildGroupRatingKpi(groupId, range) {
  const rating = normalizeRating(groups[groupId]?.rating || groupRatings[groupId]?.rating);
  if (rating.type === "none") return null;
  const matches = getGroupMatchesSorted(groupId);
  if (rating.type === "elo") {
    const totalDelta = matches.reduce((acc, m) => acc + getMatchRatingDelta(m), 0);
    let value = Math.round(Number(rating.base || 0));
    let peakAllTime = value;
    let peakRange = value;
    matches.forEach((match) => {
      value += getMatchRatingDelta(match);
      peakAllTime = Math.max(peakAllTime, value);
      const d = dateFromKey(match.day);
      const inRange = !(range?.start && d < range.start) && !(range?.endExclusive && d >= range.endExclusive);
      if (inRange) peakRange = Math.max(peakRange, value);
    });
    const current = Math.round(Number(rating.base || 0) + totalDelta);
    return {
      typeLabel: "ELO",
      main: `${current}`,
      sub: (!range?.start && !range?.endExclusive)
        ? `Peak: ${peakAllTime}`
        : `Peak: ${peakAllTime}`
    };
  }

  let cur = normalizeRating(rating);
  let peakAllState = { ...cur };
  let peakRangeState = { ...cur };
  matches.forEach((match) => {
    cur = normalizeRating({ ...cur, ...applyRrDelta(cur, getMatchRatingDelta(match)) });
    if (rrPeakScore(cur) > rrPeakScore(peakAllState)) peakAllState = { ...cur };
    const d = dateFromKey(match.day);
    const inRange = !(range?.start && d < range.start) && !(range?.endExclusive && d >= range.endExclusive);
    if (inRange && rrPeakScore(cur) > rrPeakScore(peakRangeState)) peakRangeState = { ...cur };
  });

  return {
    typeLabel: "RR",
    main: formatRrMain(cur),
    sub: (!range?.start && !range?.endExclusive)
      ? `Peak: ${formatRrMain(peakAllState)}`
      : `Peak: ${formatRrMain(peakAllState)}`
  };
}

function groupRatingSnapshot(groupId, range) {
  return buildGroupRatingKpi(groupId, range);
}

function getBaseInputValue(modal, selector, field) {
  const raw = modal.querySelector(selector)?.value;
  const value = raw === "" ? 0 : Number(raw);
  return clampBaseCounter(Number.isFinite(value) ? value : 0, field, true);
}

async function openGroupBasesModal(groupId, modeId = null) {
  const resolvedModeId = modeId || currentModeId || getGroupTargetModeId(groupId);
  if (!resolvedModeId || !modes[resolvedModeId]) return;
  const currentBases = getModeBases(resolvedModeId);
  const currentRating = normalizeRating(groups[groupId]?.rating || groupRatings[groupId]?.rating);
  const showRating = currentRating.type !== "none";
  const modeLabel = modes[resolvedModeId]?.modeName || "Modo";

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal habit-modal base-modal" role="dialog" aria-modal="true">
    <div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title">Bases · ${modeLabel}</div>
      <button class="icon-btn" type="button" data-close>✕</button>
    </div>
    <div class="modal-scroll sheet-body">
      ${showRating ? `<section class="base-section"><strong>Rating del grupo</strong>
        <div class="form-grid row-3">
          ${currentRating.type === "elo" ? `<label class="field"><span class="field-label">ELO base</span><input id="games-base-rating" type="number" min="0" max="1000000" step="1" value="${currentRating.base}" inputmode="numeric"></label>` : `<label class="field"><span class="field-label">RR base</span><input id="games-base-rating" type="number" min="0" max="100" step="1" value="${currentRating.base}" inputmode="numeric"></label>
          <label class="field"><span class="field-label">Tier</span><select id="games-base-tier">${RR_TIERS.map((tier) => `<option value="${tier}" ${tier === currentRating.tier ? "selected" : ""}>${tier}</option>`).join("")}</select></label>
          <label class="field"><span class="field-label">Division</span><input id="games-base-div" type="number" min="1" max="3" step="1" value="${currentRating.div || 1}" inputmode="numeric"></label>`}
        </div></section>` : ""}
      <details class="base-section" open><summary>W/L/T base</summary><div class="base-modal-grid">
        <label class="base-field"><span>Wins</span><input id="games-base-wins" type="number" min="0" max="1000000" step="1" value="${currentBases.wins}" inputmode="numeric"></label>
        <label class="base-field"><span>Losses</span><input id="games-base-losses" type="number" min="0" max="1000000" step="1" value="${currentBases.losses}" inputmode="numeric"></label>
        <label class="base-field"><span>Ties</span><input id="games-base-ties" type="number" min="0" max="1000000" step="1" value="${currentBases.ties}" inputmode="numeric"></label>
      </div></details>
      <details class="base-section" open><summary>K/D/A base</summary><div class="base-modal-grid">
        <label class="base-field"><span>Kills (K)</span><input id="games-base-k" type="number" min="0" max="1000000" step="1" value="${currentBases.k}" inputmode="numeric"></label>
        <label class="base-field"><span>Deaths (D)</span><input id="games-base-d" type="number" min="0" max="1000000" step="1" value="${currentBases.d}" inputmode="numeric"></label>
        <label class="base-field"><span>Assists (A)</span><input id="games-base-a" type="number" min="0" max="1000000" step="1" value="${currentBases.a}" inputmode="numeric"></label>
      </div></details>
      <details class="base-section" open><summary>Rondas base</summary><div class="base-modal-grid">
        <label class="base-field"><span>Rondas a favor</span><input id="games-base-rf" type="number" min="0" max="1000000" step="1" value="${currentBases.rf}" inputmode="numeric"></label>
        <label class="base-field"><span>Rondas en contra</span><input id="games-base-ra" type="number" min="0" max="1000000" step="1" value="${currentBases.ra}" inputmode="numeric"></label>
      </div></details>
      
    </div>
    <div class="modal-footer sheet-footer base-modal-footer">
      <button class="btn ghost" type="button" data-close>Cancelar</button>
      <button class="btn primary" type="button" data-save>Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  syncModalScrollLock();

  const close = () => {
    modal.remove();
    syncModalScrollLock();
  };

  modal.addEventListener("click", async (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) {
      close();
      return;
    }
    if (!e.target.closest("[data-save]")) return;

    const bases = normalizeGroupBases({
      wins: getBaseInputValue(modal, "#games-base-wins", "wins"),
      losses: getBaseInputValue(modal, "#games-base-losses", "losses"),
      ties: getBaseInputValue(modal, "#games-base-ties", "ties"),
      k: getBaseInputValue(modal, "#games-base-k", "k"),
      d: getBaseInputValue(modal, "#games-base-d", "d"),
      a: getBaseInputValue(modal, "#games-base-a", "a"),
      rf: getBaseInputValue(modal, "#games-base-rf", "rf"),
      ra: getBaseInputValue(modal, "#games-base-ra", "ra"),
      grenades: getBaseInputValue(modal, "#games-base-grenades", "grenades"),
      throws: getBaseInputValue(modal, "#games-base-throws", "throws"),
      lossesExtra: getBaseInputValue(modal, "#games-base-losses-extra", "lossesExtra"),
      updatedAt: nowTs()
    }, {}, true);

    const updates = { [`${GAMES_MODES_PATH}/${resolvedModeId}/bases`]: bases };
    modeBases[resolvedModeId] = { ...(modeBases[resolvedModeId] || {}), bases };

    if (showRating) {
      let nextRating = currentRating;
      if (currentRating.type === "elo") {
        nextRating = normalizeRating({ ...currentRating, base: clampBaseCounter(modal.querySelector("#games-base-rating")?.value || 0, "rating", true), updatedAt: nowTs() });
      } else {
        const tier = modal.querySelector("#games-base-tier")?.value || currentRating.tier;
        const divVal = Math.round(Number(modal.querySelector("#games-base-div")?.value || 1));
        nextRating = normalizeRating({
          ...currentRating,
          base: Math.max(0, Math.min(100, Math.round(Number(modal.querySelector("#games-base-rating")?.value || 0)))),
          tier,
          div: tier === "Radiante" ? null : Math.max(1, Math.min(3, divVal)),
          updatedAt: nowTs()
        });
      }
      updates[`${GAMES_GROUPS_PATH}/${groupId}/rating`] = nextRating;
      groups[groupId] = { ...(groups[groupId] || {}), rating: nextRating };
    }

    await update(ref(db), updates);
    renderGlobalStats();
    if (currentModeId && modes[currentModeId]?.groupId === groupId) renderModeDetail();
    close();
  });
}

function renderRankChips(selectedGroupId, range) {
  if (!$rankChips) return;
  const groupRows = Object.values(groups || {}).filter((g) => g?.id && normalizeRating(g.rating).type !== "none");
  const targets = selectedGroupId === "all" ? groupRows : groupRows.filter((g) => g.id === selectedGroupId);
  if (!targets.length) {
    $rankChips.innerHTML = "";
    return;
  }

  $rankChips.innerHTML = targets.map((group) => {
    const snapshot = groupRatingSnapshot(group.id, range);
    if (!snapshot) return "";
    return `<button class="games-rank-chip" type="button" data-group-id="${group.id}">
      <div class="games-rank-chip-top">
        <span class="games-rank-chip-game">${group.name || "Grupo"}</span>
        <span class="games-rank-chip-type">${snapshot.typeLabel}</span>
      </div>
      <div class="games-rank-chip-main">${snapshot.main}</div>
      <div class="games-rank-chip-sub">${snapshot.sub}</div>
    </button>`;
  }).join("");

  targets.forEach((group) => {
    const chip = $rankChips.querySelector(`[data-group-id="${group.id}"]`);
    if (!chip) return;
    const accent = getGroupAccent(group.id);
    chip.style.background = `radial-gradient(circle at top, color-mix(in srgb, ${accent} 28%, transparent), rgba(255,255,255,0.02))`;
    chip.style.borderColor = `color-mix(in srgb, ${accent} 35%, rgba(255,255,255,0.08))`;
    chip.addEventListener("click", () => { openGroupBasesModal(group.id, getGroupTargetModeId(group.id)).catch((err) => console.error("[games] bases:edit:error", err)); });
  });
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
  const selectedGroupIds = selected === "all"
    ? Object.values(groups || {}).map((g) => g?.id).filter(Boolean)
    : [selected].filter(Boolean);
  const modeIds = modeRows.map((m) => m.id);
  const now = new Date();
  const range = getRangeBounds(statsRange, now, getMinDataDate(modeIds));
  const dayRange = getDayRange(statsRange, now);
  console.log("[games] range", { rangeKey: statsRange, startDay: dayRange.startDay, endDay: dayRange.endDay });
  const mergedDaily = mergeDailyMaps(modeIds);
  const points = buildDailySeries(mergedDaily, range);
  const totals = sumInRange(mergedDaily, range.start, range.endExclusive);
  const counterTotals = getCounterTotalsByGroups(selectedGroupIds, statsRange, now);
  totals.wins = counterTotals.totals.wins;
  totals.losses = counterTotals.totals.losses;
  totals.ties = counterTotals.totals.ties;
  totals.k = counterTotals.totals.k;
  totals.d = counterTotals.totals.d;
  totals.a = counterTotals.totals.a;
  totals.rf = counterTotals.totals.rf;
  totals.ra = counterTotals.totals.ra;
  console.log("[games] bases:kpis", {
    groupId: selected,
    range: statsRange,
    base: counterTotals.base,
    sums: counterTotals.sums,
    totals: counterTotals.totals
  });
  renderRankChips(selected, range);

  const byGroup = selectedGroupIds.reduce((acc, gId) => {
    const totalsByGroup = getCounterTotalsByGroups([gId], statsRange, now).totals;
    acc[gId] = { wins: totalsByGroup.wins, losses: totalsByGroup.losses, ties: totalsByGroup.ties };
    return acc;
  }, {});

  const byMode = modeRows.map((m) => {
    const stats = computeModeAgg(m.id, statsRange, now);
    const pct = ensurePct(stats.wins, stats.losses, stats.ties);
    return { mode: m, stats, pct };
  }).sort((a, b) => b.pct.total - a.pct.total);

  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  if ($statsTotals) {
    const shooterText = (totals.k || totals.d || totals.a || totals.rf || totals.ra)
      ? ` - K ${totals.k} D ${totals.d} A ${totals.a} - R ${totals.rf}-${totals.ra}`
      : "";
    $statsTotals.textContent = `${pct.total} partidas - ${totals.wins}W / ${totals.losses}L / ${totals.ties}T - ${pct.winPct}%W${shooterText}`;
  }
  if ($statsSub) $statsSub.textContent = selected === "all" ? "Global" : (groups[selected]?.name || "Grupo");
  renderKpiPanel({ k: totals.k, d: totals.d, a: totals.a, w: totals.wins, rf: totals.rf, ra: totals.ra });
  renderDonut($statsDonut, totals, true, "stats");
  renderLineChart($statsLine, points, "stats");

  if ($statsBreakdown) {
    const topWin = [...byMode].sort((a, b) => b.pct.winPct - a.pct.winPct)[0];
    const topPlays = byMode[0];
    const breakdownRows = byMode.map((entry) => ({
      mode: entry.mode.modeName || "Modo",
      groupCategory: isGroupShooter(entry.mode.groupId) ? "shooter" : "other",
      matches: entry.pct.total,
      wins: entry.stats.wins,
      losses: entry.stats.losses,
      ties: entry.stats.ties,
      winrate: entry.pct.winPct,
      k: Number(entry.stats.k || 0),
      d: Number(entry.stats.d || 0),
      a: Number(entry.stats.a || 0),
      rf: Number(entry.stats.rf || 0),
      ra: Number(entry.stats.ra || 0),
      accent: detectStatsAccent(`${groups[entry.mode.groupId]?.name || ""} ${entry.mode.modeName || ""}`)
    }));

    const groupRows = Object.entries(byGroup).map(([gId, v]) => {
      const gp = ensurePct(v.wins, v.losses, v.ties);
      return {
        label: groups[gId]?.name || "Sin grupo",
        matches: gp.total,
        wins: v.wins,
        losses: v.losses,
        ties: v.ties,
        winrate: gp.winPct,
        accent: getGroupAccent(gId)
      };
    }).sort((a, b) => b.matches - a.matches);

    const modeRowsTop = byMode.slice(0, 5).map((entry) => ({
      label: entry.mode.modeName || "Modo",
      matches: entry.pct.total,
      wins: entry.stats.wins,
      losses: entry.stats.losses,
      ties: entry.stats.ties,
      winrate: entry.pct.winPct,
      accent: detectStatsAccent(`${groups[entry.mode.groupId]?.name || ""} ${entry.mode.modeName || ""}`)
    }));

    const topRows = [
      topWin ? {
        label: "Mejor winrate",
        matches: topWin.pct.total,
        wins: topWin.stats.wins,
        losses: topWin.stats.losses,
        ties: topWin.stats.ties,
        winrate: topWin.pct.winPct,
        accent: detectStatsAccent(`${groups[topWin.mode.groupId]?.name || ""} ${topWin.mode.modeName || ""}`)
      } : null,
      topPlays ? {
        label: "Mas jugado",
        matches: topPlays.pct.total,
        wins: topPlays.stats.wins,
        losses: topPlays.stats.losses,
        ties: topPlays.stats.ties,
        winrate: topPlays.pct.winPct,
        accent: detectStatsAccent(`${groups[topPlays.mode.groupId]?.name || ""} ${topPlays.mode.modeName || ""}`)
      } : null
    ].filter(Boolean);

    $statsBreakdown.innerHTML = [
      renderBreakdownStatsCard(breakdownRows),
      renderStatsListCard("Por grupo", groupRows),
      renderStatsListCard("Por modo", modeRowsTop),
      renderStatsListCard("Top", topRows)
    ].join("");
  }
}

function renderBreakdownStatsCard(list) {
  const content = list.length ? list.map((x) => `
    <div class="stats-line" style="${buildStatsGlowStyle(x.accent)}">
      <b>${x.mode}</b>
      <span>${formatLineRight(x.matches, x.wins, x.losses, x.ties, x.winrate)}</span>
    </div>
    ${x.groupCategory === "shooter" && x.matches > 0 ? `<div class="stats-line-sub">K ${x.k} - D ${x.d} - A ${x.a} - R ${x.rf}-${x.ra}</div>` : ""}
  `).join("") : `<div class="games-stats-empty">Sin datos</div>`;
  return renderStatsFold({
    id: "breakdown",
    title: "Desglose",
    subtitle: `${list.length} modos`,
    body: content,
    open: true
  });
}

function renderStatsListCard(title, list) {
  const rows = list.length ? list.map((entry) => `
    <div class="stats-line" style="${buildStatsGlowStyle(entry.accent)}">
      <b>${entry.label}</b>
      <span>${formatLineRight(entry.matches, entry.wins, entry.losses, entry.ties, entry.winrate)}</span>
    </div>
  `).join("") : `<div class="games-stats-empty">Sin datos</div>`;
  return renderStatsFold({
    id: slugifyStatsFold(title),
    title,
    subtitle: `${list.length} filas`,
    body: rows
  });
}

function renderStatsFold({ id, title, subtitle, body, open = false }) {
  return `
    <div class="stats-fold">
      <button class="stats-fold-head" type="button" data-fold-toggle="${id}" aria-expanded="${open ? "true" : "false"}">
        <span>${title}</span>
        <span class="stats-fold-sub">${subtitle}</span>
      </button>
      <div class="stats-fold-body${open ? " open" : ""}" id="fold-${id}">
        ${body}
      </div>
    </div>
  `;
}

function slugifyStatsFold(value) {
  return String(value || "stats")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "stats";
}

function toggleStatsFold(id) {
  const body = document.getElementById(`fold-${id}`);
  if (!body) return;
  body.classList.toggle("open");
  const isOpen = body.classList.contains("open");
  $statsBreakdown?.querySelector(`[data-fold-toggle="${id}"]`)?.setAttribute("aria-expanded", String(isOpen));
}

function detectStatsAccent(source) {
  const val = String(source || "").toLowerCase();
  if (/cs2|counter|csgo/.test(val)) return "#22c55e";
  if (/valorant/.test(val)) return "#ef4444";
  if (/fortnite/.test(val)) return "#60a5fa";
  if (/league|lol/.test(val)) return "#f59e0b";
  if (/apex/.test(val)) return "#fb7185";
  return "#8b5cf6";
}

function buildStatsGlowStyle(accent) {
  const color = accent || "#8b5cf6";
  return `background: radial-gradient(circle at top, color-mix(in srgb, ${color} 25%, transparent), rgba(255,255,255,0.02)); border-color: color-mix(in srgb, ${color} 30%, rgba(255,255,255,0.05));`;
}

function setGamesTab(tab) {
  gamesPanel = tab === "stats" ? "stats" : "counters";
  state.gamesRangeKey = gamesPanel === "stats" ? (statsRange || "total") : "total";
  console.log("[games] tab:set", { tab: gamesPanel });
  const isStats = gamesPanel === "stats";
  $tabCounters?.classList.toggle("is-active", !isStats);
  $tabCounters?.setAttribute("aria-selected", String(!isStats));
  $tabStats?.classList.toggle("is-active", isStats);
  $tabStats?.setAttribute("aria-selected", String(isStats));
}

function renderGamesList() {
  renderGamesPanel();
}

function renderStats() {
  renderGlobalStats();
}

function refreshOpenModeModal() {
  if (currentModeId) renderModeDetail();
}

function renderGamesPanel() {
  setGamesTab(gamesPanel);
  const stats = gamesPanel === "stats";
  $statsCard?.classList.toggle("hidden", !stats);
  $groupsList?.classList.toggle("hidden", stats);
  $empty?.classList.toggle("hidden", stats || Object.values(groups || {}).some((g) => g?.id));
  if (!$groupsList) return;
  const groupRows = Object.values(groups || {})
    .filter((g) => g?.id)
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0) || (a.name || "").localeCompare(b.name || "", "es"));
  $groupsList.innerHTML = "";
  if ($empty) $empty.style.display = groupRows.length ? "none" : "block";
  const running = getRunningSessionState();

  groupRows.forEach((g) => {
    const groupedModes = groupModes(g.id);
    const { wins, losses, ties } = groupTotals(g.id);
    const totalMinutes = groupMinutesTotal(g.id);
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
          <div class="game-group-meta">${losses}L / ${wins}W / ${ties}T - ${lossPct}% - ${winPct}% - ${formatHoursMinutes(totalMinutes)}</div>
        </div>
        <div class="game-group-actions">
          <button class="game-session-btn" data-action="toggle-session">${hasRunning ? `${elapsed}` : "Iniciar"}</button>
          <button class="game-menu-btn" data-action="group-menu">...</button>
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
  renderGlobalStats();
}

function render() {
  renderGamesList();
  if (currentModeId && !modes[currentModeId]) closeModeDetail();
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
  if ($groupCategory) $groupCategory.value = "other";
  if ($groupRankType) $groupRankType.value = "none";
  if ($groupAccent) $groupAccent.value = "#8b5cf6";
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
  if ($groupEditCategory) $groupEditCategory.value = getGroupCategory(g.id);
  if ($groupEditRankType) $groupEditRankType.value = getGroupRankType(g.id);
  if ($groupEditAccent) $groupEditAccent.value = g.accent || "#8b5cf6";
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
  const $groupCategoryWrap = document.getElementById("game-group-category-wrap");
  if ($groupCategoryWrap) $groupCategoryWrap.style.display = isNew ? "block" : "none";
  const $groupRankTypeWrap = document.getElementById("game-group-ranktype-wrap");
  if ($groupRankTypeWrap) $groupRankTypeWrap.style.display = isNew ? "block" : "none";
  const $groupAccentWrap = document.getElementById("game-group-accent-wrap");
  if ($groupAccentWrap) $groupAccentWrap.style.display = isNew ? "block" : "none";
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
      category: ($groupCategory?.value || "other"),
      tags: { shooter: ($groupCategory?.value || "other") === "shooter" },
      rankType: ($groupRankType?.value || "none"),
      rating: normalizeRating({ type: ($groupRankType?.value || "none"), base: 0, tier: "Hierro", div: 1 }),
      accent: $groupAccent?.value || "#8b5cf6",
      createdAt: nowTs(),
      updatedAt: nowTs()
    };
    groupIdValue = groupPayload.id;
    groups[groupPayload.id] = groupPayload;
    await set(groupIdRef, groupPayload);
    await update(ref(db), {
      [`${GAMES_GROUPS_PATH}/${groupPayload.id}/rating`]: groupPayload.rating
    });
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
    const basePayload = normalizeGroupBases({});
    modeBases[payload.id] = { bases: basePayload };
    await set(ref(db, `${GAMES_MODES_PATH}/${payload.id}/bases`), basePayload);
  }
  saveCache();
  closeModeModal();
  render();
}



function resultKeyFromCode(result) {
  if (result === "W") return "wins";
  if (result === "L") return "losses";
  return "ties";
}

function normalizeShooterPayload(raw = {}) {
  return {
    k: clampStat(raw.k),
    d: clampStat(raw.d),
    a: clampStat(raw.a),
    rf: clampStat(raw.rf),
    ra: clampStat(raw.ra)
  };
}

async function addMatchWithStats(modeId, result, options = {}) {
  const mode = modes[modeId];
  if (!mode) return;
  const day = options.day || todayKey();
  const statKey = resultKeyFromCode(result);
  const groupId = mode.groupId;
  const rankType = getGroupRankType(groupId);
  const rankDelta = Math.round(Number(options.rankDelta || 0));
  const isShooter = isGroupShooter(groupId);
  const shooter = isShooter ? normalizeShooterPayload(options) : { k: 0, d: 0, a: 0, rf: 0, ra: 0 };

  await runTransaction(ref(db, `${DAILY_PATH}/${modeId}/${day}`), (current) => {
    const base = current || {};
    return {
      wins: clamp(Number(base.wins || 0) + (statKey === "wins" ? 1 : 0)),
      losses: clamp(Number(base.losses || 0) + (statKey === "losses" ? 1 : 0)),
      ties: clamp(Number(base.ties || 0) + (statKey === "ties" ? 1 : 0)),
      minutes: clamp(Number(base.minutes || 0)),
      k: clamp(Number(base.k || 0) + shooter.k),
      d: clamp(Number(base.d || 0) + shooter.d),
      a: clamp(Number(base.a || 0) + shooter.a),
      rf: clamp(Number(base.rf || 0) + shooter.rf),
      ra: clamp(Number(base.ra || 0) + shooter.ra)
    };
  });

  const payload = { matches: 1, w: result === "W" ? 1 : 0, l: result === "L" ? 1 : 0, t: result === "T" ? 1 : 0, ...shooter };
  const jobs = [
    runTransaction(ref(db, `${AGG_DAY_PATH}/${day}/${groupId}/${modeId}`), (current) => {
      const base = current || {};
      return {
        matches: clamp(Number(base.matches || 0) + payload.matches),
        w: clamp(Number(base.w || 0) + payload.w),
        l: clamp(Number(base.l || 0) + payload.l),
        t: clamp(Number(base.t || 0) + payload.t),
        k: clamp(Number(base.k || 0) + payload.k),
        d: clamp(Number(base.d || 0) + payload.d),
        a: clamp(Number(base.a || 0) + payload.a),
        rf: clamp(Number(base.rf || 0) + payload.rf),
        ra: clamp(Number(base.ra || 0) + payload.ra)
      };
    }),
    runTransaction(ref(db, `${AGG_TOTAL_PATH}/${groupId}/${modeId}`), (current) => {
      const base = current || {};
      return {
        matches: clamp(Number(base.matches || 0) + payload.matches),
        w: clamp(Number(base.w || 0) + payload.w),
        l: clamp(Number(base.l || 0) + payload.l),
        t: clamp(Number(base.t || 0) + payload.t),
        k: clamp(Number(base.k || 0) + payload.k),
        d: clamp(Number(base.d || 0) + payload.d),
        a: clamp(Number(base.a || 0) + payload.a),
        rf: clamp(Number(base.rf || 0) + payload.rf),
        ra: clamp(Number(base.ra || 0) + payload.ra)
      };
    })
  ];

  if (rankType !== "none") {
    jobs.push(
      runTransaction(ref(db, `${AGG_RANK_DAY_PATH}/${day}/${groupId}`), (current) => {
        const base = current || {};
        const next = { ...base, delta: Number(base.delta || 0) + rankDelta };
        if (rankType === "elo") next.elo = Number(base.elo || 0) + rankDelta;
        if (rankType === "days") next.days = Math.max(0, Number(base.days || 0) + rankDelta);
        if (rankType === "rr") {
          const rrState = applyRrDelta(base, rankDelta);
          next.tier = rrState.tier;
          next.div = rrState.div;
          next.rr = rrState.rr;
        }
        return next;
      }),
      runTransaction(ref(db, `${AGG_RANK_TOTAL_PATH}/${groupId}`), (current) => {
        const base = current || {};
        const next = { ...base, delta: Number(base.delta || 0) + rankDelta };
        if (rankType === "elo") next.elo = Number(base.elo || 0) + rankDelta;
        if (rankType === "days") next.days = Math.max(0, Number(base.days || 0) + rankDelta);
        if (rankType === "rr") {
          const rrState = applyRrDelta(base, rankDelta);
          next.tier = rrState.tier;
          next.div = rrState.div;
          next.rr = rrState.rr;
        }
        return next;
      })
    );
  }

  await Promise.all(jobs);

  if (isShooter || rankType !== "none") {
    const matchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await set(ref(db, `${MATCHES_PATH}/${day}/${groupId}/${modeId}/${matchId}`), {
      ts: Date.now(),
      result,
      ...shooter,
      rankDelta
    });
  }

  triggerHaptic();
}

function openResultModal(modeId, result) {
  const mode = modes[modeId];
  if (!mode) return Promise.resolve(false);
  const group = groups[mode.groupId] || {};
  const rankType = getGroupRankType(mode.groupId);
  const shooter = isGroupShooter(mode.groupId);
  const rankLabel = rankType === "elo" ? "Delta ELO" : "Delta RR";
  const rankPlaceholder = rankType === "elo" ? "ELO" : "RR";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "game-mini-modal-overlay";
    overlay.innerHTML = `
      <div class="game-mini-modal" role="dialog" aria-modal="true" aria-label="Registrar resultado">
        <div class="game-mini-title">${group.name || "Grupo"} - ${mode.modeName || "Modo"} - ${result}</div>
        <label class="field">
          <span class="field-label">Dia</span>
          <input type="date" class="game-mini-date" value="${todayKey()}" max="9999-12-31" />
        </label>
        ${shooter ? `<div class="game-mini-grid two">
          <input class="game-mini-input" data-key="rf" inputmode="numeric" placeholder="R+" maxlength="7" />
          <input class="game-mini-input" data-key="ra" inputmode="numeric" placeholder="R-" maxlength="7" />
        </div>
        <div class="game-mini-grid three">
          <input class="game-mini-input" data-key="k" inputmode="numeric" placeholder="K" maxlength="7" />
          <input class="game-mini-input" data-key="d" inputmode="numeric" placeholder="D" maxlength="7" />
          <input class="game-mini-input" data-key="a" inputmode="numeric" placeholder="A" maxlength="7" />
        </div>` : ""}
        ${rankType !== "none" ? `<div class="game-mini-grid one">
          <label class="field">
            <span class="field-label">${rankLabel}</span>
            <input class="game-mini-input-rr" data-key="rankDelta" inputmode="numeric" placeholder="${rankPlaceholder}" maxlength="5" />
          </label>
          <div class="game-sign-toggle" data-sign-wrap>
            <button type="button" class="btn-verde" data-sign="1">[+] Verde</button>
            <button type="button" class="btn-rojo" data-sign="-1">[-] Rojo</button>
          </div>
        </div>` : ""}
        <div class="game-mini-actions">
          <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
          <button type="button" class="btn primary" data-act="save">Guardar</button>
        </div>
      </div>`;
    const close = (ok, payload = null) => {
      overlay.remove();
      document.body.classList.remove("has-open-modal");
      resolve(ok ? payload : false);
    };
    overlay.addEventListener("click", (e) => {
      const signBtn = e.target.closest('[data-sign]');
      if (signBtn) {
        overlay.dataset.ratingSign = signBtn.dataset.sign;
        overlay.querySelectorAll('[data-sign]').forEach((n) => n.classList.toggle('primary', n === signBtn));
        return;
      }
      if (e.target === overlay || e.target.closest('[data-act="cancel"]')) close(false);
      if (e.target.closest('[data-act="save"]')) {
        const dateInput = overlay.querySelector('.game-mini-date');
        const payload = { day: dateInput?.value || todayKey() };
        overlay.querySelectorAll('.game-mini-input').forEach((node) => {
          payload[node.dataset.key] = Number(node.value || 0);
        });
        payload.ratingDeltaSign = Number(overlay.dataset.ratingSign || 1);
        if (!overlay.dataset.ratingSign) console.log("[games] rating:sign:default", { modeId, groupId: mode.groupId, sign: 1 });
        close(true, payload);
      }
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") {
        e.preventDefault();
        overlay.querySelector('[data-act="save"]')?.click();
      }
    });
    document.body.appendChild(overlay);
    document.body.classList.add("has-open-modal");
    overlay.querySelector('.game-mini-input')?.focus();
  });
}

async function rebuildDailyFromMatches(modeId, day) {
  console.log("[games] daily:rebuild:start", { modeId, day });
  const mode = modes[modeId];
  if (!mode?.groupId) return;
  const snap = await get(ref(db, `${GAMES_MATCHES_PATH}/${mode.groupId}`));
  const allMatches = snap.val() || {};
  const matches = Object.values(allMatches).filter((m) => m?.day === day && m?.modeId === modeId);
  console.log("[games] daily:rebuild:matches", matches.length);

  const dailyObj = matches.reduce((acc, match) => {
    const resultKey = String(match.resultKey || "ties");
    if (resultKey === "wins") acc.wins += 1;
    else if (resultKey === "losses") acc.losses += 1;
    else acc.ties += 1;
    acc.k += Number(match.k || 0);
    acc.d += Number(match.d || 0);
    acc.a += Number(match.a || 0);
    acc.rf += Number(match.rf || 0);
    acc.ra += Number(match.ra || 0);
    acc.minutes += clamp(Number(match.minutes || 0));
    const abs = Number(match.ratingDeltaAbs);
    const sign = Number(match.ratingDeltaSign);
    const delta = Number.isFinite(abs) && Number.isFinite(sign) ? Math.round(abs * sign) : 0;
    if (getGroupRankType(mode.groupId) === "elo") acc.eloDelta += delta;
    if (getGroupRankType(mode.groupId) === "rr") acc.rrDelta += delta;
    return acc;
  }, { wins: 0, losses: 0, ties: 0, minutes: 0, k: 0, d: 0, a: 0, rf: 0, ra: 0, eloDelta: 0, rrDelta: 0 });
  console.log("[games] daily:rebuild:fold", dailyObj);

  dailyByMode[modeId] = dailyByMode[modeId] || {};
  if (!matches.length) {
    delete dailyByMode[modeId][day];
    await remove(ref(db, `${DAILY_PATH}/${modeId}/${day}`));
  } else {
    dailyByMode[modeId][day] = dailyObj;
    await set(ref(db, `${DAILY_PATH}/${modeId}/${day}`), dailyObj);
  }
  console.log("[games] daily:rebuild:done", { modeId, day });
}

async function patchModeCounter(modeId, key, delta) {
  console.log("[games] patchModeCounter:start", { modeId, key, delta });
  const mode = modes[modeId];
  if (!mode) return;

  const resultMap = { wins: "W", losses: "L", ties: "T" };
  const result = resultMap[key] || "T";
  const rankType = getGroupRankType(mode.groupId);
  let day = todayKey();

  if (delta > 0) {
    let payload = { day };
    const shouldOpenModal = isGroupShooter(mode.groupId) || rankType !== "none";
    if (shouldOpenModal) {
      const formPayload = await openResultModal(modeId, result);
      if (!formPayload) return;
      payload = formPayload;
    }
    day = payload.day || day;
    console.log("[games] match:add:start", { modeId, day, resultKey: key });
    console.log("[games] match:add:payload", payload);

    const matchRef = push(ref(db, `${GAMES_MATCHES_PATH}/${mode.groupId}`));
    const deltaAbs = Math.abs(Math.round(Number(payload.rankDelta || 0)));
    const sign = Number(payload.ratingDeltaSign || 1) === -1 ? -1 : 1;
    const deltaFinal = rankType === "none" ? null : (deltaAbs * sign);
    const matchObj = {
      matchId: matchRef.key,
      modeId,
      groupId: mode.groupId,
      day,
      createdAt: nowTs(),
      resultKey: key,
      wins: key === "wins" ? 1 : 0,
      losses: key === "losses" ? 1 : 0,
      ties: key === "ties" ? 1 : 0,
      k: clampStat(payload.k),
      d: clampStat(payload.d),
      a: clampStat(payload.a),
      rf: clampStat(payload.rf),
      ra: clampStat(payload.ra),
      ratingDeltaAbs: rankType === "none" ? null : deltaAbs,
      ratingDeltaSign: rankType === "none" ? null : sign,
      ratingDeltaFinal: rankType === "none" ? null : deltaFinal,
      minutes: clamp(Number(payload.minutes || 0))
    };
    console.log("[games] match:add", matchObj);
    await set(matchRef, matchObj);
    matchesByGroup[mode.groupId] = matchesByGroup[mode.groupId] || {};
    matchesByGroup[mode.groupId][matchRef.key] = matchObj;
    rebuildMatchesByModeIndex();
    if (deltaFinal !== null) {
      console.log("[games] rating:add", { groupId: mode.groupId, deltaAbs, sign, deltaFinal });
    }
    await rebuildDailyFromMatches(modeId, day);
  }

  if (delta < 0) {
    console.log("[games] match:undo:start", { modeId, day, resultKey: key });
    const snap = await get(ref(db, `${GAMES_MATCHES_PATH}/${mode.groupId}`));
    const byId = snap.val() || {};
    const candidates = Object.values(byId)
      .filter((m) => m?.day === day && m?.resultKey === key && m?.modeId === modeId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const target = candidates[0];
    if (!target?.matchId) return;
    console.log("[games] match:undo", { foundMatchId: target.matchId, match: target });
    await remove(ref(db, `${GAMES_MATCHES_PATH}/${mode.groupId}/${target.matchId}`));
    if (matchesByGroup?.[mode.groupId]) delete matchesByGroup[mode.groupId][target.matchId];
    rebuildMatchesByModeIndex();
    const abs = Number(target.ratingDeltaAbs);
    const sign = Number(target.ratingDeltaSign);
    if (Number.isFinite(abs) && Number.isFinite(sign)) {
      const deltaFinal = Math.round(abs * sign);
      console.log("[games] rating:undo", { groupId: mode.groupId, deltaFinal });
    }
    await rebuildDailyFromMatches(modeId, day);
  }

  mode.updatedAt = nowTs();
  await update(ref(db, `${MODES_PATH}/${modeId}`), { updatedAt: mode.updatedAt });
  renderGamesList();
  renderStats();
  refreshOpenModeModal();
  triggerHaptic();
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
  const action = prompt("Accion de grupo: editar | add | reset | delete");
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
  if (!group?.linkedHabitId) return alert("Vincula un habito al grupo para usar sesiones.");
  const api = window.__bookshellHabits;
  if (!api) return;
  const running = getRunningSessionState();
  if (running) {
    if (running.targetHabitId !== group.linkedHabitId) return alert("Ya hay una sesion activa");
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

function formatHoursMinutes(min) {
  const minutes = Math.max(0, Math.round(Number(min || 0)));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getModeDayMinutes(mode, dateKey, rec = null) {
  const row = rec || dailyByMode[mode.id]?.[dateKey] || {};
  return clamp(Number(row.minutes || 0));
}

function getGroupModeIds(groupId) {
  return groupModes(groupId).map((m) => m.id);
}

function getGroupDayMinutes(groupId, day) {
  return getGroupModeIds(groupId).reduce((acc, modeId) => {
    return acc + clamp(Number(dailyByMode[modeId]?.[day]?.minutes || 0));
  }, 0);
}

async function syncGroupLinkedHabitMinutes(groupId, linkedHabitId, day) {
  if (!groupId || !linkedHabitId || !day) return;
  const totalMinutes = getGroupDayMinutes(groupId, day);
  const totalSec = Math.round(totalMinutes * 60);
  habitSessions[linkedHabitId] = habitSessions[linkedHabitId] || {};
  habitSessions[linkedHabitId][day] = totalSec;
  await set(ref(db, `${HABIT_SESSIONS_PATH}/${linkedHabitId}/${day}`), totalSec);
}

function getGroupTargetModeId(groupId) {
  const group = groups[groupId] || {};
  const modeIds = getGroupModeIds(groupId);
  if (!modeIds.length) return null;
  if (group.lastUsedModeId && modeIds.includes(group.lastUsedModeId)) return group.lastUsedModeId;
  return modeIds[0];
}

async function reconcileGamesFromHabitSessions() {
  const updates = {};
  Object.values(groups || {}).forEach((group) => {
    if (!group?.id || !group.linkedHabitId) return;
    const targetModeId = getGroupTargetModeId(group.id);
    if (!targetModeId) return;
    const byDate = habitSessions?.[group.linkedHabitId];
    if (!byDate || typeof byDate !== "object") return;
    Object.entries(byDate).forEach(([dateKey, rawVal]) => {
      const habitMin = readDayMinutes(rawVal);
      const sumModes = getGroupDayMinutes(group.id, dateKey);
      const delta = habitMin - sumModes;
      if (Math.abs(delta) < 1) return;
      const currentMinutes = clamp(Number(dailyByMode[targetModeId]?.[dateKey]?.minutes || 0));
      const nextMinutes = Math.max(0, currentMinutes + delta);
      if (nextMinutes === currentMinutes) return;
      dailyByMode[targetModeId] = dailyByMode[targetModeId] || {};
      const prev = dailyByMode[targetModeId][dateKey] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
      dailyByMode[targetModeId][dateKey] = {
        wins: clamp(Number(prev.wins || 0)),
        losses: clamp(Number(prev.losses || 0)),
        ties: clamp(Number(prev.ties || 0)),
        minutes: nextMinutes,
        k: clamp(Number(prev.k || 0)),
        d: clamp(Number(prev.d || 0)),
        a: clamp(Number(prev.a || 0)),
        rf: clamp(Number(prev.rf || 0)),
        ra: clamp(Number(prev.ra || 0))
      };
      updates[`${DAILY_PATH}/${targetModeId}/${dateKey}/minutes`] = nextMinutes;
    });
  });
  if (!Object.keys(updates).length) return;
  saveCache();
  render();
  renderGlobalStats();
  if (currentModeId) renderModeDetail();
  await update(ref(db), updates);
}

function renderModeLineChart(modeId) {
  const mode = modes[modeId];
  const $el = document.getElementById(`games-mode-line-${modeId}`);
  if (!mode || !$el) return;
  $el.style.minHeight = "220px";

  const modeDaily = dailyByMode[mode.id] || {};
  const minDate = getMinDataDate([mode.id]);
  const range = getRangeBounds(detailRange, new Date(), minDate);
  const points = buildDailySeries(modeDaily, range);

  renderLineChart($el, points, "detail");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      detailLineChart?.resize();
    });
  });
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
  const now = new Date();
  const detailRangeBounds = getRangeBounds(detailRange, now, getMinDataDate([mode.id]));
  const detailDayRange = getDayRange(detailRange, now);
  console.log("[games] range", { rangeKey: detailRange, startDay: detailDayRange.startDay, endDay: detailDayRange.endDay });
  const totals = computeModeAgg(mode.id, detailRange, now);
  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  const minutes = Object.entries(modeDaily).reduce((acc, [day, rec]) => acc + getModeDayMinutes(mode, day, rec || {}), 0);
  const hoursText = `${(minutes / 60).toFixed(1)}h`;

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

  const ratingSnap = groupRatingSnapshot(mode.groupId, detailRangeBounds);
  const shooterLine = isGroupShooter(mode.groupId) && pct.total > 0
    ? `<div>K ${totals.k} - D ${totals.d} - A ${totals.a} - R ${totals.rf}-${totals.ra}</div>`
    : "";
  const bases = getModeBases(mode.id);

  $detailTitle.textContent = `${group.name || "Grupo"} - ${mode.modeName || "Modo"}`;
  $detailBody.innerHTML = `
    <section class="game-detail-head">
      <div class="game-detail-top">
        <div>
          <div class="game-detail-name">${mode.modeEmoji || group.emoji || "🎮"} ${group.name || "Grupo"} - ${mode.modeName || "Modo"}</div>
          <div class="game-detail-sub">${formatLineRight(pct.total, totals.wins, totals.losses, totals.ties, pct.winPct)}</div>
        </div>
        <div class="game-detail-actions">
          <button class="game-menu-btn" data-action="edit-mode">Editar</button>
          <button class="game-menu-btn" data-action="reset-mode">Reset</button>
          <button class="game-menu-btn" data-action="delete-mode">Eliminar</button>
        </div>
      </div>
      <div class="game-detail-summary">
        <div>W/L/T: ${formatWLT({ w: totals.wins, l: totals.losses, t: totals.ties })}</div>
        <div>Horas jugadas (habito grupo): ${hoursText}</div>
        ${shooterLine}
      </div>
    </section>

    <section class="game-detail-section">
      <strong>Controles</strong>
      <div class="game-controls-grid">
        <div class="game-control-col loss">
          <div>Derrotas</div><div class="game-control-value">${totals.losses}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="loss">+1</button><button class="game-ctrl-btn" data-action="loss-minus">-1</button></div>
        </div>
        <div class="game-control-col tie">
          <div>Empates</div><div class="game-control-value">${totals.ties}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="tie">+1</button><button class="game-ctrl-btn" data-action="tie-minus">-1</button></div>
        </div>
        <div class="game-control-col win">
          <div>Victorias</div><div class="game-control-value">${totals.wins}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="win">+1</button><button class="game-ctrl-btn" data-action="win-minus">-1</button></div>
        </div>
      </div>
    </section>

<section class="game-detail-section">
  <strong>Bases del modo</strong>

  <div class="game-detail-top-wrap">
    ${ratingSnap ? `
      <div class="games-rank-chip" data-group-id="${mode.groupId}">
        <div class="games-rank-chip-top">
          <span class="games-rank-chip-game">${group.name || "Grupo"}</span>
          <span class="games-rank-chip-type">${ratingSnap.typeLabel}</span>
        </div>
        <div class="games-rank-chip-main">${ratingSnap.main}</div>
        <div class="games-rank-chip-sub">${ratingSnap.sub}</div>
      </div>
    ` : ""}

    <div class="game-detail-bases-wrap">
      <div class="game-detail-sub">W ${bases.wins} - L ${bases.losses} - T ${bases.ties}</div>
      <div class="game-detail-sub">K ${bases.k} - D ${bases.d} - A ${bases.a}</div>
      <div class="game-detail-sub">R ${bases.rf}-${bases.ra}</div>
    </div>
  </div>

  <button class="game-menu-btn"
    data-action="edit-group-bases"
    data-group-id="${mode.groupId}"
    data-mode-id="${mode.id}">
    Editar bases del modo
  </button>
</section>


    <section class="game-detail-section">
      <strong>Rango</strong>
      <div class="game-ranges">
        <button class="game-range-btn ${detailRange === "day" ? "is-active" : ""}" data-range="day">Dia</button>
        <button class="game-range-btn ${detailRange === "week" ? "is-active" : ""}" data-range="week">Semana</button>
        <button class="game-range-btn ${detailRange === "month" ? "is-active" : ""}" data-range="month">Mes</button>
        <button class="game-range-btn ${detailRange === "year" ? "is-active" : ""}" data-range="year">Ano</button>
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
      <button class="game-menu-btn" data-cal-nav="-1" aria-label="Mes anterior"><-</button>
      <button class="game-menu-btn" data-cal-nav="1" aria-label="Mes siguiente">-></button>
    </div>
  </div>

  <div class="habit-month-grid game-calendar-grid">${rows}</div>
</section>`;


  renderDonut(document.getElementById("game-detail-donut"), totals, true, "detail");
  renderModeLineChart(mode.id);
}
async function saveDayRecord(modeId, day, rec) {
  dailyByMode[modeId] = dailyByMode[modeId] || {};
  dailyByMode[modeId][day] = {
    wins: clamp(Number(rec?.wins || 0)),
    losses: clamp(Number(rec?.losses || 0)),
    ties: clamp(Number(rec?.ties || 0)),
    minutes: clamp(Number(rec?.minutes || 0)),
    k: clamp(Number(rec?.k || 0)),
    d: clamp(Number(rec?.d || 0)),
    a: clamp(Number(rec?.a || 0)),
    rf: clamp(Number(rec?.rf || 0)),
    ra: clamp(Number(rec?.ra || 0))
  };

  await set(ref(db, `${DAILY_PATH}/${modeId}/${day}`), dailyByMode[modeId][day]);

  render();
  renderGlobalStats();
  if (currentModeId === modeId) {
    renderModeDetail();
    renderModeLineChart(modeId);
    requestAnimationFrame(() => detailLineChart?.resize?.());
  }

  const mode = modes?.[modeId];
  const group = mode ? groups?.[mode.groupId] : null;
  if (group?.linkedHabitId) {
    await syncGroupLinkedHabitMinutes(group.id, group.linkedHabitId, day);
  }
}



function openDayRecordModal(modeId, day) {
  const mode = modes[modeId];
  if (!mode) return;
  const rec = dailyByMode[modeId]?.[day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
  let state = {
    wins: clamp(Number(rec.wins || 0)),
    losses: clamp(Number(rec.losses || 0)),
    ties: clamp(Number(rec.ties || 0)),
    minutes: clamp(Number(rec.minutes || 0)),
    k: clamp(Number(rec.k || 0)),
    d: clamp(Number(rec.d || 0)),
    a: clamp(Number(rec.a || 0)),
    rf: clamp(Number(rec.rf || 0)),
    ra: clamp(Number(rec.ra || 0))
  };
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="game-day-modal-overlay" aria-hidden="true"></div>
  <div class="modal habit-modal game-day-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div class="modal-title">Registro del dia</div></div>
    <div class="modal-scroll sheet-body">
      <label class="field"><span class="field-label">Fecha</span><input type="text" value="${day}" readonly></label>
      <label class="field"><span class="field-label">Horas / minutos</span><input id="game-day-minutes" type="number" min="0" value="${state.minutes || 0}" inputmode="numeric">
</label>
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
  const panel = modal.querySelector(".game-day-modal");
  const minutesInput = modal.querySelector("#game-day-minutes");

  ["pointerdown", "touchstart"].forEach((evtName) => {
    panel?.addEventListener(evtName, (e) => e.stopPropagation());
    minutesInput?.addEventListener(evtName, (e) => e.stopPropagation());
  });
  minutesInput?.addEventListener("click", (e) => e.stopPropagation());
  requestAnimationFrame(() => {
    setTimeout(() => {
      minutesInput?.focus({ preventScroll: true });
      minutesInput?.select?.();
    }, 50);
  });

  const repaint = () => {
    modal.querySelectorAll(".game-day-counter").forEach((row) => {
      const k = row.dataset.k;
      row.querySelector("strong").textContent = state[k];
    });
  };
  modal.addEventListener("pointerdown", async (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) {
      modal.remove();
      syncModalScrollLock();
      return;
    }
  });

  modal.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) {
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
  const val = Number(modal.querySelector("#game-day-minutes")?.value || 0);
  state.minutes = clamp(val);
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
      const minutes = clamp(Number(row?.minutes || 0));
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

  const groupsRows = Object.values(groups || {}).map(g => ({
    __info: "Exportar Juegos: 1) CSV único 2) ZIP (por modo)",
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
      const minutes = clamp(Number(row?.minutes || 0));
      return { date, wins, losses, ties, matches, minutes, hours: toHours(minutes), winPct: matches ? ((wins / matches) * 100).toFixed(2) : "0.00" };
    }).filter((row) => row.matches || row.minutes).sort((a, b) => a.date.localeCompare(b.date));
    const filename = `mode__${sanitizeFileToken(group.name)}__${sanitizeFileToken(mode.modeName)}__${sanitizeFileToken(mode.id)}.csv`;
    files[filename] = buildCsv(rows, ["date", "wins", "losses", "ties", "matches", "minutes", "hours", "winPct"]);
  });
  await downloadZip(files, "bookshell-games-export.zip");
}

async function onGamesExportClick() {
  const choice = prompt(
    "Exportar Juegos:\n1) CSV unico\n2) ZIP (por modo)",
    "1"
  );
  if (!choice) return;
  if (choice.trim() === "2") await exportGamesZipByMode();
  else exportGamesCsvSingle();
}


function openModeDetail(modeId) {
  if (!modes[modeId]) return;
  currentModeId = modeId;
  const mode = modes[modeId];
  const group = groups[mode.groupId];
  if (group && group.lastUsedModeId !== modeId) {
    group.lastUsedModeId = modeId;
    groups[group.id] = group;
    saveCache();
    update(ref(db, `${GROUPS_PATH}/${group.id}`), { lastUsedModeId: modeId, updatedAt: nowTs() }).catch(() => {});
  }
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
  const groupIdValue = btn.dataset.groupId || btn.closest(".game-group")?.dataset.groupId;
  const actionModeId = btn.dataset.modeId || modeId;
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
  if (action === "group-menu" && groupIdValue) return handleGroupMenu(groupIdValue);
  if (action === "edit-group-bases" && groupIdValue) return openGroupBasesModal(groupIdValue, actionModeId);
  if (action === "edit-group-rating" && groupIdValue) return openGroupBasesModal(groupIdValue, actionModeId);
  if (action === "edit-group-kda-base" && groupIdValue) return openGroupBasesModal(groupIdValue, actionModeId);
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
    const prevRating = normalizeRating(group.rating || groupRatings[id]?.rating);
    const nextType = ($groupEditRankType?.value || "none");
    const payload = {
      name: $groupEditName.value.trim(),
      emoji: ($groupEditEmoji.value || "🎮").trim() || "🎮",
      linkedHabitId: $groupEditHabit.value || null,
      category: ($groupEditCategory?.value || "other"),
      tags: { shooter: ($groupEditCategory?.value || "other") === "shooter" },
      rankType: nextType,
      rating: prevRating.type === nextType ? prevRating : normalizeRating({ type: nextType, base: 0, tier: "Hierro", div: 1 }),
      accent: $groupEditAccent?.value || "#8b5cf6",
      updatedAt: nowTs()
    };
    groups[id] = { ...group, ...payload };
    render();
    await update(ref(db, `${GROUPS_PATH}/${id}`), payload);
    await set(ref(db, `${GAMES_GROUPS_PATH}/${id}/rating`), payload.rating);
    closeGroupModal();
    saveCache();
  });

  $groupsList?.addEventListener("click", onListClick);
  $statsFilter?.addEventListener("change", renderGlobalStats);
  $tabCounters?.addEventListener("click", () => { setGamesTab("counters"); renderGamesPanel(); });
  $tabStats?.addEventListener("click", () => { setGamesTab("stats"); renderGamesPanel(); renderGlobalStats(); });
  $gamesExportBtn?.addEventListener("click", onGamesExportClick);
  $statsBreakdown?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fold-toggle]");
    if (!btn) return;
    toggleStatsFold(btn.dataset.foldToggle);
  });

  document.getElementById("game-stats-ranges")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stats-range]");
    if (!btn) return;
    statsRange = btn.dataset.statsRange;
    state.gamesRangeKey = statsRange || "total";
    const dayRange = getDayRange(statsRange, new Date());
    console.log("[games] range", { rangeKey: statsRange, startDay: dayRange.startDay, endDay: dayRange.endDay });
    localStorage.setItem("bookshell-games-stats-range", statsRange);
    document.querySelectorAll("#game-stats-ranges .game-range-btn").forEach((node) => node.classList.toggle("is-active", node === btn));
    renderStats();
    renderGamesList();
  });

  $detailBody?.addEventListener("click", async (e) => {
    const rangeBtn = e.target.closest("[data-range]");
    if (rangeBtn) {
      detailRange = rangeBtn.dataset.range;
      const dayRange = getDayRange(detailRange, new Date());
      console.log("[games] range", { rangeKey: detailRange, startDay: dayRange.startDay, endDay: dayRange.endDay });
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
    Object.keys(groups).forEach((id) => {
      groups[id] = { ...groups[id], id, rating: normalizeRating(groupRatings[id]?.rating || groups[id]?.rating) };
    });
    if (!localStorage.getItem(OPEN_KEY)) {
      Object.keys(groups).forEach((id) => openGroups.add(id));
    }
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
    render();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });


  onValue(ref(db, GAMES_MODES_PATH), (snap) => {
    modeBases = snap.val() || {};
    render();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });
  onValue(ref(db, GAMES_GROUPS_PATH), (snap) => {
    groupRatings = snap.val() || {};
    Object.keys(groups).forEach((id) => {
      groups[id] = {
        ...groups[id],
        rating: normalizeRating(groupRatings[id]?.rating || groups[id]?.rating)
      };
    });
    render();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });

  onValue(ref(db, GAMES_MATCHES_PATH), (snap) => {
    matchesByGroup = snap.val() || {};
    rebuildMatchesByModeIndex();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });

  onValue(ref(db, AGG_RANK_DAY_PATH), (snap) => {
    aggRankDay = snap.val() || {};
    renderGlobalStats();
  });

  onValue(ref(db, AGG_RANK_TOTAL_PATH), (snap) => {
    aggRankTotal = snap.val() || {};
    renderGlobalStats();
  });

  onValue(ref(db, HABITS_PATH), (snap) => {
    habits = snap.val() || {};
    if ($groupHabit) $groupHabit.innerHTML = habitOptionsHtml();
    if ($groupEditHabit) $groupEditHabit.innerHTML = habitOptionsHtml();
    render();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });

  onValue(ref(db, HABIT_SESSIONS_PATH), (snap) => {
    habitSessions = snap.val() || {};
    reconcileGamesFromHabitSessions().catch(() => {});
  });
}

/* ========= Sesiones: actualizar solo texto del botón (sin render completo) ========= */
function getRunningSessionFromHabitSessions() {
  const list = Object.values(habitSessions || {});
  return list.find(s => s && s.isRunning);
}

function tickSessionButtons() {
  const running = getRunningSessionFromHabitSessions();
  if (!running) return;

  const details = document.querySelectorAll("#games-groups-list .game-group");

  details.forEach((detail) => {
    const groupId = detail.dataset.groupId;
    const g = groups?.[groupId];
    const btn = detail.querySelector(".game-session-btn");
    if (!btn) return;

    const hasRunning =
      g?.linkedHabitId &&
      running.targetHabitId === g.linkedHabitId;

    if (!hasRunning) {
      const idle = "▶ Iniciar";
      if (btn.textContent.trim() !== idle) btn.textContent = idle;
      return;
    }

    const elapsed = formatDuration(
      (Date.now() - Number(running.startTs || Date.now())) / 1000
    );

    const next = `■ ${elapsed}`;
    if (btn.textContent !== next) btn.textContent = next;
  });
}


function startSessionTicker() {
  if (sessionTick) clearInterval(sessionTick);
  sessionTick = setInterval(tickSessionButtons, 1000);
}

async function migrateOldRatingToGroup() {
  const updates = {};
  const byGroup = {};
  Object.values(modes || {}).forEach((mode) => {
    if (!mode?.groupId) return;
    const rankType = getGroupRankType(mode.groupId);
    if (rankType === "none") return;
    const prev = byGroup[mode.groupId];
    const candidate = { mode, updatedAt: Number(mode.updatedAt || 0) };
    if (!prev || candidate.updatedAt > prev.updatedAt) byGroup[mode.groupId] = candidate;
  });

  Object.entries(byGroup).forEach(([groupId, { mode }]) => {
    const current = normalizeRating(groups[groupId]?.rating || groupRatings[groupId]?.rating);
    if (current.type !== "none") return;
    if (getGroupRankType(groupId) === "elo") {
      updates[`${groupId}/rating`] = normalizeRating({ type: "elo", base: Number(mode.ratingBase || 0), updatedAt: nowTs() });
      return;
    }
    const tier = RR_TIERS[RR_TIER_INDEX[String(mode?.rankBase?.tier || "HIERRO").toUpperCase()] || 0] || "Hierro";
    updates[`${groupId}/rating`] = normalizeRating({ type: "rr", base: Number(mode.rrBase || 0), tier, div: Number(mode?.rankBase?.div || 1), updatedAt: nowTs() });
  });

  if (!Object.keys(updates).length) return 0;
  await update(ref(db, GAMES_GROUPS_PATH), updates);
  return Object.keys(updates).length;
}

window.migrateOldRatingToGroup = migrateOldRatingToGroup;

function init() {
  if (!$groupsList) return;
  loadCache();
  bind();
  document.querySelectorAll("#game-stats-ranges .game-range-btn").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.statsRange === statsRange));
  listenRemote();
  render();

  if (sessionTick) clearInterval(sessionTick);
  sessionTick = setInterval(tickSessionButtons, 1000); // â antes: render()
}


init();
