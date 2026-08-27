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
