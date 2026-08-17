import { getPushPublicKey, subscribeToPush, unsubscribeFromPush } from "../api/onegov";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The browser's push subscription API takes the VAPID public key as raw bytes, not the base64url string the server hands out. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Requests notification permission, opens a push subscription, and registers it with notification-service -- in that order, so nothing is stored server-side unless the browser actually granted permission. */
export async function enablePush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("notification-permission-denied");
  }

  const publicKey = await getPushPublicKey();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await subscribeToPush(subscription.toJSON());
  return subscription;
}

export async function disablePush(): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  await unsubscribeFromPush(subscription.endpoint);
  await subscription.unsubscribe();
}
