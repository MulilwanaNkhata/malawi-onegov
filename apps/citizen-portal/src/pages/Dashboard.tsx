import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import {
  listApplications,
  listTradingLicenses,
  type BirthCertificateApplication,
  type TradingLicenseApplication,
} from "../api/onegov";
import { StatusPill } from "../components/StatusPill";

export default function Dashboard() {
  const { user, isStaff } = useAuth();
  const { t } = useLanguage();
  const [applications, setApplications] = useState<BirthCertificateApplication[]>([]);
  const [licenses, setLicenses] = useState<TradingLicenseApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isStaff) {
      setLoading(false);
      return;
    }
    Promise.all([listApplications(), listTradingLicenses()])
      .then(([apps, lics]) => {
        setApplications(apps);
        setLicenses(lics);
      })
      .finally(() => setLoading(false));
  }, [isStaff]);

  return (
    <div className="container">
      <div className="card">
        <h1>
          {t("welcome")}, {user?.fullName}
        </h1>
        <p className="muted">{t("appName")} — {t("tagline")}</p>
        {isStaff && (
          <div className="btn-row">
            <Link className="btn btn-secondary" to="/staff/queue">
              {t("birthCertificateService")} {t("staffQueue")}
            </Link>
            <Link className="btn btn-secondary" to="/staff/trading-licenses">
              {t("tradingLicenseService")} {t("staffQueue")}
            </Link>
            <Link className="btn btn-secondary" to="/staff/analytics">
              {t("analytics")}
            </Link>
          </div>
        )}
      </div>

      {!isStaff && (
        <>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>{t("myApplications")}</h2>
              <Link className="btn" to="/applications/new">
                {t("newApplication")}
              </Link>
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

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>{t("myTradingLicenses")}</h2>
              <Link className="btn" to="/trading-licenses/new">
                {t("newTradingLicense")}
              </Link>
            </div>

            {loading ? (
              <p className="muted">...</p>
            ) : licenses.length === 0 ? (
              <p className="muted">{t("noApplications")}</p>
            ) : (
              licenses.map((license) => (
                <div className="list-item" key={license.id}>
                  <div>
                    <strong>{license.businessName}</strong>
                    <div className="muted">{license.referenceNumber}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusPill status={license.status} />
                    <Link to={`/trading-licenses/${license.id}`}>{t("viewDetails")}</Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
