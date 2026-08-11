import axios from "axios";

const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL ?? "http://audit-service:4002";
const AUDIT_SHARED_SECRET = process.env.AUDIT_SHARED_SECRET ?? "";

export interface AuditEventInput {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget-but-logged emission of a security-relevant event to the
 * central audit service. Failures are logged locally and never block the
 * calling request -- audit-service unavailability must not take down
 * citizen-facing flows, but is itself alerted on via service monitoring.
 */
export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    await axios.post(`${AUDIT_SERVICE_URL}/events`, event, {
      headers: { "x-audit-secret": AUDIT_SHARED_SECRET },
      timeout: 3000,
    });
  } catch (err) {
    console.error("[audit] failed to record event", event.action, (err as Error).message);
  }
}
