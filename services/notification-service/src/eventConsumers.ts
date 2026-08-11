import { subscribeToEvents } from "./lib/eventBus.js";
import { notifyUser } from "./lib/notify.js";
import { resolveApplication } from "./lib/internalClients.js";

/** Human-readable service name per entityType, for message copy. Add a line here for each new pilot service. */
const SERVICE_NAMES: Record<string, string> = {
  birth_certificate: "Birth Certificate",
  trading_license: "Trading Licence",
};

// UNDER_REVIEW is intentionally omitted: for this workflow it is only ever
// reached via PAYMENT_CONFIRMED, which the payment.completed handler above
// already notifies the citizen about -- this avoids sending a duplicate.
const STATE_MESSAGES: Record<string, string> = {
  ADDITIONAL_INFO_REQUIRED: "requires additional information -- please check the portal",
  APPROVED: "has been approved",
  REJECTED: "was not approved -- see the portal for details",
  ISSUED: "certificate has been issued and is ready to download",
};

export function startEventConsumers(): void {
  subscribeToEvents(async (event) => {
    try {
      switch (event.name) {
        case "application.submitted": {
          const data = event.data as {
            applicantUserId: string;
            referenceNumber: string;
            entityType?: string;
            label?: string;
            childFullName?: string; // legacy field name, kept for backward compatibility
          };
          const serviceName = SERVICE_NAMES[data.entityType ?? "birth_certificate"] ?? "application";
          const label = data.label ?? data.childFullName ?? "";
          await notifyUser(
            data.applicantUserId,
            "application.submitted",
            "Application received",
            `Your ${serviceName} application for ${label} was received. Reference: ${data.referenceNumber}. You will be notified once the fee payment is confirmed.`
          );
          break;
        }

        case "payment.completed": {
          const data = event.data as { payerUserId: string; referenceNumber: string; amount: string };
          await notifyUser(
            data.payerUserId,
            "payment.completed",
            "Payment received",
            `We received your payment of MWK ${data.amount} for reference ${data.referenceNumber}. Your application has moved to review.`
          );
          break;
        }

        case "application.status_changed": {
          const data = event.data as { entityType: string; entityId: string; toState: string };
          const serviceName = SERVICE_NAMES[data.entityType];
          if (!serviceName) return; // unknown entity type -- nothing to resolve or notify about
          const application = await resolveApplication(data.entityType, data.entityId);
          if (!application) return;
          const message = STATE_MESSAGES[data.toState];
          if (!message) return;
          await notifyUser(
            application.applicantUserId,
            "application.status_changed",
            "Application status update",
            `Your ${serviceName} application (${application.referenceNumber}) ${message}.`
          );
          break;
        }

        case "certificate.issued": {
          const data = event.data as { applicantUserId: string; referenceNumber: string; entityType?: string };
          const serviceName = SERVICE_NAMES[data.entityType ?? "birth_certificate"] ?? "document";
          await notifyUser(
            data.applicantUserId,
            "certificate.issued",
            "Certificate ready",
            `Your ${serviceName} (reference ${data.referenceNumber}) is ready. Download it from your OneGov document wallet.`
          );
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("[notification-service] failed handling event", event.name, (err as Error).message);
    }
  });
}
