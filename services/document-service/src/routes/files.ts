import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { z } from "zod";
import { db } from "../lib/db.js";
import { minioClient, BUCKET, presignedDownloadUrl } from "../lib/storage.js";
import { requireAuth, requireService } from "../middleware/requireAuth.js";
import { renderBirthCertificatePdf, renderTradingLicenseCertificatePdf } from "../lib/certificatePdf.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file_required" });
  if (!MAX_ALLOWED_MIME.has(req.file.mimetype)) {
    return res.status(400).json({ error: "unsupported_file_type", allowed: [...MAX_ALLOWED_MIME] });
  }

  const meta = z
    .object({ entityType: z.string(), entityId: z.string(), documentType: z.string() })
    .safeParse(req.body);
  if (!meta.success) return res.status(400).json({ error: "validation_error" });

  const { entityType, entityId, documentType } = meta.data;
  const storageKey = `${entityType}/${entityId}/${uuidv4()}-${req.file.originalname}`;
  const checksumSha256 = createHash("sha256").update(req.file.buffer).digest("hex");

  await minioClient.putObject(BUCKET, storageKey, req.file.buffer, req.file.size, {
    "Content-Type": req.file.mimetype,
  });

  const stored = await db.storedFile.create({
    data: {
      ownerUserId: req.user!.sub,
      entityType,
      entityId,
      documentType,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey,
      checksumSha256,
    },
  });

  return res.status(201).json({ id: stored.id, documentType: stored.documentType, originalName: stored.originalName });
});

router.get("/:id", requireAuth, async (req, res) => {
  const file = await db.storedFile.findUnique({ where: { id: req.params.id } });
  if (!file) return res.status(404).json({ error: "not_found" });

  const isOwner = file.ownerUserId === req.user!.sub;
  const isStaff = ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR", "SYSTEM_ADMIN"].includes(req.user!.role);
  if (!isOwner && !isStaff) return res.status(403).json({ error: "forbidden" });

  const downloadUrl = await presignedDownloadUrl(file.storageKey);
  return res.json({
    id: file.id,
    documentType: file.documentType,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    checksumSha256: file.checksumSha256,
    createdAt: file.createdAt,
    downloadUrl,
  });
});

const generateCertificateSchema = z.object({
  ownerUserId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  referenceNumber: z.string(),
  childFullName: z.string(),
  dateOfBirth: z.string(),
  placeOfBirth: z.string(),
  sex: z.string(),
  motherFullName: z.string(),
  fatherFullName: z.string().optional(),
});

/** Internal: civil-registration-service calls this when an application is APPROVED. */
router.post("/generate-certificate", requireService, async (req, res) => {
  const parsed = generateCertificateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const data = parsed.data;

  const issuedAt = new Date().toISOString().slice(0, 10);
  const pdfBuffer = await renderBirthCertificatePdf({ ...data, issuedAt });
  const storageKey = `certificates/${data.entityId}/birth-certificate-${data.referenceNumber}.pdf`;
  const checksumSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

  await minioClient.putObject(BUCKET, storageKey, pdfBuffer, pdfBuffer.length, {
    "Content-Type": "application/pdf",
  });

  const stored = await db.storedFile.create({
    data: {
      ownerUserId: data.ownerUserId,
      entityType: data.entityType,
      entityId: data.entityId,
      documentType: "BIRTH_CERTIFICATE",
      originalName: `birth-certificate-${data.referenceNumber}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
      storageKey,
      checksumSha256,
    },
  });

  return res.status(201).json({ id: stored.id });
});

const generateTradingLicenseSchema = z.object({
  ownerUserId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  referenceNumber: z.string(),
  businessName: z.string(),
  businessType: z.string(),
  tradingAddress: z.string(),
  district: z.string(),
  ownerFullName: z.string(),
});

/** Internal: trading-license-service calls this when an application is APPROVED. */
router.post("/generate-trading-license-certificate", requireService, async (req, res) => {
  const parsed = generateTradingLicenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  const data = parsed.data;

  const issuedAt = new Date().toISOString().slice(0, 10);
  const pdfBuffer = await renderTradingLicenseCertificatePdf({ ...data, issuedAt });
  const storageKey = `certificates/${data.entityId}/trading-license-${data.referenceNumber}.pdf`;
  const checksumSha256 = createHash("sha256").update(pdfBuffer).digest("hex");

  await minioClient.putObject(BUCKET, storageKey, pdfBuffer, pdfBuffer.length, {
    "Content-Type": "application/pdf",
  });

  const stored = await db.storedFile.create({
    data: {
      ownerUserId: data.ownerUserId,
      entityType: data.entityType,
      entityId: data.entityId,
      documentType: "TRADING_LICENSE",
      originalName: `trading-license-${data.referenceNumber}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
      storageKey,
      checksumSha256,
    },
  });

  return res.status(201).json({ id: stored.id });
});

export default router;
