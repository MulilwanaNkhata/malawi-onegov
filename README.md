# Malawi OneGov — Pilot Scaffold

A working, runnable slice of the Malawi OneGov national digital government
platform: three full citizen journeys -- **apply for a Birth Certificate**,
**apply for a Trading Licence** (both: apply → upload documents → pay the
fee via mobile money → track status → get notified → download the digital
certificate), and **file a complaint** -- built on the shared platform
services every government service reuses (identity/MFA, API gateway,
workflow engine, payments, notifications, document wallet, tamper-evident
audit log, reporting).

The second and third services exist specifically to prove the platform's
core claim: onboarding a new government service is a new workflow template
plus one new domain service, not a change to the shared engine. Complaints
in particular is a deliberately *different-shaped* process from the other
two (no fee, no approve/reject branch, and a real reopen loop) -- proof the
engine generalizes to something other than a structurally-identical clone.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for exactly what was
reused unchanged vs. added new.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full component
map and how it maps back to the platform brief, and
[`docs/openapi.yaml`](docs/openapi.yaml) for the public API contract --
browse it interactively at http://localhost:4000/docs once the stack is
running (see "Developer portal" below).

> This repository is the **code scaffold** deliverable. It does not include
> the long-form strategy document (executive summary, governance model,
> procurement, staffing, cost categories, etc.) from the original brief --
> ask if you'd like that written up separately.

## What's implemented

| Service | Port | Responsibility |
| --- | --- | --- |
| `api-gateway` | 4000 | Single public entry point, JWT-aware routing, rate limiting |
| `identity-service` | 4001 | Registration, TOTP MFA, login, JWT/refresh, RBAC |
| `audit-service` | 4002 | Hash-chained, tamper-evident audit log |
| `workflow-service` | 4003 | Generic finite-state-machine engine |
| `document-service` | 4004 | MinIO-backed document wallet + PDF certificate generation |
| `payment-service` | 4005 | Mock mobile money adapter (Airtel Money / TNM Mpamba shaped) |
| `notification-service` | 4006 | Event-driven SMS (mock) / email (MailHog) notifications |
| `civil-registration-service` | 4007 | Birth Certificate domain logic, orchestrates the above |
| `trading-license-service` | 4008 | Trading Licence domain logic -- the second pilot service, reusing everything above |
| `ussd-gateway` | 4009 | Feature-phone access: check status, apply, and pay the fee for a Trading Licence or Birth Certificate, over USSD (PIN-authenticated) |
| `complaints-service` | 4010 | Complaints/support domain logic -- the third pilot service, and a genuinely different-shaped workflow (no fee, has a reopen loop) |
| `citizen-portal` | 5173 | Mobile-first React SPA + installable PWA, English/Chichewa |

Infrastructure: PostgreSQL (one database per service), Redis (event bus),
MinIO (object storage), MailHog (catches outgoing dev email at
http://localhost:8025).

## Prerequisites

- Docker Desktop (with Docker Compose)
- Node.js 20+ only if you want to run the seed script or type-check outside Docker

## Running it

```bash
cd malawi-onegov
docker compose up --build
```

First boot pulls several images and installs npm dependencies inside each
container, so it can take a few minutes. When it settles:

- Citizen portal: http://localhost:5173
- API gateway: http://localhost:4000/health/deep (aggregate health of every service)
- MinIO console: http://localhost:9001 (login: `onegov` / `onegov-secret`)
- MailHog (view "sent" emails): http://localhost:8025

### Seed the two staff accounts

The public registration endpoint only ever creates `CITIZEN` accounts (staff
onboarding is meant to be an administrative act). Seed demo
`REGISTRAR_OFFICER`, `REGISTRAR_SUPERVISOR`, and `SYSTEM_ADMIN` accounts once
Postgres is up:

```bash
cd scripts
npm install
npm run seed:staff
```

This prints the shared demo password for all three seeded accounts --
that's all you need to log in with `MFA_REQUIRED=false` (the local default,
see below). It also prints a TOTP secret, still enrolled and still usable if
you turn MFA back on; get a fresh 6-digit code any time with:

