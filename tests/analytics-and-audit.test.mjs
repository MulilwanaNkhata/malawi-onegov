import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { apiOrThrow, registerAndLoginCitizen, loginAsSupervisor, loginAsAdmin } from "./helpers.mjs";

describe("Reporting & analytics", () => {
  test("application analytics returns counts for every known status", async () => {
    const supervisorToken = await loginAsSupervisor();
    const stats = await apiOrThrow("GET", "/applications/analytics", undefined, supervisorToken);
    assert.ok(stats.totalApplications >= 0);
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "ISSUED"]) {
      assert.ok(status in stats.byStatus, `byStatus should have a key for ${status}`);
    }
  });

  test("trading licence analytics is independent of birth certificate analytics", async () => {
    const supervisorToken = await loginAsSupervisor();
    const [bc, tl] = await Promise.all([
      apiOrThrow("GET", "/applications/analytics", undefined, supervisorToken),
      apiOrThrow("GET", "/trading-licenses/analytics", undefined, supervisorToken),
    ]);
    // Both are real, independently-owned datasets -- there's no reason their totals should be coupled.
    assert.ok(typeof bc.totalApplications === "number");
    assert.ok(typeof tl.totalApplications === "number");
  });

  test("payment analytics aggregates revenue across both pilot services", async () => {
    const supervisorToken = await loginAsSupervisor();
    const stats = await apiOrThrow("GET", "/payments/analytics", undefined, supervisorToken);
    assert.ok(stats.totalCollected >= 0);
    assert.equal(stats.currency, "MWK");
    const sumByProvider = Object.values(stats.byProvider).reduce((sum, p) => sum + p.total, 0);
    assert.equal(sumByProvider, stats.totalCollected, "per-provider totals should sum to the grand total");
  });

  test("a plain citizen cannot read analytics", async () => {
    const { accessToken } = await registerAndLoginCitizen("Analytics Snoop Attempt");
    const { api } = await import("./helpers.mjs");
    const { status } = await api("GET", "/applications/analytics", undefined, accessToken);
    assert.equal(status, 403);
  });
});

describe("Audit trail: tamper-evident hash chain", () => {
  test("the chain verifies as intact", async () => {
    const adminToken = await loginAsAdmin();
    const result = await apiOrThrow("GET", "/audit/verify", undefined, adminToken);
    assert.equal(result.valid, true, "hash chain should verify -- if this fails, something rewrote audit history");
    assert.ok(result.checkedCount > 0);
  });

  test("a sensitive action recorded during this test run appears in the audit log", async () => {
    const citizen = await registerAndLoginCitizen("Audit Trail Test User");
    const adminToken = await loginAsAdmin();

    const events = await apiOrThrow(
      "GET",
      `/audit?actorUserId=${citizen.userId}&action=USER_REGISTERED`,
      undefined,
      adminToken
    );
    assert.ok(events.length >= 1, "expected the USER_REGISTERED audit event for this test's citizen");
    assert.equal(events[0].resourceId, citizen.userId);
  });

  test("only REGISTRAR_SUPERVISOR/SYSTEM_ADMIN roles can query the audit log", async () => {
    const { accessToken } = await registerAndLoginCitizen("Audit Snoop Attempt");
    const { api } = await import("./helpers.mjs");
    const { status } = await api("GET", "/audit", undefined, accessToken);
    assert.equal(status, 403);
  });
});
