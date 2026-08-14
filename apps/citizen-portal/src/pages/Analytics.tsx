import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import {
  getApplicationAnalytics,
  getPaymentAnalytics,
  getTradingLicenseAnalytics,
  getComplaintAnalytics,
  type ApplicationAnalytics,
  type PaymentAnalytics,
  type ComplaintAnalytics,
} from "../api/onegov";

const STATUS_ORDER = ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "ISSUED"];
const COMPLAINT_STATUS_ORDER = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function StatusBreakdown({ stats }: { stats: ApplicationAnalytics }) {
  const { t } = useLanguage();
  const maxCount = Math.max(1, ...Object.values(stats.byStatus));

  if (stats.totalApplications === 0) return <p className="muted">{t("noDataYet")}</p>;

  return (
    <>
      {STATUS_ORDER.map((status) => {
        const count = stats.byStatus[status] ?? 0;
        const pct = Math.round((count / maxCount) * 100);
        return (
          <div className="meter-row" key={status}>
            <span className="meter-label">{status.replace(/_/g, " ")}</span>
            <div className="meter-track">
              <div className={`meter-fill status-${status}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="meter-value">{count}</span>
          </div>
        );
      })}
    </>
  );
}

export default function Analytics() {
  const { t } = useLanguage();
  const [birthCertStats, setBirthCertStats] = useState<ApplicationAnalytics | null>(null);
  const [tradingLicenseStats, setTradingLicenseStats] = useState<ApplicationAnalytics | null>(null);
  const [paymentStats, setPaymentStats] = useState<PaymentAnalytics | null>(null);
  const [complaintStats, setComplaintStats] = useState<ComplaintAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getApplicationAnalytics(), getTradingLicenseAnalytics(), getPaymentAnalytics(), getComplaintAnalytics()])
      .then(([bc, tl, p, c]) => {
        setBirthCertStats(bc);
        setTradingLicenseStats(tl);
        setPaymentStats(p);
        setComplaintStats(c);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="container">Loading...</div>;
  if (!birthCertStats || !tradingLicenseStats || !paymentStats || !complaintStats) {
    return <div className="container">Could not load analytics.</div>;
  }

  const totalApplications = birthCertStats.totalApplications + tradingLicenseStats.totalApplications;
  const processingSamples = [birthCertStats.averageProcessingHours, tradingLicenseStats.averageProcessingHours].filter(
    (h): h is number => h !== null
  );
  const avgProcessingHours =
    processingSamples.length === 0 ? null : processingSamples.reduce((a, b) => a + b, 0) / processingSamples.length;

  return (
    <div className="container">
      <div className="card">
        <h1>{t("analytics")}</h1>
        <p className="muted">Across all three pilot services (Birth Certificate, Trading Licence &amp; Complaints)</p>

        <div className="stat-grid">
          <div className="stat-tile">
            <p className="stat-label">{t("totalApplications")}</p>
            <p className="stat-value">{totalApplications.toLocaleString()}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t("avgProcessingTime")}</p>
            <p className="stat-value">
              {avgProcessingHours === null
                ? "–"
                : avgProcessingHours < 1
                  ? Math.round(avgProcessingHours * 60) + "m"
                  : avgProcessingHours.toFixed(1) + "h"}
            </p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t("totalFeesCollected")}</p>
            <p className="stat-value">
              {paymentStats.totalCollected.toLocaleString()} <span style={{ fontSize: "0.9rem" }}>{paymentStats.currency}</span>
            </p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t("totalTransactions")}</p>
            <p className="stat-value">{paymentStats.totalTransactions.toLocaleString()}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t("myComplaints")}</p>
            <p className="stat-value">{complaintStats.totalComplaints.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          {t("applicationsByStatus")} — {t("birthCertificateService")}
        </h2>
        <StatusBreakdown stats={birthCertStats} />
      </div>

      <div className="card">
        <h2>
          {t("applicationsByStatus")} — {t("tradingLicenseService")}
        </h2>
        <StatusBreakdown stats={tradingLicenseStats} />
      </div>

      <div className="card">
        <h2>
          {t("applicationsByStatus")} — {t("complaintsService")}
        </h2>
        {complaintStats.totalComplaints === 0 ? (
          <p className="muted">{t("noDataYet")}</p>
        ) : (
          COMPLAINT_STATUS_ORDER.map((status) => {
            const count = complaintStats.byStatus[status] ?? 0;
            const maxCount = Math.max(1, ...Object.values(complaintStats.byStatus));
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div className="meter-row" key={status}>
                <span className="meter-label">{status.replace(/_/g, " ")}</span>
                <div className="meter-track">
                  <div className={`meter-fill status-${status}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="meter-value">{count}</span>
              </div>
            );
          })
        )}
        {Object.keys(complaintStats.byCategory).length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>{t("complaintCategory")}</h2>
            {Object.entries(complaintStats.byCategory).map(([category, count]) => (
              <div className="list-item" key={category}>
                <span>{category.replace(/_/g, " ")}</span>
                <span className="muted">{count}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>{t("paymentsByProvider")}</h2>
        {Object.keys(paymentStats.byProvider).length === 0 ? (
          <p className="muted">{t("noDataYet")}</p>
        ) : (
          Object.entries(paymentStats.byProvider).map(([provider, stats]) => (
            <div className="list-item" key={provider}>
              <span>{provider.replace(/_/g, " ")}</span>
              <span className="muted">
                {stats.count} &middot; {stats.total.toLocaleString()} {paymentStats.currency}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
