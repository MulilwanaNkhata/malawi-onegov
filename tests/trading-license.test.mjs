import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { api, apiOrThrow, registerAndLoginCitizen, loginAsSupervisor, waitUntil } from "./helpers.mjs";

describe("Trading Licence: full citizen + staff journey (second pilot service)", () => {
  test("apply -> pay -> auto-review -> approve -> licence issued -> notified", async () => {
    const citizen = await registerAndLoginCitizen("Grace Banda");

    const application = await apiOrThrow(
      "POST",
      "/trading-licenses",
      {
        businessName: "Banda General Store",
        businessType: "RETAIL",
        tradingAddress: "Plot 14, Chilobwe Road",
        district: "Blantyre",
        ownerFullName: "Grace Banda",
      },
      citizen.accessToken
    );
    assert.match(application.referenceNumber, /^TL-\d{4}-[A-F0-9]{8}$/);
    assert.equal(application.status, "SUBMITTED");
    assert.equal(application.feeAmount, 15000, "trading licence fee should differ from the birth certificate fee");

    await apiOrThrow(
      "POST",
      "/payments",
      {
        entityType: "trading_license",
        entityId: application.id,
        amount: application.feeAmount,
        currency: application.feeCurrency,
        provider: "TNM_MPAMBA",
        phoneNumber: citizen.phone,
      },
      citizen.accessToken
    );

    const underReview = await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/trading-licenses/${application.id}`, undefined, citizen.accessToken);
      return current.status === "UNDER_REVIEW" ? current : null;
    });
    assert.ok(underReview, "application did not reach UNDER_REVIEW after payment confirmation");

    const supervisorToken = await loginAsSupervisor();
    const reviewed = await apiOrThrow(
      "POST",
      `/trading-licenses/${application.id}/review`,
      { action: "APPROVE" },
      supervisorToken
    );
    assert.equal(reviewed.status, "APPROVED");

    const issued = await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/trading-licenses/${application.id}`, undefined, citizen.accessToken);
      return current.status === "ISSUED" ? current : null;
    });
    assert.ok(issued, "licence was not issued in time");

    const cert = await apiOrThrow("GET", `/trading-licenses/${application.id}/certificate`, undefined, citizen.accessToken);
    const download = await fetch(cert.downloadUrl);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");

    const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
    const businessNotification = notifications.find((n) => n.body.includes("Trading Licence"));
    assert.ok(businessNotification, "expected at least one notification mentioning 'Trading Licence' by name");
  });

  test("a rejected application does not generate a certificate", async () => {
    const citizen = await registerAndLoginCitizen("Rejection Test Owner");
    const application = await apiOrThrow(
      "POST",
      "/trading-licenses",
      {
        businessName: "Reject Me Enterprises",
        businessType: "OTHER",
        tradingAddress: "Nowhere Road",
        district: "Mzuzu",
        ownerFullName: "Rejection Test Owner",
      },
      citizen.accessToken
    );
    await apiOrThrow(
      "POST",
      "/payments",
      {
        entityType: "trading_license",
        entityId: application.id,
        amount: application.feeAmount,
        currency: application.feeCurrency,
        provider: "AIRTEL_MONEY",
        phoneNumber: citizen.phone,
      },
      citizen.accessToken
    );
    await waitUntil(async () => {
      const current = await apiOrThrow("GET", `/trading-licenses/${application.id}`, undefined, citizen.accessToken);
      return current.status === "UNDER_REVIEW" ? current : null;
    });

    const supervisorToken = await loginAsSupervisor();
    const rejected = await apiOrThrow(
      "POST",
      `/trading-licenses/${application.id}/review`,
      { action: "REJECT", comment: "Incomplete trading address." },
      supervisorToken
    );
    assert.equal(rejected.status, "REJECTED");

    // Give any (incorrect) certificate-generation path a moment, then confirm none occurred.
    await new Promise((r) => setTimeout(r, 2000));
    const final = await apiOrThrow("GET", `/trading-licenses/${application.id}`, undefined, citizen.accessToken);
    assert.equal(final.status, "REJECTED");
    assert.equal(final.certificateDocumentId, null);

    const { status } = await api("GET", `/trading-licenses/${application.id}/certificate`, undefined, citizen.accessToken);
    assert.equal(status, 409, "downloading a certificate for a rejected application should fail cleanly");
  });
});
