import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { setUssdPin } from "../api/onegov";
import { isPushSupported, getExistingPushSubscription, enablePush, disablePush } from "../lib/pushSubscription";

type PushUiState = "unsupported" | "checking" | "off" | "on";

function PushNotificationsSection() {
  const { t } = useLanguage();
  const [state, setState] = useState<PushUiState>(isPushSupported() ? "checking" : "unsupported");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    getExistingPushSubscription()
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function handleEnable() {
    setError(null);
    setBusy(true);
    try {
      await enablePush();
      setState("on");
    } catch (err) {
      setError(
        err instanceof Error && err.message === "notification-permission-denied"
          ? t("pushPermissionDenied")
          : t("pushEnableError")
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setError(null);
    setBusy(true);
    try {
      await disablePush();
      setState("off");
    } catch {
      setError(t("pushDisableError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{t("pushTitle")}</h2>
      <p className="muted">{t("pushBody")}</p>
      {state === "unsupported" && <p className="muted">{t("pushUnsupported")}</p>}
      {state === "checking" && <p className="muted">...</p>}
      {state === "on" && (
        <>
          <p className="muted">{t("pushEnabledStatus")}</p>
          <button className="btn btn-secondary" onClick={handleDisable} disabled={busy}>
            {t("pushDisable")}
          </button>
        </>
      )}
      {state === "off" && (
        <button className="btn" onClick={handleEnable} disabled={busy}>
          {t("pushEnable")}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!/^\d{4,6}$/.test(pin)) {
      setError(t("ussdPinFormatError"));
      return;
    }
    if (pin !== confirmPin) {
      setError(t("ussdPinMismatchError"));
      return;
    }

    setBusy(true);
    try {
      await setUssdPin(pin);
      setSuccess(true);
      setPin("");
      setConfirmPin("");
    } catch {
      setError(t("ussdPinSetError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1>{t("profile")}</h1>
        <p className="muted">
          {user?.fullName} &middot; {user?.phone}
        </p>
      </div>

      <div className="card">
        <h2>{t("ussdPinTitle")}</h2>
        <p className="muted">{t("ussdPinBody")}</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="pin">{t("ussdPinLabel")}</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPin">{t("ussdPinConfirmLabel")}</label>
            <input
              id="confirmPin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          {error && <p className="error">{error}</p>}
          {success && <p className="muted">{t("ussdPinSetSuccess")}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {t("ussdPinSubmit")}
          </button>
        </form>
      </div>

      <PushNotificationsSection />
    </div>
  );
}
