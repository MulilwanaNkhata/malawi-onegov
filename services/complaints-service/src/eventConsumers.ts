import { subscribeToEvents } from "./lib/eventBus.js";
import { db } from "./lib/db.js";
import { ENTITY_TYPE } from "./lib/internalClients.js";

/**
 * Keeps this service's own read-model `status` column in sync with the
 * authoritative state in workflow-service -- same pattern as the other two
 * pilot services. Unlike them, there's no PAYMENT_CONFIRMED or ISSUE
 * follow-up here: a complaint has no fee and nothing gets generated when it
 * resolves, so this consumer is deliberately just the sync step, nothing more.
 */
export function startEventConsumers(): void {
  subscribeToEvents(async (event) => {
    if (event.name !== "application.status_changed") return;
    const data = event.data as { entityType: string; entityId: string; toState: string };
    if (data.entityType !== ENTITY_TYPE) return;

    await db.complaint.updateMany({
      where: { id: data.entityId },
      data: { status: data.toState },
    });
  });
}
