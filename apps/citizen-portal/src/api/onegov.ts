import { api } from "./client";

export interface BirthCertificateApplication {
  id: string;
  referenceNumber: string;
  applicantUserId: string;
  childFullName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  sex: string;
  motherFullName: string;
  fatherFullName?: string | null;
  status: string;
  feeAmount: string;
  feeCurrency: string;
  workflowInstanceId: string | null;
  certificateDocumentId: string | null;
  createdAt: string;
  documents: { id: string; documentType: string; documentServiceFileId: string }[];
  payment?: { id: string; status: string; referenceNumber: string; amount: string } | null;
}

export async function getFeeSchedule() {
  const { data } = await api.get<{ amount: number; currency: string }>("/applications/fee-schedule");
  return data;
}

export async function listApplications(status?: string) {
  const { data } = await api.get<BirthCertificateApplication[]>("/applications", { params: { status } });
  return data;
}

export async function getApplication(id: string) {
  const { data } = await api.get<BirthCertificateApplication>(`/applications/${id}`);
  return data;
}

export interface NewApplicationInput {
  childFullName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  sex: "MALE" | "FEMALE";
  motherFullName: string;
  motherNationalId?: string;
  fatherFullName?: string;
  fatherNationalId?: string;
}

export async function createApplication(input: NewApplicationInput) {
  const { data } = await api.post("/applications", input);
  return data as { id: string; referenceNumber: string; status: string; feeAmount: number; feeCurrency: string };
}

export async function uploadApplicationDocument(applicationId: string, documentType: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("entityType", "birth_certificate");
  form.append("entityId", applicationId);
  form.append("documentType", documentType);
  const { data: uploaded } = await api.post("/documents", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  await api.post(`/applications/${applicationId}/documents`, {
    documentType,
    documentServiceFileId: uploaded.id,
  });
}

export async function resubmitApplication(applicationId: string, comment?: string) {
  await api.post(`/applications/${applicationId}/resubmit`, { comment });
}

export async function reviewApplication(
  applicationId: string,
  action: "REQUEST_MORE_INFO" | "APPROVE" | "REJECT",
  comment?: string
) {
  const { data } = await api.post(`/applications/${applicationId}/review`, { action, comment });
  return data as { status: string };
}

export async function getCertificateDownload(applicationId: string) {
  const { data } = await api.get(`/applications/${applicationId}/certificate`);
  return data as { downloadUrl: string; originalName: string };
}

export interface Payment {
  id: string;
  referenceNumber: string;
  entityType: string;
  entityId: string;
  amount: string;
  currency: string;
  provider: string;
  status: string;
  createdAt: string;
}

export async function initiatePayment(input: {
  entityType: string;
  entityId: string;
  amount: number;
  currency?: string;
  provider: "AIRTEL_MONEY" | "TNM_MPAMBA" | "BANK_TRANSFER";
  phoneNumber: string;
}) {
  const { data } = await api.post("/payments", input);
  return data as { id: string; referenceNumber: string; status: string };
}

export async function listMyPayments() {
  const { data } = await api.get<Payment[]>("/payments");
  return data;
}

export interface NotificationLog {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
}

export async function listNotifications() {
  const { data } = await api.get<NotificationLog[]>("/notifications");
  return data;
}

export interface ApplicationAnalytics {
  totalApplications: number;
  byStatus: Record<string, number>;
  averageProcessingHours: number | null;
}

export async function getApplicationAnalytics() {
  const { data } = await api.get<ApplicationAnalytics>("/applications/analytics");
  return data;
}

export interface PaymentAnalytics {
  totalCollected: number;
  totalTransactions: number;
  currency: string;
  byProvider: Record<string, { count: number; total: number }>;
}

export async function getPaymentAnalytics() {
  const { data } = await api.get<PaymentAnalytics>("/payments/analytics");
  return data;
}

// ---------------------------------------------------------------------------
// Trading Licence -- the second pilot service. Mirrors the Birth Certificate
// functions above closely; kept as its own set of calls (rather than a
// generic "application service" abstraction) since the underlying resources
// are genuinely different shapes -- see civil-registration-service vs
// trading-license-service on the backend for the same choice.
// ---------------------------------------------------------------------------

export interface TradingLicenseApplication {
  id: string;
  referenceNumber: string;
  applicantUserId: string;
  businessName: string;
  businessType: string;
  tradingAddress: string;
  district: string;
  ownerFullName: string;
  ownerNationalId?: string | null;
  status: string;
  feeAmount: string;
  feeCurrency: string;
  workflowInstanceId: string | null;
  certificateDocumentId: string | null;
  createdAt: string;
  documents: { id: string; documentType: string; documentServiceFileId: string }[];
  payment?: { id: string; status: string; referenceNumber: string; amount: string } | null;
}

export async function getTradingLicenseFeeSchedule() {
  const { data } = await api.get<{ amount: number; currency: string }>("/trading-licenses/fee-schedule");
  return data;
}

export async function listTradingLicenses(status?: string) {
  const { data } = await api.get<TradingLicenseApplication[]>("/trading-licenses", { params: { status } });
  return data;
}

export async function getTradingLicense(id: string) {
  const { data } = await api.get<TradingLicenseApplication>(`/trading-licenses/${id}`);
  return data;
}

export interface NewTradingLicenseInput {
  businessName: string;
  businessType: "RETAIL" | "RESTAURANT" | "SERVICES" | "MANUFACTURING" | "OTHER";
  tradingAddress: string;
  district: string;
  ownerFullName: string;
  ownerNationalId?: string;
}

export async function createTradingLicense(input: NewTradingLicenseInput) {
  const { data } = await api.post("/trading-licenses", input);
  return data as { id: string; referenceNumber: string; status: string; feeAmount: number; feeCurrency: string };
}

export async function uploadTradingLicenseDocument(applicationId: string, documentType: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("entityType", "trading_license");
  form.append("entityId", applicationId);
  form.append("documentType", documentType);
  const { data: uploaded } = await api.post("/documents", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  await api.post(`/trading-licenses/${applicationId}/documents`, {
    documentType,
    documentServiceFileId: uploaded.id,
  });
}

export async function resubmitTradingLicense(applicationId: string, comment?: string) {
  await api.post(`/trading-licenses/${applicationId}/resubmit`, { comment });
}

export async function reviewTradingLicense(
  applicationId: string,
  action: "REQUEST_MORE_INFO" | "APPROVE" | "REJECT",
  comment?: string
) {
  const { data } = await api.post(`/trading-licenses/${applicationId}/review`, { action, comment });
  return data as { status: string };
}

export async function getTradingLicenseCertificateDownload(applicationId: string) {
  const { data } = await api.get(`/trading-licenses/${applicationId}/certificate`);
  return data as { downloadUrl: string; originalName: string };
}

export async function getTradingLicenseAnalytics() {
  const { data } = await api.get<ApplicationAnalytics>("/trading-licenses/analytics");
  return data;
}

// ---------------------------------------------------------------------------
// USSD PIN -- lets a citizen set the short numeric PIN used to authenticate
// on the feature-phone (USSD) channel. Can only be set from an authenticated
// smartphone/portal session; see services/ussd-gateway for why.
// ---------------------------------------------------------------------------

export async function setUssdPin(pin: string) {
  await api.post("/users/me/ussd-pin", { pin });
}
