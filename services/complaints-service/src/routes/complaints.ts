import { Router, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../lib/db.js";
import { requireAuth, requireRole, requireService } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../lib/audit.js";
import { publishEvent } from "../lib/eventBus.js";
import { createWorkflowInstance, transitionWorkflow } from "../lib/internalClients.js";

const router = Router();

const STAFF_ROLES = ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"];

const CATEGORIES = ["SERVICE_QUALITY", "CORRUPTION", "DELAY", "STAFF_CONDUCT", "OTHER"] as const;

router.get("/categories", (_req, res) => res.json(CATEGORIES));

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  subject: z.string().min(3),
  description: z.string().min(10),
  relatedServiceType: z.string().optional(),
  relatedReferenceNumber: z.string().optional(),
});

router.post("/", requireAuth, requireRole("CITIZEN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const referenceNumber = `CMP-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const complaint = await db.complaint.create({
    data: {
      ...parsed.data,
      referenceNumber,
      citizenUserId: req.user!.sub,
      status: "OPEN",
    },
  });

  const workflowInstance = await createWorkflowInstance(complaint.id);
  await db.complaint.update({ where: { id: complaint.id }, data: { workflowInstanceId: workflowInstance.id } });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "COMPLAINT_SUBMITTED",
    resourceType: "Complaint",
    resourceId: complaint.id,
    metadata: { referenceNumber, category: complaint.category },
  });

  await publishEvent("application.submitted", {
    applicantUserId: req.user!.sub,
    referenceNumber,
    entityType: "complaint",
    label: complaint.subject,
  });

  return res.status(201).json({ id: complaint.id, referenceNumber, status: complaint.status });
});

router.get("/", requireAuth, async (req, res) => {
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

  const complaints = await db.complaint.findMany({
    where: {
      citizenUserId: isStaff ? undefined : req.user!.sub,
      status: statusFilter,
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(complaints);
});

const ALL_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

/** Staff reporting view: volume by status/category, average time-to-resolve. */
router.get("/analytics", requireAuth, requireRole(...STAFF_ROLES), async (_req, res) => {
  const [total, statusCounts, categoryCounts, resolved] = await Promise.all([
    db.complaint.count(),
    db.complaint.groupBy({ by: ["status"], _count: { _all: true } }),
    db.complaint.groupBy({ by: ["category"], _count: { _all: true } }),
    db.complaint.findMany({
      where: { status: { in: ["RESOLVED", "CLOSED"] } },
      select: { createdAt: true, updatedAt: true },
    }),
  ]);

  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const row of statusCounts) byStatus[row.status] = row._count._all;

  const byCategory: Record<string, number> = {};
  for (const row of categoryCounts) byCategory[row.category] = row._count._all;

  const averageResolutionHours =
    resolved.length === 0
      ? null
      : resolved.reduce((sum, c) => sum + (c.updatedAt.getTime() - c.createdAt.getTime()), 0) /
        resolved.length /
        (1000 * 60 * 60);

  return res.json({ totalComplaints: total, byStatus, byCategory, averageResolutionHours });
});

async function loadComplaintOr404(id: string, res: Response) {
  const complaint = await db.complaint.findUnique({
    where: { id },
    include: { responses: { orderBy: { createdAt: "asc" } } },
  });
  if (!complaint) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return complaint;
}

router.get("/:id", requireAuth, async (req, res) => {
  const complaint = await loadComplaintOr404(req.params.id, res);
  if (!complaint) return;

  const isOwner = complaint.citizenUserId === req.user!.sub;
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  return res.json(complaint);
});

const responseSchema = z.object({ message: z.string().min(1) });

/** A message on the thread that doesn't necessarily change status -- e.g. a staff clarifying question. */
router.post("/:id/responses", requireAuth, async (req, res) => {
  const complaint = await db.complaint.findUnique({ where: { id: req.params.id } });
  if (!complaint) return res.status(404).json({ error: "not_found" });

  const isOwner = complaint.citizenUserId === req.user!.sub;
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  const parsed = responseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const response = await db.complaintResponse.create({
    data: {
      complaintId: complaint.id,
      authorUserId: req.user!.sub,
      authorRole: req.user!.role,
      message: parsed.data.message,
    },
  });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "COMPLAINT_RESPONSE_ADDED",
    resourceType: "Complaint",
    resourceId: complaint.id,
  });

  if (isStaff) {
    await publishEvent("complaint.response_added", {
      complaintId: complaint.id,
      referenceNumber: complaint.referenceNumber,
      recipientUserId: complaint.citizenUserId,
    });
  }

  return res.status(201).json(response);
});

const actionSchema = z.object({
  action: z.enum(["ASSIGN", "RESOLVE", "CLOSE", "REOPEN"]),
  message: z.string().optional(),
});

/** Single generic transition endpoint, same shape as the review endpoints on the other two pilot services -- workflow-service enforces which role may fire which action. */
router.post("/:id/action", requireAuth, async (req, res) => {
  const complaint = await db.complaint.findUnique({ where: { id: req.params.id } });
  if (!complaint) return res.status(404).json({ error: "not_found" });
  if (!complaint.workflowInstanceId) return res.status(409).json({ error: "no_workflow_instance" });

  const isOwner = complaint.citizenUserId === req.user!.sub;
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  if (parsed.data.action === "RESOLVE" && !parsed.data.message) {
    return res.status(400).json({ error: "resolution_message_required" });
  }

  try {
    const result = await transitionWorkflow(complaint.workflowInstanceId, {
      action: parsed.data.action,
      actorUserId: req.user!.sub,
      actorRole: req.user!.role,
      comment: parsed.data.message,
    });

    if (parsed.data.message) {
      await db.complaintResponse.create({
        data: {
          complaintId: complaint.id,
          authorUserId: req.user!.sub,
          authorRole: req.user!.role,
          message: parsed.data.message,
        },
      });
    }

    return res.json({ status: result.currentState });
  } catch (err) {
    return res.status(409).json({ error: "transition_rejected", details: (err as Error).message });
  }
});

/** Internal: notification-service resolves "who filed this / what's it called" for a status-change event. */
router.get("/internal/:id", requireService, async (req, res) => {
  const complaint = await db.complaint.findUnique({ where: { id: req.params.id } });
  if (!complaint) return res.status(404).json({ error: "not_found" });
  return res.json({
    id: complaint.id,
    referenceNumber: complaint.referenceNumber,
    applicantUserId: complaint.citizenUserId,
    label: complaint.subject,
    status: complaint.status,
  });
});

export default router;
