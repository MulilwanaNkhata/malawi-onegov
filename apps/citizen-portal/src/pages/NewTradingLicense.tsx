import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { createTradingLicense, getTradingLicenseFeeSchedule, type NewTradingLicenseInput } from "../api/onegov";

const initialForm: NewTradingLicenseInput = {
  businessName: "",
  businessType: "RETAIL",
  tradingAddress: "",
  district: "",
  ownerFullName: "",
  ownerNationalId: "",
};

export default function NewTradingLicense() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState<NewTradingLicenseInput>(initialForm);
  const [fee, setFee] = useState<{ amount: number; currency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTradingLicenseFeeSchedule().then(setFee);
  }, []);

  function update<K extends keyof NewTradingLicenseInput>(key: K, value: NewTradingLicenseInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await createTradingLicense(form);
      navigate(`/trading-licenses/${result.id}`);
    } catch {
      setError("Could not submit application. Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("newTradingLicense")}</h1>
        {fee && (
          <p className="muted">
            {t("feeAmount")}: {fee.amount} {fee.currency}
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>{t("businessName")}</label>
            <input value={form.businessName} onChange={(e) => update("businessName", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("businessType")}</label>
            <select value={form.businessType} onChange={(e) => update("businessType", e.target.value as NewTradingLicenseInput["businessType"])}>
              <option value="RETAIL">{t("businessTypeRetail")}</option>
              <option value="RESTAURANT">{t("businessTypeRestaurant")}</option>
              <option value="SERVICES">{t("businessTypeServices")}</option>
              <option value="MANUFACTURING">{t("businessTypeManufacturing")}</option>
              <option value="OTHER">{t("businessTypeOther")}</option>
            </select>
          </div>
          <div className="field">
            <label>{t("tradingAddress")}</label>
            <input value={form.tradingAddress} onChange={(e) => update("tradingAddress", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("district")}</label>
            <input value={form.district} onChange={(e) => update("district", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("ownerFullName")}</label>
            <input value={form.ownerFullName} onChange={(e) => update("ownerFullName", e.target.value)} required />
          </div>
          <div className="field">
            <label>{t("nationalId")}</label>
            <input value={form.ownerNationalId} onChange={(e) => update("ownerNationalId", e.target.value)} />
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
