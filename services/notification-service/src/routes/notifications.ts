import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getVapidPublicKey } from "../lib/pushAdapter.js";

const router = Router();

/** Citizen's in-app notification inbox. */
router.get("/", requireAuth, async (req, res) => {
  const notifications = await db.notificationLog.findMany({
    where: { recipientUserId: req.user!.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json(notifications);
});

/** The public half of the VAPID keypair -- not secret, needed by the browser to open a push subscription. */
router.get("/push/public-key", requireAuth, (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) return res.status(503).json({ error: "push_not_configured" });
  return res.json({ publicKey });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Registers (or re-registers) the calling browser/device to receive push notifications for this citizen. */
router.post("/push/subscribe", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const { endpoint, keys } = parsed.data;
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: req.user!.sub, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    // A citizen could in principle re-subscribe on a different account on
    // the same browser profile -- re-point the existing row rather than
    // erroring on the unique endpoint, so the newer login wins.
    update: { userId: req.user!.sub, p256dh: keys.p256dh, auth: keys.auth },
  });
  return res.status(204).send();
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

/** Called when the citizen turns push off from the portal, or the browser reports the subscription is gone. */
router.delete("/push/subscribe", requireAuth, async (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  await db.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: req.user!.sub } });
  return res.status(204).send();
});

export default router;
