import { authenticator } from "otplib";
import QRCode from "qrcode";

const ISSUER = "Malawi OneGov";

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function verifyMfaCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export async function buildEnrollmentQrCode(accountLabel: string, secret: string): Promise<string> {
  const otpauthUrl = authenticator.keyuri(accountLabel, ISSUER, secret);
  return QRCode.toDataURL(otpauthUrl);
}
