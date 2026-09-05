# QBusto — Pre-Production Checklist

Practical, repository-specific checklist to work through before putting QBusto
into production. Every command and variable named here is verified against the
actual code as of this writing (backend `src/config/env.js`, the root
`Makefile`, and each app's `package.json`/`.env.example`) — nothing here is
invented. Where the repository genuinely has no answer (no Docker/PM2/Nginx/CI
config exists in this repository), that is stated explicitly rather than
guessed.

See also: [`CLAUDE.md`](../CLAUDE.md) and [`memory.md`](../memory.md) for the
full architecture reference this checklist assumes.

---

## 0. Scope of this launch

### Code readiness vs deployment readiness

These are two different questions and this document keeps them apart.

**Code readiness — met.** The application code is production-ready on the
verification actually run against this working tree: the backend suite passes
in full, backend lint reports zero errors, `verify-schema` matches the live
database, `healthcheck` exits 0, all three frontends type-check, lint and
build, and the OpenAPI spec and all three generated clients are in sync with
the routes. Nothing below is a claim about code quality.

**Deployment readiness — outstanding.** What remains is production
*configuration* and *post-deployment verification*: real Cashfree credentials,
a publicly reachable HTTPS backend, webhook registration, and the smoke tests
in §7 and §9. Those cannot be completed before the deployment exists, and
their absence is not a code defect.

A missing piece of **optional** infrastructure does not make the application
blocked. See "Deferred" below.

### The production cinema

**Cinema 8 (`1Cinemas Noida`) is the primary production cinema for this
launch.** Where this checklist says "the production cinema", that is the one
it means.

Every other cinema in the database is test/development data. Their
configuration gaps — including cinemas with no `payment_gateway_config` row —
are **not production blockers**, because they cannot affect production
traffic: credentials are per cinema with no global fallback, so an
unconfigured test cinema affects only itself. `make healthcheck` lists them
(see §9); treat that list as an inventory, not a failure.

### Deferred — explicitly NOT launch blockers

| Item | Decision | Where documented |
| --- | --- | --- |
| **Redis caching** | Implemented in code, **not enabled** for this deployment. `REDIS_URL` stays unset; every catalogue request goes to SQL Server, which remains the source of truth. | §12 |
| **POS integration** (Vista/Showbiz) | **On hold.** One ShowBiz adapter exists (transport verified only); nothing is required for this release. Showtimes come from the client's own `session` table. | §12 |
| **QBusto refund API** | **Not being built.** Refunds are performed in the Cashfree Dashboard by the operator. | §12, §11 |

None of the three blocks go-live. Do not promote them to requirements.

---

## 1. Database

- [ ] **Take a final `.bak` backup** of the production-bound `qbusto` database
      before running any migration against it. SQL Server: `BACKUP DATABASE
      qbusto TO DISK = '<path>\qbusto_pre_prod_<date>.bak'`.
- [ ] **Take a `.sql` export** as a second, human-diffable backup format
      (`sqlcmd`/SSMS "Generate Scripts", or your existing export tooling — the
      repo's own `db_export/qbusto.sql` shows the expected shape of this kind
      of export, though that specific file is a client snapshot, not something
      to overwrite).
- [ ] **Verify migrations are fully applied and none are pending:**
      ```bash
      cd backend && npx sequelize-cli db:migrate:status
      ```
      Every migration should show `up`. There are 40 migrations in
      `backend/migrations/` as of this writing, timestamp-ordered; apply with
      `make migrate` (or
      `npx sequelize-cli db:migrate` from `backend/` — **not** `npm run
      db:migrate`, which does not exist as a script).
- [ ] **Run `make verify-schema`** (`cd backend && npm run verify-schema`) —
      confirms Sequelize models, associations and initialization match the
      actual schema.
- [ ] **Run `make healthcheck`** (`cd backend && npm run healthcheck`) —
      checks required env vars, DB connectivity, pending migrations, required
      seed data (`order_statuses`, `payment_statuses`), and SQL Server version.
      Should exit 0. Equivalent to what `GET /ready` reports on a running
      server.
- [ ] **Verify no test/probe data remains.** This repository's dev tooling
      creates data in identifiable, out-of-range id bands specifically so it
      can be found and removed:
      - `backend/scripts/seed-dev-sessions.js` writes to `session` with
        `Session_lngSessionId >= 900000`. Clean with:
        `node scripts/seed-dev-sessions.js --clean`.
      - Any orders/screens/etc. created by manual testing, adversarial payment
        testing, or other dev scripts (`seed-dev-data.js`, `seed-dev-dataset.js`,
        `seed-dev-orders.js`, `seed-dev-banners.js`, `create-dev-user.js`) —
        confirm none of this data is present in the production-bound database.
        Query `orders`, `session`, `users` for anything you don't recognize as
        genuine client data before go-live.
- [ ] **Verify client data is intact** — `session` is the client's own table
      (not QBusto-owned) and the single source of showtimes; there is no longer
      a `film` or `shows` table. Confirm row counts and a spot-check of a few
      known screenings match what the client's system expects, and that
      `Film_strName` (the title) is populated.
      `screens` and `screen_layout` similarly hold client-provided
      category/seat_row data. **The screen/seat-row model is settled and
      intentional** — see §13 before changing anything here; a `screens` row is
      a screen record qualified by its `seat_row`, so one auditorium may
      legitimately have several rows.
- [ ] **Verify database permissions.** The application's `DB_USER` should have
      exactly the privileges the backend needs (read/write on application
      tables, `EXECUTE` where Sequelize needs it) — not `sa` or an
      over-privileged account, in production.
- [ ] **Verify the backup/restore procedure actually works** — restore the
      `.bak` taken above into a scratch database on the same instance and
      confirm the application can be pointed at it and boots (`make
      healthcheck` against the restored copy). A backup that has never been
      test-restored is not a verified backup.

---

## 2. Backend environment

All variables are validated by `backend/src/config/env.js`, which **throws at
boot** on missing/malformed required values. Copy `backend/.env.example` to
`backend/.env` and set every value below for production; the list below is the
complete real set of variables the code reads (nothing here is invented, and
nothing outside this file plus `DB_*`/`API_BASE_URL` is required).

**Application**
- [ ] `NODE_ENV=production`
- [ ] `PORT` — the port the backend listens on
- [ ] `API_BASE_URL` — the real public HTTPS origin of the backend; used in
      the generated OpenAPI document

**Database (all required, no defaults)**
- [ ] `DB_HOST`, `DB_PORT` (default 1433), `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- [ ] `DB_ENCRYPT=true`
- [ ] `DB_TRUST_SERVER_CERTIFICATE=false` in production, once the SQL Server
      instance presents a trusted (not self-signed) certificate

**Authentication**
- [ ] `JWT_SECRET` — **enforced ≥32 characters in production**, must be a long
      random value, never reused from development
- [ ] `JWT_EXPIRES_IN` (default `1d`), `JWT_ISSUER` (default `qbusto`)

**CORS**
- [ ] `CORS_ALLOWED_ORIGINS` — explicit comma-separated list of the real
      production frontend origins. **A wildcard (`*`) is a development
      convenience only** and logs a warning at startup — must not be used in
      production.
- [ ] `CORS_ALLOW_CREDENTIALS` as required by the deployment

**Logging / rate limiting**
- [ ] `LOG_LEVEL` (production default: `info`), `LOG_DIR`
- [ ] `RATE_LIMIT_WINDOW_MS` (default 900000), `RATE_LIMIT_MAX` (default 300)

**API documentation**
- [ ] `SWAGGER_ENABLED` — consider `false` on a publicly reachable deployment

**Catalogue cache — optional, and deliberately OFF for this launch**
- [ ] `REDIS_URL` — **leave unset.** Redis is not being enabled for the initial
      production deployment (§12). With no URL the cache is inert and every
      consumer request is served from SQL Server, which is the intended and
      supported configuration.
- [ ] `CACHE_TTL_SECONDS` (default 60) and `REDIS_TIMEOUT_MS` (default 1000) —
      only read when `REDIS_URL` is set; nothing to configure while it is not.

**Cashfree — see §3 for the full production procedure**
- [ ] `CREDENTIALS_ENCRYPTION_KEY` — **the only payment secret in the
      environment.** There are no `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY`/
      `CASHFREE_ENVIRONMENT` vars any more: credentials and environment live
      per cinema in `payment_gateway_config`, and this key is what
      encrypts/decrypts them. Without it no cinema can take a payment.
- [ ] **Nothing about Cashfree is checked at boot.** The old guards were
      removed with the vars they inspected, so every per-cinema check in §3
      is now manual and there is no safety net behind it.
- [ ] `CASHFREE_NOTIFY_URL` — optional at the Joi level, but see §3: required
      in practice unless a webhook is registered directly in the Cashfree
      Dashboard
- [ ] `CASHFREE_RETURN_URL` — optional; the Consumer recovers on its own
      regardless
- [ ] `CASHFREE_FALLBACK_CUSTOMER_PHONE` (default `9999999999`) — only matters
      for orders with no usable customer mobile
- [ ] `CASHFREE_TIMEOUT_MS` (default 4000, max 30000)
- [ ] `CREDENTIALS_ENCRYPTION_KEY` — **required**, 64 hex characters (32
      bytes), boot throws without a validly-shaped value. Encrypts every
      `payment_gateway_config.gateway_secret_encrypted` row
      (`backend/src/utils/credentials.js`, AES-256-GCM). Generate once with
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      and **never rotate it casually** — every cinema's stored Cashfree
      secret was encrypted with this exact key, and changing it makes every
      one of them undecryptable (they would all need to be re-entered from
      the Dashboard). Back this value up as carefully as a database
      credential, and keep it **out of the database** (server config / secret
      manager only) — that separation is the entire point of encrypting the
      column at all.

**Image uploads**
- [ ] `FILE_STORAGE_PATH` — **must be an absolute path outside the source
      tree** in production (see §5)
- [ ] `MAX_UPLOAD_SIZE_MB` (default 5, hard max 50)

---

## 3. Cashfree

### TEST MODE (what you have today)

- Dashboard is at `merchant.cashfree.com/merchants/pg/developers/webhooks?env=test`
  — a separate configuration space from production; nothing here carries over.
- Each cinema's `payment_gateway_config.environment` is `test` (or `sandbox`).
  That column is now the **only** place the environment is set — the Consumer
  reads it from the `payment-init` response rather than from a build-time
  variable, so there is nothing to keep in step by hand.
- The Webhooks tab, with no endpoint added, shows a placeholder row labeled
  `NOTIFY_URL` — this is **not** a configured webhook, it's Cashfree
  describing the per-order `notify_url` fallback mechanism. Confirm whether
  you've actually clicked **Add Webhook Endpoint** here or not before
  assuming test-mode webhooks work.
- A tunnel (ngrok, Cloudflare Tunnel) is required to receive webhooks locally
  — `localhost` is not reachable from Cashfree's servers regardless of TLS.
  Self-signed certificates do not help; use a tunnel that issues a real
  public HTTPS URL.

### Per-cinema credentials — decide this BEFORE go-live

Every cinema running under this deployment can run its own Cashfree merchant
account (`payment_gateway_config`, set from `Cinemas → (cinema) → Payment
gateway` in the Dashboard). This is the **only** source of credentials —
there is no global fallback behind it, so a cinema with no active row simply
cannot take payments and answers 503 at payment-init.

**For this launch that means exactly one cinema: cinema 8.** The other
cinemas listed by `make healthcheck` as having no active
`payment_gateway_config` are test/development cinemas; because there is no
global fallback, an unconfigured cinema affects only itself and cannot touch
production traffic. Do not treat them as blockers (§0).

`POST /api/cinemas` (2026-08-25) now requires `gatewayId`/`secretKey`/
`environment` and creates the cinema plus its `payment_gateway_config` row in
one transaction — so **any cinema created through the Dashboard from this
date onward already has its own credentials by construction**, nothing to
double-check there. This section still matters for **every cinema created
before that change**, and for anything inserted directly into the database
outside the API (a data migration, a manual fixture) — neither is covered by
that guarantee. For each production cinema:

- [ ] It has its own `payment_gateway_config` row with real production
      credentials. There is no fallback to inherit, so a missing row is not a
      degraded state — that cinema takes no payments at all.
- [ ] Confirm `environment` is actually `prod`/`production`, not left on
      `test`. **Nothing checks this anywhere**: a cinema left on test collects
      no real money while checkout, webhooks and order status all look
      completely healthy. This is the single most expensive thing on this
      checklist to get wrong.
- [ ] Do the browser-close / no-return / webhook tests below (§7) against at
      least one production cinema — the credential resolution path and the
      webhook's per-cinema signature verification are worth confirming live,
      not just in test.

### PRODUCTION MODE — BEFORE deployment

Configuration decisions that can be made and applied before the backend is
publicly reachable. Everything requiring a live public URL is in the next
subsection.

- [ ] **Production Cashfree credentials for cinema 8** — App ID / Secret Key
      from the Cashfree Dashboard under **Switch to Prod → Developers → API
      Keys**, entered under `Cinemas → 1Cinemas Noida → Payment gateway` with
      `environment` set to `prod`. These are different credentials from the
      test/sandbox pair.
- [ ] **Cinema 8's `payment_gateway_config.environment` is switched from
      `test` to the production value.** Both `prod` and `production` are
      accepted (Cashfree's own docs and dashboard disagree on the word). This
      is a data change on the row, not an environment variable — and nothing
      in the system checks it, so it must be confirmed by looking.
- [ ] **Nothing to set on the Consumer.** `VITE_CASHFREE_MODE` no longer
      exists. `payment-init` returns the environment its session was issued in
      (`mode`: `sandbox`/`production`), resolved from that cinema's own
      `payment_gateway_config.environment`, and the Consumer loads the Cashfree
      SDK with that value. Setting the cinema's `environment` above is
      therefore the whole change — no Consumer rebuild, no coordinated deploy,
      and a deployment whose cinemas sit on different environments is served
      correctly by one build.

      This replaced a build-time constant that had to be kept in step with
      every cinema row by hand; when the two disagreed the SDK rejected the
      payment session id and the checkout silently never opened. Removing the
      second source removed the mismatch.
- [ ] **`CASHFREE_RETURN_URL`** — set to
      `https://<your-production-consumer-domain>/payment`. Genuinely optional
      (the Consumer reads its order id from `sessionStorage`, not the URL,
      and recovers regardless), but this is the fallback for browsers the
      Cashfree SDK can't keep in a modal (in-app browsers).
- [ ] **Webhook signature verification** — nothing to configure; it uses
      the owning cinema's own stored secret key automatically (there is no
      separate webhook secret with Cashfree, unlike the previous Razorpay
      integration). Note the consequence: a delivery whose `order_id` matches
      no QBusto order resolves no secret and is refused as unverifiable (400)
      rather than recorded as `unknown_gateway_order`.
