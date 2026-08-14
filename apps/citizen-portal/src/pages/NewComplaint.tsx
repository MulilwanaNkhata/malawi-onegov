import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { createComplaint, type NewComplaintInput } from "../api/onegov";

const initialForm: NewComplaintInput = {
  category: "SERVICE_QUALITY",
  subject: "",
  description: "",
  relatedServiceType: "",
  relatedReferenceNumber: "",
};

export default function NewComplaint() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState<NewComplaintInput>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update<K extends keyof NewComplaintInput>(key: K, value: NewComplaintInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await createComplaint({
        ...form,
        relatedServiceType: form.relatedServiceType || undefined,
        relatedReferenceNumber: form.relatedReferenceNumber || undefined,
      });
      navigate(`/complaints/${result.id}`);
    } catch {
      setError("Could not submit your complaint. Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("fileComplaint")}</h1>
        <p className="muted">{t("fileComplaintIntro")}</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>{t("complaintCategory")}</label>
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value as NewComplaintInput["category"])}
            >
              <option value="SERVICE_QUALITY">{t("categoryServiceQuality")}</option>
              <option value="DELAY">{t("categoryDelay")}</option>
              <option value="STAFF_CONDUCT">{t("categoryStaffConduct")}</option>
              <option value="CORRUPTION">{t("categoryCorruption")}</option>
              <option value="OTHER">{t("categoryOther")}</option>
            </select>
          </div>
          <div className="field">
            <label>{t("complaintSubject")}</label>
            <input value={form.subject} onChange={(e) => update("subject", e.target.value)} required minLength={3} />
          </div>
          <div className="field">
            <label>{t("complaintDescription")}</label>
            <textarea
              rows={5}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              required
              minLength={10}
            />
          </div>
          <div className="field">
            <label>{t("relatedReferenceNumber")}</label>
            <input
              placeholder="BC-2026-... / TL-2026-... (optional)"
              value={form.relatedReferenceNumber}
              onChange={(e) => update("relatedReferenceNumber", e.target.value)}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
