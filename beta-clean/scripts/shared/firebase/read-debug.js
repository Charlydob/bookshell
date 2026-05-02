const METRICS_STORAGE_KEY = "bookshell:firebase-metrics:v2"
const MAX_READ_LOGS = 1500
const MAX_RISK_LOGS = 600
const MAX_METRIC_SAMPLES = 3200
const MAX_DUPLICATE_LOGS = 240
const LARGE_PAYLOAD_BYTES = 180 * 1024
const HEAVY_PAYLOAD_BYTES = 420 * 1024
const RANGE_WINDOWS_MS = Object.freeze({
  "1m": 60 * 1000,
  "10m": 10 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "since-start": Infinity,
})
const MODULE_LABELS = Object.freeze({
  shell: "Shell",
  finance: "Finanzas",
  habits: "Habitos",
  recipes: "Recetas",
  gym: "Gym",
  world: "Mundo",
  books: "Libros",
  games: "Juegos",
  notes: "Notas",
  reminders: "Recordatorios",
  improvements: "Mejoras",
  media: "Media",
  "videos-hub": "Videos",
  general: "General",
  achievements: "Logros",
  unknown: "Otros",
})
const VIEW_MODULE_MAP = Object.freeze({
  shell: "shell",
  "view-books": "books",
  "view-notes": "notes",
  "view-videos-hub": "videos-hub",
  "view-recipes": "recipes",
  "view-habits": "habits",
  "view-games": "games",
  "view-media": "media",
  "view-world": "world",
  "view-finance": "finance",
  "view-improvements": "improvements",
  "view-gym": "gym",
})
const PATH_MODULE_RULES = Object.freeze([
  { test: /\/finance(?:\/|$)/i, module: "finance" },
  { test: /\/habits(?:\/|$)|\/habitSessions(?:\/|$)|\/activeHabitSessions(?:\/|$)/i, module: "habits" },
  { test: /\/recipes(?:\/|$)|\/nutrition(?:\/|$)|\/foodItems(?:\/|$)/i, module: "recipes" },
  { test: /\/gym(?:\/|$)/i, module: "gym" },
  { test: /\/world(?:\/|$)/i, module: "world" },
  { test: /\/books(?:\/|$)|\/readingLog(?:\/|$)/i, module: "books" },
  { test: /\/notes(?:\/|$)|\/reminders(?:\/|$)/i, module: "notes" },
  { test: /\/games(?:\/|$)/i, module: "games" },
  { test: /\/videosHub(?:\/|$)|\/videos(?:\/|$)/i, module: "videos-hub" },
  { test: /\/media(?:\/|$)|\/movies(?:\/|$)|\/series(?:\/|$)/i, module: "media" },
  { test: /\/improvements(?:\/|$)/i, module: "improvements" },
  { test: /\/meta\/achievements(?:\/|$)/i, module: "achievements" },
  { test: /\/meta\/general(?:\/|$)|\/missions(?:\/|$)/i, module: "general" },
])

function nowTs() {
  return Date.now()
}

function nowIso() {
  return new Date().toISOString()
}

function perfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0
}

function bump(path) {
  state.counts.set(path, (state.counts.get(path) || 0) + 1)
}

function cloneDefault(value) {
  if (Array.isArray(value)) return [...value]
  if (value && typeof value === "object") return { ...value }
  return value
}

function normalizeViewId(viewId = "") {
  return String(viewId || "global").trim() || "global"
}

function normalizeModuleKey(value = "") {
  const safeValue = String(value || "").trim().toLowerCase()
  if (!safeValue) return ""
  if (MODULE_LABELS[safeValue]) return safeValue
  if (safeValue === "view-shell") return "shell"
  return safeValue
}

function resolveModuleKey({ module = "", viewId = "", path = "" } = {}) {
  const explicitModule = normalizeModuleKey(module)
  if (explicitModule) return explicitModule

  const fromView = normalizeModuleKey(VIEW_MODULE_MAP[normalizeViewId(viewId)])
  if (fromView) return fromView

  const safePath = String(path || "").trim()
  if (safePath) {
    const rule = PATH_MODULE_RULES.find((entry) => entry.test.test(safePath))
    if (rule?.module) return rule.module
  }

  return viewId === "shell" ? "shell" : "unknown"
}

