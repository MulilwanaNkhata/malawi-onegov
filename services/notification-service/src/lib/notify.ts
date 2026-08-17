import { db } from "./db.js";
import { sendSms, sendEmail } from "./channels.js";
import { sendPush } from "./pushAdapter.js";
import { resolveUserContact } from "./internalClients.js";

export async function notifyUser(
  recipientUserId: string,
  templateCode: string,
  subject: string,
  body: string
): Promise<void> {
  const contact = await resolveUserContact(recipientUserId);
  if (!contact) {
    console.warn("[notification-service] could not resolve contact for", recipientUserId);
    return;
  }

  try {
    const { providerRef } = await sendSms(contact.phone, body);
    await db.notificationLog.create({
      data: { recipientUserId, channel: "SMS", templateCode, subject, body, status: "SENT", providerRef },
    });
  } catch (err) {
    await db.notificationLog.create({
      data: { recipientUserId, channel: "SMS", templateCode, subject, body, status: "FAILED" },
    });
    console.error("[notification-service] sms failed", (err as Error).message);
  }

  // Email is optional at registration -- only send if the citizen provided one.
  if (contact.email) {
    try {
      const { providerRef } = await sendEmail(contact.email, subject, body);
      await db.notificationLog.create({
        data: { recipientUserId, channel: "EMAIL", templateCode, subject, body, status: "SENT", providerRef },
      });
    } catch (err) {
      await db.notificationLog.create({
        data: { recipientUserId, channel: "EMAIL", templateCode, subject, body, status: "FAILED" },
      });
      console.error("[notification-service] email failed", (err as Error).message);
    }
  }

  // Push is opt-in from the citizen-portal PWA (Profile page) -- only
  // attempt it, and only log it, if there's actually a subscription to
  // send to; a citizen who never enabled push shouldn't accumulate FAILED
  // rows for a channel they never turned on.
  try {
    const { sent, providerRef } = await sendPush(recipientUserId, { title: subject, body });
    if (sent > 0) {
      await db.notificationLog.create({
        data: { recipientUserId, channel: "PUSH", templateCode, subject, body, status: "SENT", providerRef },
      });
    }
  } catch (err) {
    await db.notificationLog.create({
      data: { recipientUserId, channel: "PUSH", templateCode, subject, body, status: "FAILED" },
    });
    console.error("[notification-service] push failed", (err as Error).message);
  }
}
