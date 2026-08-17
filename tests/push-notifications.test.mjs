import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { apiOrThrow, api, registerAndLoginCitizen, waitUntil } from "./helpers.mjs";

function fakeSubscription(endpoint) {
  return {
    endpoint,
    expirationTime: null,
    keys: { p256dh: "BFakeP256dhKeyForTestingPurposesOnly1234567890", auth: "FakeAuthSecretForTests" },
  };
}

describe("Push notifications", () => {
  test("the VAPID public key is published and looks like a real key, not a placeholder", async () => {
    const citizen = await registerAndLoginCitizen("Push Key Citizen");
    const { publicKey } = await apiOrThrow("GET", "/notifications/push/public-key", undefined, citizen.accessToken);
    assert.ok(publicKey, "expected a public key to be configured");
    assert.match(publicKey, /^[A-Za-z0-9_-]{80,}$/, `expected a base64url VAPID public key, got: ${publicKey}`);
  });

  test("subscribing then unsubscribing a push endpoint round-trips cleanly", async () => {
    const citizen = await registerAndLoginCitizen("Push Subscribe Citizen");
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;

    const subscribed = await api("POST", "/notifications/push/subscribe", fakeSubscription(endpoint), citizen.accessToken);
    assert.equal(subscribed.status, 204);

    // Re-subscribing the same endpoint (e.g. the browser re-registering on
    // reload) must upsert cleanly, not conflict on the unique endpoint.
    const resubscribed = await api("POST", "/notifications/push/subscribe", fakeSubscription(endpoint), citizen.accessToken);
    assert.equal(resubscribed.status, 204);

    const unsubscribed = await api("DELETE", "/notifications/push/subscribe", { endpoint }, citizen.accessToken);
    assert.equal(unsubscribed.status, 204);
  });

  test("subscribing with a malformed endpoint is rejected", async () => {
    const citizen = await registerAndLoginCitizen("Push Bad Endpoint Citizen");
    const response = await api(
      "POST",
      "/notifications/push/subscribe",
      fakeSubscription("not-a-url"),
      citizen.accessToken
    );
    assert.equal(response.status, 400);
  });

  test("a citizen who never enabled push gets SMS as usual but no PUSH log entry at all", async () => {
    const citizen = await registerAndLoginCitizen("No Push Citizen");

    await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "No Push Baby",
        dateOfBirth: "2026-05-05",
        placeOfBirth: "Mzuzu",
        sex: "MALE",
        motherFullName: "No Push Mother",
      },
      citizen.accessToken
    );

    const smsLogged = await waitUntil(async () => {
      const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
      return notifications.find((n) => n.channel === "SMS" && n.templateCode === "application.submitted");
    });
    assert.ok(smsLogged, "SMS notification should still be logged regardless of push subscription state");

    const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
    const pushLogged = notifications.find((n) => n.channel === "PUSH");
    assert.equal(pushLogged, undefined, "no PUSH log row should exist for a citizen who never subscribed");
  });

  test("a subscription pointing at an unreachable endpoint is attempted and logged as FAILED, not silently dropped", async () => {
    const citizen = await registerAndLoginCitizen("Doomed Push Citizen");
    // Port 1 inside notification-service's own container has nothing
    // listening -- a fast, deterministic connection failure without needing
    // a real push service or a second mock server reachable from Docker.
    const endpoint = `https://localhost:1/doomed-endpoint-${Date.now()}`;
    await apiOrThrow("POST", "/notifications/push/subscribe", fakeSubscription(endpoint), citizen.accessToken);

    await apiOrThrow(
      "POST",
      "/applications",
      {
        childFullName: "Doomed Push Baby",
        dateOfBirth: "2026-05-06",
        placeOfBirth: "Karonga",
        sex: "FEMALE",
        motherFullName: "Doomed Push Mother",
      },
      citizen.accessToken
    );

    const pushLogged = await waitUntil(async () => {
      const notifications = await apiOrThrow("GET", "/notifications", undefined, citizen.accessToken);
      return notifications.find((n) => n.channel === "PUSH" && n.templateCode === "application.submitted");
    });
    assert.ok(pushLogged, "expected a PUSH log row once notify.ts attempted delivery to the subscribed endpoint");
    assert.equal(pushLogged.status, "FAILED", "an unreachable push endpoint should be logged as FAILED, not SENT");
  });
});
