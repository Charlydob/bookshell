const GOOGLE_SHEETS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbxqyaxc9OfULInEGT-U8qFuIW3QXe6yiULLP97FLb7nOi6H9S9ULplFU136vHM_Q8k67Q/exec";

const GOOGLE_SHEETS_TOKEN = "MiTokenSuperSecreto123456";
const GOOGLE_SHEETS_PENDING_TICKET_SYNC_KEY = "bookshell_finance_gs_pending_ticket_sync_v1";

function readPendingTicketSyncQueue() {
  try {
    const raw = window?.localStorage?.getItem(GOOGLE_SHEETS_PENDING_TICKET_SYNC_KEY) || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (_) {
    return [];
  }
}

function writePendingTicketSyncQueue(queue = []) {
  try {
    window?.localStorage?.setItem(GOOGLE_SHEETS_PENDING_TICKET_SYNC_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
  } catch (_) {}
}

function ticketSyncQueueKey(payload = {}) {
  return String(
    payload?.ticket?.id
    || payload?.ticket?.ticketId
    || payload?.ticket?.movementId
    || payload?.ticket?.txId
    || payload?.ticketId
    || "",
  ).trim();
}

function enqueuePendingTicketSync(data = {}, meta = {}) {
  const safeKey = ticketSyncQueueKey(data);
  if (!safeKey) return;
  const queue = readPendingTicketSyncQueue();
  const nextEntry = {
    key: safeKey,
    entity: "ticket",
    action: "confirm",
    data,
    queuedAt: Number(meta?.queuedAt || Date.now()),
    lastError: String(meta?.lastError || "").trim(),
    attempts: Math.max(1, Number(meta?.attempts || 1)),
  };
  const filtered = queue.filter((entry) => String(entry?.key || "").trim() !== safeKey);
  filtered.push(nextEntry);
  writePendingTicketSyncQueue(filtered);
}

function removePendingTicketSync(data = {}) {
  const safeKey = ticketSyncQueueKey(data);
  if (!safeKey) return;
  const queue = readPendingTicketSyncQueue();
  writePendingTicketSyncQueue(queue.filter((entry) => String(entry?.key || "").trim() !== safeKey));
}

async function postToGoogleSheets(entity, action, data, options = {}) {
  try {
    const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        token: GOOGLE_SHEETS_TOKEN,
        entity,
        action,
        data,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Google Sheets sync failed: ${response.status} ${text}`);
    }

    if (!text) return;

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      console.warn("[finance] Google Sheets sync response was not JSON:", text);
      return { ok: true, raw: text };
    }

    if (!json?.ok) {
      throw new Error(json?.error || "Google Sheets sync returned ok=false");
    }

    return json;
  } catch (err) {
    console.warn("[finance] Google Sheets sync failed", { entity, action, data, err });
    if (options?.throwOnError) throw err;
    return { ok: false, error: err };
  }
}

export async function syncTicketConfirmToGoogleSheets(data = {}, options = {}) {
  try {
    const result = await postToGoogleSheets("ticket", "confirm", data, { throwOnError: true });
    removePendingTicketSync(data);
    return result || { ok: true };
  } catch (err) {
    if (options.enqueueOnError !== false) {
      enqueuePendingTicketSync(data, {
        lastError: err?.message || String(err || ""),
        attempts: Number(options?.attempts || 1),
      });
    }
    throw err;
  }
}

export async function flushPendingTicketSyncToGoogleSheets() {
  const queue = readPendingTicketSyncQueue();
  if (!queue.length) return { ok: true, flushed: 0, pending: 0 };
  let flushed = 0;
  for (const entry of queue) {
    const payload = entry?.data && typeof entry.data === "object" ? entry.data : null;
    if (!payload) continue;
    await syncTicketConfirmToGoogleSheets(payload, {
      enqueueOnError: true,
      attempts: Number(entry?.attempts || 1) + 1,
    });
    flushed += 1;
  }
  return { ok: true, flushed, pending: readPendingTicketSyncQueue().length };
}

export function getPendingTicketSyncCount() {
  return readPendingTicketSyncQueue().length;
}

export function syncMovementCreateToGoogleSheets(movement) {
  return postToGoogleSheets("movement", "create", movement);
}

export function syncMovementUpdateToGoogleSheets(movement) {
  return postToGoogleSheets("movement", "update", movement);
}

export function syncMovementDeleteToGoogleSheets(movementId) {
  return postToGoogleSheets("movement", "delete", {
    id: String(movementId || "").trim(),
  });
}

export function syncProductUpsertToGoogleSheets(product) {
  return postToGoogleSheets("product", "update", product);
}

export function syncProductDeleteToGoogleSheets(productId) {
  return postToGoogleSheets("product", "delete", {
    id: String(productId || "").trim(),
  });
}

export function syncAccountCreateToGoogleSheets(account) {
  return postToGoogleSheets("account", "create", account);
}

export function syncProductSummaryUpsertToGoogleSheets(summary) {
  return postToGoogleSheets("productSummary", "update", summary);
}

export function syncProductSummaryDeleteToGoogleSheets(summary) {
  return postToGoogleSheets("productSummary", "delete", {
    product: String(summary?.product || "").trim(),
    supermarketName: String(summary?.supermarketName || "").trim(),
  });
}
