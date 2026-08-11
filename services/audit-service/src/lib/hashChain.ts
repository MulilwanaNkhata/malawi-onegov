import { createHash } from "crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface HashableFields {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string; // ISO timestamp, fixed at write time so the hash is stable
  prevHash: string;
}

export function computeHash(fields: HashableFields): string {
  const canonical = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
