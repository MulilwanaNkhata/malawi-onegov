import { Router, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import axios from "axios";
import { db } from "../lib/db.js";
import { requireAuth, requireRole, requireService } from "../middleware/requireAuth.js";
import { recordAuditEvent } from "../lib/audit.js";
import { publishEvent } from "../lib/eventBus.js";
import {
  createWorkflowInstance,
  transitionWorkflow,
  lookupPaymentForApplication,
} from "../lib/internalClients.js";

const router = Router();

export const FEE_AMOUNT = 2000;
export const FEE_CURRENCY = "MWK";

const STAFF_ROLES = ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"];
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL ?? "http://document-service:4004";

router.get("/fee-schedule", (_req, res) => {
  res.json({ service: "birth_certificate", amount: FEE_AMOUNT, currency: FEE_CURRENCY });
});

const createSchema = z.object({
  childFullName: z.string().min(2),
  dateOfBirth: z.string(), // ISO date, e.g. "2026-01-15"
  placeOfBirth: z.string().min(2),
  sex: z.enum(["MALE", "FEMALE"]),
  motherFullName: z.string().min(2),
  motherNationalId: z.string().optional(),
  fatherFullName: z.string().optional(),
  fatherNationalId: z.string().optional(),
});

router.post("/", requireAuth, requireRole("CITIZEN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const referenceNumber = `BC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const application = await db.birthCertificateApplication.create({
    data: {
      ...parsed.data,
      referenceNumber,
      applicantUserId: req.user!.sub,
      status: "SUBMITTED",
      feeAmount: FEE_AMOUNT,
      feeCurrency: FEE_CURRENCY,
    },
  });

  const workflowInstance = await createWorkflowInstance(application.id);
  await db.birthCertificateApplication.update({
    where: { id: application.id },
    data: { workflowInstanceId: workflowInstance.id },
  });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "BIRTH_CERTIFICATE_APPLICATION_SUBMITTED",
    resourceType: "BirthCertificateApplication",
    resourceId: application.id,
    metadata: { referenceNumber },
  });

  await publishEvent("application.submitted", {
    applicationId: application.id,
    applicantUserId: req.user!.sub,
    referenceNumber,
    childFullName: application.childFullName,
    entityType: "birth_certificate",
    label: application.childFullName,
  });

  return res.status(201).json({
    id: application.id,
    referenceNumber,
    status: application.status,
    feeAmount: FEE_AMOUNT,
    feeCurrency: FEE_CURRENCY,
  });
});

router.get("/", requireAuth, async (req, res) => {
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

  const applications = await db.birthCertificateApplication.findMany({
    where: {
      applicantUserId: isStaff ? undefined : req.user!.sub,
      status: statusFilter,
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(applications);
});

const ALL_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADDITIONAL_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
  "ISSUED",
];

/** Staff reporting view: volume by status and average time-to-issue. */
router.get("/analytics", requireAuth, requireRole(...STAFF_ROLES), async (_req, res) => {
  const [total, statusCounts, issued] = await Promise.all([
    db.birthCertificateApplication.count(),
    db.birthCertificateApplication.groupBy({ by: ["status"], _count: { _all: true } }),
    db.birthCertificateApplication.findMany({
      where: { status: "ISSUED" },
      select: { createdAt: true, updatedAt: true },
    }),
  ]);

  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const row of statusCounts) byStatus[row.status] = row._count._all;

  const averageProcessingHours =
    issued.length === 0
      ? null
      : issued.reduce((sum, a) => sum + (a.updatedAt.getTime() - a.createdAt.getTime()), 0) /
        issued.length /
        (1000 * 60 * 60);

  return res.json({
    totalApplications: total,
    byStatus,
    averageProcessingHours,
  });
});

async function loadApplicationOr404(id: string, res: Response) {
  const application = await db.birthCertificateApplication.findUnique({
    where: { id },
    include: { documents: true },
  });
  if (!application) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return application;
}

router.get("/:id", requireAuth, async (req, res) => {
  const application = await loadApplicationOr404(req.params.id, res);
  if (!application) return;

  const isOwner = application.applicantUserId === req.user!.sub;
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  const payment = await lookupPaymentForApplication(application.id);
  return res.json({ ...application, payment });
});

/** Proxies to document-service's presigned URL, forwarding the citizen's own JWT for ownership checks. */
router.get("/:id/certificate", requireAuth, async (req, res) => {
  const application = await db.birthCertificateApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: "not_found" });

  const isOwner = application.applicantUserId === req.user!.sub;
  const isStaff = STAFF_ROLES.includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  if (!application.certificateDocumentId) {
    return res.status(409).json({ error: "certificate_not_yet_issued" });
  }

  try {
    const { data } = await axios.get(`${DOCUMENT_SERVICE_URL}/files/${application.certificateDocumentId}`, {
      headers: { authorization: req.headers.authorization },
      timeout: 5000,
    });
    return res.json(data);
  } catch {
    return res.status(502).json({ error: "document_service_unavailable" });
  }
});

