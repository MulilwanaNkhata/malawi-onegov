import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { listNotifications, type NotificationLog } from "../api/onegov";

export default function Notifications() {
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listNotifications()
      .then(setNotifications)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <div className="card">
        <h1>{t("notifications")}</h1>
        {loading ? (
          <p className="muted">...</p>
        ) : notifications.length === 0 ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          notifications.map((n) => (
            <div className="list-item" key={n.id}>
              <div>
                <strong>{n.subject ?? n.channel}</strong>
                <div className="muted">{n.body}</div>
              </div>
              <span className="muted">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
