import { API_BASE_URL } from "../data/config.js";

function api(path, options = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.reason || body.error || `HTTP ${response.status}`), { response, body });
    return body;
  });
}

function decodeVapidKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const bytes = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export async function getPushSupport() {
  const serviceWorkerAvailable = "serviceWorker" in navigator;
  const notificationAvailable = "Notification" in window;
  let registration = null;

  if (serviceWorkerAvailable) {
    try {
      registration = await navigator.serviceWorker.getRegistration("./");
    } catch (error) {
      console.warn("[push:support:registration]", error);
    }
  }

  const registrationPushManagerAvailable = Boolean(registration?.pushManager);
  const diagnostics = {
    currentUrl: window.location.href,
    displayModeStandalone: Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches),
    navigatorStandalone: navigator.standalone,
    serviceWorkerAvailable,
    serviceWorkerRegistrationActive: Boolean(registration?.active),
    pushManagerGlobalAvailable: "PushManager" in window,
    registrationPushManagerAvailable,
    notificationAvailable,
    notificationPermission: notificationAvailable ? Notification.permission : "unsupported",
  };
  const missingApis = [
    !serviceWorkerAvailable && "navigator.serviceWorker",
    !registration && "ServiceWorkerRegistration",
    !registrationPushManagerAvailable && "ServiceWorkerRegistration.pushManager",
    !notificationAvailable && "Notification",
  ].filter(Boolean);

  return {
    supported: serviceWorkerAvailable && registrationPushManagerAvailable && notificationAvailable,
    permission: diagnostics.notificationPermission,
    diagnostics,
    missingApis,
  };
}

export async function getPushRegistration() {
  const registration = await navigator.serviceWorker.getRegistration("./") || await navigator.serviceWorker.ready;
  if (!registration) throw new Error("service_worker_not_registered");
  return registration;
}

export async function getPushState() {
  const support = await getPushSupport();
  if (!support.supported) return { ...support, registered: false, configured: false };
  const registration = await getPushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  try {
    const status = await api("/push/status");
    return { ...support, registered: Boolean(subscription), configured: status.configured, subscription, status };
  } catch (statusError) {
    console.warn("[push:status:api]", statusError);
    return { ...support, registered: Boolean(subscription), configured: false, subscription, statusError };
  }
}

export async function enablePush() {
  const support = await getPushSupport();
  if (!support.supported) throw new Error(`push_unsupported:${support.missingApis.join(",")}`);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(`notification_permission_${permission}`);
  const status = await api("/push/status");
  if (!status.configured || !status.vapidPublicKey) throw new Error("push_not_configured");
  const registration = await getPushRegistration();
  let subscription = await registration.pushManager.getSubscription();
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(status.vapidPublicKey) });
  await api("/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
  return subscription;
}

export async function disablePush() {
  const registration = await getPushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
  return true;
}

export async function sendTestPush() {
  const subscription = await (await getPushRegistration()).pushManager.getSubscription();
  if (!subscription) throw new Error("device_not_registered");
  return api("/push/test", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
}

export async function sendTodayPendingPush(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich") {
  return api("/reminders/today/push", {
    method: "POST",
    body: JSON.stringify({ timezone }),
  });
}

export async function sendReminderTestPush(reminderId = "", kind = "reminder") {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId) throw new Error("reminder_required");
  const subscription = await (await getPushRegistration()).pushManager.getSubscription();
  if (!subscription) throw new Error("device_not_registered");
  return api(`/reminders/${encodeURIComponent(safeReminderId)}/test-push`, {
    method: "POST",
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      kind,
    }),
  });
}

export async function getShortcutStatus() {
  return api("/shortcuts/status", { method: "GET" });
}

export async function generateShortcutToken() {
  return api("/shortcuts/token", { method: "POST", body: JSON.stringify({}) });
}

export async function revokeShortcutToken() {
  return api("/shortcuts/token", { method: "DELETE" });
}

function filenameFromContentDisposition(value = "") {
  const utfMatch = String(value || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].trim().replace(/^"|"$/g, ""));
  const asciiMatch = String(value || "").match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1]?.trim() || "";
}

export async function downloadBookshellExport() {
  const response = await fetch(`${API_BASE_URL}/export`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { response, body });
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(response.headers.get("Content-Disposition") || "")
    || `bookshell-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { filename, size: blob.size };
}
