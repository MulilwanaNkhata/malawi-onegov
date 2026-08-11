import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../lib/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../lib/audit.js";
import { publishEvent } from "../lib/eventBus.js";
import { MockMobileMoneyAdapter } from "../lib/providerAdapter.js";

const router = Router();

async function completePayment(referenceNumber: string, providerTransactionId: string) {
  const payment = await db.payment.findUnique({ where: { referenceNumber } });
  if (!payment || payment.status !== "PENDING") return;

  const updated = await db.payment.update({
    where: { id: payment.id },
    data: { status: "COMPLETED", providerTransactionId, completedAt: new Date() },
  });

  await recordAuditEvent({
    actorUserId: null,
    actorRole: "SYSTEM",
    action: "PAYMENT_COMPLETED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { referenceNumber, providerTransactionId, amount: payment.amount.toString() },
  });

  await publishEvent("payment.completed", {
    paymentId: updated.id,
    entityType: updated.entityType,
    entityId: updated.entityId,
    referenceNumber: updated.referenceNumber,
    amount: updated.amount.toString(),
    payerUserId: updated.payerUserId,
  });
}

const adapter = new MockMobileMoneyAdapter(completePayment);

const initiateSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("MWK"),
  provider: z.enum(["AIRTEL_MONEY", "TNM_MPAMBA", "BANK_TRANSFER"]),
  phoneNumber: z.string().min(9),
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const { entityType, entityId, amount, currency, provider, phoneNumber } = parsed.data;

  const referenceNumber = `PAY-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const payment = await db.payment.create({
    data: {
      referenceNumber,
      entityType,
      entityId,
      payerUserId: req.user!.sub,
      amount,
      currency,
      provider,
      phoneNumber,
      status: "PENDING",
    },
  });

  const { providerTransactionId } = await adapter.initiate({ amount, phoneNumber, referenceNumber });
  await db.payment.update({ where: { id: payment.id }, data: { providerTransactionId } });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "PAYMENT_INITIATED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { referenceNumber, provider, amount },
  });

  return res.status(201).json({
    id: payment.id,
    referenceNumber,
    status: "PENDING",
    note: "In this scaffold, payment auto-completes ~3s after initiation to simulate a mobile money provider webhook.",
  });
});

/**
 * The endpoint a real Airtel Money / TNM Mpamba integration would call back
 * on payment completion. Exposed here so it can also be invoked manually
 * (e.g. via curl) to demo the flow without waiting for the mock timer.
 */
const webhookSchema = z.object({ referenceNumber: z.string(), providerTransactionId: z.string() });
router.post("/webhook/mock-provider", async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  await completePayment(parsed.data.referenceNumber, parsed.data.providerTransactionId);
  return res.status(204).send();
});

router.get("/", requireAuth, async (req, res) => {
  const payments = await db.payment.findMany({
    where: { payerUserId: req.user!.sub },
    orderBy: { createdAt: "desc" },
  });
  return res.json(payments);
});

/** Staff reporting view: revenue collected and volume by mobile money provider. */
router.get(
  "/analytics",
  requireAuth,
  requireRole("REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"),
  async (_req, res) => {
    const completed = await db.payment.findMany({
      where: { status: "COMPLETED" },
      select: { amount: true, provider: true },
    });

    const totalCollected = completed.reduce((sum, p) => sum + Number(p.amount), 0);
    const byProvider: Record<string, { count: number; total: number }> = {};
    for (const p of completed) {
      const entry = byProvider[p.provider] ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(p.amount);
      byProvider[p.provider] = entry;
    }

    return res.json({
      totalCollected,
      totalTransactions: completed.length,
      currency: "MWK",
      byProvider,
    });
  }
);

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";

/** Internal: lets civil-registration-service check "has this application's fee been paid?" */
router.get("/by-entity/lookup", async (req, res) => {
  if (req.headers["x-service-secret"] !== SERVICE_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  const { entityType, entityId } = req.query;
  const payment = await db.payment.findFirst({
    where: {
      entityType: typeof entityType === "string" ? entityType : undefined,
      entityId: typeof entityId === "string" ? entityId : undefined,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) return res.status(404).json({ error: "not_found" });
  return res.json(payment);
});

router.get("/:id", requireAuth, async (req, res) => {
  const payment = await db.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: "not_found" });
  const isOwner = payment.payerUserId === req.user!.sub;
  const isStaff = ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"].includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });
  return res.json(payment);
});

export default router;
