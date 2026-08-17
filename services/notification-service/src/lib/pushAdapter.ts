import webpush from "web-push";
import { db } from "./db.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:onegov-admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Sends a real Web Push notification (not mocked -- unlike SMS, this needs
 * no paid gateway account, just the VAPID keypair above; the browser's own
 * push service does the delivery). Fans out to every device/browser the
 * citizen has subscribed on. A subscription the push service reports as
 * gone (410) or not-found (404) is expected lifecycle, not a failure -- the
 * browser revoked it, most often by uninstalling the app -- so it's quietly
 * deleted rather than logged as an error.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<{ sent: number; providerRef?: string }> {
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return { sent: 0 };

  let sent = 0;
  let lastRef: string | undefined;
  let failures = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
      lastRef = `push-${sub.id}-${Date.now()}`;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        failures++;
      }
    }
  }

  if (sent === 0 && failures > 0) {
    throw new Error(`push delivery failed for all ${failures} subscription(s)`);
  }
  return { sent, providerRef: lastRef };
}
