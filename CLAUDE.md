# CLAUDE.md — QBusto

Authoritative startup context. Read this before scanning the repo.
Fuller backup copy: [memory.md](./memory.md).

> **README.md is partially outdated.** It predates the Film/Session work, the
> client-database alignment and the Cashfree decision. Where README.md and the
> code disagree, **the code wins**. See "README drift" at the bottom.

---

## What QBusto is

Multi-tenant cinema food-ordering platform for on-premise deployment, replacing
the legacy Vista PopExpress workflow. A guest scans a QR code at their seat,
orders food, pays; staff manage the catalogue; the kitchen sees paid orders.

## Applications

| Dir | App | Notes |
| --- | --- | --- |
| `backend/` | Express + Sequelize + **SQL Server** | Sole source of truth for auth, validation, tenancy, pricing, orders, payments |
| `consumer/` | React/Vite, **public + unauthenticated** | QR → catalogue → order → pay |
| `dashboard/` | React/Vite + Ant Design | Staff admin (catalogue, pricing, users, orders) |
| `kitchen/` | React/Vite | Wall-mounted board for paid orders |
| `shared/` | `openapi.json` + `uploads/` | The API contract and all uploaded images |
| `db_export/` | `qbusto.bak`, `qbusto.sql` | Client DB snapshots. Not used at runtime |

Frontends hold **no business rules**. Every rule lives in the backend.

---

## Architecture rules that matter

- **Multi-tenancy:** `Chain → Cinema → Screen`. Every staff service applies a
  `tenantScope(actor)` helper — `owner` sees everything, everyone else is
  filtered to `chainId`. **Out-of-scope resources return 404, never 403.**
- **Auth:** JWT bearer. `authenticate()` reloads the user **and permissions on
  every request** (so revocation is immediate). `authorize(MODULE, ACTION)`
  validates module/action names **at mount time** — a typo throws at boot.
  `owner` bypasses the permission table entirely.
- **Roles:** `owner`, `chain_admin`, `cinema_admin`, `kitchen_staff`,
  `cinema_accountant`. Actions: `read`/`edit`/`delete`.
- **Constants:** `backend/src/constants.js` mirrors DB CHECK constraints.
  Change both together.
- **Order snapshots:** `order_items` freezes `productName`, `unitPrice`,
  `discount`, `total` at order time; `orders` freezes `filmTitle`/`showTime`.
  Catalogue edits must never rewrite history.
- **Client-side prices are never trusted.** The consumer sends only
  `productId` + `quantity`; the backend computes everything.

---

## Payments — Cashfree (migrated from Razorpay, complete)

QBusto has fully migrated from Razorpay to **Cashfree**. No Razorpay code,
dependency or configuration remains anywhere in the repository.

Three consumer endpoints, all idempotent:

```
POST /api/consumer/orders                          (Idempotency-Key header required)
POST /api/consumer/orders/:orderId/payment-init
POST /api/consumer/orders/:orderId/payment-verify
POST /api/webhooks/cashfree                         (raw body, HMAC-authed, no JWT)
```

**The single most important piece of this system:**
`backend/src/services/paymenttransition.service.js` → `applyPaidTransition()`.
It is a **compare-and-set** (`UPDATE … WHERE payment_status_id = pending`)
called by **three independent discovery paths** — this seam is
**provider-agnostic and survived the migration untouched**:

1. Browser `payment-verify` — takes no identity from the request; Cashfree's
   hosted checkout hands the browser no cryptographic credential, so it asks
   Cashfree directly, server-to-server, "was this order paid".
2. Webhook (`PAYMENT_SUCCESS_WEBHOOK`)
3. Pull reconciliation (`cashfree.client.fetchOrderPayments`, timeout via
   `CASHFREE_TIMEOUT_MS`, default 4s) — triggered on re-hitting `payment-init`
   or `payment-verify`, **not** a cron

Whichever lands first wins; the others are harmless no-ops. It also calls
`fulfilment.confirmOnPayment()` (another CAS, `initiated → confirmed`), which
is what makes the order appear on the Kitchen display — exactly once. Verified
live under 5-way concurrent webhook delivery: exactly one transition, one
kitchen ticket, every time.

**Other invariants:**
- `orders.gateway_order_id` (renamed from `razorpay_order_id`) has a
  **filtered UNIQUE index**; init uses CAS on `WHERE gateway_order_id IS NULL`
  → one gateway order per QBusto order, ever. The gateway order id is
  **deterministic** (`qbusto_order_<orderId>`), not random, so Cashfree's own
  `x-idempotency-key` is a second independent guard on the same invariant.
- Webhook dedup = `payment_webhook_events.event_id` (renamed from
  `razorpay_webhook_events`) **UNIQUE constraint** — Cashfree sends no
  dedicated event-id header, so the key is derived: `${event}:${cfPaymentId ||
  gatewayOrderId}`.
- `PAYMENT_FAILED_WEBHOOK` / `PAYMENT_USER_DROPPED_WEBHOOK` are **recorded but
  never mutate order state** — a failed/dropped attempt must stay retryable.
  Only staff can set `failed`.
