import { subscribeToEvents } from "./lib/eventBus.js";
import { db } from "./lib/db.js";
import { recordAuditEvent } from "./lib/audit.js";
import { publishEvent } from "./lib/eventBus.js";
import { generateCertificatePdf, transitionWorkflow, ENTITY_TYPE } from "./lib/internalClients.js";

export function startEventConsumers(): void {
  subscribeToEvents(async (event) => {
    if (event.name !== "application.status_changed") return;
    const data = event.data as { entityType: string; entityId: string; toState: string };
    if (data.entityType !== ENTITY_TYPE) return;

    const application = await db.birthCertificateApplication.findUnique({ where: { id: data.entityId } });
    if (!application) return;

    // Keep the local read-model in sync with the authoritative workflow state.
    await db.birthCertificateApplication.update({
      where: { id: application.id },
      data: { status: data.toState },
    });

    if (data.toState !== "APPROVED") return;

    try {
      const cert = await generateCertificatePdf({
        ownerUserId: application.applicantUserId,
        entityId: application.id,
        referenceNumber: application.referenceNumber,
        childFullName: application.childFullName,
        dateOfBirth: application.dateOfBirth,
        placeOfBirth: application.placeOfBirth,
        sex: application.sex,
        motherFullName: application.motherFullName,
        fatherFullName: application.fatherFullName ?? undefined,
      });

      await db.birthCertificateApplication.update({
        where: { id: application.id },
        data: { certificateDocumentId: cert.id },
      });

      await recordAuditEvent({
        actorUserId: null,
        actorRole: "SYSTEM",
        action: "BIRTH_CERTIFICATE_GENERATED",
        resourceType: "BirthCertificateApplication",
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
        label: application.childFullName,
      });
    } catch (err) {
      console.error("[civil-registration-service] certificate generation failed", (err as Error).message);
    }
  });
}
