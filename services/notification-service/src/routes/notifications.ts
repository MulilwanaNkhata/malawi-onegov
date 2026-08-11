import { Router } from "express";
import { db } from "../lib/db.js";
import { requireAuth } from "../middleware/requireAuth.js";

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

export default router;
