import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import type { Role } from "../shared.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-insecure-jwt-secret-change-me";
const JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  fullName: string;
  mfa: true;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  // JWT_ACCESS_TTL is a runtime-configured string (e.g. "15m"), which is
  // wider than jsonwebtoken's `expiresIn` template-literal type -- the value
  // is still validated by jsonwebtoken itself at call time.
  const options: jwt.SignOptions = { expiresIn: JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"] };
  return jwt.sign(claims, JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, JWT_SECRET) as AccessTokenClaims;
}

/** Opaque refresh tokens: random bytes handed to the client, only the hash is stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTtlMs(): number {
  const raw = process.env.JWT_REFRESH_TTL ?? "30d";
  const match = /^(\d+)([dhm])$/.exec(raw);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return value * multiplier;
}
