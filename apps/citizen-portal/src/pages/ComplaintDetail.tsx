import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { addComplaintResponse, complaintAction, getComplaint, type Complaint } from "../api/onegov";
import { StatusPill } from "../components/StatusPill";

const CATEGORY_LABELS: Record<string, string> = {
  SERVICE_QUALITY: "categoryServiceQuality",
  DELAY: "categoryDelay",
  STAFF_CONDUCT: "categoryStaffConduct",
  CORRUPTION: "categoryCorruption",
  OTHER: "categoryOther",
};

export default function ComplaintDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [resolutionText, setResolutionText] = useState("");
  const [reopenText, setReopenText] = useState("");

  async function reload() {
    if (!id) return;
    const data = await getComplaint(id);
    setComplaint(data);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="container">Loading...</div>;
  if (!complaint) return <div className="container">Not found.</div>;

  const isOwner = complaint.citizenUserId === user?.id;
  const isStaff = user?.role === "REGISTRAR_OFFICER" || user?.role === "REGISTRAR_SUPERVISOR" || user?.role === "SYSTEM_ADMIN";
  const isSupervisor = user?.role === "REGISTRAR_SUPERVISOR";

  async function runAction(action: "ASSIGN" | "RESOLVE" | "CLOSE" | "REOPEN", actionMessage?: string) {
    if (!id) return;
    setBusy(true);
    setMessage(null);
    try {
      await complaintAction(id, action, actionMessage);
      setResolutionText("");
      setReopenText("");
      await reload();
    } catch {
      setMessage("That action is not allowed from the current status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReply() {
    if (!id || !replyText.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await addComplaintResponse(id, replyText.trim());
      setReplyText("");
      await reload();
    } catch {
      setMessage("Could not send your message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <p>
        <Link to="/">&larr; {t("back")}</Link>
      </p>

      <div className="card">
        <h1>{complaint.subject}</h1>
        <p>
          {t("referenceNumber")}: <strong>{complaint.referenceNumber}</strong>
        </p>
        <p>
          {t("status")}: <StatusPill status={complaint.status} />
        </p>
        <p className="muted">{t("complaintCategory")}: {t(CATEGORY_LABELS[complaint.category] ?? "categoryOther")}</p>
        <p className="muted">{complaint.description}</p>
        {complaint.relatedReferenceNumber && (
          <p className="muted">
            {t("relatedReferenceNumber")}: {complaint.relatedReferenceNumber}
          </p>
        )}
        {message && <p className="muted">{message}</p>}
      </div>

      {isStaff && complaint.status === "OPEN" && (
        <div className="card">
          <button className="btn" onClick={() => runAction("ASSIGN")} disabled={busy}>
            {t("complaintAssign")}
          </button>
        </div>
      )}

      {isStaff && complaint.status === "IN_PROGRESS" && (
        <div className="card">
          <h2>{t("complaintResolve")}</h2>
          <div className="field">
            <textarea
              rows={3}
              placeholder={t("complaintResolutionPlaceholder")}
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
            />
            <button className="btn" onClick={() => runAction("RESOLVE", resolutionText)} disabled={busy || !resolutionText.trim()}>
              {t("complaintResolve")}
            </button>
          </div>
        </div>
      )}

      {complaint.status === "RESOLVED" && (isOwner || isSupervisor) && (
        <div className="card">
          <h2>{t("complaintResolved")}</h2>
          {isOwner && (
            <button className="btn" onClick={() => runAction("CLOSE")} disabled={busy} style={{ marginRight: 8 }}>
              {t("complaintCloseSatisfied")}
            </button>
          )}
          {isSupervisor && !isOwner && (
            <button className="btn" onClick={() => runAction("CLOSE")} disabled={busy} style={{ marginRight: 8 }}>
              {t("complaintClose")}
            </button>
          )}
          {isOwner && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>{t("complaintReopenPrompt")}</label>
              <textarea rows={2} value={reopenText} onChange={(e) => setReopenText(e.target.value)} />
              <button className="btn btn-secondary" onClick={() => runAction("REOPEN", reopenText)} disabled={busy}>
                {t("complaintReopen")}
              </button>
            </div>
          )}
        </div>
      )}

      {complaint.status === "CLOSED" && isSupervisor && (
        <div className="card">
          <button className="btn btn-secondary" onClick={() => runAction("REOPEN")} disabled={busy}>
            {t("complaintReopen")}
          </button>
        </div>
      )}

      <div className="card">
        <h2>{t("complaintThread")}</h2>
        {(complaint.responses?.length ?? 0) === 0 ? (
          <p className="muted">{t("complaintNoResponses")}</p>
        ) : (
          complaint.responses!.map((r) => (
            <div className="list-item" key={r.id} style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <strong>{r.authorRole === "CITIZEN" ? t("complaintYou") : t("complaintSupportTeam")}</strong>
              <p className="muted" style={{ margin: "4px 0" }}>{r.message}</p>
            </div>
          ))
        )}
        {(isOwner || isStaff) && (
          <div className="field" style={{ marginTop: 12 }}>
            <textarea rows={2} placeholder={t("complaintReplyPlaceholder")} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
            <button className="btn btn-secondary" onClick={handleReply} disabled={busy || !replyText.trim()}>
              {t("complaintSendReply")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
