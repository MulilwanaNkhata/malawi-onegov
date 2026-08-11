import axios from "axios";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";
const CIVIL_REGISTRATION_SERVICE_URL =
  process.env.CIVIL_REGISTRATION_SERVICE_URL ?? "http://civil-registration-service:4007";
const TRADING_LICENSE_SERVICE_URL =
  process.env.TRADING_LICENSE_SERVICE_URL ?? "http://trading-license-service:4008";
const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL ?? "http://identity-service:4001";

export interface ApplicationStatus {
  referenceNumber: string;
  label: string;
  status: string;
}

async function lookup(baseUrl: string, path: string, referenceNumber: string): Promise<ApplicationStatus | null> {
  try {
    const { data } = await axios.get(`${baseUrl}${path}/internal/by-reference/${encodeURIComponent(referenceNumber)}`, {
      headers: { "x-service-secret": SERVICE_SHARED_SECRET },
      timeout: 4000,
    });
    return data;
  } catch {
    return null;
  }
}

export function lookupBirthCertificate(referenceNumber: string) {
  return lookup(CIVIL_REGISTRATION_SERVICE_URL, "/applications", referenceNumber);
}

export function lookupTradingLicense(referenceNumber: string) {
  return lookup(TRADING_LICENSE_SERVICE_URL, "/licenses", referenceNumber);
}

export type UssdPinAuthResult =
  | { ok: true; userId: string; fullName: string; role: string }
  | { ok: false; reason: "invalid" | "locked" | "error" };

/** Authenticates a feature-phone session against the PIN a citizen set from the portal. */
export async function verifyUssdPin(phone: string, pin: string): Promise<UssdPinAuthResult> {
  try {
    const { data } = await axios.post(
      `${IDENTITY_SERVICE_URL}/users/internal/ussd-auth`,
      { phone, pin },
      { headers: { "x-service-secret": SERVICE_SHARED_SECRET }, timeout: 4000 }
    );
    return { ok: true, ...data };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 423) return { ok: false, reason: "locked" };
    if (axios.isAxiosError(err) && err.response?.status === 401) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "error" };
  }
}

export interface UssdTradingLicenseInput {
  businessName: string;
  businessType: "RETAIL" | "RESTAURANT" | "SERVICES" | "MANUFACTURING" | "OTHER";
  tradingAddress: string;
  district: string;
  ownerFullName: string;
}

/** Submits a Trading Licence application on the citizen's behalf, having already authenticated them via PIN. */
export async function submitTradingLicenseApplication(
  applicantUserId: string,
  input: UssdTradingLicenseInput
): Promise<{ referenceNumber: string } | null> {
  try {
    const { data } = await axios.post(
      `${TRADING_LICENSE_SERVICE_URL}/licenses/internal/apply-on-behalf`,
      { applicantUserId, ...input },
      { headers: { "x-service-secret": SERVICE_SHARED_SECRET }, timeout: 4000 }
    );
    return data;
  } catch {
    return null;
  }
}