- **PENDING is a distinct, load-bearing state.** A UPI collect not yet
  approved/declined must never be treated as a safely-retryable failure.
  `reconcilePaymentFromGateway` reports `gatewayPending: true` whenever any
  attempt is still outstanding (deliberately not amount-filtered), and
  `payment-verify`'s 409 carries it through so the frontend keeps the payment
  attempt alive instead of offering a second charge.
- Webhook signature: `HMAC-SHA256(CASHFREE_SECRET_KEY, timestamp + rawBody)`,
  **base64**, compared with `crypto.timingSafeEqual`. Three differences from
  the old Razorpay algorithm that would silently break verification if reused
  naively: the timestamp is signed material (not just a header), the digest is
  base64 not hex, and there is **no separate webhook secret** — the API secret
  key does double duty.
- **No refund API integration.** `refunded` is a staff-only DB status flip;
  actual refunds happen in the Cashfree Dashboard.
- **No expiry job.** An abandoned order sits `pending` indefinitely.
- Payment statuses: `pending → {paid,failed}`, `failed → {pending,paid}`,
  `paid → refunded`. Order statuses: `initiated → confirmed → preparing →
  ready → delivered`, plus `rejected`.
- **`CASHFREE_NOTIFY_URL`/`CASHFREE_RETURN_URL` are both optional and, in this
  environment, both unset.** `RETURN_URL` being unset is fine — the Consumer
  recovers via `sessionStorage`, not the URL. `NOTIFY_URL` unset means webhook
  delivery depends entirely on a webhook being registered directly in the
  Cashfree Dashboard (Developers → Webhooks) instead — confirm this exists for
  the production account before go-live; see
  [pre-production-checklist.md](./docs/pre-production-checklist.md).

---

## Films, Sessions, Screens — the client-owned area

**This is the least README-documented and most surprising part of the repo.**

`film` and `session` are the **client's own Vista tables**, not QBusto tables.
They keep their provider column names (`Film_strCode`, `Session_lngSessionId`,
`Session_dtmRealShow`, …) because the client syncs against them. Models supply
QBusto vocabulary via `field:` mappings only.

- `film` PK = `Film_strCode` (varchar), **not** an integer id.
- `session` PK = composite `(Code, Session_lngSessionId)`; `Code` FKs to
  `cinemas.code`, not `cinemas.id`.
- **There is deliberately no second `films`/`sessions` table.** Earlier
  migrations that created QBusto-owned duplicates were **removed**.
- `session` has **no `screens.id`** — only `Screen_bytNum`/`Screen_strName`.
  Session responses return `screenName` as text; no screen id is derived.

**Session status (`Session_strStatus`) — client-defined:**

| Value | Meaning | Consumer behaviour |
| --- | --- | --- |
| `O` | Open | **The only status offered to customers** |
| `C` | Closed | Excluded in SQL |
| `I` | Inactive | Excluded in SQL |

The filter is a **SQL predicate**, not a mapping step — a non-Open session never
leaves the database.

Consumer session picker: programming day runs **06:00 → 06:00**, only future
screenings, capped at **2 per screen** so one busy auditorium can't crowd out
the rest.

Film/Session API routes are **read-only** (`GET` only, `Settings:read`).
`Film_strNowShowingFlag` and `Film_strStatus` are passed through **raw** —
their vocabulary is undefined by the client, so no meaning is invented.

**`screens` grain conflict (UNRESOLVED):** QBusto treats one `screens` row as
one auditorium (`orders.screen_id` FKs to it), but the client loaded it at
**seat-row grain** — ~82 rows for ~27 auditoriums, with `category`
("Platinum"/"Recliner") and `seat_row` ("A".."N") columns. Screen-name
uniqueness and `ScreenSelect` are ambiguous under this grain. **Do not build on
`screens` grain without asking.**

`screen_layout` = the client's seat map (one row per seat), links to a screen by
**`screen_name` text, not FK**. Currently **empty**; modelled so schema
verification sees it, but **nothing reads it**. QBusto neither sells nor
allocates seats.

---

## Database & migrations

SQL Server. 32 migrations in `backend/migrations/`, timestamp-ordered. Sequelize
CLI reads `backend/config/config.js` (via `.sequelizerc`), **not** `src/config/env.js`.

Two recent alignment migrations are the current state of the art:

- `20260823001000-align-client-naming.js` — **renames only**, via `sp_rename`.
  `Film`→`film`, `Session`→`session`, `screens.Category`→`category`,
  `SeatRow`→`seat_row`, `screen_layout` columns → snake_case. Provider columns
  inside `film`/`session` deliberately **not** renamed. Re-runnable.
- `20260824000100-provision-client-schema.js` — creates `film`, `session`,
  `screen_layout`, `screens.category`, `screens.seat_row` **only when absent**,
  reproducing the client's exact DDL. On the client's DB it is a verified
  **no-op**. Exists so a fresh/CI/DR database matches. Its `down()` refuses to
  drop anything holding data and **never** auto-drops `screen_layout`.

