import axios from "axios";

const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL ?? "http://audit-service:4002";
const AUDIT_SHARED_SECRET = process.env.AUDIT_SHARED_SECRET ?? "";

export async function recordAuditEvent(event: {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await axios.post(`${AUDIT_SERVICE_URL}/events`, event, {
      headers: { "x-audit-secret": AUDIT_SHARED_SECRET },
      timeout: 3000,
    });
  } catch (err) {
    console.error("[audit] failed to record event", event.action, (err as Error).message);
  }
}
