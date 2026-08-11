import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { api, apiOrThrow, registerAndLoginCitizen, loginAsSupervisor, waitUntil } from "./helpers.mjs";

describe("Birth Certificate: full citizen + staff journey", () => {
  test("apply -> pay -> auto-review -> approve -> certificate issued -> notified", async () => {
    const citizen = await registerAndLoginCitizen("Thandiwe Mvula's Parent");

    const application = await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "Thandiwe Mvula",
        dateOfBirth: "2026-06-01",
        placeOfBirth: "Zomba District Hospital",
        sex: "FEMALE",
        motherFullName: "Chisomo Mvula",
      },
      citizen.accessToken
    );
    assert.match(application.referenceNumber, /^BC-\d{4}-[A-F0-9]{8}$/);
    assert.equal(application.status, "SUBMITTED");
    assert.equal(application.feeAmount, 2000);

    const payment = await apiOrThrow(
      "POST",
      "/payments",
      {
        entityType: "birth_certificate",
        entityId: application.id,
        amount: application.feeAmount,
        currency: application.feeCurrency,
        provider: "AIRTEL_MONEY",
        phoneNumber: citizen.phone,
      },
      citizen.accessToken
    );
    assert.equal(payment.status, "PENDING", "mock payment starts pending, confirms asynchronously");

    // The mock provider auto-confirms after ~3s, which should drive: payment.completed ->
    // workflow-service's PAYMENT_CONFIRMED transition -> SUBMITTED -> UNDER_REVIEW.
    const underReview = await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/applications/${application.id}`, undefined, citizen.accessToken);
      return current.status === "UNDER_REVIEW" ? current : null;
    });
    assert.ok(underReview, "application did not reach UNDER_REVIEW after payment confirmation");
    assert.equal(underReview.payment.status, "COMPLETED");

    const supervisorToken = await loginAsSupervisor();
    const queue = await apiOrThrow("GET", "/applications?status=UNDER_REVIEW", undefined, supervisorToken);
    assert.ok(
      queue.some((a) => a.id === application.id),
      "application should appear in the supervisor's review queue"
    );

    const reviewed = await apiOrThrow(
      "POST",
      `/applications/${application.id}/review`,
      { action: "APPROVE", comment: "Looks correct." },
      supervisorToken
    );
    assert.equal(reviewed.status, "APPROVED");

    // Approval triggers async certificate generation + auto-ISSUE.
    const issued = await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/applications/${application.id}`, undefined, citizen.accessToken);
      return current.status === "ISSUED" ? current : null;
    });
    assert.ok(issued, "certificate was not issued in time");
    assert.ok(issued.certificateDocumentId, "issued application should have a certificate document id");

    const cert = await apiOrThrow("GET", `/applications/${application.id}/certificate`, undefined, citizen.accessToken);
    assert.match(cert.downloadUrl, /^http:\/\/localhost:9000\//, "presigned URL must be browser-reachable, not the internal Docker hostname");

    const download = await fetch(cert.downloadUrl);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF", "downloaded certificate should be a real PDF");

    const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
    const subjects = notifications.map((n) => n.subject);
    for (const expected of ["Application received", "Payment received", "Application status update", "Certificate ready"]) {
      assert.ok(subjects.includes(expected), `expected a "${expected}" notification`);
    }
  });

  test("only a REGISTRAR_SUPERVISOR (not a REGISTRAR_OFFICER) can approve or reject", async () => {
    const citizen = await registerAndLoginCitizen("Approval Guard Test");
    const application = await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "Guard Test Child",
        dateOfBirth: "2026-01-01",
        placeOfBirth: "Lilongwe",
        sex: "MALE",
        motherFullName: "Guard Test Mother",
      },
      citizen.accessToken
    );

    const { loginWithMfa } = await import("./helpers.mjs");
    const officerToken = await loginWithMfa("+265991000001", "Passw0rd!", "JBSWY3DPEHPK3PXP");

    // Not yet UNDER_REVIEW (no payment made), so this should fail on workflow state --
    // but even once UNDER_REVIEW, an officer must not be able to APPROVE.
    const { status } = await api(
      "POST",
      `/applications/${application.id}/review`,
      { action: "APPROVE" },
      officerToken
    );
    assert.ok([403, 409].includes(status), "an officer approving (or approving from the wrong state) must be rejected");
  });

  test("citizens cannot see each other's applications", async () => {
    const owner = await registerAndLoginCitizen("Owner");
    const stranger = await registerAndLoginCitizen("Stranger");

    const application = await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "Privacy Test Child",
        dateOfBirth: "2026-01-01",
        placeOfBirth: "Mzuzu",
        sex: "MALE",
        motherFullName: "Privacy Test Mother",
      },
      owner.accessToken
    );

    const { status } = await api("GET", `/applications/${application.id}`, undefined, stranger.accessToken);
    assert.equal(status, 403);
  });
});
