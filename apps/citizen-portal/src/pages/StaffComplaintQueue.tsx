import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { listComplaints, type Complaint } from "../api/onegov";
import { StatusPill } from "../components/StatusPill";

const FILTERS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", ""] as const;

export default function StaffComplaintQueue() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<string>("OPEN");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listComplaints(status || undefined)
      .then(setComplaints)
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="container">
      <div className="card">
        <h1>
          {t("staffQueue")} — {t("complaintsService")}
        </h1>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button key={f || "ALL"} className={f === status ? "btn" : "btn btn-secondary"} onClick={() => setStatus(f)}>
              {f ? f.replace(/_/g, " ") : "ALL"}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="muted">...</p>
        ) : complaints.length === 0 ? (
          <p className="muted">{t("complaintNoneInQueue")}</p>
        ) : (
          complaints.map((complaint) => (
            <div className="list-item" key={complaint.id}>
              <div>
                <strong>{complaint.subject}</strong>
                <div className="muted">{complaint.referenceNumber}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusPill status={complaint.status} />
                <Link to={`/complaints/${complaint.id}`}>{t("viewDetails")}</Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