- [ ] **Required Cashfree Dashboard configuration beyond webhooks** — confirm
      whether pre-authorization is enabled on the account. It is not
      currently inspected anywhere in the code (`payment.authorization` is
      never read); if pre-auth is on, an authorized-but-not-captured payment
      would currently be indistinguishable from any other non-`SUCCESS`
      status. Leave pre-auth off unless you've confirmed the code handles it.

### PRODUCTION MODE — AFTER deployment

**The production webhook cannot be verified before the backend is deployed to
a publicly reachable HTTPS domain.** Cashfree delivers from its own servers to
a public URL; there is nothing to register, and nothing to test, until that
URL exists. Its absence before deployment is a sequencing fact, **not a code
defect** — do not record the webhook as "verified" until the steps below have
actually been carried out against the deployed backend.

The endpoint is:

```
https://<production-api-domain>/api/webhooks/cashfree
```

`<production-api-domain>` is a placeholder. Substitute the real domain once it
is known; do not guess it in advance.

- [ ] **Confirm the production API domain resolves and is reachable over
      HTTPS** from outside the venue network — not just from the server
      itself. `curl https://<production-api-domain>/health` from an external
      network is sufficient.
- [ ] **Confirm nothing in front of the backend re-serialises the request
      body.** Cashfree signs the exact raw bytes, decimal amounts included, so
      a JSON-aware reverse proxy or CDN that parses and re-emits the body
      breaks every signature. The route is mounted before `express.json()`
      precisely to preserve those bytes; a proxy can still undo it.
