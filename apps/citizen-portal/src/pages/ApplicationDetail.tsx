import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import {
  getApplication,
  getCertificateDownload,
  initiatePayment,
  resubmitApplication,
  reviewApplication,
  uploadApplicationDocument,
  type BirthCertificateApplication,
} from "../api/onegov";
import { StatusPill } from "../components/StatusPill";

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, isStaff } = useAuth();
  const { t } = useLanguage();

  const [application, setApplication] = useState<BirthCertificateApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!id) return;
    const data = await getApplication(id);
    setApplication(data);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="container">Loading...</div>;
  if (!application) return <div className="container">Not found.</div>;

  const isOwner = application.applicantUserId === user?.id;
  const hasPaid = application.payment?.status === "COMPLETED";

  async function handleUpload(documentType: string, file: File | undefined) {
    if (!file || !id) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadApplicationDocument(id, documentType, file);
      setMessage("Document uploaded.");
      await reload();
    } catch {
      setMessage("Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(provider: "AIRTEL_MONEY" | "TNM_MPAMBA", phoneNumber: string) {
    if (!application) return;
    setBusy(true);
    setMessage(null);
    try {
      await initiatePayment({
        entityType: "birth_certificate",
        entityId: application.id,
        amount: Number(application.feeAmount),
        currency: application.feeCurrency,
        provider,
        phoneNumber,
      });
      setMessage("Payment initiated. It will confirm automatically in a few seconds -- refresh to check.");
    } catch {
      setMessage("Could not start payment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResubmit() {
    if (!id) return;
    setBusy(true);
    try {
      await resubmitApplication(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(action: "REQUEST_MORE_INFO" | "APPROVE" | "REJECT") {
    if (!id) return;
    setBusy(true);
    setMessage(null);
    try {
      await reviewApplication(id, action);
      await reload();
    } catch {
      setMessage("Action not allowed from the current status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!id) return;
    const { downloadUrl } = await getCertificateDownload(id);
    window.open(downloadUrl, "_blank");
  }

  return (
    <div className="container">
      <p>
        <Link to="/">&larr; {t("back")}</Link>
      </p>

      <div className="card">
        <h1>{application.childFullName}</h1>
        <p>
          {t("referenceNumber")}: <strong>{application.referenceNumber}</strong>
        </p>
        <p>
          {t("status")}: <StatusPill status={application.status} />
        </p>
        <p className="muted">
          {t("dateOfBirth")}: {application.dateOfBirth} · {t("placeOfBirth")}: {application.placeOfBirth}
        </p>
        <p className="muted">{t("motherFullName")}: {application.motherFullName}</p>
        {message && <p className="muted">{message}</p>}
      </div>

      {isOwner && application.status === "SUBMITTED" && (
        <div className="card">
          <h2>{t("uploadDocument")}</h2>
          <UploadForm onSubmit={handleUpload} busy={busy} />

          <h2>{t("payNow")}</h2>
          {hasPaid ? (
            <p className="muted">Payment already received.</p>
          ) : (
            <PayForm feeAmount={Number(application.feeAmount)} currency={application.feeCurrency} onPay={handlePay} busy={busy} />
          )}
        </div>
      )}

      {isOwner && application.status === "ADDITIONAL_INFO_REQUIRED" && (
        <div className="card">
          <h2>{t("uploadDocument")}</h2>
          <UploadForm onSubmit={handleUpload} busy={busy} />
          <button className="btn" onClick={handleResubmit} disabled={busy}>
            {t("resubmit")}
          </button>
        </div>
      )}

      {isOwner && application.status === "ISSUED" && (
        <div className="card">
          <h2>{t("downloadCertificate")}</h2>
          <button className="btn" onClick={handleDownload}>
            {t("downloadCertificate")}
          </button>
        </div>
      )}

      {isStaff && (application.status === "UNDER_REVIEW" || application.status === "ADDITIONAL_INFO_REQUIRED") && (
        <div className="card">
          <h2>{t("staffQueue")}</h2>
          <div className="btn-row">
            {application.status === "UNDER_REVIEW" && (
              <button className="btn btn-secondary" onClick={() => handleReview("REQUEST_MORE_INFO")} disabled={busy}>
                {t("requestMoreInfo")}
              </button>
            )}
            {user?.role === "REGISTRAR_SUPERVISOR" && (
              <>
                {application.status === "UNDER_REVIEW" && (
                  <button className="btn" onClick={() => handleReview("APPROVE")} disabled={busy}>
                    {t("approve")}
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => handleReview("REJECT")} disabled={busy}>
                  {t("reject")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {application.documents.length > 0 && (
        <div className="card">
          <h2>{t("uploadDocument")}</h2>
          {application.documents.map((doc) => (
            <div className="list-item" key={doc.id}>
              <span>{doc.documentType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadForm({ onSubmit, busy }: { onSubmit: (documentType: string, file: File | undefined) => void; busy: boolean }) {
  const { t } = useLanguage();
  const [documentType, setDocumentType] = useState("HOSPITAL_NOTIFICATION");
  const [file, setFile] = useState<File | undefined>(undefined);

  return (
    <div className="field">
      <label>{t("documentType")}</label>
      <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
        <option value="HOSPITAL_NOTIFICATION">Hospital notification of birth</option>
        <option value="PARENT_NATIONAL_ID">Parent national ID</option>
        <option value="OTHER">Other supporting document</option>
      </select>
      <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0])} />
      <button className="btn btn-secondary" onClick={() => onSubmit(documentType, file)} disabled={busy || !file}>
        {t("uploadDocument")}
      </button>
    </div>
  );
}

function PayForm({
  feeAmount,
  currency,
  onPay,
  busy,
}: {
  feeAmount: number;
  currency: string;
  onPay: (provider: "AIRTEL_MONEY" | "TNM_MPAMBA", phoneNumber: string) => void;
  busy: boolean;
}) {
  const { t } = useLanguage();
  const [provider, setProvider] = useState<"AIRTEL_MONEY" | "TNM_MPAMBA">("AIRTEL_MONEY");
  const [phoneNumber, setPhoneNumber] = useState("");

  return (
    <div className="field">
      <p className="muted">
        {t("feeAmount")}: {feeAmount} {currency}
      </p>
      <label>{t("payWith")}</label>
      <select value={provider} onChange={(e) => setProvider(e.target.value as "AIRTEL_MONEY" | "TNM_MPAMBA")}>
        <option value="AIRTEL_MONEY">Airtel Money</option>
        <option value="TNM_MPAMBA">TNM Mpamba</option>
      </select>
      <input placeholder={t("phone")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
      <button className="btn" onClick={() => onPay(provider, phoneNumber)} disabled={busy || !phoneNumber}>
        {t("payNow")}
      </button>
    </div>
  );
}
