import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

export function OfflineBanner() {
  const { t } = useLanguage();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;
  return <div className="offline-banner">{t("offlineBanner")}</div>;
}