- [ ] **Register the webhook** in the **production** Cashfree Dashboard
      (Switch to Prod first), Developers → Webhooks → **Add Webhook
      Endpoint**:
      - URL: `https://<production-api-domain>/api/webhooks/cashfree`
      - Subscribe to at least the payment-success event; also subscribe to the
        failed/user-dropped events if you want them recorded for audit (the
        code records but never acts on them either way).
      - **AND/OR** set `CASHFREE_NOTIFY_URL` to the same URL on the backend.
        One of the two is required — without either, a payment where the
        customer's browser never returns to the app has no automatic
        settlement path, and the order sits `pending` until a human manually
        re-triggers `payment-init`/`payment-verify` on it.
- [ ] **Verify the webhook actually reaches the deployed backend** — the
      **Logs** tab beside Webhooks in the Cashfree Dashboard must show a `200`
      delivery. A `4xx`/`5xx` or a timeout here means the endpoint is not
      correctly exposed; fix that before taking real payments.
- [ ] **Controlled payment / webhook smoke test** against production Cashfree,
      on cinema 8, before general go-live:
      - [ ] UPI payment succeeds
      - [ ] Card payment succeeds
      - [ ] Browser-close test: pay, then close the browser tab immediately
            after — before the SDK/verify call returns — and confirm the order
            still settles to `paid` (via webhook or a later manual
            `payment-verify`/`payment-init` retry).
      - [ ] Payment succeeds without ever returning to the Consumer (closed
            tab / crashed browser mid-payment) — confirm the webhook alone
            settles it, with **zero** frontend involvement.
