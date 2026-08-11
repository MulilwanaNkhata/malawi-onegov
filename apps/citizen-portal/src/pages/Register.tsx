import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function Register() {
  const { register } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { mfaEnrollment } = await register({
        fullName,
        phone,
        email: email || undefined,
        nationalId: nationalId || undefined,
        password,
      });
      setEnrollment(mfaEnrollment);
    } catch (err: any) {
      setError(err?.response?.data?.error === "phone_already_registered" ? "That phone number is already registered." : "Registration failed. Please check your details.");
    } finally {
      setBusy(false);
    }
  }

  if (enrollment) {
    return (
      <div className="container">
        <div className="card">
          <h1>{t("mfaEnrollmentTitle")}</h1>
          <p className="muted">{t("mfaEnrollmentBody")}</p>
          <img src={enrollment.qrCodeDataUrl} alt="MFA enrollment QR code" width={200} height={200} />
          <div className="field">
            <label>{t("secretKey")}</label>
            <input readOnly value={enrollment.secret} onFocus={(e) => e.target.select()} />
          </div>
          <button className="btn" onClick={() => navigate("/login")}>
            {t("continueToLogin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("createAccount")}</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="fullName">{t("fullName")}</label>
            <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="phone">{t("phone")}</label>
            <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+265..." />
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nationalId">{t("nationalId")}</label>
            <input id="nationalId" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password")}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {t("register")}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          <Link to="/login">{t("alreadyHaveAccount")}</Link>
        </p>
      </div>
    </div>
  );
}