Seeders load **only** order-status and payment-status master data. No user
account — create one before anything can log in.

---

## Generated files — never hand-edit

- `shared/openapi.json` ← `cd backend && npm run gen:spec`
- `consumer|dashboard|kitchen/src/api/generated/**` ← `npm run gen:api` (Orval)

Flow: backend route annotations → `gen:spec` → `openapi.json` → `gen:api` →
typed clients. **Change a route ⇒ regenerate spec, then all three clients**
(`make gen-api` does both). Regenerate **once** at the end, not per-edit.

---

## Commands

```bash
make install        # all four apps
make setup          # install + db-create + migrate + seed + verify
make migrate        # npx sequelize-cli db:migrate   (NOTE: no npm run db:migrate exists)
make seed           # status master data only
make gen-api        # gen:spec + all three clients
make verify         # verify-schema + healthcheck
make dev-backend | dev-consumer | dev-dashboard | dev-kitchen
cd backend && npm test          # Jest + supertest, ~22 suites
```

Dev ports: consumer 5173, dashboard 5174, kitchen 5175, backend 4000. Ports are
**fixed** — a clash fails startup rather than silently moving to an origin CORS
would reject.

Frontends have **no test suites**; they are verified by `npm run typecheck`,
`lint`, `build`.

---

## Environment

Validated by Joi in `backend/src/config/env.js`, which **throws at boot** on
misconfiguration. Everything reads from this module, not `process.env` — no
exceptions; the Razorpay-era `process.env.RAZORPAY_KEY_ID`/`_SECRET` direct
read in `consumer.service.js` no longer exists.

Boot guards worth knowing: production + missing `CASHFREE_APP_ID`/
`CASHFREE_SECRET_KEY` → **throw**; production + `CASHFREE_ENVIRONMENT` not
`prod`/`production` → **throw** (a production deploy pointed at the Cashfree
sandbox would look completely healthy while taking no real money); non-prod +
`CASHFREE_ENVIRONMENT=prod`/`production` → warn (charges real cards); only one
of the credential pair set → warn.

Key vars: `DB_*`, `JWT_SECRET` (≥32 chars in prod), `CORS_ALLOWED_ORIGINS`,
`FILE_STORAGE_PATH`, `MAX_UPLOAD_SIZE_MB`, `CASHFREE_APP_ID`,
`CASHFREE_SECRET_KEY`, `CASHFREE_ENVIRONMENT`, `CASHFREE_NOTIFY_URL`
(optional), `CASHFREE_RETURN_URL` (optional), `CASHFREE_FALLBACK_CUSTOMER_PHONE`,
`CASHFREE_TIMEOUT_MS`. There is **no separate webhook secret** — Cashfree signs
with `CASHFREE_SECRET_KEY` itself. Never commit values.

---

## Image uploads

`POST /api/uploads/{entity}` (dashboard) → disk; read via `GET /uploads/...`.
Entity allowlist: `banners`, `films`, `categories`, `chains`, `products`.

- multer **memory** storage; bytes are **magic-number validated** before
  anything touches disk. Extension and browser MIME are untrusted.
- **SVG is deliberately rejected** (XML → stored-XSS vector).
- Filename = 16 random bytes + detected extension; written with flag `wx`.
- DB stores the **application path** `/uploads/<entity>/<file>` in the *same*
  column as external URLs — no second column, no discriminator.
- `FILE_STORAGE_PATH` must be **outside the source tree** in production, or a
  redeploy deletes every uploaded image. The DB holds only the path.

---

## POS — deferred, do not build

`backend/src/pos/` holds an adapter contract + registry. The registry is
**empty**; `getAdapter()` throws for every provider. DB accepts providers
`vista`, `showbizz` (double-z, matches the CHECK constraint — do not "fix"),
`impact`, `qbusto`. **No route or service uses any POS table.** Reports and POS
Integrations are Dashboard placeholders.

---

## Pitfalls

1. Don't hand-edit generated API clients or `openapi.json`.
2. Don't add a QBusto-owned `films`/`sessions` table — `film`/`session` are the
   canonical client tables.
3. Don't rename provider columns inside `film`/`session`.
4. Don't assume one `screens` row = one auditorium (see grain conflict).
5. Don't let a gateway signal set payment status `failed` — that's staff-only.
6. Don't route the webhook through `express.json()`; it needs the **raw body**.
7. Don't bypass `applyPaidTransition()` for a `pending → paid` move.
8. Out-of-scope resource ⇒ **404, not 403**.
9. `make migrate`, not `npm run db:migrate` (that script doesn't exist).
10. Rebuild frontends to change `VITE_API_URL` — it's baked in at build time.

## README drift (verified against code)

- No mention of `film`/`session`/`screen_layout`, session `O`/`C`/`I`, or the
  `screens` grain conflict — the largest gap.
- Doesn't mention `db_export/`, or the `create-dev-user.js` /
  `seed-dev-*.js` scripts.
- Embeds a development username/password in plain text.
- `backend/docs/client-database-changes.md` §6 references `npm run db:migrate`,
  which **does not exist** in `backend/package.json`.