function getModuleLabel(moduleKey = "") {
  const safeModule = resolveModuleKey({ module: moduleKey })
  return MODULE_LABELS[safeModule] || MODULE_LABELS.unknown
}

function safeSnapshotValue(snapshotOrValue) {
  if (snapshotOrValue && typeof snapshotOrValue.val === "function") {
    try {
      return snapshotOrValue.val()
    } catch (_) {
      return null
    }
  }
  return snapshotOrValue
}

function estimatePayloadBytes(value) {
  try {
    const normalized = value === undefined ? null : value
    const serialized = typeof normalized === "string" ? normalized : JSON.stringify(normalized)
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(serialized).length
    }
    return serialized.length
  } catch (_) {
    return 0
  }
}

function formatBytes(bytes = 0) {
  const safe = Math.max(0, Number(bytes) || 0)
  if (safe >= 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(2)} MB`
  if (safe >= 1024) return `${(safe / 1024).toFixed(1)} KB`
  return `${safe} B`
}

function looksHeavyFirebasePath(path = "") {
  const safePath = String(path || "").trim()
  if (!safePath) return false
  return /v2\/users\/[^/]+$|v2\/users\/[^/]+\/(finance|recipes|habits|world|notes)$|v2\/users\/[^/]+\/finance\/(?:transactions|movements|tx|foodItems|shoppingHub|tickets)(?:\/|$)|v2\/users\/[^/]+\/recipes\/(?:nutrition|products|dailyLogsByDate)(?:\/|$)|v2\/users\/[^/]+\/habits\/habitSessions(?:\/|$)|v2\/public(?:\/|$)/.test(safePath)
}

function getPathRiskReason(path = "", { bounded = false } = {}) {
  const safePath = String(path || "").trim()
  if (!safePath || bounded) return ""
  if (/v2\/users\/[^/]+$/.test(safePath)) return "root-user-read"
  if (/\/finance(?:\/)?$/.test(safePath)) return "finance-root-read"
  if (/\/habits(?:\/)?$/.test(safePath)) return "habits-root-read"
  if (/\/recipes(?:\/)?$/.test(safePath)) return "recipes-root-read"
  if (looksHeavyFirebasePath(safePath)) return "heavy-branch-read"
  return ""
}

function trimArray(list = [], max = 0) {
  while (list.length > max) list.shift()
}

function readPersistedMetrics() {
  try {
    const raw = localStorage.getItem(METRICS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch (_) {
    return null
  }
}

function serializeMetricsState() {
  return {
    bootAt: state.metrics.bootAt,
    samples: state.metrics.samples,
    duplicateListeners: state.metrics.duplicateListeners,
    cacheByModule: Object.fromEntries(state.metrics.cacheByModule.entries()),
  }
}

function persistMetricsSoon() {
  if (state.metrics.persistTimer) return
  state.metrics.persistTimer = window.setTimeout(() => {
    state.metrics.persistTimer = 0
    try {
      localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(serializeMetricsState()))
    } catch (_) {}
  }, 480)
}

function appendMetricSample(sample = {}) {
  const item = {
    ts: nowTs(),
    at: nowIso(),
    module: resolveModuleKey({ module: sample.module, viewId: sample.viewId, path: sample.path }),
    viewId: normalizeViewId(sample.viewId),
    path: String(sample.path || "").trim(),
    source: String(sample.source || "").trim(),
    reason: String(sample.reason || "").trim(),
    mode: String(sample.mode || sample.source || "").trim(),
    type: String(sample.type || "event").trim(),
    bounded: Boolean(sample.bounded),
    querySummary: String(sample.querySummary || "").trim(),
    bytes: Math.max(0, Number(sample.bytes) || 0),
    durationMs: Number.isFinite(Number(sample.durationMs)) ? Math.round(Number(sample.durationMs)) : null,
    key: String(sample.key || "").trim(),
    eventIndex: Number.isFinite(Number(sample.eventIndex)) ? Number(sample.eventIndex) : null,
    initial: sample.initial == null ? null : Boolean(sample.initial),
    estimatedCount: Number.isFinite(Number(sample.estimatedCount)) ? Number(sample.estimatedCount) : null,
    message: String(sample.message || "").trim(),
    storage: String(sample.storage || "").trim(),
    extra: sample.extra && typeof sample.extra === "object" ? { ...sample.extra } : null,
  }
  state.metrics.samples.push(item)
  trimArray(state.metrics.samples, MAX_METRIC_SAMPLES)
  persistMetricsSoon()
  return item
}

function recordDuplicateListener(item = {}) {
  const payload = {
    at: nowIso(),
    ts: nowTs(),
    module: resolveModuleKey({ module: item.module, viewId: item.viewId, path: item.path }),
    viewId: normalizeViewId(item.viewId),
    path: String(item.path || "").trim(),
    key: String(item.key || "").trim(),
    reason: String(item.reason || "").trim(),
  }
  state.metrics.duplicateListeners.push(payload)
  trimArray(state.metrics.duplicateListeners, MAX_DUPLICATE_LOGS)
  appendMetricSample({
    type: "listener-duplicate",
    source: "onValue",
    ...payload,
  })
  console.warn(`[metrics] listener:duplicate path=${payload.path} module=${payload.module}`)
}

function updateListenerStats(viewId, key, patch = {}) {
  const safeViewId = normalizeViewId(viewId)
  const safeKey = String(key || "").trim()
  if (!safeKey) return
  const listenerId = state.listenerKeys.get(`${safeViewId}:${safeKey}`)
  if (!listenerId) return
  const entry = state.activeListeners.get(listenerId)
  if (!entry) return
  entry.events = Math.max(0, Number(entry.events || 0)) + Math.max(0, Number(patch.events || 0))
  entry.bytesReceived = Math.max(0, Number(entry.bytesReceived || 0)) + Math.max(0, Number(patch.bytes || 0))
  entry.lastEventAt = nowTs()
  if (patch.initialEvent) entry.initialEventAt = entry.initialEventAt || entry.lastEventAt
}

function buildRepeatedPathAlerts(samples = []) {
  const grouped = new Map()
  samples.forEach((sample) => {
    if (!sample?.path) return
    if (!["read-request", "read-result", "listener-start", "listener-event"].includes(sample.type)) return
    const key = `${sample.module}|${sample.path}|${sample.source || sample.mode || ""}`
    const current = grouped.get(key) || {
      module: sample.module,
      path: sample.path,
      source: sample.source || sample.mode || "",
      count: 0,
      bytes: 0,
      lastAt: 0,
    }
    current.count += 1
    current.bytes += Math.max(0, Number(sample.bytes || 0))
    current.lastAt = Math.max(current.lastAt, Number(sample.ts || 0))
    grouped.set(key, current)
  })
  return Array.from(grouped.values())
    .filter((item) => (item.source === "get" && item.count >= 5) || ((item.source === "onValue" || item.source === "onChildAdded" || item.source === "onChildChanged" || item.source === "onChildRemoved") && item.count >= 10))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return right.bytes - left.bytes
    })
    .slice(0, 18)
}

function getMetricRangeSince(rangeKey = "since-start") {
  const windowMs = RANGE_WINDOWS_MS[rangeKey] ?? RANGE_WINDOWS_MS["since-start"]
  if (!Number.isFinite(windowMs)) return 0
  return nowTs() - windowMs
}

function filterSamplesByRange(rangeKey = "since-start") {
  const since = getMetricRangeSince(rangeKey)
  if (!since) return [...state.metrics.samples]
  return state.metrics.samples.filter((item) => Number(item.ts || 0) >= since)
}

function buildModuleMetricsSummary(samples = [], rangeKey = "since-start") {
  const modules = new Map()
  const ensureModule = (moduleKey) => {
    const safeModule = resolveModuleKey({ module: moduleKey })
    if (modules.has(safeModule)) return modules.get(safeModule)
    const row = {
      module: safeModule,
      label: getModuleLabel(safeModule),
      getCount: 0,
      listenerStarts: 0,
      listenerEvents: 0,
      bytesReceived: 0,
      cacheBytes: Math.max(0, Number(state.metrics.cacheByModule.get(safeModule) || 0)),
      lastReadAt: 0,
      activeListeners: 0,
      duplicateListeners: 0,
      riskyReads: 0,
      paths: new Map(),
    }
    modules.set(safeModule, row)
    return row
  }

  samples.forEach((sample) => {
    const row = ensureModule(sample.module)
    if (sample.type === "read-request" && sample.source === "get") {
      row.getCount += 1
    }
    if (sample.type === "read-result" && sample.source === "get") {
      row.bytesReceived += Math.max(0, Number(sample.bytes || 0))
      row.lastReadAt = Math.max(row.lastReadAt, Number(sample.ts || 0))
    }
    if (sample.type === "listener-start") {
      row.listenerStarts += 1
    }
    if (sample.type === "listener-event") {
      row.listenerEvents += 1
      row.bytesReceived += Math.max(0, Number(sample.bytes || 0))
      row.lastReadAt = Math.max(row.lastReadAt, Number(sample.ts || 0))
    }
    if (sample.type === "listener-duplicate") {
      row.duplicateListeners += 1
    }
    if (sample.type === "risk") {
      row.riskyReads += 1
    }
    if (sample.path) {
      const pathRow = row.paths.get(sample.path) || {
        path: sample.path,
        readCount: 0,
        bytes: 0,
        lastAt: 0,
        sources: new Set(),
        risks: new Set(),
      }
      if (sample.type === "read-request" || sample.type === "read-result" || sample.type === "listener-start" || sample.type === "listener-event") {
        pathRow.readCount += 1
      }
      if (sample.type === "read-result" || sample.type === "listener-event") {
        pathRow.bytes += Math.max(0, Number(sample.bytes || 0))
      }
      if (sample.type === "risk" && sample.reason) {
        pathRow.risks.add(sample.reason)
      }
      if (sample.source) pathRow.sources.add(sample.source)
      pathRow.lastAt = Math.max(pathRow.lastAt, Number(sample.ts || 0))
      row.paths.set(sample.path, pathRow)
    }
  })

  state.metrics.duplicateListeners
    .filter((item) => Number(item.ts || 0) >= getMetricRangeSince(rangeKey))
    .forEach((item) => {
      const row = ensureModule(item.module)
      row.duplicateListeners += 1
    })

  state.activeListeners.forEach((entry) => {
    const row = ensureModule(entry.module)
    row.activeListeners += 1
  })

  return Array.from(modules.values())
    .map((row) => ({
      ...row,
      paths: Array.from(row.paths.values())
        .map((pathRow) => ({
          path: pathRow.path,
          readCount: pathRow.readCount,
          bytes: pathRow.bytes,
          lastAt: pathRow.lastAt,
          sources: Array.from(pathRow.sources.values()),
          risks: Array.from(pathRow.risks.values()),
        }))
        .sort((left, right) => {
          if (right.bytes !== left.bytes) return right.bytes - left.bytes
          return right.readCount - left.readCount
        }),
    }))
    .sort((left, right) => {
      const rightScore = right.bytesReceived + (right.listenerEvents * 40) + (right.getCount * 25)
      const leftScore = left.bytesReceived + (left.listenerEvents * 40) + (left.getCount * 25)
      return rightScore - leftScore
    })
}

const persisted = readPersistedMetrics()

const state = {
  reads: Array.isArray(persisted?.samples)
    ? persisted.samples.filter((item) => item?.type === "read-request" || item?.type === "read-result" || item?.type === "listener-start" || item?.type === "listener-event").slice(-MAX_READ_LOGS)
    : [],
  counts: new Map(),
  activeListeners: new Map(),
  viewListeners: new Map(),
  listenerKeys: new Map(),
  bytesRisk: Array.isArray(persisted?.samples)
    ? persisted.samples.filter((item) => item?.type === "risk").slice(-MAX_RISK_LOGS)
    : [],
  metrics: {
    bootAt: Number(persisted?.bootAt || 0) || nowTs(),
    samples: Array.isArray(persisted?.samples) ? persisted.samples.slice(-MAX_METRIC_SAMPLES) : [],
    duplicateListeners: Array.isArray(persisted?.duplicateListeners) ? persisted.duplicateListeners.slice(-MAX_DUPLICATE_LOGS) : [],
    cacheByModule: new Map(Object.entries(persisted?.cacheByModule || {}).map(([module, bytes]) => [module, Math.max(0, Number(bytes) || 0)])),
    persistTimer: 0,
  },
}

export function logFirebaseBytesRisk({ path = "", reason = "", viewId = "global", module = "", estimatedCount = null } = {}) {
  const resolvedModule = resolveModuleKey({ module, viewId, path })
  const item = {
    ts: nowTs(),
    at: nowIso(),
    path,
    reason,
    viewId: normalizeViewId(viewId),
    module: resolvedModule,
    estimatedCount,
  }
  state.bytesRisk.push(item)
  trimArray(state.bytesRisk, MAX_RISK_LOGS)
  appendMetricSample({
    type: "risk",
    source: "risk",
    path,
    reason,
    viewId,
    module: resolvedModule,
    estimatedCount,
  })
  console.warn("[firebase:bytes-risk]", item)
  console.warn(`[metrics] risk path=${path} reason=${reason}`)
}

export function logFirebaseRead({
  path = "",
  mode = "get",
  reason = "",
  viewId = "global",
  module = "",
  estimatedCount = null,
  bounded = false,
  querySummary = "",
} = {}) {
  const resolvedModule = resolveModuleKey({ module, viewId, path })
  const item = {
    at: nowIso(),
    path,
    mode,
    reason,
    viewId: normalizeViewId(viewId),
    module: resolvedModule,
    estimatedCount,
    bounded: !!bounded,
    querySummary: String(querySummary || "").trim(),
  }
  state.reads.push(item)
  trimArray(state.reads, MAX_READ_LOGS)
  bump(path)
  appendMetricSample({
    type: mode === "get" ? "read-request" : "listener-start",
    source: mode === "get" ? "get" : mode,
    path,
    reason,
    viewId,
    module: resolvedModule,
    estimatedCount,
    bounded,
    querySummary,
    mode,
  })
  const riskReason = getPathRiskReason(path, { bounded })
  if (riskReason) {
    logFirebaseBytesRisk({ path, reason: reason || riskReason, viewId, module: resolvedModule, estimatedCount })
  }
  const tag = mode === "get"
    ? "[firebase:get]"
    : mode === "onValue"
      ? "[firebase:listen:attach]"
      : "[firebase:read]"
  console.debug(tag, item)
}

function detachListenerId(id, { invoke = true, stopReason = "" } = {}) {
  const entry = state.activeListeners.get(id)
  if (!entry) return

  if (invoke) {
    try { entry.unsubscribe?.() } catch (_) {}
  }

  const list = state.viewListeners.get(entry.viewId) || []
  const nextList = list.filter((listenerId) => listenerId !== id)
  if (nextList.length) state.viewListeners.set(entry.viewId, nextList)
  else state.viewListeners.delete(entry.viewId)

  if (entry.listenerKey) {
    const current = state.listenerKeys.get(entry.listenerKey)
    if (current === id) state.listenerKeys.delete(entry.listenerKey)
  }

  state.activeListeners.delete(id)
  appendMetricSample({
    type: "listener-stop",
    source: entry.mode || "onValue",
    path: entry.path || "",
    reason: stopReason || entry.reason || "",
    viewId: entry.viewId,
    module: entry.module,
    key: entry.key || "",
    bytes: entry.bytesReceived || 0,
    extra: {
      activeMs: Math.max(0, nowTs() - Number(entry.startedAtTs || nowTs())),
      events: Number(entry.events || 0),
    },
  })
  console.debug("[firebase:listen:stop]", {
    at: nowIso(),
    viewId: entry.viewId,
    path: entry.path || "",
    key: entry.key || "",
    mode: entry.mode || "onValue",
    reason: stopReason || entry.reason || "",
  })
}

export function registerViewListener(viewId, unsubscribe, meta = {}) {
  if (typeof unsubscribe !== "function") return unsubscribe
  const safeViewId = normalizeViewId(viewId)
  const key = String(meta.key || "").trim()
  const listenerKey = key ? `${safeViewId}:${key}` : ""
  const resolvedModule = resolveModuleKey({ module: meta.module, viewId: safeViewId, path: meta.path })
  const existingId = listenerKey ? state.listenerKeys.get(listenerKey) : ""
  if (existingId) {
    recordDuplicateListener({
      module: resolvedModule,
      viewId: safeViewId,
      path: meta.path,
      key,
      reason: meta.reason,
    })
    detachListenerId(existingId, { invoke: true, stopReason: "replaced" })
  }

  const id = `${safeViewId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  state.activeListeners.set(id, {
    viewId: safeViewId,
    unsubscribe,
    ...meta,
    module: resolvedModule,
    key,
    listenerKey,
    startedAt: nowIso(),
    startedAtTs: nowTs(),
    events: 0,
    bytesReceived: 0,
  })
  const list = state.viewListeners.get(safeViewId) || []
  list.push(id)
  state.viewListeners.set(safeViewId, list)
  if (listenerKey) state.listenerKeys.set(listenerKey, id)

  if (meta.path) {
    if (looksHeavyFirebasePath(meta.path) && !meta.bounded) {
      logFirebaseBytesRisk({
        path: meta.path,
        reason: meta.reason || meta.mode || "listen-start",
        viewId: safeViewId,
        module: resolvedModule,
        estimatedCount: meta.estimatedCount ?? null,
      })
    }
    console.debug("[firebase:listen:start]", {
      at: nowIso(),
      viewId: safeViewId,
      path: meta.path,
      key,
      mode: meta.mode || "onValue",
      reason: meta.reason || "",
    })
    console.info(`[metrics] listener:start path=${meta.path} module=${resolvedModule}`)
  }

  return () => {
    detachListenerId(id, { invoke: true, stopReason: "manual" })
  }
}

export function cleanupViewListeners(viewId) {
  const safeViewId = normalizeViewId(viewId)
  const ids = [...(state.viewListeners.get(safeViewId) || [])]
  ids.forEach((id) => {
    detachListenerId(id, { invoke: true, stopReason: "view-cleanup" })
  })
}

export function clearReadCache(key = "") {
  const safeKey = String(key || "").trim()
  if (!safeKey) return
  try {
    localStorage.removeItem(`bookshell:cache:${safeKey}`)
  } catch (_) {}
}

export function registerCacheMetric({
  module = "",
  key = "",
  bytes = 0,
  storage = "local",
  reason = "cache-write",
} = {}) {
  const resolvedModule = resolveModuleKey({ module, path: key })
  const safeBytes = Math.max(0, Number(bytes) || 0)
  state.metrics.cacheByModule.set(resolvedModule, safeBytes)
  appendMetricSample({
    type: "cache-size",
    source: "cache",
    module: resolvedModule,
    path: key,
    bytes: safeBytes,
    reason,
    storage,
  })
  console.info(`[metrics] cache:size module=${resolvedModule} bytes=${safeBytes}`)
}

export function trackFirebasePayload({
  path = "",
  module = "",
  reason = "",
  viewId = "global",
  source = "get",
  snapshot = null,
  value = undefined,
  bounded = false,
  querySummary = "",
  durationMs = null,
  key = "",
  eventIndex = null,
  initial = null,
  mode = "",
} = {}) {
  const resolvedModule = resolveModuleKey({ module, viewId, path })
  const payloadValue = value === undefined ? safeSnapshotValue(snapshot) : value
  const bytes = estimatePayloadBytes(payloadValue)
  const sample = appendMetricSample({
    type: source === "get" ? "read-result" : "listener-event",
    source,
    path,
    reason,
    viewId,
    module: resolvedModule,
    bounded,
    querySummary,
    bytes,
    durationMs,
    key,
    eventIndex,
    initial,
    mode: mode || source,
  })
  if (source !== "get") {
    updateListenerStats(viewId, key || path, {
      events: 1,
      bytes,
      initialEvent: eventIndex === 1 || initial === true,
    })
    console.info(`[metrics] listener:event path=${path} module=${resolvedModule} bytes=${bytes}`)
  } else {
    console.info(`[metrics] read path=${path} module=${resolvedModule} bytes=${bytes} source=${source}`)
  }
  if (bytes >= HEAVY_PAYLOAD_BYTES) {
    logFirebaseBytesRisk({
      path,
      reason: `${reason || source}:payload>${Math.round(HEAVY_PAYLOAD_BYTES / 1024)}kb`,
      viewId,
      module: resolvedModule,
    })
  } else if (bytes >= LARGE_PAYLOAD_BYTES) {
    appendMetricSample({
      type: "payload-warning",
      source,
      path,
      reason,
      viewId,
      module: resolvedModule,
      bytes,
      bounded,
      querySummary,
    })
  }
  return { value: payloadValue, bytes, sample }
}

export async function trackedGet(targetRef, options = {}, getImpl = null) {
  if (typeof getImpl !== "function") {
    throw new Error("trackedGet requiere un getImpl valido")
  }
  const startedAt = perfNow()
  logFirebaseRead({ ...options, mode: "get" })
  const snapshot = await getImpl(targetRef)
  trackFirebasePayload({
    ...options,
    source: "get",
    snapshot,
    durationMs: perfNow() - startedAt,
    mode: "get",
  })
  return snapshot
}

export function trackedOnValue(targetRef, handler, options = {}, onValueImpl = null) {
  if (typeof onValueImpl !== "function") {
    throw new Error("trackedOnValue requiere un onValueImpl valido")
  }
  const safeOptions = {
    viewId: "global",
    reason: "tracked-onValue",
    mode: "onValue",
    ...options,
  }
  let eventCount = 0
  logFirebaseRead({ ...safeOptions, mode: safeOptions.mode || "onValue" })
  const unsubscribe = onValueImpl(
    targetRef,
    (snapshot) => {
      eventCount += 1
      trackFirebasePayload({
        ...safeOptions,
        source: safeOptions.mode || "onValue",
        snapshot,
        key: safeOptions.key || safeOptions.path,
        eventIndex: eventCount,
        initial: eventCount === 1,
        mode: safeOptions.mode || "onValue",
      })
      handler?.(snapshot)
    },
    (error) => {
      appendMetricSample({
        type: "listener-error",
        source: safeOptions.mode || "onValue",
        path: safeOptions.path,
        reason: safeOptions.reason,
        viewId: safeOptions.viewId,
        module: safeOptions.module,
        key: safeOptions.key || safeOptions.path,
        message: error?.message || String(error || ""),
      })
      safeOptions.onError?.(error)
    }
  )
  return registerViewListener(safeOptions.viewId, unsubscribe, safeOptions)
}

export function getFirebaseMetricsSnapshot(rangeKey = "since-start") {
  const samples = filterSamplesByRange(rangeKey)
  const modules = buildModuleMetricsSummary(samples, rangeKey)
  const totals = modules.reduce((acc, module) => ({
    getCount: acc.getCount + module.getCount,
    listenerStarts: acc.listenerStarts + module.listenerStarts,
    listenerEvents: acc.listenerEvents + module.listenerEvents,
    bytesReceived: acc.bytesReceived + module.bytesReceived,
    activeListeners: acc.activeListeners + module.activeListeners,
    duplicateListeners: acc.duplicateListeners + module.duplicateListeners,
    riskyReads: acc.riskyReads + module.riskyReads,
    cacheBytes: acc.cacheBytes + module.cacheBytes,
  }), {
    getCount: 0,
    listenerStarts: 0,
    listenerEvents: 0,
    bytesReceived: 0,
    activeListeners: 0,
    duplicateListeners: 0,
    riskyReads: 0,
    cacheBytes: 0,
  })
  const alerts = [
    ...state.metrics.duplicateListeners
      .filter((item) => Number(item.ts || 0) >= getMetricRangeSince(rangeKey))
      .map((item) => ({
        kind: "listener-duplicate",
        module: item.module,
        path: item.path,
        message: `Listener duplicado en ${item.path}`,
      })),
    ...buildRepeatedPathAlerts(samples).map((item) => ({
      kind: item.source === "get" ? "repeated-get" : "repeated-listener",
      module: item.module,
      path: item.path,
      message: `${item.path} se repitio ${item.count} veces`,
      count: item.count,
      bytes: item.bytes,
    })),
  ].slice(0, 24)

  return {
    generatedAt: nowIso(),
    generatedAtTs: nowTs(),
    bootAt: state.metrics.bootAt,
    rangeKey,
    rangeOptions: Object.keys(RANGE_WINDOWS_MS),
    totals,
    modules,
    alerts,
    samples,
    risks: state.bytesRisk.filter((item) => {
      const itemTs = Number(item?.ts || 0) || Date.parse(item?.at || "") || 0
      return itemTs >= getMetricRangeSince(rangeKey)
    }),
    activeListeners: [...state.activeListeners.values()].map((entry) => ({
      viewId: entry.viewId,
      module: entry.module,
      path: entry.path || "",
      key: entry.key || "",
      reason: entry.reason || "",
      mode: entry.mode || "onValue",
      startedAt: entry.startedAt || "",
      events: Number(entry.events || 0),
      bytesReceived: Number(entry.bytesReceived || 0),
      lastEventAt: Number(entry.lastEventAt || 0),
    })),
  }
}

export function clearFirebaseMetrics() {
  state.metrics.samples = []
  state.metrics.duplicateListeners = []
  state.metrics.cacheByModule = new Map()
  state.bytesRisk = []
  state.reads = []
  try {
    localStorage.removeItem(METRICS_STORAGE_KEY)
  } catch (_) {}
}

export function exposeFirebaseReadDebug() {
  if (typeof window === "undefined") return
  window.__bookshellDebug = window.__bookshellDebug || {}
  window.__bookshellDebug.firebaseReads = () => ({
    reads: [...state.reads],
    counts: Object.fromEntries(state.counts.entries()),
    activeListeners: [...state.activeListeners.values()],
    bytesRisk: [...state.bytesRisk],
    suspicious: state.reads.filter((r) => looksHeavyFirebasePath(r.path) && !r.bounded),
  })
  window.__bookshellDebug.firebaseMetrics = (rangeKey = "since-start") => getFirebaseMetricsSnapshot(rangeKey)
  window.__bookshellDebug.clearFirebaseMetrics = () => clearFirebaseMetrics()
  window.__bookshellDebug.formatMetricBytes = (bytes) => formatBytes(bytes)
}

function inferCacheModuleFromKey(key = "") {
  const safeKey = String(key || "").trim()
  if (!safeKey) return "unknown"
  const firstToken = safeKey.split(/[.:/]/).find(Boolean) || ""
  return resolveModuleKey({ module: firstToken, path: safeKey })
}

export function readWithCache({ key, ttlMs, loader }) {
  const storageKey = `bookshell:cache:${key}`
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.cacheUpdatedAt && Date.now() - parsed.cacheUpdatedAt < ttlMs) {
        registerCacheMetric({
          module: inferCacheModuleFromKey(key),
          key: storageKey,
          bytes: estimatePayloadBytes(raw),
          storage: "localStorage",
          reason: "cache-hit",
        })
        return Promise.resolve(parsed.data)
      }
    }
  } catch (_) {}
  return Promise.resolve(loader()).then((data) => {
    try {
      const payload = JSON.stringify({ cacheUpdatedAt: Date.now(), data: cloneDefault(data) })
      localStorage.setItem(storageKey, payload)
      registerCacheMetric({
        module: inferCacheModuleFromKey(key),
        key: storageKey,
        bytes: estimatePayloadBytes(payload),
        storage: "localStorage",
        reason: "cache-save",
      })
    } catch (_) {}
    return data
  })
}
