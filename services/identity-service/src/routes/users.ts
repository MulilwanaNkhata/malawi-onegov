import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { db } from "../lib/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../lib/audit.js";
import { ROLES } from "../shared.js";

const router = Router();
const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";
const USSD_PIN_LOCKOUT_THRESHOLD = 5;
const USSD_PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function isValidServiceSecret(req: { headers: Record<string, unknown> }): boolean {
  const provided = req.headers["x-service-secret"];
  return typeof provided === "string" && safeEquals(provided, SERVICE_SHARED_SECRET);
}

router.get("/me", requireAuth, async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) return res.status(404).json({ error: "not_found" });
  return res.json({
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    nationalId: user.nationalId,
    role: user.role,
    createdAt: user.createdAt,
  });
});

// Staff directory, e.g. for admin screens listing registrar officers.
router.get(
  "/",
  requireAuth,
  requireRole(ROLES.REGISTRAR_SUPERVISOR, ROLES.SYSTEM_ADMIN),
  async (req, res) => {
    const role = req.query.role as string | undefined;
    const users = await db.user.findMany({
      where: role ? { role: role as never } : undefined,
      select: { id: true, fullName: true, phone: true, role: true, isActive: true },
      orderBy: { fullName: "asc" },
    });
    return res.json(users);
  }
);

/**
 * Internal, service-to-service lookup (not exposed via the public gateway).
 * Lets other domain services resolve a display name for a userId without
 * duplicating identity data into every domain database.
 */
router.get("/internal/:id", async (req, res) => {
  if (!isValidServiceSecret(req)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "not_found" });
  return res.json({ id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role });
});

const setUssdPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits") });

/**
 * Enrolling a USSD PIN requires a real smartphone/portal session (TOTP MFA
 * already passed to get this access token) -- there is deliberately no way
 * to set or reset a PIN from the USSD channel itself, since that would let
 * anyone who merely knows a citizen's phone number take over USSD access.
 */
router.post("/me/ussd-pin", requireAuth, async (req, res) => {
  const parsed = setUssdPinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const ussdPinHash = await bcrypt.hash(parsed.data.pin, 10);
  await db.user.update({
    where: { id: req.user!.sub },
    data: { ussdPinHash, ussdPinSetAt: new Date(), ussdPinFailedAttempts: 0, ussdPinLockedUntil: null },
  });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "USSD_PIN_SET",
    resourceType: "User",
    resourceId: req.user!.sub,
    ipAddress: req.ip,
  });

  return res.status(204).send();
});

const ussdAuthSchema = z.object({ phone: z.string(), pin: z.string() });

/**
 * Internal only, called by ussd-gateway to authenticate a feature-phone
 * session. Same generic failure response whether the phone is unknown, no
 * PIN was ever set, or the PIN is wrong -- doesn't reveal which, to avoid
 * turning this into an account-enumeration oracle. Lockout mirrors the
 * failure-path rigor of the TOTP login flow, adapted for a 4-6 digit PIN's
 * much smaller keyspace.
 */
router.post("/internal/ussd-auth", async (req, res) => {
  if (!isValidServiceSecret(req)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  const parsed = ussdAuthSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  const { phone, pin } = parsed.data;

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !user.isActive || !user.ussdPinHash) {
    return res.status(401).json({ error: "ussd_pin_invalid" });
  }

  if (user.ussdPinLockedUntil && user.ussdPinLockedUntil > new Date()) {
    return res.status(423).json({ error: "ussd_pin_locked", lockedUntil: user.ussdPinLockedUntil });
  }

  const valid = await bcrypt.compare(pin, user.ussdPinHash);
  if (!valid) {
    const attempts = user.ussdPinFailedAttempts + 1;
    const locked = attempts >= USSD_PIN_LOCKOUT_THRESHOLD;
    await db.user.update({
      where: { id: user.id },
      data: {
        ussdPinFailedAttempts: locked ? 0 : attempts,
        ussdPinLockedUntil: locked ? new Date(Date.now() + USSD_PIN_LOCKOUT_DURATION_MS) : null,
      },
    });
    if (locked) {
      await recordAuditEvent({
        actorUserId: user.id,
        actorRole: user.role,
        action: "USSD_PIN_LOCKED",
        resourceType: "User",
        resourceId: user.id,
        metadata: { failedAttempts: attempts },
      });
    }
    return res.status(401).json({ error: "ussd_pin_invalid" });
  }

  if (user.ussdPinFailedAttempts > 0 || user.ussdPinLockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { ussdPinFailedAttempts: 0, ussdPinLockedUntil: null } });
  }

  return res.json({ userId: user.id, fullName: user.fullName, role: user.role });
});

export default router;
