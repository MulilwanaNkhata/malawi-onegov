import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BASE } from "./helpers.mjs";

const GATEWAY_ROOT = BASE.replace(/\/api$/, "");

describe("developer portal (/docs)", () => {
  test("GET /docs serves the interactive Swagger UI page", async () => {
    const res = await fetch(`${GATEWAY_ROOT}/docs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const body = await res.text();
    assert.match(body, /swagger-ui/i);
  });

  test("GET /docs/openapi.yaml serves the real spec, not a stale copy", async () => {
    const res = await fetch(`${GATEWAY_ROOT}/docs/openapi.yaml`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /^openapi: 3\.0\.3/);
    // spot-check a couple of routes that only exist because this session
    // expanded the spec past the original Birth-Certificate-only draft
    assert.match(body, /\/trading-licenses:/);
    assert.match(body, /\/users\/me\/ussd-pin:/);
  });

  test("GET /docs/swagger-ui-bundle.js serves the self-hosted Swagger UI asset", async () => {
    const res = await fetch(`${GATEWAY_ROOT}/docs/swagger-ui-bundle.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
  });
});