/** Internal: lets a trusted channel service (e.g. ussd-gateway) look up status by the citizen-facing reference number, without needing a citizen session. */
router.get("/internal/by-reference/:referenceNumber", requireService, async (req, res) => {
  const application = await db.birthCertificateApplication.findUnique({
    where: { referenceNumber: req.params.referenceNumber },
  });
  if (!application) return res.status(404).json({ error: "not_found" });
  return res.json({
    referenceNumber: application.referenceNumber,
    label: application.childFullName,
    status: application.status,
    createdAt: application.createdAt,
  });
});

/** Internal: notification-service resolves "who applied / what's it called" for a status-change event. */
router.get("/internal/:id", requireService, async (req, res) => {
  const application = await db.birthCertificateApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: "not_found" });
  return res.json({
    id: application.id,
    referenceNumber: application.referenceNumber,
    applicantUserId: application.applicantUserId,
    childFullName: application.childFullName,
    label: application.childFullName,
    status: application.status,
  });
});

const documentLinkSchema = z.object({ documentType: z.string(), documentServiceFileId: z.string() });

/** Citizen uploads the file to document-service directly, then registers the link here. */
router.post("/:id/documents", requireAuth, async (req, res) => {
  const application = await db.birthCertificateApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: "not_found" });
  if (application.applicantUserId !== req.user!.sub) return res.status(403).json({ error: "forbidden" });

  const parsed = documentLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const doc = await db.applicationDocument.create({
    data: { applicationId: application.id, ...parsed.data },
  });

  await recordAuditEvent({
    actorUserId: req.user!.sub,
    actorRole: req.user!.role,
    action: "APPLICATION_DOCUMENT_UPLOADED",
    resourceType: "BirthCertificateApplication",
    resourceId: application.id,
    metadata: { documentType: parsed.data.documentType },
  });

  return res.status(201).json(doc);
});

router.post("/:id/resubmit", requireAuth, async (req, res) => {
  const application = await db.birthCertificateApplication.findUnique({ where: { id: req.params.id } });
  if (!application) return res.status(404).json({ error: "not_found" });
  if (application.applicantUserId !== req.user!.sub) return res.status(403).json({ error: "forbidden" });
  if (!application.workflowInstanceId) return res.status(409).json({ error: "no_workflow_instance" });

  try {
    await transitionWorkflow(application.workflowInstanceId, {
      action: "RESUBMIT",
      actorUserId: req.user!.sub,
      actorRole: req.user!.role,
      comment: typeof req.body?.comment === "string" ? req.body.comment : undefined,
    });
  } catch (err) {
    return res.status(409).json({ error: "transition_rejected", details: (err as Error).message });
  }
  return res.status(204).send();
});

const reviewSchema = z.object({
  action: z.enum(["REQUEST_MORE_INFO", "APPROVE", "REJECT"]),
  comment: z.string().optional(),
});

router.post(
  "/:id/review",
  requireAuth,
  requireRole("REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR"),
  async (req, res) => {
    const application = await db.birthCertificateApplication.findUnique({ where: { id: req.params.id } });
    if (!application) return res.status(404).json({ error: "not_found" });
    if (!application.workflowInstanceId) return res.status(409).json({ error: "no_workflow_instance" });

    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });

    if (parsed.data.action !== "REQUEST_MORE_INFO" && req.user!.role !== "REGISTRAR_SUPERVISOR") {
      return res.status(403).json({ error: "only_supervisor_can_approve_or_reject" });
    }

    try {
      const result = await transitionWorkflow(application.workflowInstanceId, {
        action: parsed.data.action,
        actorUserId: req.user!.sub,
        actorRole: req.user!.role,
        comment: parsed.data.comment,
      });
      return res.json({ status: result.currentState });
    } catch (err) {
      return res.status(409).json({ error: "transition_rejected", details: (err as Error).message });
    }
  }
);

export default router;
