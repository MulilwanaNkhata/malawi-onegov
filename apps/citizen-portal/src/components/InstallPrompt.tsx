import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const DISMISSED_KEY = "onegov-install-prompt-dismissed";

/**
 * Chrome/Edge/Android fire `beforeinstallprompt` and let a page trigger the
 * native install flow directly. iOS Safari never fires that event -- there
 * is no programmatic install there, only "Share > Add to Home Screen" --
 * so this shows an instructional hint instead of a button on iOS.
 */
export function InstallPrompt() {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_KEY) === "1");
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handler);
    if (isIos()) setIosHint(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (dismissed || isStandalone() || (!deferredPrompt && !iosHint)) return null;

  function dismiss() {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <div className="install-banner">
      <span>{deferredPrompt ? t("installHintAndroid") : t("installHintIos")}</span>
      <div className="install-banner-actions">
        {deferredPrompt && (
          <button className="btn" onClick={install}>
            {t("installApp")}
          </button>
        )}
        <button className="btn-secondary" onClick={dismiss}>
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
