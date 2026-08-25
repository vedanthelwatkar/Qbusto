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
      Every migration should show `up`. There are 32+ migrations in
      `backend/migrations/`, timestamp-ordered; apply with `make migrate` (or
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
- [ ] **Verify client data is intact** — `film` and `session` are the client's
      own Vista tables (not QBusto-owned); confirm row counts and a spot-check
      of a few known films/sessions match what the client's system expects.
      `screens` and `screen_layout` similarly hold client-provided
      category/seat_row data — see the unresolved `screens` grain conflict
      noted in `CLAUDE.md` before assuming one `screens` row = one auditorium.
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

**Cashfree — see §3 for the full production procedure**
- [ ] `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` — **both required in
      production; boot throws without them.** These are now the **fallback**
      credentials, used only for a cinema with no active
      `payment_gateway_config` row — see the new "Per-cinema credentials"
      part of §3. Boot still requires them even so: a fallback that cannot
      itself be configured is not a fallback.
- [ ] `CASHFREE_ENVIRONMENT=prod` (or `production`) — **boot throws if this is
      not a production value while `NODE_ENV=production`**. Applies to the
      fallback only; each cinema's own `payment_gateway_config` row carries
      its own `environment`, set from the Dashboard, independently.
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
- `CASHFREE_ENVIRONMENT=test` (or `sandbox`), `VITE_CASHFREE_MODE=sandbox`.
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
gateway` in the Dashboard), resolved ahead of the global `CASHFREE_APP_ID`/
`CASHFREE_SECRET_KEY` fallback above.

`POST /api/cinemas` (2026-08-25) now requires `gatewayId`/`secretKey`/
`environment` and creates the cinema plus its `payment_gateway_config` row in
one transaction — so **any cinema created through the Dashboard from this
date onward already has its own credentials by construction**, nothing to
double-check there. This section still matters for **every cinema created
before that change**, and for anything inserted directly into the database
outside the API (a data migration, a manual fixture) — neither is covered by
that guarantee. For each production cinema:

- [ ] Either it has its own `payment_gateway_config` row with
      `environment: production` and real production credentials, **or** the
      deployment-wide fallback is intentionally what it should settle
      against — decide this explicitly per cinema, not by omission. A cinema
      silently falling back to the global pair is not a bug (the fallback
      logs a warning every time it fires — grep `payment_gateway_config` in
      logs to find any cinema doing this), but it should be a deliberate
      choice, not a forgotten setup step.
- [ ] If a cinema's own credentials are configured, confirm `environment` is
      actually `prod`/`production`, not left on `test` — unlike the global
      `CASHFREE_ENVIRONMENT` var, this is **not boot-checked**; a cinema
      pointed at sandbox credentials in production fails every payment for
      that cinema alone while the rest of the deployment looks fine.
- [ ] Do the browser-close / no-return / webhook tests below (§7) against at
      least one cinema running its **own** `payment_gateway_config`
      credentials, not only against the global fallback — the credential
      resolution path and the webhook's per-cinema signature verification are
      both new and worth confirming live, not just in test.

### PRODUCTION MODE — required before go-live

- [ ] **Production Cashfree credentials** — `CASHFREE_APP_ID`/
      `CASHFREE_SECRET_KEY` from the Cashfree Dashboard under **Switch to
      Prod → Developers → API Keys**. These are different credentials from
      the test/sandbox pair.
- [ ] **`CASHFREE_ENVIRONMENT=prod`** on the backend, in production.
- [ ] **`VITE_CASHFREE_MODE=production`** on the Consumer, baked in at build
      time — **must match** `CASHFREE_ENVIRONMENT`, or the checkout SDK
      rejects the payment session id with no fallback and no warning; the
      build otherwise looks completely healthy.
- [ ] **HTTPS requirement** — the webhook endpoint
      (`POST /api/webhooks/cashfree`) must be reachable over HTTPS from
      Cashfree's servers, and nothing in front of it (reverse proxy, CDN) may
      re-serialise the request body — Cashfree signs the exact raw bytes,
      decimal amounts included, and a JSON-aware proxy round-trip breaks
      every signature.
- [ ] **Webhook registration** — under the **production** Cashfree Dashboard
      (Switch to Prod first), Developers → Webhooks → **Add Webhook
      Endpoint**:
      - URL: `https://<your-production-backend>/api/webhooks/cashfree`
      - Subscribe to at least the payment-success event; also subscribe to
        the failed/user-dropped events if you want them recorded for audit
        (the code records but never acts on them either way).
      - **AND/OR** set `CASHFREE_NOTIFY_URL` to the same URL on the backend.
        One of the two is required — without either, a payment where the
        customer's browser never returns to the app has no automatic
        settlement path, and the order sits `pending` until a human manually
        re-triggers `payment-init`/`payment-verify` on it.
- [ ] **`CASHFREE_RETURN_URL`** — set to
      `https://<your-production-consumer-domain>/payment`. Genuinely optional
      (the Consumer reads its order id from `sessionStorage`, not the URL,
      and recovers regardless), but this is the fallback for browsers the
      Cashfree SDK can't keep in a modal (in-app browsers).
- [ ] **Webhook signature verification** — nothing to configure; it uses
      `CASHFREE_SECRET_KEY` automatically (there is no separate webhook
      secret with Cashfree, unlike the previous Razorpay integration). Just
      confirm the same production secret key is set consistently.
- [ ] **Required Cashfree Dashboard configuration beyond webhooks** — confirm
      whether pre-authorization is enabled on the account. It is not
      currently inspected anywhere in the code (`payment.authorization` is
      never read); if pre-auth is on, an authorized-but-not-captured payment
      would currently be indistinguishable from any other non-`SUCCESS`
      status. Leave pre-auth off unless you've confirmed the code handles it.
- [ ] **Do at least one real test payment against production Cashfree before
      general go-live**, covering:
      - [ ] UPI payment succeeds
      - [ ] Card payment succeeds
      - [ ] Browser-close test: pay, then close the browser tab immediately
            after — before the SDK/verify call returns — and confirm the
            order still settles to `paid` (via webhook or a later manual
            `payment-verify`/`payment-init` retry).
      - [ ] Payment succeeds without ever returning to the Consumer (closed
            tab / crashed browser mid-payment) — confirm the webhook alone
            settles it, with **zero** frontend involvement.
      - [ ] Confirm the webhook actually reaches the backend — check the
            **Logs** tab next to Webhooks in the Cashfree Dashboard for a
            `200` delivery.
      - [ ] Confirm the order becomes `paid` in the database after the above.
      - [ ] Confirm the KDS receives **exactly one** order for that payment
            (not zero, not two) — this is the single most safety-critical
            invariant in the payment system (`applyPaidTransition`'s
            compare-and-set).

---

## 4. Frontends (Consumer, Dashboard, Kitchen)

All three are Vite/React static bundles. `VITE_*` variables are **baked in at
build time** — changing one requires a rebuild, not a config reload.

For **each** of `consumer/`, `dashboard/`, `kitchen/`:

- [ ] `VITE_API_URL` set to the real production HTTPS origin of the backend,
      with **no trailing slash and no `/api` suffix** (each app appends its
      own paths; a value ending in `/api` produces `/api/api/...` and 404s).
- [ ] Consumer only: `VITE_CASHFREE_MODE=production` (see §3).
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
      sandbox/test pair (`CASHFREE_ENVIRONMENT` boot guard enforces this, but
      confirm the actual key values too — a `prod` environment setting with a
      pasted-in test key would still fail against the live API, just not
      silently).
- [ ] **No `.env` files committed to the repository** — confirm
      `backend/.env`, `consumer/.env`, `dashboard/.env`, `kitchen/.env` are
      all gitignored and none were accidentally committed at any point
      (`git log --all --full-history -- '**/.env'` to check history, not
      just the working tree).
- [ ] **No test credentials in production** — no `CASHFREE_ENVIRONMENT=test`
      value, no development `JWT_SECRET`, no development database credentials
      carried into the production `.env`.
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
- [ ] **Frontend loading** — each of Consumer, Dashboard, Kitchen loads
      without console errors, and each successfully calls the backend (check
      Network tab for a real `200` from `VITE_API_URL`, not a CORS failure).
- [ ] **Login** — staff login on the Dashboard succeeds and issues a working
      JWT.
- [ ] **Consumer loading** — catalogue, banners, and session picker all load
      for at least one real cinema.
- [ ] **Dashboard loading** — catalogue/orders/users views load for a real
      staff account.
- [ ] **Kitchen loading** — the KDS board loads (empty is fine if there are no
      paid orders yet).
- [ ] **Image loading** — at least one product/banner image with a local
      upload (not an external URL) loads correctly from
      `VITE_API_URL/uploads/...`.
- [ ] **Session listing** — `GET /api/consumer/cinemas/{cinemaId}/sessions`
      returns real, current sessions for at least one cinema.
- [ ] **Order creation** — a real order can be created end-to-end from the
      Consumer.
- [ ] **Payment** — a real payment against production Cashfree succeeds (see
      §7).
- [ ] **Webhook** — confirmed delivered and processed (Cashfree Dashboard
      Logs tab shows `200`; the order transitioned to `paid`).
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

## 11. Go-live sign-off

```
[ ] Database backed up
[ ] Production environment configured
[ ] CREDENTIALS_ENCRYPTION_KEY generated and backed up (never rotate casually)
[ ] Cashfree production credentials configured (global fallback)
[ ] Per-cinema payment_gateway_config decided for every production cinema
[ ] Cashfree webhook configured and reachable
[ ] HTTPS configured
[ ] Consumer production build verified
[ ] Dashboard production build verified
[ ] Kitchen production build verified
[ ] Image storage configured
[ ] Payment tested
[ ] Webhook tested
[ ] KDS tested
[ ] Backup verified
[ ] Rollback plan confirmed
```
