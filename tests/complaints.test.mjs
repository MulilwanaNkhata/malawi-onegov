import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  apiOrThrow,
  registerAndLoginCitizen,
  loginAsSupervisor,
  loginWithMfa,
  waitUntil,
  SEEDED_STAFF_MFA_SECRET,
} from "./helpers.mjs";

// Seeded REGISTRAR_OFFICER, matching the phone/password/secret every other
// seeded-staff helper in this suite uses (see scripts/seed-staff.mjs).
function loginWithSeededOfficer() {
  return loginWithMfa("+265991000001", "Passw0rd!", SEEDED_STAFF_MFA_SECRET);
}

describe("Complaints/support: full citizen + staff journey (third pilot service, a genuinely different workflow shape)", () => {
  test("file -> assign -> resolve -> reopen -> resolve -> close, with a running response thread", async () => {
    const citizen = await registerAndLoginCitizen("Complaint Test Citizen");

    const complaint = await apiOrThrow(
      "POST",
      "/complaints",
      {
        category: "DELAY",
        subject: "My Birth Certificate review is taking too long",
        description: "I applied three weeks ago and there has been no update on the status.",
      },
      citizen.accessToken
    );
    assert.match(complaint.referenceNumber, /^CMP-\d{4}-[A-F0-9]{8}$/);
    assert.equal(complaint.status, "OPEN");

    const supervisorToken = await loginAsSupervisor();

    const queue = await apiOrThrow("GET", "/complaints?status=OPEN", undefined, supervisorToken);
    assert.ok(queue.some((c) => c.id === complaint.id), "the new complaint should appear in the staff OPEN queue");

    const assigned = await apiOrThrow("POST", `/complaints/${complaint.id}/action`, { action: "ASSIGN" }, supervisorToken);
    assert.equal(assigned.status, "IN_PROGRESS");

    await apiOrThrow(
      "POST",
      `/complaints/${complaint.id}/responses`,
      { message: "Thanks for reporting this -- can you share your application reference number?" },
      supervisorToken
    );

    const resolveWithoutMessage = await api(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "RESOLVE" },
      supervisorToken
    );
    assert.equal(resolveWithoutMessage.status, 400, "resolving without an explanation message should be rejected");

    const resolved = await apiOrThrow(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "RESOLVE", message: "Your application has been expedited and moved to review." },
      supervisorToken
    );
    assert.equal(resolved.status, "RESOLVED");

    const inSyncAfterResolve = await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/complaints/${complaint.id}`, undefined, citizen.accessToken);
      return current.status === "RESOLVED" ? current : null;
    });
    assert.ok(inSyncAfterResolve, "complaints-service's own read model did not catch up to RESOLVED in time");

    // Citizen isn't satisfied -- this is the loop the apply-and-issue templates never needed.
    const reopened = await apiOrThrow(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "REOPEN", message: "Still no change on my application, please check again." },
      citizen.accessToken
    );
    assert.equal(reopened.status, "IN_PROGRESS");

    await apiOrThrow(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "RESOLVE", message: "Confirmed -- your application moved to APPROVED this morning." },
      supervisorToken
    );

    const closed = await apiOrThrow("POST", `/complaints/${complaint.id}/action`, { action: "CLOSE" }, citizen.accessToken);
    assert.equal(closed.status, "CLOSED");

    const final = await apiOrThrow("GET", `/complaints/${complaint.id}`, undefined, citizen.accessToken);
    assert.equal(final.responses.length, 4, "expected the clarifying question, first resolution, the reopen message, and the second resolution");
    assert.deepEqual(
      final.responses.map((r) => r.authorRole),
      ["REGISTRAR_SUPERVISOR", "REGISTRAR_SUPERVISOR", "CITIZEN", "REGISTRAR_SUPERVISOR"]
    );

    const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
    assert.ok(
      notifications.some((n) => n.body.includes(complaint.referenceNumber) && n.body.includes("handled by our support team")),
      "expected a notification about the complaint moving to IN_PROGRESS"
    );
    assert.ok(
      notifications.some((n) => n.templateCode === "complaint.response_added"),
      "expected a notification when staff added a response"
    );
  });

  test("a citizen cannot see or act on another citizen's complaint", async () => {
    const owner = await registerAndLoginCitizen("Complaint Owner");
    const stranger = await registerAndLoginCitizen("Complaint Stranger");

    const complaint = await apiOrThrow(
      "POST",
      "/complaints",
      { category: "OTHER", subject: "Private complaint", description: "This should not be visible to anyone else." },
      owner.accessToken
    );

    const { status: getStatus } = await api("GET", `/complaints/${complaint.id}`, undefined, stranger.accessToken);
    assert.equal(getStatus, 403);

    const { status: actionStatus } = await api(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "CLOSE" },
      stranger.accessToken
    );
    assert.equal(actionStatus, 403);
  });

  test("only a REGISTRAR_SUPERVISOR (not a REGISTRAR_OFFICER) can close or reopen", async () => {
    const citizen = await registerAndLoginCitizen("Role Boundary Citizen");
    const complaint = await apiOrThrow(
      "POST",
      "/complaints",
      { category: "STAFF_CONDUCT", subject: "Role boundary test", description: "Testing who may close a complaint." },
      citizen.accessToken
    );

    // SYSTEM_ADMIN, like on the other two pilot services, isn't in any
    // transition's allowedRoles -- REGISTRAR_SUPERVISOR does the ASSIGN/RESOLVE setup here.
    const supervisorToken = await loginAsSupervisor();
    await apiOrThrow("POST", `/complaints/${complaint.id}/action`, { action: "ASSIGN" }, supervisorToken);
    await apiOrThrow(
      "POST",
      `/complaints/${complaint.id}/action`,
      { action: "RESOLVE", message: "Resolved for the role-boundary test." },
      supervisorToken
    );

    // REGISTRAR_OFFICER is allowed to ASSIGN/RESOLVE but the template does not grant it CLOSE.
    const officerToken = await loginWithSeededOfficer();
    const { status } = await api("POST", `/complaints/${complaint.id}/action`, { action: "CLOSE" }, officerToken);
    assert.equal(status, 409, "workflow-service should reject CLOSE from a role the template does not allow");
  });

  test("a citizen cannot call the staff-only analytics endpoint", async () => {
    const citizen = await registerAndLoginCitizen("Analytics Boundary Citizen");
    const { status } = await api("GET", "/complaints/analytics", undefined, citizen.accessToken);
    assert.equal(status, 403);
  });

  test("analytics shape reflects real data (staff only)", async () => {
    const citizen = await registerAndLoginCitizen("Analytics Data Citizen");
    await apiOrThrow(
      "POST",
      "/complaints",
      { category: "CORRUPTION", subject: "Analytics test complaint", description: "Just here to move the analytics counters." },
      citizen.accessToken
    );

    const supervisorToken = await loginAsSupervisor();
    const analytics = await apiOrThrow("GET", "/complaints/analytics", undefined, supervisorToken);
    assert.ok(analytics.totalComplaints >= 1);
    assert.ok(analytics.byCategory.CORRUPTION >= 1);
    assert.ok(typeof analytics.byStatus.OPEN === "number");
  });
});
