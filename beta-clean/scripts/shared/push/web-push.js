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

export function getPushSupport() {
  return { supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported" };
}

export async function getPushRegistration() {
  const registration = await navigator.serviceWorker.getRegistration("./") || await navigator.serviceWorker.ready;
  if (!registration) throw new Error("service_worker_not_registered");
  return registration;
}

export async function getPushState() {
  const support = getPushSupport();
  if (!support.supported) return { ...support, registered: false, configured: false };
  const [registration, status] = await Promise.all([getPushRegistration(), api("/push/status")]);
  const subscription = await registration.pushManager.getSubscription();
  return { ...support, registered: Boolean(subscription), configured: status.configured, subscription, status };
}

export async function enablePush() {
  if (!getPushSupport().supported) throw new Error("push_unsupported");
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
