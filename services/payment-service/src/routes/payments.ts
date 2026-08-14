import { Router } from "express";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "crypto";
import { db } from "../lib/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../lib/audit.js";
import { publishEvent } from "../lib/eventBus.js";
import { MockMobileMoneyAdapter } from "../lib/providerAdapter.js";

const router = Router();
const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function isValidServiceSecret(req: { headers: Record<string, unknown> }): boolean {
  const provided = req.headers["x-service-secret"];
  return typeof provided === "string" && safeEquals(provided, SERVICE_SHARED_SECRET);
}

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

/** Shared by the citizen-facing POST / below and the internal pay-on-behalf endpoint (USSD channel). */
async function createAndInitiatePayment(
  payerUserId: string,
  actorRole: string,
  data: z.infer<typeof initiateSchema>,
  channel: "portal" | "ussd"
) {
  const { entityType, entityId, amount, currency, provider, phoneNumber } = data;
  const referenceNumber = `PAY-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const payment = await db.payment.create({
    data: {
      referenceNumber,
      entityType,
      entityId,
      payerUserId,
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
    actorUserId: payerUserId,
    actorRole,
    action: "PAYMENT_INITIATED",
    resourceType: "Payment",
    resourceId: payment.id,
    metadata: { referenceNumber, provider, amount, channel },
  });

  return { id: payment.id, referenceNumber };
}

router.post("/", requireAuth, async (req, res) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const { id, referenceNumber } = await createAndInitiatePayment(req.user!.sub, req.user!.role, parsed.data, "portal");

  return res.status(201).json({
    id,
    referenceNumber,
    status: "PENDING",
    note: "In this scaffold, payment auto-completes ~3s after initiation to simulate a mobile money provider webhook.",
  });
});

const payOnBehalfSchema = initiateSchema
  .omit({ provider: true })
  .extend({ payerUserId: z.string().uuid(), provider: z.enum(["AIRTEL_MONEY", "TNM_MPAMBA"]) });

/**
 * Internal only: lets a trusted channel service (currently ussd-gateway)
 * start a fee payment on a citizen's behalf, having already authenticated
 * and authorized them itself (PIN + ownership check, not a JWT -- feature
 * phones can't hold a session token). Deliberately excludes BANK_TRANSFER
 * from the provider choice -- that's not something a USSD menu maps to.
 */
router.post("/internal/pay-on-behalf", async (req, res) => {
  if (!isValidServiceSecret(req)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  const parsed = payOnBehalfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const { payerUserId, ...data } = parsed.data;
  const { id, referenceNumber } = await createAndInitiatePayment(payerUserId, "CITIZEN", data, "ussd");

  return res.status(201).json({
    id,
    referenceNumber,
    status: "PENDING",
  });
});

/**
 * The endpoint a real Airtel Money / TNM Mpamba integration would call back
 * on payment completion. A real provider webhook is always authenticated
 * (signature or shared secret) -- this one requires the same internal
 * service secret every other trusted-caller endpoint in the platform does,
 * both to mirror that reality and because without it, anyone who learns a
 * referenceNumber (e.g. the citizen who just made the payment) could mark
 * their own government fee "paid" without paying it. Still invokable
 * manually via curl to demo the flow without waiting for the mock timer --
 * just needs the header, same as any other internal call.
 */
const webhookSchema = z.object({ referenceNumber: z.string(), providerTransactionId: z.string() });
router.post("/webhook/mock-provider", async (req, res) => {
  if (!isValidServiceSecret(req)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
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

/** Internal: lets civil-registration-service check "has this application's fee been paid?" */
router.get("/by-entity/lookup", async (req, res) => {
  if (!isValidServiceSecret(req)) {
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
