import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../lib/db.js";
import { computeHash, GENESIS_HASH } from "../lib/hashChain.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = Router();
const AUDIT_SHARED_SECRET = process.env.AUDIT_SHARED_SECRET ?? "";

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function serialize(event: {
  sequence: bigint;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  prevHash: string;
  hash: string;
  createdAt: Date;
}) {
  return { ...event, sequence: Number(event.sequence) };
}

const eventSchema = z.object({
  actorUserId: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Internal-only ingestion endpoint. Every other service in the platform
 * calls this to record a security-relevant action. Protected by a shared
 * service secret rather than citizen JWTs since callers are other services,
 * not end users.
 */
router.post("/", async (req, res) => {
  const provided = req.headers["x-audit-secret"];
  if (typeof provided !== "string" || !safeEquals(provided, AUDIT_SHARED_SECRET)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  // Serialize writes so the hash chain cannot fork under concurrent inserts.
  //
  // A plain `db.$transaction(async (tx) => { SELECT last; INSERT })` does
  // NOT actually serialize this under Postgres's default READ COMMITTED
  // isolation: two concurrent transactions can both SELECT the same "last"
  // row before either commits (a SELECT takes no lock that blocks another
  // SELECT), so both compute their new hash from the same prevHash and both
  // successfully INSERT -- forking the chain. This was a real bug here,
  // caught by the integration test suite under concurrent load (multiple
  // services writing audit events at once, which is the normal case, not an
  // edge case). `pg_advisory_xact_lock` forces every writer through this
  // critical section one at a time; the lock is scoped to the transaction
  // and releases automatically on commit/rollback.
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('onegov_audit_chain'))`;
    const last = await tx.auditEvent.findFirst({ orderBy: { sequence: "desc" } });
    const prevHash = last?.hash ?? GENESIS_HASH;
    const createdAt = new Date();

    const hash = computeHash({
      actorUserId: parsed.data.actorUserId ?? null,
      actorRole: parsed.data.actorRole ?? null,
      action: parsed.data.action,
      resourceType: parsed.data.resourceType,
      resourceId: parsed.data.resourceId,
      ipAddress: parsed.data.ipAddress ?? null,
      userAgent: parsed.data.userAgent ?? null,
      metadata: parsed.data.metadata ?? null,
      createdAt: createdAt.toISOString(),
      prevHash,
    });

    return tx.auditEvent.create({
      data: {
        actorUserId: parsed.data.actorUserId ?? null,
        actorRole: parsed.data.actorRole ?? null,
        action: parsed.data.action,
        resourceType: parsed.data.resourceType,
        resourceId: parsed.data.resourceId,
        ipAddress: parsed.data.ipAddress ?? null,
        userAgent: parsed.data.userAgent ?? null,
        metadata: (parsed.data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        createdAt,
        prevHash,
        hash,
      },
    });
  });

  return res.status(201).json(serialize(result));
});

/** Staff/admin query API, e.g. for a SIEM export job or an investigations screen. */
router.get("/", requireAuth, requireRole("REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"), async (req, res) => {
  const { resourceType, resourceId, actorUserId, action, limit } = req.query;
  const events = await db.auditEvent.findMany({
    where: {
      resourceType: typeof resourceType === "string" ? resourceType : undefined,
      resourceId: typeof resourceId === "string" ? resourceId : undefined,
      actorUserId: typeof actorUserId === "string" ? actorUserId : undefined,
      action: typeof action === "string" ? action : undefined,
    },
    orderBy: { sequence: "desc" },
    take: Math.min(Number(limit) || 100, 500),
  });
  return res.json(events.map(serialize));
});

/** Walks the full chain and confirms no record has been altered or removed. */
router.get("/verify", requireAuth, requireRole("SYSTEM_ADMIN"), async (_req, res) => {
  const events = await db.auditEvent.findMany({ orderBy: { sequence: "asc" } });

  let expectedPrevHash = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) {
      return res.json({ valid: false, brokenAtSequence: Number(event.sequence), checkedCount: events.length });
    }
    const recomputed = computeHash({
      actorUserId: event.actorUserId,
      actorRole: event.actorRole,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
      prevHash: event.prevHash,
    });
    if (recomputed !== event.hash) {
      return res.json({ valid: false, brokenAtSequence: Number(event.sequence), checkedCount: events.length });
    }
    expectedPrevHash = event.hash;
  }

  return res.json({ valid: true, checkedCount: events.length });
});

export default router;
