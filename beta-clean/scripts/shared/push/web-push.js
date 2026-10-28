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

function pushDeviceId(){let id=localStorage.getItem('bookshell:push-device:v1');if(!id){id=crypto.randomUUID();localStorage.setItem('bookshell:push-device:v1',id);}return id;}
async function endpointHash(endpoint){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('').slice(0,16);}
async function currentSubscription(registration,status){let subscription=await registration.pushManager.getSubscription();if(subscription&&(status.expiredEndpointHashes||[]).includes(await endpointHash(subscription.endpoint))){await subscription.unsubscribe();subscription=null;}return subscription;}
async function projectsApi(path,method='GET',data){const r=await fetch('/projects-api/projects/notifications/'+path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});const b=await r.json();if(!r.ok)throw new Error(b.error||'No se pudo consultar notificaciones');return b;}
export const getNotificationStatus=()=>projectsApi('status');
export const saveDailySummarySettings=settings=>projectsApi('settings','PATCH',settings);
export const previewDailySummary=()=>projectsApi('preview','POST',{});
export async function sendDailySummaryTest(summaryTest=true){const subscription=await(await getPushRegistration()).pushManager.getSubscription();if(!subscription)throw new Error('Activa las notificaciones en este dispositivo');return projectsApi('test','POST',{endpoint:subscription.endpoint,summaryTest,requestId:crypto.randomUUID()});}
export async function syncPushRegistration(){if(!('Notification' in window)||Notification.permission!=='granted'||localStorage.getItem('bookshell:push-disabled:v1')==='1')return;const support=await getPushSupport();if(!support.supported)return;const registration=await getPushRegistration(),status=await api('/push/status');if(!status.configured)return;let subscription=await currentSubscription(registration,status);if(!subscription){try{subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(status.vapidPublicKey)});}catch{return;}}await api('/push/subscribe',{method:'POST',body:JSON.stringify({...subscription.toJSON(),deviceId:pushDeviceId()})});}

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
    const localHash=subscription?await endpointHash(subscription.endpoint):null;const serverRegistered=subscription&&(status.subscriptions||[]).some(s=>s.endpointHash===localHash);
    return { ...support, registered: Boolean(serverRegistered)&&localStorage.getItem('bookshell:push-disabled:v1')!=='1', configured: status.configured, subscription, status };
  } catch (statusError) {
    console.warn("[push:status:api]", statusError);
    return { ...support, registered: Boolean(subscription), configured: false, subscription, statusError };
  }
}

export async function enablePush(requestedPermission=null) {
  if(!('Notification' in window))throw new Error('Instala Bookshell en la pantalla de inicio y activa sus notificaciones.');
  const permission = await (requestedPermission||Notification.requestPermission());
  if (permission !== "granted") throw new Error(`notification_permission_${permission}`);
  const support=await getPushSupport();if(!support.supported)throw new Error(`push_unsupported:${support.missingApis.join(',')}`);
  const status = await api("/push/status");
  if (!status.configured || !status.vapidPublicKey) throw new Error("push_not_configured");
  const registration = await getPushRegistration();
  let subscription = await currentSubscription(registration,status);
  localStorage.removeItem('bookshell:push-disabled:v1');
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(status.vapidPublicKey) });
  await api("/push/subscribe", { method: "POST", body: JSON.stringify({...subscription.toJSON(),deviceId:pushDeviceId()}) });
  return subscription;
}

export async function disablePush() {
  localStorage.setItem('bookshell:push-disabled:v1','1');
  const registration = await getPushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
  return true;
}

export async function sendTestPush(){return sendDailySummaryTest(false);}

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
