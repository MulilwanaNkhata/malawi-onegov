import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function Login() {
  const { loginPassword, loginMfa } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await loginPassword(phone, password);
      if (result.mfaRequired) {
        setMfaTicket(result.mfaTicket);
      } else {
        navigate("/");
      }
    } catch {
      setError("Invalid phone number or password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaTicket) return;
    setError(null);
    setBusy(true);
    try {
      await loginMfa(mfaTicket, code);
      navigate("/");
    } catch {
      setError("Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("login")}</h1>

        {!mfaTicket ? (
          <form onSubmit={handlePasswordSubmit}>
            <div className="field">
              <label htmlFor="phone">{t("phone")}</label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="password">{t("password")}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn" type="submit" disabled={busy}>
              {t("login")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit}>
            <p className="muted">{t("mfaInstructions")}</p>
            <div className="field">
              <label htmlFor="code">{t("mfaCode")}</label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn" type="submit" disabled={busy}>
              {t("verify")}
            </button>
          </form>
        )}

        <p className="muted" style={{ marginTop: 16 }}>
          <Link to="/register">{t("needAccount")}</Link>
        </p>
      </div>
    </div>
  );
}
