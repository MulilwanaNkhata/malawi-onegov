import { Routes, Route, Link } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useLanguage } from "./i18n/LanguageContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import NewApplication from "./pages/NewApplication";
import ApplicationDetail from "./pages/ApplicationDetail";
import Notifications from "./pages/Notifications";
import StaffQueue from "./pages/StaffQueue";
import Analytics from "./pages/Analytics";
import NewTradingLicense from "./pages/NewTradingLicense";
import TradingLicenseDetail from "./pages/TradingLicenseDetail";
import StaffTradingLicenseQueue from "./pages/StaffTradingLicenseQueue";
import Profile from "./pages/Profile";

export default function App() {
  const { user, logout, isStaff } = useAuth();
  const { lang, setLang, t } = useLanguage();

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div>
            <Link className="brand" to="/">
              {t("appName")}
            </Link>
            <p className="tagline">{t("tagline")}</p>
          </div>
          <nav className="nav">
            <button onClick={() => setLang(lang === "en" ? "ny" : "en")}>{lang === "en" ? "Chichewa" : "English"}</button>
            {user ? (
              <>
                {isStaff && <Link to="/staff/analytics">{t("analytics")}</Link>}
                {!isStaff && <Link to="/profile">{t("profile")}</Link>}
                <Link to="/notifications">{t("notifications")}</Link>
                <button onClick={logout}>{t("logout")}</button>
              </>
            ) : (
              <>
                <Link to="/login">{t("login")}</Link>
                <Link to="/register">{t("register")}</Link>
              </>
            )}
          </nav>
        </div>
      </div>

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/applications/new"
          element={
            <ProtectedRoute>
              <NewApplication />
            </ProtectedRoute>
          }
        />
        <Route
          path="/applications/:id"
          element={
            <ProtectedRoute>
              <ApplicationDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trading-licenses/new"
          element={
            <ProtectedRoute>
              <NewTradingLicense />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trading-licenses/:id"
          element={
            <ProtectedRoute>
              <TradingLicenseDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/trading-licenses"
          element={
            <ProtectedRoute staffOnly>
              <StaffTradingLicenseQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/queue"
          element={
            <ProtectedRoute staffOnly>
              <StaffQueue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/analytics"
          element={
            <ProtectedRoute staffOnly>
              <Analytics />
            </ProtectedRoute>
          }
        />
      </Routes>

      <footer>Malawi OneGov — pilot scaffold (Birth Certificate &amp; Trading Licence journeys)</footer>
    </>
  );
}
