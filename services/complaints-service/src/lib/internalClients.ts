import axios from "axios";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";
const serviceHeaders = { "x-service-secret": SERVICE_SHARED_SECRET };

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://workflow-service:4003";

export const ENTITY_TYPE = "complaint";
export const WORKFLOW_TEMPLATE_CODE = "complaint";

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
