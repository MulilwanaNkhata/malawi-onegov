// Shared helpers for the integration test suite. These tests exercise the
// *live* stack through the public gateway (http://localhost:4000) exactly
// as a real client would -- there is no mocking, no direct DB access, no
// bypassing auth. Run `docker compose up -d` first (see tests/README.md).
import { createHmac } from "node:crypto";

export const BASE = process.env.ONEGOV_BASE_URL ?? "http://localhost:4000/api";
export const SEEDED_SUPERVISOR_PHONE = "+265991000002";
export const SEEDED_ADMIN_PHONE = "+265991000000";
export const SEEDED_STAFF_MFA_SECRET = "JBSWY3DPEHPK3PXP";

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP, independently implemented from (and cross-validated against) otplib -- see identity-service's own MFA verification. */
export function totp(secretBase32) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 1_000_000).padStart(6, "0");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every call goes through here, and every call retries on 429. `/auth/*` is
 * deliberately rate-limited (brute-force protection -- see identity-service
 * and api-gateway), and this suite legitimately makes more than 20 auth
 * calls across a full run; a 429 is never the real answer to any request in
 * this system, so waiting it out and returning the genuine result is
 * correct for a success-path call *and* for a test deliberately asserting a
 * specific rejection (e.g. "wrong password -> 401") -- both want the real
 * answer, not a transient rate-limit hiccup standing in for it.
 *
 * `body` may be a plain object, or a zero-arg function returning one --
 * use the function form for anything time-sensitive (a TOTP code): a body
 * captured *before* a 65s backoff sleep would be stale by the time it's
 * actually sent (the exact bug this project's own login flow taught us to
 * watch for earlier the same day this suite was written).
 */
export async function api(method, path, body, token, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resolvedBody = typeof body === "function" ? body() : body;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: resolvedBody !== undefined ? JSON.stringify(resolvedBody) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* no body */
    }
    if (res.status !== 429 || attempt === maxAttempts) return { status: res.status, ok: res.ok, data };
    await sleep(65_000);
  }
}

export async function apiOrThrow(method, path, body, token) {
  const { ok, status, data } = await api(method, path, body, token);
  if (!ok) throw new Error(`${method} ${path} -> ${status}: ${JSON.stringify(data)}`);
  return data;
}

export function randomPhone() {
  return `+2659${Math.floor(9_000_000 + Math.random() * 999_999)}`;
}

/** Registers a fresh citizen (no login) and returns the raw /auth/register response plus the credentials used. */
export async function registerCitizen(fullName = "Test Citizen") {
  const phone = randomPhone();
  const password = "TestPass1!";
  const reg = await apiOrThrow("POST", "/auth/register", { fullName, phone, password });
  return { phone, password, ...reg };
}

/** Registers a fresh citizen and returns { phone, password, accessToken, userId }. */
export async function registerAndLoginCitizen(fullName = "Test Citizen") {
  const { phone, password, userId, mfaEnrollment } = await registerCitizen(fullName);
  const accessToken = await loginWithMfa(phone, password, mfaEnrollment.secret);
  return { phone, password, mfaSecret: mfaEnrollment.secret, userId, accessToken };
}

/** Full two-step login (password, then TOTP) for any account. */
export async function loginWithMfa(phone, password, mfaSecret) {
  const { mfaTicket } = await apiOrThrow("POST", "/auth/login", { phone, password });
  const { accessToken } = await apiOrThrow("POST", "/auth/mfa/verify", () => ({ mfaTicket, code: totp(mfaSecret) }));
  return accessToken;
}

// Memoized: reusing one staff session across the whole suite (rather than
// re-logging-in for every test) is both how a real client would behave and
// meaningfully cuts the suite's total auth-call volume. 15 min access-token
// TTL comfortably outlasts a full test run.
let cachedSupervisorToken;
export async function loginAsSupervisor() {
  cachedSupervisorToken ??= await loginWithMfa(SEEDED_SUPERVISOR_PHONE, "Passw0rd!", SEEDED_STAFF_MFA_SECRET);
  return cachedSupervisorToken;
}

let cachedAdminToken;
export async function loginAsAdmin() {
  cachedAdminToken ??= await loginWithMfa(SEEDED_ADMIN_PHONE, "Passw0rd!", SEEDED_STAFF_MFA_SECRET);
  return cachedAdminToken;
}

/** Polls `fn` until it returns a truthy value or the timeout elapses. Returns the last result either way. */
export async function waitUntil(fn, { timeoutMs = 15_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let result = await fn();
  while (!result && Date.now() < deadline) {
    await sleep(intervalMs);
    result = await fn();
  }
  return result;
}
