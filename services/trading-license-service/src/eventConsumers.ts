import { subscribeToEvents } from "./lib/eventBus.js";
import { db } from "./lib/db.js";
import { recordAuditEvent } from "./lib/audit.js";
import { publishEvent } from "./lib/eventBus.js";
import { generateLicenseCertificatePdf, transitionWorkflow, ENTITY_TYPE } from "./lib/internalClients.js";

export function startEventConsumers(): void {
  subscribeToEvents(async (event) => {
    if (event.name !== "application.status_changed") return;
    const data = event.data as { entityType: string; entityId: string; toState: string };
    if (data.entityType !== ENTITY_TYPE) return;

    const application = await db.tradingLicenseApplication.findUnique({ where: { id: data.entityId } });
    if (!application) return;

    await db.tradingLicenseApplication.update({
      where: { id: application.id },
      data: { status: data.toState },
    });

    if (data.toState !== "APPROVED") return;

    try {
      const cert = await generateLicenseCertificatePdf({
        ownerUserId: application.applicantUserId,
        entityId: application.id,
        referenceNumber: application.referenceNumber,
        businessName: application.businessName,
        businessType: application.businessType,
        tradingAddress: application.tradingAddress,
        district: application.district,
        ownerFullName: application.ownerFullName,
      });

      await db.tradingLicenseApplication.update({
        where: { id: application.id },
        data: { certificateDocumentId: cert.id },
      });

      await recordAuditEvent({
        actorUserId: null,
        actorRole: "SYSTEM",
        action: "TRADING_LICENSE_GENERATED",
        resourceType: "TradingLicenseApplication",
        resourceId: application.id,
        metadata: { documentId: cert.id },
      });

      if (application.workflowInstanceId) {
        await transitionWorkflow(application.workflowInstanceId, {
          action: "ISSUE",
          actorUserId: null,
          actorRole: "SYSTEM",
        });
      }

      await publishEvent("certificate.issued", {
        entityId: application.id,
        applicantUserId: application.applicantUserId,
        referenceNumber: application.referenceNumber,
        documentId: cert.id,
        entityType: ENTITY_TYPE,
        label: application.businessName,
      });
    } catch (err) {
      console.error("[trading-license-service] certificate generation failed", (err as Error).message);
    }
  });
}
