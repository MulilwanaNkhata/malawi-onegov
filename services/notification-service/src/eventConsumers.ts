import { subscribeToEvents } from "./lib/eventBus.js";
import { notifyUser } from "./lib/notify.js";
import { resolveApplication } from "./lib/internalClients.js";

/**
 * Human-readable "kind" phrase per entityType, for message copy -- already
 * includes "application" where that reads naturally (Birth Certificate,
 * Trading Licence) and omits it where it wouldn't ("complaint" is not an
 * "application"). Add a line here for each new pilot service.
 */
const SERVICE_NAMES: Record<string, string> = {
  birth_certificate: "Birth Certificate application",
  trading_license: "Trading Licence application",
  complaint: "complaint",
};

/** What to say right after "was received" -- varies because not every service has a fee step. */
const SUBMITTED_FOLLOWUP: Record<string, string> = {
  birth_certificate: "You will be notified once the fee payment is confirmed.",
  trading_license: "You will be notified once the fee payment is confirmed.",
  complaint: "Our support team will review it shortly.",
};

// UNDER_REVIEW is intentionally omitted: for this workflow it is only ever
// reached via PAYMENT_CONFIRMED, which the payment.completed handler above
// already notifies the citizen about -- this avoids sending a duplicate.
//
// State names are assumed unique across every registered workflow template
// (true today -- complaint's OPEN/IN_PROGRESS/RESOLVED/CLOSED don't collide
// with the apply-and-issue templates' states). A future template reusing an
// existing name with different copy would need this keyed by entityType too.
const STATE_MESSAGES: Record<string, string> = {
  ADDITIONAL_INFO_REQUIRED: "requires additional information -- please check the portal",
  APPROVED: "has been approved",
  REJECTED: "was not approved -- see the portal for details",
  ISSUED: "certificate has been issued and is ready to download",
  IN_PROGRESS: "is now being handled by our support team",
  RESOLVED: "has been marked resolved -- check the portal, and reopen it if this doesn't fully address your concern",
  CLOSED: "has been closed",
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
          const entityType = data.entityType ?? "birth_certificate";
          const serviceName = SERVICE_NAMES[entityType] ?? "application";
          const followUp = SUBMITTED_FOLLOWUP[entityType] ?? "";
          const label = data.label ?? data.childFullName ?? "";
          await notifyUser(
            data.applicantUserId,
            "application.submitted",
            "Application received",
            `Your ${serviceName} for ${label} was received. Reference: ${data.referenceNumber}. ${followUp}`
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
            `Your ${serviceName} (${application.referenceNumber}) ${message}.`
          );
          break;
        }

        case "complaint.response_added": {
          const data = event.data as { complaintId: string; referenceNumber: string; recipientUserId: string };
          await notifyUser(
            data.recipientUserId,
            "complaint.response_added",
            "New response on your complaint",
            `Support has responded to your complaint (${data.referenceNumber}). Check the portal for details.`
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
