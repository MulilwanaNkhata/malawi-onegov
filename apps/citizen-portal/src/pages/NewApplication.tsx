import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { createApplication, getFeeSchedule, type NewApplicationInput } from "../api/onegov";

const initialForm: NewApplicationInput = {
  childFullName: "",
  dateOfBirth: "",
  placeOfBirth: "",
  sex: "MALE",
  motherFullName: "",
  motherNationalId: "",
  fatherFullName: "",
  fatherNationalId: "",
};

export default function NewApplication() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState<NewApplicationInput>(initialForm);
  const [fee, setFee] = useState<{ amount: number; currency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFeeSchedule().then(setFee);
  }, []);

  function update<K extends keyof NewApplicationInput>(key: K, value: NewApplicationInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await createApplication(form);
      navigate(`/applications/${result.id}`);
    } catch {
      setError("Could not submit application. Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("newApplication")}</h1>
        {fee && (
          <p className="muted">
            {t("feeAmount")}: {fee.amount} {fee.currency}
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>{t("childFullName")}</label>
            <input value={form.childFullName} onChange={(e) => update("childFullName", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("dateOfBirth")}</label>
            <input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("placeOfBirth")}</label>
            <input value={form.placeOfBirth} onChange={(e) => update("placeOfBirth", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("sex")}</label>
            <select value={form.sex} onChange={(e) => update("sex", e.target.value as "MALE" | "FEMALE")}>
              <option value="MALE">{t("male")}</option>
              <option value="FEMALE">{t("female")}</option>
            </select>
          </div>
          <div className="field">
            <label>{t("motherFullName")}</label>
            <input value={form.motherFullName} onChange={(e) => update("motherFullName", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("nationalId")} ({t("motherFullName")})</label>
            <input value={form.motherNationalId} onChange={(e) => update("motherNationalId", e.target.value)} />
          </div>
          <div className="field">
            <label>{t("fatherFullName")}</label>
            <input value={form.fatherFullName} onChange={(e) => update("fatherFullName", e.target.value)} />
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
