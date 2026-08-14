import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import {
  getApplicationAnalytics,
  getTradingLicenseAnalytics,
  getComplaintAnalytics,
  getPaymentAnalytics,
  listApplications,
  listTradingLicenses,
  listComplaints,
  type ApplicationAnalytics,
  type ComplaintAnalytics,
  type PaymentAnalytics,
} from "../api/onegov";
import { StatusPill } from "../components/StatusPill";
import { DocumentIcon, BriefcaseIcon, MessageIcon, ClockIcon, AlertCircleIcon, DollarSignIcon, ArrowRightIcon } from "../components/Icons";

const ROLE_LABEL_KEY: Record<string, string> = {
  REGISTRAR_OFFICER: "roleRegistrarOfficer",
  REGISTRAR_SUPERVISOR: "roleRegistrarSupervisor",
  SYSTEM_ADMIN: "roleSystemAdmin",
};

interface ActivityItem {
  key: string;
  icon: ReactNode;
  title: string;
  referenceNumber: string;
  status: string;
  createdAt: string;
  link: string;
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [bcStats, setBcStats] = useState<ApplicationAnalytics | null>(null);
  const [tlStats, setTlStats] = useState<ApplicationAnalytics | null>(null);
  const [complaintStats, setComplaintStats] = useState<ComplaintAnalytics | null>(null);
  const [paymentStats, setPaymentStats] = useState<PaymentAnalytics | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getApplicationAnalytics(),
      getTradingLicenseAnalytics(),
      getComplaintAnalytics(),
      getPaymentAnalytics(),
      listApplications(),
      listTradingLicenses(),
      listComplaints(),
    ])
      .then(([bc, tl, complaints, payments, apps, licenses, complaintList]) => {
        setBcStats(bc);
        setTlStats(tl);
        setComplaintStats(complaints);
        setPaymentStats(payments);

        const merged: ActivityItem[] = [
          ...apps.map((a) => ({
            key: `bc-${a.id}`,
            icon: <DocumentIcon size={16} />,
            title: a.childFullName,
            referenceNumber: a.referenceNumber,
            status: a.status,
            createdAt: a.createdAt,
            link: `/applications/${a.id}`,
          })),
          ...licenses.map((l) => ({
            key: `tl-${l.id}`,
            icon: <BriefcaseIcon size={16} />,
            title: l.businessName,
            referenceNumber: l.referenceNumber,
            status: l.status,
            createdAt: l.createdAt,
            link: `/trading-licenses/${l.id}`,
          })),
          ...complaintList.map((c) => ({
            key: `cx-${c.id}`,
            icon: <MessageIcon size={16} />,
            title: c.subject,
            referenceNumber: c.referenceNumber,
            status: c.status,
            createdAt: c.createdAt,
            link: `/complaints/${c.id}`,
          })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        setActivity(merged.slice(0, 8));
      })
      .finally(() => setLoading(false));
  }, []);

  const roleLabel = user ? t(ROLE_LABEL_KEY[user.role] ?? "staffQueue") : "";

  const awaitingReviewBC = bcStats?.byStatus["UNDER_REVIEW"] ?? 0;
  const awaitingReviewTL = tlStats?.byStatus["UNDER_REVIEW"] ?? 0;
  const openComplaints = complaintStats?.byStatus["OPEN"] ?? 0;
  const inProgressComplaints = complaintStats?.byStatus["IN_PROGRESS"] ?? 0;

  return (
    <div className="container container-wide">
      <div className="card staff-hero">
        <div>
          <h1>
            {t("welcome")}, {user?.fullName}
          </h1>
          {user && <span className="role-badge">{roleLabel}</span>}
          <p className="muted" style={{ marginTop: 8 }}>
            {t("staffDashboardSubtitle")}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>{t("atAGlance")}</h2>
        {loading ? (
          <p className="muted">...</p>
        ) : (
          <div className="stat-grid">
            <div className="stat-tile stat-tile-alert">
              <div className="stat-tile-icon">
                <ClockIcon size={18} />
              </div>
              <p className="stat-label">{t("awaitingReviewBC")}</p>
              <p className="stat-value">{awaitingReviewBC}</p>
            </div>
            <div className="stat-tile stat-tile-alert">
              <div className="stat-tile-icon">
                <ClockIcon size={18} />
              </div>
              <p className="stat-label">{t("awaitingReviewTL")}</p>
              <p className="stat-value">{awaitingReviewTL}</p>
            </div>
            <div className="stat-tile stat-tile-alert">
              <div className="stat-tile-icon">
                <AlertCircleIcon size={18} />
              </div>
              <p className="stat-label">{t("openComplaints")}</p>
              <p className="stat-value">{openComplaints}</p>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-icon">
                <MessageIcon size={18} />
              </div>
              <p className="stat-label">{t("inProgressComplaints")}</p>
              <p className="stat-value">{inProgressComplaints}</p>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-icon">
                <DollarSignIcon size={18} />
              </div>
              <p className="stat-label">{t("totalFeesCollected")}</p>
              <p className="stat-value">
                {paymentStats ? paymentStats.totalCollected.toLocaleString() : "–"}{" "}
                <span style={{ fontSize: "0.85rem" }}>{paymentStats?.currency}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2>{t("serviceQueues")}</h2>
          <Link to="/staff/analytics" className="link-arrow">
            {t("viewFullAnalytics")} →
          </Link>
        </div>

        <div className="queue-grid">
          <Link to="/staff/queue" className="queue-card">
            <div className="queue-card-icon">
              <DocumentIcon size={22} />
            </div>
            <div className="queue-card-body">
              <h3>{t("birthCertificateService")}</h3>
              <div className="queue-card-stats">
                <span>
                  <strong>{bcStats?.totalApplications ?? 0}</strong> {t("totalInQueue")}
                </span>
                <span className="queue-card-alert">
                  <strong>{awaitingReviewBC}</strong> {t("needsAction")}
                </span>
              </div>
            </div>
            <ArrowRightIcon size={18} />
          </Link>

          <Link to="/staff/trading-licenses" className="queue-card">
            <div className="queue-card-icon">
              <BriefcaseIcon size={22} />
            </div>
            <div className="queue-card-body">
              <h3>{t("tradingLicenseService")}</h3>
              <div className="queue-card-stats">
                <span>
                  <strong>{tlStats?.totalApplications ?? 0}</strong> {t("totalInQueue")}
                </span>
                <span className="queue-card-alert">
                  <strong>{awaitingReviewTL}</strong> {t("needsAction")}
                </span>
              </div>
            </div>
            <ArrowRightIcon size={18} />
          </Link>

          <Link to="/staff/complaints" className="queue-card">
            <div className="queue-card-icon">
              <MessageIcon size={22} />
            </div>
            <div className="queue-card-body">
              <h3>{t("complaintsService")}</h3>
              <div className="queue-card-stats">
                <span>
                  <strong>{complaintStats?.totalComplaints ?? 0}</strong> {t("totalInQueue")}
                </span>
                <span className="queue-card-alert">
                  <strong>{openComplaints + inProgressComplaints}</strong> {t("needsAction")}
                </span>
              </div>
            </div>
            <ArrowRightIcon size={18} />
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>{t("recentActivity")}</h2>
        {loading ? (
          <p className="muted">...</p>
        ) : activity.length === 0 ? (
          <p className="muted">{t("noRecentActivity")}</p>
        ) : (
          activity.map((item) => (
            <div className="list-item" key={item.key}>
              <div className="activity-item-main">
                <span className="activity-icon">{item.icon}</span>
                <div>
                  <strong>{item.title}</strong>
                  <div className="muted">{item.referenceNumber}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusPill status={item.status} />
                <Link to={item.link}>{t("viewDetails")}</Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
