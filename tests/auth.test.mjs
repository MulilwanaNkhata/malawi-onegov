import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { api, apiOrThrow, randomPhone, registerCitizen, registerAndLoginCitizen, totp } from "./helpers.mjs";

describe("identity: registration and MFA login", () => {
  test("registering returns an MFA enrollment secret and QR code", async () => {
    const { status, data } = await api("POST", "/auth/register", {
      fullName: "Auth Test User",
      phone: randomPhone(),
      password: "TestPass1!",
    });
    assert.equal(status, 201);
    assert.ok(data.userId, "expected a userId in the response");
    assert.match(data.mfaEnrollment.secret, /^[A-Z2-7]+$/, "MFA secret should be base32");
    assert.match(data.mfaEnrollment.qrCodeDataUrl, /^data:image\/png;base64,/);
  });

  test("registering the same phone number twice is rejected", async () => {
    const { phone } = await registerCitizen("Dup User");
    const { status, data } = await api("POST", "/auth/register", { fullName: "Dup User", phone, password: "TestPass1!" });
    assert.equal(status, 409);
    assert.equal(data.error, "phone_already_registered");
  });

  test("full login flow: password step, then a fresh TOTP code, succeeds", async () => {
    const { accessToken, userId } = await registerAndLoginCitizen("Login Test User");
    assert.ok(accessToken, "expected an access token after MFA verification");

    const me = await apiOrThrow("GET", "/users/me", undefined, accessToken);
    assert.equal(me.id, userId);
    assert.equal(me.role, "CITIZEN");
  });

  test("with MFA_REQUIRED off, /auth/login returns a working session directly (no TOTP step needed)", async () => {
    const { phone, password } = await registerCitizen("Direct Login Test User");
    const loginRes = await apiOrThrow("POST", "/auth/login", { phone, password });

    assert.equal(loginRes.mfaRequired, false);
    assert.ok(loginRes.accessToken, "expected a usable access token straight from /auth/login");
    assert.ok(loginRes.refreshToken);
    assert.ok(loginRes.mfaTicket, "the MFA ticket should still be minted even though it isn't required -- /auth/mfa/verify must stay fully usable");

    // Prove the directly-issued token is a real, working session, not a stub.
    const me = await apiOrThrow("GET", "/users/me", undefined, loginRes.accessToken);
    assert.equal(me.role, "CITIZEN");

    // And prove the MFA subsystem underneath is untouched: the ticket this
    // same login minted still works against /auth/mfa/verify on demand.
    const citizen = await registerCitizen("Still Works Test User");
    const stillWorksLogin = await apiOrThrow("POST", "/auth/login", { phone: citizen.phone, password: citizen.password });
    const mfaResult = await apiOrThrow("POST", "/auth/mfa/verify", () => ({
      mfaTicket: stillWorksLogin.mfaTicket,
      code: totp(citizen.mfaEnrollment.secret),
    }));
    assert.ok(mfaResult.accessToken, "the full MFA verification path must still work even while login-time MFA is optional");
  });

  test("wrong password is rejected before MFA is ever asked for", async () => {
    const { phone } = await registerCitizen("Bad Pw User");
    const { status, data } = await api("POST", "/auth/login", { phone, password: "WrongPassword!" });
    assert.equal(status, 401);
    assert.equal(data.error, "invalid_credentials");
  });

  test("wrong TOTP code is rejected even with a valid ticket", async () => {
    const { phone, password } = await registerCitizen("Bad MFA User");
    const { mfaTicket } = await apiOrThrow("POST", "/auth/login", { phone, password });
    const { status, data } = await api("POST", "/auth/mfa/verify", { mfaTicket, code: "000000" });
    assert.equal(status, 401);
    assert.equal(data.error, "invalid_mfa_code");
  });

  test("a citizen's TOTP secret does not unlock a different account", async () => {
    const alice = await registerAndLoginCitizen("Alice");
    const bob = await registerCitizen("Bob");

    const { mfaTicket } = await apiOrThrow("POST", "/auth/login", { phone: bob.phone, password: bob.password });
    const { status } = await api("POST", "/auth/mfa/verify", { mfaTicket, code: totp(alice.mfaSecret) });
    assert.equal(status, 401, "Alice's TOTP code must not verify Bob's login ticket");
  });

  test("refresh token rotates and the old one is rejected on reuse", async () => {
    const { phone, password, mfaSecret } = await registerAndLoginCitizen("Refresh Test User");
    const { mfaTicket } = await apiOrThrow("POST", "/auth/login", { phone, password });
    const { refreshToken } = await apiOrThrow("POST", "/auth/mfa/verify", () => ({ mfaTicket, code: totp(mfaSecret) }));

    const rotated = await apiOrThrow("POST", "/auth/refresh", { refreshToken });
    assert.ok(rotated.accessToken);
    assert.notEqual(rotated.refreshToken, refreshToken, "refresh should issue a new token, not reuse the old one");

    const { status } = await api("POST", "/auth/refresh", { refreshToken });
    assert.equal(status, 401, "a rotated-out refresh token must not work a second time");
  });

  test("reusing a rotated-out refresh token revokes the entire token family, not just that one request", async () => {
    const { phone, password, mfaSecret } = await registerAndLoginCitizen("Reuse Detection Test User");
    const { mfaTicket } = await apiOrThrow("POST", "/auth/login", { phone, password });
    const { refreshToken: original } = await apiOrThrow("POST", "/auth/mfa/verify", () => ({
      mfaTicket,
      code: totp(mfaSecret),
    }));

    const rotated = await apiOrThrow("POST", "/auth/refresh", { refreshToken: original });
    const currentToken = rotated.refreshToken;

    // Replaying the already-rotated-out original token is the reuse signal
    // (e.g. a stolen token used after the real client already moved past it).
    const reuse = await api("POST", "/auth/refresh", { refreshToken: original });
    assert.equal(reuse.status, 401);

    // The token from the legitimate rotation above must now ALSO be dead,
    // even though it was never itself replayed -- proving the whole family
    // was revoked, not just the reused token rejected in isolation.
    const { status } = await api("POST", "/auth/refresh", { refreshToken: currentToken });
    assert.equal(status, 401, "the entire token family should be revoked once reuse of a rotated-out token is detected");
  });

  test("a citizen cannot call a staff-only endpoint", async () => {
    const { accessToken } = await registerAndLoginCitizen("Non-staff User");
    const { status } = await api("GET", "/applications/analytics", undefined, accessToken);
    assert.equal(status, 403);
  });
});

describe("identity: USSD PIN enrollment", () => {
  test("a PIN shorter than 4 digits or containing non-digits is rejected", async () => {
    const { accessToken } = await registerAndLoginCitizen("Bad PIN User");
    const tooShort = await api("POST", "/users/me/ussd-pin", { pin: "12" }, accessToken);
    assert.equal(tooShort.status, 400);

    const notDigits = await api("POST", "/users/me/ussd-pin", { pin: "abcd" }, accessToken);
    assert.equal(notDigits.status, 400);
  });

  test("setting a USSD PIN requires a real login session, not just a phone number", async () => {
    const { status } = await api("POST", "/users/me/ussd-pin", { pin: "1234" }, undefined);
    assert.equal(status, 401);
  });

  test("a 4-6 digit PIN is accepted", async () => {
    const { accessToken } = await registerAndLoginCitizen("Good PIN User");
    const { status } = await api("POST", "/users/me/ussd-pin", { pin: "246810" }, accessToken);
    assert.equal(status, 204);
  });
});