```bash
node generate-totp.mjs JBSWY3DPEHPK3PXP
```

**MFA is optional locally, on purpose.** `identity-service`'s
`MFA_REQUIRED` env var defaults to `false` in `docker-compose.yml` --
password alone logs you in. This isn't MFA removed, just not required at
login: registration still enrolls a real TOTP secret and shows the QR code,
and `/auth/mfa/verify` is fully intact and tested either way (relaying a
30-second-lived code through a chat session during development was the
actual friction, not MFA itself). Set `MFA_REQUIRED=true` in a root `.env`
file (see `.env.example`) to require the second factor again -- no code
changes needed.

## Demo walkthrough

1. Open http://localhost:5173, click **Register**, fill in the form.
2. Note the MFA secret shown (or scan the QR code into an authenticator
   app) -- optional to actually use it right now, see above.
3. Log in with your phone/password. With `MFA_REQUIRED=false` (the local
   default) that's the whole flow; if you've turned it on, enter the TOTP
   code too (`node scripts/generate-totp.mjs <secret>` if you didn't scan
   it) -- **generate it right before you enter it**, it expires in ~30-90
   seconds.
4. From the dashboard, apply for **any or all**: a Birth Certificate, a
   Trading Licence -- both forms work the same way, note the reference
   number -- or **file a complaint** (no fee, no form of its own to fill in
   twice; see step 11).
5. On the application detail page, upload a supporting document and pay the
   fee (pick Airtel Money or TNM Mpamba, enter any phone number). The mock
   payment auto-confirms after ~3 seconds; refresh to see status move to
   `UNDER_REVIEW`.
6. Check **Notifications** -- you'll see the submission and payment
   confirmation messages, and http://localhost:8025 will have the matching
   emails if you registered with one.
7. Log out, log back in as a seeded staff account (phone
   `+265991000002`, the Registrar Supervisor). Staff land on a different
   home page from citizens -- a dashboard showing what's actually awaiting
   action right now (counts per service, not just a list of buttons) plus a
   combined recent-activity feed across all three services. Open the
   relevant **review queue** from there, open the application, and
   **Approve** it.
8. The platform generates the certificate/licence PDF automatically, issues
   it, and notifies the citizen. Log back in as the citizen and click
   **Download certificate** on the application page.
