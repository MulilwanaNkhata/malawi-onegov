import axios from "axios";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";
const serviceHeaders = { "x-service-secret": SERVICE_SHARED_SECRET };

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://workflow-service:4003";
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL ?? "http://document-service:4004";
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4005";

export const ENTITY_TYPE = "trading_license";
export const WORKFLOW_TEMPLATE_CODE = "trading_license";

export async function createWorkflowInstance(entityId: string): Promise<{ id: string; currentState: string }> {
  const { data } = await axios.post(
    `${WORKFLOW_SERVICE_URL}/instances`,
    { templateCode: WORKFLOW_TEMPLATE_CODE, entityType: ENTITY_TYPE, entityId },
    { headers: serviceHeaders, timeout: 5000 }
  );
  return data;
}

export async function transitionWorkflow(
  instanceId: string,
  input: { action: string; actorUserId: string | null; actorRole: string; comment?: string }
): Promise<{ currentState: string }> {
  const { data } = await axios.post(`${WORKFLOW_SERVICE_URL}/instances/${instanceId}/transitions`, input, {
    headers: serviceHeaders,
    timeout: 5000,
  });
  return data;
}

export async function generateLicenseCertificatePdf(input: {
  ownerUserId: string;
  entityId: string;
  referenceNumber: string;
  businessName: string;
  businessType: string;
  tradingAddress: string;
  district: string;
  ownerFullName: string;
}): Promise<{ id: string }> {
  const { data } = await axios.post(
    `${DOCUMENT_SERVICE_URL}/files/generate-trading-license-certificate`,
    { ...input, entityType: ENTITY_TYPE },
    { headers: serviceHeaders, timeout: 15000 }
  );
  return data;
}

export async function lookupPaymentForApplication(applicationId: string) {
  try {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/payments/by-entity/lookup`, {
      headers: serviceHeaders,
      params: { entityType: ENTITY_TYPE, entityId: applicationId },
      timeout: 5000,
    });
    return data;
  } catch {
    return null;
  }
}
