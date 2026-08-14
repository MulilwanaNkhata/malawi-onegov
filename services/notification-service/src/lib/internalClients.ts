import axios from "axios";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";
const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL ?? "http://identity-service:4001";
const CIVIL_REGISTRATION_SERVICE_URL =
  process.env.CIVIL_REGISTRATION_SERVICE_URL ?? "http://civil-registration-service:4007";
const TRADING_LICENSE_SERVICE_URL =
  process.env.TRADING_LICENSE_SERVICE_URL ?? "http://trading-license-service:4008";
const COMPLAINTS_SERVICE_URL = process.env.COMPLAINTS_SERVICE_URL ?? "http://complaints-service:4010";

export interface UserContact {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
}

export async function resolveUserContact(userId: string): Promise<UserContact | null> {
  try {
    const { data } = await axios.get(`${IDENTITY_SERVICE_URL}/users/internal/${userId}`, {
      headers: { "x-service-secret": SERVICE_SHARED_SECRET },
      timeout: 3000,
    });
    return data;
  } catch {
    return null;
  }
}

export interface ApplicationSummary {
  id: string;
  referenceNumber: string;
  applicantUserId: string;
  label: string; // human-readable name for the thing applied for (child's name, business name, ...)
  status: string;
}

/**
 * workflow-service's status-change events only know entityType/entityId, not
 * who applied -- that mapping is owned by the domain service. Each domain
 * service exposes the same internal-lookup shape (id/referenceNumber/
 * applicantUserId/label/status) at GET /<resource>/internal/:id, so adding a
 * new pilot service is a one-line addition to this map, not new branching
 * logic elsewhere.
 */
const RESOLVERS: Record<string, (entityId: string) => string> = {
  birth_certificate: (id) => `${CIVIL_REGISTRATION_SERVICE_URL}/applications/internal/${id}`,
  trading_license: (id) => `${TRADING_LICENSE_SERVICE_URL}/licenses/internal/${id}`,
  complaint: (id) => `${COMPLAINTS_SERVICE_URL}/complaints/internal/${id}`,
};

export async function resolveApplication(entityType: string, entityId: string): Promise<ApplicationSummary | null> {
  const buildUrl = RESOLVERS[entityType];
  if (!buildUrl) return null;
  try {
    const { data } = await axios.get(buildUrl(entityId), {
      headers: { "x-service-secret": SERVICE_SHARED_SECRET },
      timeout: 3000,
    });
    return data;
  } catch {
    return null;
  }
}
