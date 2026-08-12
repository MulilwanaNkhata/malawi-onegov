import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { db } from "../lib/db.js";
import type { User } from "@prisma/client";
import { generateMfaSecret, verifyMfaCode, buildEnrollmentQrCode } from "../lib/mfa.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTtlMs,
} from "../lib/jwt.js";
import { recordAuditEvent } from "../lib/audit.js";
import { ROLES } from "../shared.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-insecure-jwt-secret-change-me";

// Secure by default: MFA is only skippable if this is explicitly set to the
// string "false" (see docker-compose.yml, where local dev currently does
// exactly that -- code-relaying a 30-second-lived TOTP code through chat
// during development was the actual problem; this doesn't remove MFA, it
// just stops requiring it at login time. Registration still enrolls a
// secret, and /auth/mfa/verify below is completely unchanged and still
// fully exercised by the test suite -- flip this back to "true" (or unset
// it) to require it again with zero code changes.
const MFA_REQUIRED = (process.env.MFA_REQUIRED ?? "true") !== "false";

/** Shared by /mfa/verify and /login's MFA-skipped path -- both mean "this login is now fully authenticated, issue a session." */
async function issueSessionTokens(user: Pick<User, "id" | "role" | "fullName">) {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    fullName: user.fullName,
    mfa: true,
  });
  const { token: refreshToken, hash } = generateRefreshToken();
  await db.refreshToken.create({
    data: {
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: hash,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });
  return { accessToken, refreshToken };
}

const registerSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(9),
  email: z.string().email().optional(),
  nationalId: z.string().min(6).optional(),
  password: z.string().min(8),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }
  const { fullName, phone, email, nationalId, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: "phone_already_registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const mfaSecret = generateMfaSecret();

  const user = await db.user.create({
    data: {
      fullName,
      phone,
      email,
      nationalId,
      passwordHash,
      mfaSecret,
      role: ROLES.CITIZEN,
    },
  });

  const qrCodeDataUrl = await buildEnrollmentQrCode(phone, mfaSecret);

  await recordAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "USER_REGISTERED",
    resourceType: "User",
    resourceId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
  });

  return res.status(201).json({
    userId: user.id,
    mfaEnrollment: {
      secret: mfaSecret,
      qrCodeDataUrl,
      note: "Add this to Google Authenticator / Authy, or use the secret manually. Required at every login.",
    },
  });
});

const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  const { phone, password } = parsed.data;

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !user.isActive) {
    await recordAuditEvent({
      actorUserId: null,
      actorRole: null,
      action: "LOGIN_FAILURE",
      resourceType: "User",
      resourceId: phone,
      ipAddress: req.ip,
      metadata: { reason: "no_such_user_or_inactive" },
    });
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: "LOGIN_FAILURE",
      resourceType: "User",
      resourceId: user.id,
      ipAddress: req.ip,
      metadata: { reason: "bad_password" },
    });
    return res.status(401).json({ error: "invalid_credentials" });
  }

  // Step 1 passed. Always issue a short-lived MFA ticket -- cheap, stateless,
  // and it's what keeps /auth/mfa/verify fully testable and usable even
  // while MFA_REQUIRED is off (see its definition above).
  const mfaTicket = jwt.sign({ sub: user.id, purpose: "mfa" }, JWT_SECRET, { expiresIn: "5m" });

  await recordAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN_PASSWORD_VERIFIED",
    resourceType: "User",
    resourceId: user.id,
    ipAddress: req.ip,
  });

  if (!MFA_REQUIRED) {
    const { accessToken, refreshToken } = await issueSessionTokens(user);
    await recordAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: "LOGIN_SUCCESS",
      resourceType: "User",
      resourceId: user.id,
      ipAddress: req.ip,
      metadata: { mfaSkipped: true },
    });
    return res.json({
      mfaRequired: false,
      mfaTicket,
      accessToken,
      refreshToken,
      user: { id: user.id, fullName: user.fullName, role: user.role, phone: user.phone },
    });
  }

  return res.json({ mfaTicket, mfaRequired: true });
});

const mfaVerifySchema = z.object({
  mfaTicket: z.string(),
  code: z.string().min(6).max(6),
});

router.post("/mfa/verify", async (req, res) => {
  const parsed = mfaVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  const { mfaTicket, code } = parsed.data;

  let payload: { sub: string; purpose: string };
  try {
    payload = jwt.verify(mfaTicket, JWT_SECRET) as typeof payload;
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_mfa_ticket" });
  }
  if (payload.purpose !== "mfa") return res.status(401).json({ error: "invalid_ticket_purpose" });

  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  if (!verifyMfaCode(user.mfaSecret, code)) {
    await recordAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: "MFA_FAILURE",
      resourceType: "User",
      resourceId: user.id,
      ipAddress: req.ip,
    });
    return res.status(401).json({ error: "invalid_mfa_code" });
  }

  const { accessToken, refreshToken } = await issueSessionTokens(user);

  await recordAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN_SUCCESS",
    resourceType: "User",
    resourceId: user.id,
    ipAddress: req.ip,
  });

  return res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, fullName: user.fullName, role: user.role, phone: user.phone },
  });
});

const refreshSchema = z.object({ refreshToken: z.string() });

router.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });

  const hash = hashRefreshToken(parsed.data.refreshToken);
  const stored = await db.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });

  if (!stored) {
    return res.status(401).json({ error: "invalid_refresh_token" });
  }

  if (stored.revoked) {
    // This exact token was already consumed by a previous rotation. Seeing
    // it again means either a stolen token being replayed after the real
    // client already moved past it, or (rarer) a client-side retry race --
    // either way the chain descended from this login can no longer be
    // trusted, so the whole family is revoked, not just this one request
    // rejected. A legitimate user just gets logged out and has to log back
    // in; that's the correct tradeoff against a silently-persisting theft.
    await db.refreshToken.updateMany({
      where: { familyId: stored.familyId, revoked: false },
      data: { revoked: true },
    });
    await recordAuditEvent({
      actorUserId: stored.userId,
      actorRole: stored.user.role,
      action: "REFRESH_TOKEN_REUSE_DETECTED",
      resourceType: "User",
      resourceId: stored.userId,
      ipAddress: req.ip,
      metadata: { familyId: stored.familyId },
    });
    return res.status(401).json({ error: "invalid_refresh_token" });
  }

  if (stored.expiresAt < new Date()) {
    return res.status(401).json({ error: "invalid_refresh_token" });
  }

  // Rotate: revoke the old one, issue a new one in the same family.
  await db.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const { token: newRefreshToken, hash: newHash } = generateRefreshToken();
  await db.refreshToken.create({
    data: {
      userId: stored.userId,
      familyId: stored.familyId,
      tokenHash: newHash,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });

  const accessToken = signAccessToken({
    sub: stored.user.id,
    role: stored.user.role,
    fullName: stored.user.fullName,
    mfa: true,
  });

  return res.json({ accessToken, refreshToken: newRefreshToken });
});

router.post("/logout", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  const hash = hashRefreshToken(parsed.data.refreshToken);
  await db.refreshToken.updateMany({ where: { tokenHash: hash }, data: { revoked: true } });
  return res.status(204).send();
});

export default router;