- [ ] **Confirm the order/payment state reconciles correctly** after each of
      the above:
      - [ ] The order's payment status is `paid` in the database, and its
            `total` equals the amount Cashfree collected — the webhook and the
            pull reconciliation both require an exact match and will settle
            nothing otherwise.
      - [ ] A row exists in `payment_webhook_events` for the delivery.
      - [ ] The KDS receives **exactly one** order for that payment (not zero,
            not two) — this is the single most safety-critical invariant in
            the payment system (`applyPaidTransition`'s compare-and-set).

---

## 3a. Cinema 8 verification (the production cinema)

Cinema 8 (`1Cinemas Noida`) is what this launch actually serves, so it gets
checked directly rather than inferred from a green test suite. Every item here
is a look at production data, not a code check.

**Catalogue and pricing**
- [ ] The cinema's catalogue loads:
      `GET /api/consumer/cinemas/8/products` returns the expected products.
- [ ] **Every product carried by cinema 8 has an active `product_pricing`
      row.** A product with an active `cinema_products` link but no pricing
      row renders as "Unavailable" on the card and cannot be ordered — the
      Consumer handles it correctly, but it is almost always a data omission
      rather than an intention. Compare the two counts and account for any
      difference.
- [ ] Per-source discounts are as intended. Each pricing row carries a
      separate discount per channel (`discount_on_qr`, `_seat_qr`, `_kiosk`,
      `_counter`), and the catalogue prices against the same channel the order
      will be charged against. Confirm the rates are deliberate, not left over
      from testing.
- [ ] Availability windows (`availability_hours`) are correct for the cinema's
      real trading hours, and a product expected to be on sale right now
      actually appears.

**Banners**
- [ ] Active banners have a `start_date`/`end_date` range that includes today.
      Dates are stored as IST wall clock, and an `end_date` picked without a
      time defaults to **midnight** — so "ends today" means the banner is
      already invisible. Check the times, not just the dates.
- [ ] Header (`H`) and inner (`I`) banner artwork loads from
      `VITE_API_URL/uploads/...`.

**Screens, sessions and the seat-row flow**
- [ ] The cinema's `screens` rows and their `seat_row` values match the real
      auditorium layout (see §13).
- [ ] `GET /api/consumer/cinemas/8/sessions` returns real, current sessions
      with `Session_strStatus = 'O'`.
- [ ] **End-to-end seat resolution:** pick a session, pick a row offered for
      it, and confirm order creation resolves a screen rather than rejecting
      the row. This is the `(cinema_id, screenName, seatRow)` lookup in §13,
      and it is the one place a screen/seat-row data mismatch surfaces as a
      customer-visible failure.

**Payment**
- [ ] Cinema 8 has an **active** `payment_gateway_config` row (`is_active = 1`).
- [ ] That row holds **production** credentials, and its `environment` is set
      to the production value — see §3.
- [ ] `make healthcheck` does **not** list cinema 8 among the cinemas that
      cannot take payment.

**Screensaver / kiosk entry**
- [ ] The cinema's `screensaver_url` artwork loads, or is deliberately unset
      (in which case the text hero is shown — a supported state, not a fault).

---

## 4. Frontends (Consumer, Dashboard, Kitchen)

All three are Vite/React static bundles. `VITE_*` variables are **baked in at
build time** — changing one requires a rebuild, not a config reload.

For **each** of `consumer/`, `dashboard/`, `kitchen/`:

- [ ] `VITE_API_URL` set to the real production HTTPS origin of the backend,
      with **no trailing slash and no `/api` suffix** (each app appends its
      own paths; a value ending in `/api` produces `/api/api/...` and 404s).
- [ ] Build:
      ```bash
      cd consumer && npm run build     # tsc --noEmit && vite build
      cd dashboard && npm run build    # tsc --noEmit && vite build
      cd kitchen && npm run build      # tsc --noEmit && vite build
      ```
      (`make build` runs all three from the repo root.) Each `build` script
      type-checks first (`tsc --noEmit`) and fails the build on a type error
      — a clean exit code is a genuine signal, not just "a bundle was
      produced."
- [ ] `npm run lint` clean (or only pre-existing/accepted warnings) in each.
- [ ] **API accessibility** — the backend origin in `VITE_API_URL` must be
      reachable from wherever the app actually runs: the Consumer from a
      customer's phone over the public internet (not just the venue Wi-Fi),
      the Kitchen from the venue network, the Dashboard from wherever staff
      access it.
- [ ] **HTTPS** — serve all three over HTTPS. Cashfree's checkout and general
      browser payment/security features expect a secure context.
- [ ] **Image/upload accessibility** — product/category/banner images served
      from the backend's `FILE_STORAGE_PATH` (via `GET /uploads/...`) must be
      reachable from the same origin as `VITE_API_URL`, from the same
      audiences as above.
- [ ] **SPA fallback** — configure the static host to serve `index.html` for
      unmatched paths, so client-side routes (`/payment`,
      `/confirmation/:orderId`, etc.) resolve correctly on a direct visit or
      page refresh, not just on in-app navigation.

---

## 5. Image storage

- `FILE_STORAGE_PATH` (backend env var) is the single shared storage location
  for the **entire platform** — banners, categories, products, chain logos.
  Only the backend touches the filesystem: the Dashboard uploads through
  `POST /api/uploads/{entity}`, and the Consumer/Kitchen read images through
  `GET /uploads/...`. No frontend has its own upload directory.
- [ ] **Production filesystem location**: set `FILE_STORAGE_PATH` to an
      **absolute path outside the application/source directory** (e.g.
      `/var/lib/qbusto/uploads` on Linux, `D:\qbusto\uploads` on Windows) —
      **not** the repository-relative default (`shared/uploads`). A redeploy
      that replaces the application directory would otherwise delete every
      uploaded image, since the database stores only the path, never the
      file bytes.
- [ ] **Permissions** — the directory must exist before first boot, and be
      readable and writable by the exact account the backend process runs as.
- [ ] **Backup requirements** — this directory must be in the server's backup
      schedule. It is not part of the database backup in §1; it is a
      separate filesystem location that must be backed up separately, on the
      same cadence (or tighter, if uploads happen more often than your
      database backup interval).
- [ ] **What happens if storage is lost**: the database rows referencing
      `/uploads/<entity>/<file>` remain, but every such image 404s — nothing
      in the code detects or repairs this automatically. There is no
      orphan-cleanup job either way (by design — an image is never deleted on
      replacement, only superseded, so a wrongly-deleted file is
      unrecoverable but an orphaned one only costs disk space).
- [ ] **Restore procedure**: restoring this directory from backup is
      sufficient on its own — the database holds only relative paths under
      `/uploads/<entity>/`, so as long as the restored directory structure
      matches, no database changes are needed to reconnect images.

---

## 6. Auth / security

- [ ] `JWT_SECRET` is a long random production value, **≥32 characters**
      (enforced at boot), not reused from any development `.env`.
- [ ] `CORS_ALLOWED_ORIGINS` is an explicit list of real production origins —
      not `*`.
- [ ] HTTPS is terminated in front of every application (backend included —
      the Cashfree webhook specifically requires it).
- [ ] **Production Cashfree credentials** are the live pair, not the
      sandbox/test pair, for **cinema 8** (§0 — the other cinemas are test
      data and take no production traffic). Nothing enforces this — the boot
      guard that used to was removed along with the global vars — so check the
      cinema's `environment` AND its actual key values; a `prod` environment
      setting with a pasted-in test key fails against the live API, and a test
      environment setting takes no money at all.
- [ ] **No `.env` files committed to the repository** — confirm
      `backend/.env`, `consumer/.env`, `dashboard/.env`, `kitchen/.env` are
      all gitignored and none were accidentally committed at any point
      (`git log --all --full-history -- '**/.env'` to check history, not
      just the working tree).
- [ ] **No test credentials in production** — cinema 8 not left on
      `environment: test`, no development `JWT_SECRET`, no development
      database credentials carried into the production `.env`.
- [ ] **Database credentials** — a dedicated production `DB_USER` with
      least-privilege access (see §1), a strong `DB_PASSWORD`, `DB_ENCRYPT=true`,
      and `DB_TRUST_SERVER_CERTIFICATE=false` once the SQL Server instance has
      a trusted certificate.
- [ ] **File permissions** — `FILE_STORAGE_PATH` writable only by the backend
      service account (§5); log directory (`LOG_DIR`) similarly scoped;
      `.env` file itself readable only by the account running the backend.

---

## 7. Payment go-live test (manual, concrete)

**Golden path:**

1. [ ] Scan/open the Consumer QR entry point.
2. [ ] Select a cinema/session from the picker.
3. [ ] Add products to the cart, open checkout.
4. [ ] Fill in mobile/email, submit checkout (creates the order).
5. [ ] Cashfree hosted checkout opens (in-page modal).
6. [ ] Complete payment via UPI.
7. [ ] Complete a separate payment via card.
8. [ ] Checkout returns control to the Consumer page.
9. [ ] Order becomes `paid` (confirmed on the confirmation screen).
10. [ ] The order appears on the Kitchen Display System.

**Then, deliberately, each of:**

- [ ] **Close the checkout modal before paying** — confirm the app returns to
      a state that lets the customer try again, with nothing charged and no
      order stuck.
- [ ] **Force a failed payment** (a test card/UPI ID Cashfree provides for
      this in test mode, or a genuinely declined production instrument) —
      confirm retry is offered and works.
- [ ] **UPI left pending** (start a UPI collect, don't approve/decline it
      yet) — confirm the app does **not** offer to pay again while the
      collect is still outstanding. This is the most safety-critical
      behaviour in the whole payment flow: a UPI attempt still in flight must
      never be treated as a safely-retryable failure, or a customer risks
      being charged twice.
- [ ] **Payment succeeds but the user closes the browser** before returning
      to the Consumer — confirm the order still settles to `paid`
      automatically (webhook), with no further customer action.
- [ ] **Webhook settles the order with zero frontend involvement** — same
      test as above, verified specifically by checking the order transitions
      to `paid` even though `payment-verify` was never called from a
      browser.

---

## 8. Deployment

**What exists in this repository today:** four independent Node/Vite
applications (`backend`, `consumer`, `dashboard`, `kitchen`), a root
`Makefile` wrapping `npm`/`sequelize-cli` commands, and Sequelize migrations
under `backend/migrations/`. **There is no Docker, PM2, Nginx, systemd, or CI
configuration anywhere in this repository** — these must be set up on the
target server(s) if you use them; nothing here assumes a particular choice.

**Commands that exist and are verified:**

```bash
# Install
make install                 # all four apps
# or individually: cd <app> && npm install

# Database
make db-create                # npx sequelize-cli db:create
make migrate                  # npx sequelize-cli db:migrate
make seed                     # npx sequelize-cli db:seed:all
make verify-schema            # npm run verify-schema (backend)
make healthcheck              # npm run healthcheck (backend)
make verify                   # both of the above

# Build frontends
make build                    # all three
cd backend && NODE_ENV=production npm start     # node index.js

# API contract regeneration (if a route changed)
make gen-api                  # gen:spec + all three clients
```

**What must be configured manually on the production server** (not provided
by this repository):

- [ ] A process manager for the backend (`npm start` runs `node index.js` in
      the foreground — something needs to keep it running, restart it on
      crash, and manage logs/startup-on-boot).
- [ ] A reverse proxy / TLS termination in front of the backend and each
      frontend's static files.
- [ ] Static file hosting for the three frontend `dist/` builds, with the SPA
      fallback described in §4.
- [ ] Firewall/network rules allowing inbound HTTPS from Cashfree's servers to
      the webhook endpoint specifically.
- [ ] A backup schedule/automation implementing §1 and §5 (the repository
      provides no automated backup tooling).
- [ ] Any CI/CD pipeline, if you want one — none exists today.

---

## 9. Post-deployment verification

- [ ] **Backend health check**: `curl https://<backend>/health` and
      `curl https://<backend>/ready` — both should report `ok`/`ready`, and
      `/ready` should show `database.connected: true`, all migrations
      applied, no pending/orphaned migrations, and no missing seed data.
- [ ] **`make verify-schema`** against the production database.
- [ ] **`make healthcheck`** against the production database. Beyond the
      environment/DB/migration/seed checks it also reports two things that
      matter here:
      - **"Payment not configured for N active cinema(s)"** — an inventory,
        not a failure. **Cinema 8 must not appear in this list.** Any other
        cinema listed is test data (§0) and is not a blocker.
      - **"Cashfree environment in use"** — the environments the active
        `payment_gateway_config` rows are actually on. This must read
        `prod`/`production` for the production cinema, and it must match the
        the production cinema. There is nothing to cross-check it against any
        more: the Consumer takes its SDK mode from the `payment-init`
        response, so this row is the single source and cannot disagree with
        the frontend.
- [ ] **Frontend loading** — each of Consumer, Dashboard, Kitchen loads
      without console errors, and each successfully calls the backend (check
      Network tab for a real `200` from `VITE_API_URL`, not a CORS failure).
- [ ] **Login** — staff login on the Dashboard succeeds and issues a working
      JWT.
- [ ] **Consumer loading** — catalogue, banners, and session picker all load
      for **cinema 8** (§3a covers this cinema's data in full).
- [ ] **Dashboard loading** — catalogue/orders/users views load for a real
      staff account.
- [ ] **Kitchen loading** — the KDS board loads (empty is fine if there are no
      paid orders yet).
- [ ] **Image loading** — at least one product/banner image with a local
      upload (not an external URL) loads correctly from
      `VITE_API_URL/uploads/...`.
- [ ] **Session listing** — `GET /api/consumer/cinemas/8/sessions` returns
      real, current sessions.
- [ ] **Order creation** — a real order can be created end-to-end from the
      Consumer.
- [ ] **Payment** — a real payment against production Cashfree succeeds (see
      §7).
- [ ] **Webhook** — registered and confirmed delivered and processed, per the
      post-deployment procedure in §3 (Cashfree Dashboard Logs tab shows
      `200`; the order transitioned to `paid`). Until those steps have
      actually been carried out against the deployed backend, this stays
      unchecked — it cannot be verified in advance.
- [ ] **KDS** — the paid order appears exactly once on the Kitchen board.

---

## 10. Backup / rollback

**Must be backed up BEFORE deployment:**

- [ ] Full database backup (`.bak`, per §1) — taken immediately before
      applying any new migration.
- [ ] `FILE_STORAGE_PATH` contents (image storage, per §5).
- [ ] The current production `.env` files for all four apps, if this is an
      update to an already-running deployment (so a rollback can restore
      exact prior configuration).
- [ ] Note the exact migration state (`npx sequelize-cli db:migrate:status`
      output) before migrating, so a rollback target is known.

**Rollback considerations:**

- Migrations can be rolled back individually with
  `npx sequelize-cli db:migrate:undo` (or `make migrate-undo`), but **not
  every migration in this repository has a safe, data-preserving `down()`** —
  check the specific migration before relying on this for anything that has
  already taken production traffic. The rename migration
  (`20260825000100-rename-payment-columns-provider-neutral.js`) is
  re-runnable and reversible by design; confirm the same for any newer
  migration before depending on rollback.
- A code rollback (previous build/release) with an already-migrated database
  is only safe if the previous code version is compatible with the current
  schema — check migration compatibility both directions before rolling back
  code without rolling back the database.
- Rolling back `FILE_STORAGE_PATH` from backup is independent of database
  rollback — restoring one without the other is safe as long as you're not
  simultaneously rolling back schema changes that alter which paths the
  application expects.

---

## 11. Operational procedures

Procedures the operator runs by hand, because QBusto deliberately does not
automate them. None of these is a gap to be closed before launch.

### Refunds — Cashfree Dashboard only

**QBusto has no refund API, and none is being built for this release.** This
is a decision, not an omission.

The procedure is:

1. The operator issues the refund in the **Cashfree Dashboard**, against the
   payment, using the cinema's own merchant account.
2. A member of staff then sets the order's payment status to `refunded` in the
   QBusto Dashboard, so QBusto's record matches what Cashfree did.

Two consequences worth stating plainly, because neither is enforced by code:

- **The QBusto status flip is a bookkeeping entry, not an instruction.** It
  moves no money and calls no API. Setting it without having refunded in
  Cashfree leaves a customer un-refunded with a record saying otherwise.
- **The two steps can drift.** A refund issued in Cashfree and never recorded
  in QBusto leaves the order reading `paid`. Nothing reconciles them
  automatically, so treat the pair as one procedure.

`paid → refunded` is the only transition into this state, and it is
staff-only: no gateway signal can produce it.

### Abandoned orders

There is **no expiry job**. An order whose payment was never completed stays
`pending` indefinitely. This is intentional — a pending UPI collect must never
be timed out into a state that invites a second charge — and it means the
`orders` table accumulates unpaid rows over time. Nothing needs doing about
them; they are inert.

### Failed and dropped payments

`PAYMENT_FAILED_WEBHOOK` and `PAYMENT_USER_DROPPED_WEBHOOK` are recorded for
audit but change no order state, so a failed attempt stays retryable by the
customer. Only staff can set a payment `failed`.

---

## 12. Deferred items — not launch blockers

Each of these is a deliberate decision for this release. They are listed here
so that nobody re-derives them as outstanding work.

### Redis caching — implemented, not enabled

- The read-through catalogue cache **exists in the codebase** and is covered
  by tests. It is **not being enabled** for the initial production deployment.
- `REDIS_URL` will remain **unset**. The cache is inert without it: `enabled`
  is `Boolean(REDIS_URL) && NODE_ENV !== 'test'`, so with no URL no Redis
  command is issued at all and every catalogue request is served from SQL
  Server.
- **SQL Server remains the source of truth**, cache or no cache. The cache
  never held anything the database did not.
- **No Redis provider needs to be created for launch.** Do not add a Redis
  instance, URL, or credential to the production environment as a launch step.
- The implementation is **fail-soft** by design: every Redis error is treated
  as a cache miss and falls through to the database, and catalogue writes bump
  a generation counter rather than deleting keys. That is what makes running
  without Redis a supported configuration rather than a degraded one.
- **Enable it later if production traffic shows a need** — it is a single
  environment variable plus a restart, with no code change and no migration.
  Until then, leave it off.
- **Do not remove the implementation from the codebase** because it is
  disabled.

### POS integration (Vista / Showbiz) — on hold

- POS integration is **on hold** and is **not a production-launch requirement
  for this release**.
- The adapter boundary exists but the registry is empty: every provider
  currently resolves to a failure, and no route or service uses any POS table.
  Reports and POS Integrations in the Dashboard are placeholders.
- The existing design document, `backend/docs/pos-integration.md`, is **kept**
  as the reference for whenever this resumes, and now carries an ON HOLD
  banner. Note it is **gitignored** (`.gitignore`, "Internal engineering
  documentation") — it lives on the development team's disk and is not part of
  the client handover, so this checklist deliberately does not link to it.
- Do not implement, modify or expand POS functionality as part of this
  production work.
- Note that the client's `session` table — which the Consumer reads today — is
  **not** part of POS integration; it is populated by the client's own system
  and is unaffected by this hold. It is now the single source of showtimes;
  `film` and `shows` were dropped in `20260904000100`.

### QBusto refund API — not being built

- Refunds are performed by the cinema/operator in the **Cashfree Dashboard**;
  see §11 for the procedure.
- The absence of a refund API is **not a production blocker**.

---

## 12a. WhatsApp order confirmation — Jalpi

A customer gets a WhatsApp message when their order is confirmed.

**The provider is Jalpi** (`https://app.jalpi.com`), confirmed by the client
and already in use by their own systems. `src/services/whatsapp.client.js`
posts to `POST /api/v1/sendTemplateMessage` from Node. An earlier Meta Cloud
API implementation, written before any provider was confirmed, has been
removed; no Meta account, token or template was ever provisioned, so nothing
was migrated.

**QBusto does not use the client's `USP_SENDWHATSAPPALERT` stored procedure,
or any stored procedure, to send notifications.** That procedure was read as a
specification for the request contract and the template mapping; the
integration itself is entirely backend code. Nothing in QBusto calls it, and
turning it off does not affect QBusto's messages. If the client's own systems
still run it for POPExpress orders, both paths would fire for an order visible
to both — worth confirming before go-live.

- [ ] **Confirm the client has disabled `USP_SENDWHATSAPPALERT` for orders
      QBusto now owns**, so a customer does not get two messages.

**The template is `sos_order`, language `en`, already approved on the client's
Jalpi account.** It takes exactly **two** positional body parameters, as
documented by the client's own implementation:

```
{{1}}  #: <order id> | Screen #: <screen> | Seat #: <seat>
{{2}}  cinema location
```

Everything else the customer reads — the greeting, "Thank you for visiting …
Cinemas!!", the 25–30 minute delivery promise — is **fixed text inside the
approved template** and is not sent from QBusto. `buildBodyParameters` in
`notification.service.js` builds exactly these two values; **the parameter
count is fixed at approval time** and the provider rejects a mismatch, so
changing the body means re-approving the template AND editing that function.

`{{2}}` is read from **`cinemas.city`** on the order's own cinema (falling back
to `cinemas.name`), which is what the client's hard-coded `CL01 → Noida`,
`CL02 → Akola` mapping actually produced. QBusto hard-codes no cinema names.

**No image header.** Jalpi's request shape allows
`headertype`/`link`/`filename`/`headertext`; the client's own working call for
`sos_order` sends none of them, so neither does QBusto. There is no invented
image URL anywhere.

- [ ] **If the client later re-approves `sos_order` with an image header**,
      that needs a publicly reachable image URL supplied as configuration.
      QBusto has none today — `shared/uploads/` is served from the deployment
      and is not necessarily reachable from Jalpi's network.

**Jalpi answers `200 OK` whether it sends the message or refuses it.** Both
observed live:

```
refused:  {"ErrorCode":"506","ErrorMessage":"your waba configuration not found"}
sent:     {"ErrorCode":"000","ErrorMessage":"success","Data":[{ ... }]}
```

So HTTP status alone proves nothing, and `ErrorCode` is the signal — `000` is
success, any other populated value is a refusal. `interpretResponse` in
`whatsapp.client.js` is the only place this is decided:

> **The success body echoes the API key and the customer's mobile number
> back**, in `Data[0].Key` and `Data[0].mobileNumber`. Only `Data[0].MaskId` is
> read out, at that boundary; the parsed body never leaves the function and is
> never logged. Treat any change to that function as a credential-handling
> change.

End-to-end delivery verified live: order 109 at 1Cinemas Noida, message
received on the customer's handset.

| Outcome | Treated as |
| --- | --- |
| Transport failure / timeout | failed |
| Non-2xx HTTP | failed |
| 2xx with an explicit failure signal (`status:false`, a populated `error`) | failed |
| 2xx with no failure signal | **provisionally accepted** |

A key that Jalpi does not recognise fails as `ErrorCode 506, "your waba
configuration not found"` — the same answer a garbage key gets, and it is
returned before the template or the parameters are looked at. If every message
starts failing with 506, suspect the key or the instance, not this code.

- [ ] **Confirm which Jalpi instance is live.** The key is an *instance* API
      key (instance `919217497755` at the time of writing), not an account-wide
      one. Rotating the instance means rotating `JALPI_API_KEY`.

**Known limitation, accepted:** there is **no retry**. A transient Jalpi
outage or timeout costs that one message; the order is unaffected and the row
records `whatsapp_status = 'failed'`. There is also no delivery webhook, so
`success` means "accepted by Jalpi", not "read by the customer".

**Environment**, all optional — see `backend/.env.example`: `JALPI_BASE_URL`,
`JALPI_API_KEY`, `JALPI_TEMPLATE_NAME`, `JALPI_LANGUAGE_CODE`,
`JALPI_TIMEOUT_MS`, `WHATSAPP_DEFAULT_COUNTRY_CODE`.

- [ ] **`JALPI_API_KEY` is set in the deployment environment only.** It is
      never in the database, never in `.env.example`, never logged. Note that
      Jalpi authenticates with it as a **field in the JSON body**, not a
      header, so the request body is never logged either. There is deliberately
      no `JALPI_USERNAME`/`JALPI_PASSWORD`: the credentials issued alongside
      the key are for the Jalpi web console, and this endpoint neither accepts
      nor needs them.
- [ ] **Rotate the key that appears in `USP_SENDWHATSAPPALERT.sql`.** That
      file carries a live Jalpi key in plaintext. It has not been copied into
      QBusto's code, tests, documentation or `.env.example`, and it should not
      be — but it has been readable to anyone with the file.
- [ ] A failed send logs the HTTP status and, where the provider supplies a
      short scalar one, its error code. Never the response body: it can echo
      the customer's phone number and the request back.
- [ ] Leaving the variables unset is a **valid production state**: the backend
      boots normally and simply never sends. It refuses to boot for a bad
      Cashfree config, but not for a notification channel.
- [ ] **Turn the channel on per cinema** with `cinemas.whatsapp_enabled`. Off
      means never attempted, and `orders.whatsapp_status` stays NULL.

**A WhatsApp failure never invalidates an order.** The send is registered with
`transaction.afterCommit`, so it does not begin until the order has committed;
every path is wrapped; the outcome is a log line plus
`orders.whatsapp_status = 'failed'`. A Jalpi outage costs messages, not orders.

- [ ] After go-live, spot-check `SELECT whatsapp_status, COUNT(*) FROM orders
      GROUP BY whatsapp_status`. A wall of `failed` means a configuration
      problem, not an ordering problem.

---

## 13. Screen / seat-row architecture (settled)

Recorded here because it has been re-litigated before and because §3a's seat
resolution check depends on it.

**The model is confirmed and intentional.** `screens` holds
auditorium/screen records, and `seat_row` identifies the seat row associated
with that record. For the client's Vista data, one auditorium may therefore
appear as several `screens` rows:

```
Screen 2 + A
Screen 2 + B
Screen 2 + C
```

The client's `session` table names its auditorium as text
(`Screen_strName`), with no reference to `screens.id`. So when a customer
picks a session whose `Screen_strName` is `"Screen 2"` and then picks row
`A`, order creation resolves the matching `(cinema_id, screen name,
seat_row)` record **server-side**. A screen id supplied by the client is never
trusted — a QR is printed with whatever row existed at print time, which is
not necessarily the show the customer selected.

Do **not**, as part of this work:

- create an `auditoriums` table;
- redesign the `screens` table;
- modify `screen_layout`;
- expand this into a broader POS redesign — POS remains on hold (§12).

The current server-side resolution is the intended design, not a workaround
pending a schema change.

---

## 14. Go-live sign-off

**Before deployment**

```
[ ] Database backed up
[ ] Production environment configured
[ ] CREDENTIALS_ENCRYPTION_KEY generated and backed up (never rotate casually)
[ ] REDIS_URL deliberately left unset (deferred - see §12)
[ ] Cinema 8 production Cashfree credentials entered
[ ] Cinema 8 payment_gateway_config.environment set to production
[ ] Consumer production build verified
[ ] Dashboard production build verified
[ ] Kitchen production build verified
[ ] Image storage configured
[ ] HTTPS configured for every application
[ ] Backup verified
[ ] Rollback plan confirmed
```

**Deployment**

```
[ ] Backend deployed to a publicly reachable HTTPS domain
[ ] Consumer deployed
```

**After deployment**

```
[ ] Production API domain confirmed reachable over HTTPS from outside
[ ] Cashfree webhook registered in the PRODUCTION dashboard
[ ] Webhook delivery confirmed reaching the backend (200 in Cashfree Logs)
[ ] Controlled payment smoke test passed on cinema 8
[ ] Order/payment state confirmed reconciled after the smoke test
[ ] KDS received exactly one ticket per paid order
[ ] Cinema 8 verification complete (§3a)
[ ] make healthcheck run against production; cinema 8 not listed as unpayable
```

**Not part of sign-off** — deferred by decision, see §12: Redis, POS
integration, a QBusto refund API.
