import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { listApplications, type BirthCertificateApplication } from "../api/onegov";
import { StatusPill } from "../components/StatusPill";

const FILTERS = ["UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "ISSUED", ""] as const;

export default function StaffQueue() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<string>("UNDER_REVIEW");
  const [applications, setApplications] = useState<BirthCertificateApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listApplications(status || undefined)
      .then(setApplications)
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="container">
      <div className="card">
        <h1>{t("staffQueue")}</h1>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f || "ALL"}
              className={f === status ? "btn" : "btn btn-secondary"}
              onClick={() => setStatus(f)}
            >
              {f ? f.replace(/_/g, " ") : "ALL"}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="muted">...</p>
        ) : applications.length === 0 ? (
          <p className="muted">{t("noApplications")}</p>
        ) : (
          applications.map((application) => (
            <div className="list-item" key={application.id}>
              <div>
                <strong>{application.childFullName}</strong>
                <div className="muted">{application.referenceNumber}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusPill status={application.status} />
                <Link to={`/applications/${application.id}`}>{t("viewDetails")}</Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
