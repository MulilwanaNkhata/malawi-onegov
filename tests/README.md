# Integration test suite

These are **integration tests against the live stack**, not unit tests --
they exercise every request the same way a real client would, through the
public gateway at `http://localhost:4000`, with no mocking and no direct
database access. That's a deliberate choice for a platform whose main risk
is cross-service wiring (does workflow-service really transition on a
payment event? does the certificate URL really work from outside Docker?),
not algorithmic logic in any one function.

## Running

```bash
docker compose up -d      # stack must already be running
npm test                  # from the repo root
```

Uses Node's built-in test runner (`node --test`) -- no test framework
dependency to install. Requires Node 20+.

## What's covered

- `auth.test.mjs` -- registration, password+MFA login, the direct-login path
  used when `MFA_REQUIRED=false` (confirming the MFA subsystem underneath
  stays fully intact and independently testable either way), wrong-password/
  wrong-code rejection, refresh token rotation, refresh-token reuse
  detection (a replayed rotated-out token revokes the whole token family,
  not just itself), RBAC boundary checks, and USSD PIN enrollment
  validation (format rules, requires a real session)
- `documents.test.mjs` -- upload content validation: real PDF/PNG magic
  bytes accepted, spoofed Content-Type rejected regardless of the declared
  MIME type, path-traversal-shaped entityType/entityId rejected
- `docs-portal.test.mjs` -- the developer portal at `/docs` serves the real
  Swagger UI page, the live `docs/openapi.yaml` (not a stale copy -- spot
  checks routes that only exist because this spec was expanded this
  session), and its self-hosted static assets
- `birth-certificate.test.mjs` -- the full citizen+staff journey end to end,
  plus an ownership-isolation check and a role-boundary check on approval
- `trading-license.test.mjs` -- the same, for the second pilot service, plus
  confirming a REJECTED application never gets a certificate
- `complaints.test.mjs` -- the third pilot service, and a deliberately
  different-shaped process (no fee, no approve/reject branch): file ->
  assign -> resolve -> reopen -> resolve -> close with a full response
  thread and notification checks, ownership isolation, the
  REGISTRAR_SUPERVISOR-only CLOSE/REOPEN role boundary, and analytics
- `analytics-and-audit.test.mjs` -- analytics shape/aggregation correctness,
  audit hash-chain integrity, and that both are staff-only
- `ussd.test.mjs` -- the USSD menu tree against a real running application,
  using the same webhook contract a telco aggregator would, including the
  PIN-authenticated Trading Licence application flow: no-PIN-yet rejection,
  wrong PIN, a full application submitted end to end over USSD (and
  confirmed to show up correctly in the citizen's own portal view), invalid
  menu input, the CITIZEN-only role check, and 5-wrong-attempts lockout

## What this does *not* cover (known gaps)

No test hits Docker Desktop crashing, disk space, or infrastructure
flakiness -- those are environment problems, not application bugs. There's
also no load/performance testing, and no contract tests that would catch a
service silently changing its internal API shape without the caller
noticing (each service's TypeScript types provide some of that locally, but
nothing enforces it across the network boundary today).

## A note on test data

Tests create real citizens, real applications, and real payments in
whatever stack you point them at -- there's no seed/teardown step, matching
this being a demo scaffold rather than a CI-grade suite with an ephemeral
database per run. Assertions are written to tolerate that (checking a
specific reference number exists, not that a count equals an exact number).