9. Open **Analytics** (staff nav, or "View full analytics" from the staff
   dashboard) for the full historical breakdown -- volume, processing time,
   and revenue aggregated across all three services. The staff dashboard
   itself only surfaces the operational subset (what's pending right now),
   deliberately kept separate from this full reporting view.
10. Check `GET /api/audit` (as the seeded `SYSTEM_ADMIN`, `+265991000000`) or
    `http://localhost:4002/events/verify` to see the tamper-evident audit
    trail for everything that just happened.
11. File a complaint from the dashboard, then as staff **assign** it,
    **resolve** it with a message, and -- back as the citizen -- **reopen**
    it if unsatisfied, or close it. This loop (RESOLVED/CLOSED back to
    IN_PROGRESS) doesn't exist on the other two services; it's the clearest
    place to see the workflow engine handling a genuinely different shape
    of process, not just another apply-and-issue clone.

## Try the USSD channel (feature-phone access, no app/portal needed)

Every other service assumes a smartphone. This is the part of the pilot
built specifically for citizens who don't have one: over a plain USSD
session (no app, no internet), a citizen can check a Birth Certificate or
Trading Licence's status by reference number, apply for either **from
scratch**, and **pay the application fee** -- the whole apply-and-pay
journey, not just status lookup, works without ever touching a smartphone.

```bash
node scripts/ussd-simulator.mjs
```

This drives the platform through `POST /ussd` on the gateway using the same
webhook contract a real telco aggregator (e.g. Africa's Talking) speaks --
every key press re-sends the full accumulated input, and the app responds
`CON <text>` (show another screen) or `END <text>` (hang up).

- **Options 1 and 2** check status by reference number -- try `BC-2026-...`
  or `TL-2026-...` from an application you created above.
- **Options 3 and 4** apply for a Trading Licence or a Birth Certificate end
  to end over USSD. Both need a **USSD PIN** first: log in to the portal,
  open **Profile**, and set a 4-6 digit PIN. That PIN -- not the smartphone
  TOTP code -- is what authenticates the USSD session; it can only ever be
  set from an authenticated portal session, never over USSD itself, so
  knowing someone's phone number alone can't be used to enroll a PIN on
  their account. Five wrong PIN attempts locks it for 15 minutes. The Birth
  Certificate flow enters the date of birth as 8 digits, `DDMMYYYY` (no
  separators a keypad can't type), converted server-side to the same ISO
  date the portal's date picker already stores; the mother's/father's
  National ID and the father's details themselves are all optional, entered
  as `0` to skip.
- **Option 5** pays the fee on an existing application, also PIN-authenticated.
  Enter the reference number and it figures out which service it belongs to
  from the prefix (`BC-` or `TL-`) automatically -- no need to pick a service
  first. The amount is read from the application itself (no typing it in,
  no partial payments), and it's rejected up front if the reference number
  isn't yours or the fee's already been paid, before it ever reaches the
  provider menu.

## Install it as a mobile app

`citizen-portal` is a real Progressive Web App, not just a responsive site
-- most citizens will carry a smartphone rather than a feature phone, and
this is what makes the same app installable to a home screen like a native
one, launchable without a browser address bar, and able to open at all
without a live connection.

- **Android / Chrome / Edge**: open http://localhost:5173, and the app
  itself shows an **Install app** banner (triggered by the browser's own
  `beforeinstallprompt` event) -- tap it, no app store involved. If you
  dismiss it, the browser's own menu (⋮ → "Install app" / "Add to Home
  Screen") still works.
- **iOS Safari**: iOS never fires that install event -- there's no
  programmatic install, only **Share → Add to Home Screen**. The app
  detects it's running on iOS and shows that instruction directly instead
  of a button that wouldn't do anything there.
- **Offline**: the app shell (everything except live data) is precached by
  a service worker (`vite-plugin-pwa` + Workbox) at build time, so the app
  still *opens* with no network at all. It does not, and should not, cache
  API responses -- a stale cached "fee unpaid" for an application that was
  actually just approved would be actively misleading for a government
  service, so anything that needs live data (applications, payments,
  notifications) still needs a connection, same as before. An offline
  banner appears automatically (`navigator.onLine`) so that's obvious
  rather than surfacing as a confusing failed request.
- The container now serves a real production build (`vite build` +
  `vite preview`) instead of the dev server, specifically so the service
  worker precaches the actual built app shell rather than only proving
  registration works -- see `apps/citizen-portal/Dockerfile`.
- Service workers require HTTPS in real deployments (`localhost` is
  exempted for exactly this kind of local testing) -- see "What production
  would change" in `docs/ARCHITECTURE.md`.

## Developer portal

http://localhost:4000/docs -- an interactive Swagger UI over the platform's
real public contract, served directly off the gateway (the actual public
entry point, rather than a separate docs site that can drift from it).
Browse every endpoint, expand request/response shapes, and try requests
against the live stack.

[`docs/openapi.yaml`](docs/openapi.yaml) is the single source of truth --
it's bind-mounted straight into the `api-gateway` container
(`docker-compose.yml`), so the gateway and the file on disk can never
disagree, and Swagger UI's assets ship self-contained via `swagger-ui-dist`
(no CDN, works fully offline). The spec explicitly calls out what's
*missing* from the public contract too: `workflow-service` is reachable at
`/api/workflow` but every route on it requires the internal service secret,
not a citizen/staff JWT, so it isn't really a public endpoint despite being
proxied; and the USSD webhook (`/ussd`) is a different protocol entirely
(plain-text, not JSON) and is documented above instead.

## Running the tests

```bash
docker compose up -d   # stack must be running
npm test
```

64 integration tests against the live stack (no mocking, no direct DB
access) covering auth/MFA (both the optional-at-login and full TOTP paths --
see "Seed the two staff accounts" above), all three pilot services end to
end (including the complaints reopen loop), analytics, the audit hash-chain,
the USSD gateway (including PIN enrollment, PIN lockout, full Trading
Licence and Birth Certificate applications submitted entirely over USSD,
and fee payments over USSD that drive an application all the way to
`UNDER_REVIEW`), document upload validation, and the developer portal. See
`tests/README.md` for what's covered and, just as importantly, what isn't.

**This suite already earned its keep once**: running it under real
concurrent load caught a genuine race condition in `audit-service` -- the
hash-chain write used `SELECT last row; compute next hash; INSERT`, which
Postgres's default READ COMMITTED isolation does not serialize, so two
concurrent audit writes (entirely normal traffic, not an edge case) could
both read the same "last row" and fork the chain. Fixed with a
`pg_advisory_xact_lock` around the critical section; re-verified by firing
25 concurrent registrations at it and confirming the chain still checks out.
Exactly the kind of bug an integration suite catches and a unit test can't.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR: `docker compose up -d
--build` the whole stack, wait on the gateway's `/health/deep` aggregate
check (a real readiness gate, not a fixed sleep), seed the staff accounts,
then `npm test`. It's not just plausible-looking YAML -- every step was
dry-run locally against a genuinely cold-started stack (all containers
recreated from scratch, not reused) before being committed, and it passed
35/35.

Live at [github.com/MulilwanaNkhata/malawi-onegov](https://github.com/MulilwanaNkhata/malawi-onegov)
-- CI runs there on every push, not just locally.

## Security

A manual review (auth, injection, secrets handling, access control -- same
categories `/security-review` covers) found and fixed two real issues:

- **An unauthenticated payment-completion webhook.** `POST
  /payments/webhook/mock-provider` had no auth at all and was reachable
  through the public gateway. Anyone who learned their own payment's
  `referenceNumber` -- which a citizen legitimately gets back from
  initiating the payment -- could call it directly and mark their
  government fee "paid" without paying it. Fixed by requiring the same
  internal service secret every other trusted-caller endpoint already
  requires, which also more accurately mirrors how a real mobile money
  provider's webhook would be secured (signature/shared-secret, never open).
- **Timing-unsafe secret comparisons, system-wide.** Every internal
  service-to-service check (`x-service-secret`, `x-audit-secret`) compared
  the header against the expected secret with plain `!==` across 9 call
  sites in 7 services, instead of a constant-time comparison. This secret
  is the only thing standing between an external caller and forging
  arbitrary internal actions -- notably, `workflow-service`'s transition
  endpoint trusts whatever `actorRole` the caller claims with no further
  check, so holding this secret is enough to force-approve any application
  directly. All 9 sites now use `crypto.timingSafeEqual`.

Both fixes were verified against the running stack (a direct curl proving
the webhook now rejects unauthenticated calls with 401) and the full test
suite re-run clean (35/35) afterward.

Two lower-severity findings from the same review are now fixed too:

- **Refresh-token reuse now revokes the whole token family, not just the
  replayed token.** Each login's refresh tokens share a `familyId`;
  presenting an already-rotated-out token (the signal a real client
  wouldn't produce, but a stolen-then-replayed token would) revokes every
  token descended from that login, not just rejects that one request. A
  test proves it: rotate once, replay the original, then confirm the
  *legitimate* newer token -- never itself replayed -- is also dead.
- **Uploaded file content is now checked against its declared type**, not
  just trusted from the client-supplied Content-Type header. A file
  claiming to be a PDF/JPEG/PNG is checked against the real magic bytes for
  that format before it's stored; entityType/entityId are also now
  restricted to a safe charset (defense in depth against a self-hosted,
  file-backed object store mapping a crafted key onto a real filesystem
  path).

Both verified with new tests (6 more, 41/41 total) and a clean full suite run.

## Backup and disaster recovery

A backup nobody has ever restored isn't a backup, it's a hope. Two scripts,
same discipline as the test suite above -- don't just claim it works, prove it:

```bash
cd scripts
npm run backup          # pg_dump every domain database + archive the MinIO volume
npm run restore-drill   # prove the latest backup actually restores
```

`backup.mjs` takes a `pg_dump` of all 9 per-service databases (custom
format, read from `infra/postgres-init/init-multiple-dbs.sh` so it can never
drift out of sync with what's actually deployed) plus a tar of the MinIO
object store's volume, into
`backups/<timestamp>/` (gitignored -- these are real dumps of whatever data
is in your stack, not something to commit).

`restore-drill.mjs` is the part that actually matters: it spins up a
disposable Postgres on a scratch Docker network, restores every dump into
it, and confirms every table's row count matches the live database it came
from -- then, specifically for `audit_db`, boots the real `audit-service`
image against the restored data and re-runs its `/events/verify` hash-chain
check, confirming the tamper-evident audit trail itself survives a
disaster-recovery cycle intact, not just the raw bytes. Everything it
creates is torn down at the end (success or failure); **it never stops,
restarts, or writes to any live container, volume, or database** -- safe to
run at any time against a running system.

## Repository layout

```
malawi-onegov/
  docker-compose.yml
  infra/postgres-init/        # creates one database per service
  libs/shared/                # reference copy of cross-service contracts (roles, events)
  services/
    api-gateway/
    identity-service/
    audit-service/
    workflow-service/
    document-service/
    payment-service/
    notification-service/
    civil-registration-service/
    trading-license-service/
    ussd-gateway/
    complaints-service/
  apps/
    citizen-portal/
  scripts/                    # seed-staff.mjs, generate-totp.mjs, ussd-simulator.mjs,
                               # backup.mjs, restore-drill.mjs
  tests/                      # integration test suite (npm test)
  docs/
    ARCHITECTURE.md
    openapi.yaml
```

Each service under `services/` is independently deployable: its own
`package.json`, own Prisma schema, own Dockerfile, own database. None of them
import a shared npm package at runtime -- small pieces of shared knowledge
(role names, event names) are intentionally duplicated in each service's
`src/shared.ts` rather than centralized, so a service can be extracted,
redeployed, or rewritten on its own without dragging the rest of the
monorepo's build tooling with it.

## Notes and known limitations (by design, for a pilot scaffold)

- **Chichewa strings** in `apps/citizen-portal/src/i18n/translations.ts` are
  a first pass, not professionally reviewed -- treat them as placeholders to
  replace before any real localization sign-off.
- **MFA** is real TOTP (not a stub), but there's no SMS-based fallback for
  citizens without a smartphone -- production would need a USSD/SMS-based
  second factor for feature-phone users, per the brief's low-bandwidth
  requirements. It's also **not required at login by default locally**
  (`MFA_REQUIRED=false` in `docker-compose.yml`) -- a real deployment should
  set it back to `true`; see "Seed the two staff accounts" above.
- **USSD** (`ussd-gateway`) now covers the whole apply-and-pay journey for
  both Birth Certificate and Trading Licence, plus status lookup,
  authenticated by a PIN set from the portal (see "Try the USSD channel"
  above) -- distinct from the smartphone TOTP flow, since feature phones
  can't run an authenticator app. Not yet built: a self-service PIN reset
  without the portal (currently: set a new one from the portal, which
  overwrites the old one).
- **Payments and SMS are mocked** (see `docs/ARCHITECTURE.md` → "What
  production would change") so the pilot runs without live telco/mobile
  money credentials.
- **The PWA install/offline story covers the app shell, not push
  notifications** -- the service worker precaches static assets so the app
  opens with no network and is installable on Android/iOS home screens (see
  "Install it as a mobile app" above), but there's no Web Push subscription
  or server-side push trigger yet; notifications today are still SMS/email
  only, delivered when the citizen next opens the app.
- **Tests are integration-level only** (see `tests/`) -- they exercise the
  live stack through the gateway like a real client would, which is exactly
  what caught a real concurrency bug (below) that a unit test never would
  have. There's no load/performance testing and no per-service contract
  tests yet.
- **Backups are manual** (`npm run backup` in `scripts/`, see "Backup and
  disaster recovery" above) -- proven to actually restore via
  `restore-drill.mjs`, but there's no scheduled/automatic backup job, and no
  off-machine backup destination (dumps land in `backups/` on the same disk
  as the database they're backing up, which protects against data
  corruption or a bad migration but not a full disk failure).
