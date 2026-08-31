# memory.md — QBusto Project Knowledge (full backup)

Backup/reference copy of project context. [CLAUDE.md](./CLAUDE.md) is the
concise startup version; this file is the fuller record so context can be
reconstructed if CLAUDE.md is lost.

Verified against the repository, not against README.md. **Where README.md
conflicts with the code, the code is authoritative.** Drift list in §20.

No secrets, credentials, keys or tokens are recorded here.

---

## 1. Project overview

QBusto is a multi-tenant cinema food-ordering and management platform, designed
to run **on-premise**, replacing the legacy Vista PopExpress workflow.

Flow: a guest scans a QR code at their seat → browses the catalogue → places an
order → pays → the kitchen display shows the paid order → staff prepare and hand
over.

### Applications

| Directory | Application | Stack |
| --- | --- | --- |
| `backend/` | API server | Node.js, Express 5, Sequelize 6, SQL Server (tedious), Joi, JWT, Winston, bcrypt, multer, helmet, compression, express-rate-limit |
| `consumer/` | Customer ordering app (public, unauthenticated) | React, TypeScript, Vite, Zustand, React Hook Form, Zod, Sass |
| `dashboard/` | Management dashboard | React, TypeScript, Vite, Ant Design, Zustand, Sass |
| `kitchen/` | Kitchen Display System | React, TypeScript, Vite, Zustand, Sass |
| `shared/` | Shared contract + storage | `openapi.json`, `uploads/` |
| `db_export/` | Client DB snapshots | `qbusto.bak`, `qbusto.sql` — reference only, not runtime |

The three frontends are static bundles holding **no business rules**. Every
rule, permission check and calculation lives in the backend, reached over HTTP
through a generated typed client.

### Backend source layout

```
backend/src/
  routes/       21 files  (api, auth, availability, banner, category, chain,
                           cinema, cinemaproduct, consumer, film, health,
                           kitchen, order, orderstatus, pricing, product,
                           screen, session, upload, user, webhook)
  controllers/  18 files
  services/     20 files
  validators/   16 files  (Joi)
  middleware/   authenticate, authorize, errorHandler, notFound,
                rateLimiter, requestLogger, upload, validate
  config/       env.js, database.js, logger.js, swagger.js
  pos/          adapter.js, externalShow.js, posErrors.js, providerRegistry.js
  utils/        errors.js, jwt.js, response.js, sqlDate.js
  constants.js
```

---

## 2. Multi-tenancy

Hierarchy: **Chain → Cinema → Screen**.

Implemented as a `tenantScope(actor)` helper in each staff service:

```js
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}
```

- `owner` → `{}` (unrestricted).
- Every other role → filtered to their own `chainId`.
- A caller-supplied `chainId` filter can **narrow** within scope but never
  **widen** it (guarded by `actor.role === ROLES.OWNER`).
- **A resource outside the caller's scope is reported as 404 Not Found, not
  403 Forbidden** — existence itself is not disclosed across a tenant boundary.

---

## 3. Authentication & permissions

**`authenticate()`** (`backend/src/middleware/authenticate.js`)
- Expects `Authorization: Bearer <token>`.
- Verifies the JWT (issuer-checked), then **reloads the User and their
  permissions from the database on every request** — so a revoked permission or
  a deactivated account takes effect immediately rather than at token expiry.
- Attaches `req.user` (model instance, `passwordHash` excluded) and `req.auth`
  (decoded payload).
- Status codes: **401** for no/malformed/expired token or a subject that no
  longer exists (the credential is unusable); **403** with
  `ACCOUNT_INACTIVE` when the token is valid but the account is deactivated.

**`authorize(moduleName, action)`** (`backend/src/middleware/authorize.js`)
- Validates module and action names **when the middleware is built** (at mount
  time), so `authorize('Product', 'read')` throws at **startup** instead of
  silently denying every request in production.
- `owner` bypasses the permission table unconditionally.
- Everyone else needs a `user_permissions` row with the relevant
  `can_read`/`can_edit`/`can_delete` flag.
- Missing `req.user` is treated as a **programming error** (authorize mounted
  without authenticate) → AuthenticationError.

**Constants** (`backend/src/constants.js`) — mirrors DB CHECK constraints
deliberately, so a typo fails at boot rather than matching nothing:

- `MODULES`: Dashboard, Orders, Products, Categories, Pricing, Banners, Users,
  Reports, POS Integrations, Settings
- `ROLES`: owner, chain_admin, cinema_admin, kitchen_staff, cinema_accountant
- `ACTIONS`: read, edit, delete → `canRead`/`canEdit`/`canDelete`
- `ORDER_STATUSES`, `PAYMENT_STATUSES`, `ORDER_SOURCES`, `POS_PROVIDERS`
- `ERROR_CODES`: VALIDATION_ERROR, AUTHENTICATION_ERROR, TOKEN_EXPIRED,
  AUTHORIZATION_ERROR, ACCOUNT_INACTIVE, NOT_FOUND, CONFLICT, RATE_LIMITED,
  INTERNAL_ERROR, SERVICE_UNAVAILABLE
- `PAGINATION`: default page 1, default limit 20, max limit 100

**If the schema changes, constants.js must be updated in the same change.**

---

## 4. Database architecture

Microsoft SQL Server. Sequelize models in `backend/models/` (30 files, loaded by
`models/index.js`). Naming: `underscored: true` for QBusto-owned tables.

The Sequelize CLI reads `backend/config/config.js` (wired via
`backend/.sequelizerc`) — **not** `src/config/env.js`. `src/config/database.js`
relates the two. Nothing under `src/` should read DB connection settings from
`env.js`.

### QBusto-owned tables (selection)

`chains`, `cinemas`, `screens`, `categories`, `cinema_categories`, `products`,
`cinema_products`, `product_availability_hours`, `product_pricing`, `banners`,
`users`, `user_permissions`, `orders`, `order_items`, `order_status_logs`,
`payment_status_logs`, `order_statuses`, `payment_statuses`,
`idempotency_keys`, `razorpay_webhook_events`, `shows`,
`payment_gateway_config`, and the POS tables (`pos_integrations`,
`screen_pos_mappings`, `product_pos_mappings`, `order_pos_context`,
`pos_transactions`).

### Client-owned tables

`film`, `session`, `screen_layout` — see §7.

### Notable schema facts

- `users.password` is a **write-only virtual attribute**; a hook hashes it into
  `password_hash`. It was never a column.
- `cinemas.code` carries `UQ_cinemas_code`, which the client's
  `FK_Session_cinemas` depends on.
- `order_items` has **no** `created_at`/`updated_at` (`timestamps: false`).
- `orders.razorpay_order_id` has a **filtered UNIQUE index**
  (`WHERE razorpay_order_id IS NOT NULL`).
- `payment_status_logs` is **append-only** (`updatedAt: false`).

---

## 5. Migrations

32 files in `backend/migrations/`, timestamp-ordered:

- `20260809000100`–`20260809002600` — the original schema: statuses, chains,
  cinemas, users, permissions, screens, categories, products, pricing, banners,
  orders, order items, status logs, POS tables, payment gateway config,
  idempotency keys.
- `20260813000100-create-shows.js`
- `20260817000100-create-razorpay-webhook-events.js`
- `20260817000200-unique-order-razorpay-order-id.js`
- `20260823001000-align-client-naming.js` ← recent alignment work
- `20260824000100-provision-client-schema.js` ← recent alignment work

### `20260823001000-align-client-naming.js`

**Renames only.** Not one row inserted/updated/deleted/moved; no type,
nullability, key, index or constraint change.

| From | To |
| --- | --- |
| `Film` (table) | `film` |
| `Session` (table) | `session` |
| `screens.Category` | `screens.category` |
| `screens.SeatRow` | `screens.seat_row` |
| `screen_layout.ScreenName` | `screen_name` |
| `screen_layout.Category` | `category` |
| `screen_layout.SeatRow` | `seat_row` |
| `screen_layout.SeatNo` | `seat_no` |

**Deliberately NOT changed:** provider columns inside `film`/`session`
(`Film_strCode`, `Session_lngSessionId`, `Session_dtmRealShow`, …). Those names
are the source system's contract; renaming them would break the mapping the
client syncs against.

Uses `sp_rename` so every row, key, index, default and FK survives in place.
Constraint names (`FK_Session_Film`, `PK_Film`, `PK_Session`,
`DF_Film_Film_dtmStamp`) are independent of the table name and keep working.
Each rename is guarded by an existence check, so the migration is re-runnable.

### `20260824000100-provision-client-schema.js`

Creates `film`, `session`, `screen_layout`, `screens.category` and
`screens.seat_row` **only when absent**.

Why: those objects reached the dev database only because the client's `.bak` was
restored into it. No migration ever created them, so a database provisioned from
this repo's migrations alone (fresh install, CI, disaster recovery) would be 5
objects short of what the models declare, and every Film/Session/Screen query
would fail with "Invalid object name".

- Not a schema change — reproduces the client's exact DDL (same table names,
  provider column names, types, nullability, keys).
- `film`/`session` DDL comes from client-supplied CREATE TABLE scripts,
  reproduced verbatim including named constraints (`PK_Film`, `PK_Session`,
  `DF_Film_Film_dtmStamp`, `DF_Session_Session_dtmStamp`, `FK_Session_Film`,
  `FK_Session_cinemas`).
- `screen_layout` constraints are left **unnamed**, matching the client's copy
  (whose constraints carry SQL Server auto-generated hash names).
- Every step is guarded → running against the client's database is a **verified
  no-op** (0 rows, 0 objects changed).
- `film` is created before `session` (FK dependency).

`down()` is deliberately conservative:
- `session`/`film` dropped **only if empty**; `session` first (holds the FK).
- `screens.category`/`seat_row` dropped **only if every value is NULL**.
- `screen_layout` is **never auto-dropped**, even when empty — an empty table
  can't be distinguished between "this migration created it" and "the client
  supplied it empty", and the second case is real.
- Anything it declines to remove is logged via `console.warn`, not raised.

### Seeders

Only two, in `backend/seeders/`:
- `20260809010000-seed-order-statuses.js`
- `20260809010100-seed-payment-statuses.js`

They load **status master data only** — no user account. Nothing can log in
until a user is created (`backend/scripts/create-dev-user.js`, or
`seed-dev-data.js` for a fuller development dataset).

Historical note: `SequelizeMeta` on the client's database once lagged the repo
by 3 migrations. Older `films`/`sessions` migrations that created
**QBusto-owned duplicates** of the client's tables were **removed** rather than
applied; `20260824000100` supersedes them.

---

## 6. Orders

### Two creation paths, one schema

**Staff:** `POST /api/orders` — authenticated, `Orders:edit` →
`order.controller.create` → `order.service.createOrder`.

**Consumer:** `POST /api/consumer/orders` — **unauthenticated**, requires an
`Idempotency-Key` header (UUID v4) → `consumer.controller.createOrder` →
`consumer.service.createOrder`. The key is stored in `idempotency_keys`; a
resubmission returns the original order rather than creating a second. The race
is handled by catching `SequelizeUniqueConstraintError` on the key insert. The
frontend derives the key from an `orderFingerprint()` of the payload
(`consumer/src/services/orders.service.ts`, `utils/checkoutSession.ts`).

Both paths build order lines **server-side** from `Product`/`CinemaProduct`/
`ProductPricing` — the client sends only `productId` + `quantity`; price,
discount and total are computed. Both then, in **one Sequelize transaction**,
create the `orders` row, `order_items`, and the opening `order_status_logs` +
`payment_status_logs` rows.

A new order **always** starts `initiated` / `pending`. No client-supplied status
is ever accepted.

### Order snapshots

History must stay accurate when the catalogue changes:
- `order_items` freezes `productName`, `unitPrice`, `discount`, `total`.
- `orders` freezes `filmTitle` and `showTime` (provider-neutral display
  snapshots).

### `orders` columns (payment/identity relevant)

`cinema_id`, `screen_id` (nullable — counter/kiosk orders may not be
screen-specific), `seat_number` (e.g. "A5"), `status_id`, `source`
(`qr`/`seat_qr`/`kiosk`/`counter`), `customer_mobile`, `customer_email`,
`film_title`, `show_time`, `subtotal`, `discount`, `total` (all
`DECIMAL(10,2)`, CHECK `>= 0`), `payment_status_id`, `sms_status`,
`whatsapp_status` (each `pending`/`success`/`failed`, independent, NULL = not
applicable), `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`,
`notes`, `delivered_at`.

**`razorpay_signature` exists in the schema and model but is never written by
any code path** — the signature is verified transiently, not persisted.

### Status enums

`order_statuses.code`: `initiated`, `confirmed`, `preparing`, `ready`,
`delivered`, `rejected`.

Legal graph (`fulfilment.service.js`):
```
initiated  → confirmed | rejected
confirmed  → preparing | rejected
preparing  → ready     | rejected
ready      → delivered | rejected
delivered / rejected   → terminal
```

`payment_statuses.code`: `pending`, `paid`, `failed`, `refunded`.

Graph (`order.service.js`):
```
pending  → paid | failed
failed   → pending | paid
paid     → refunded
refunded → terminal
```

---

## 7. Films, Sessions, Screens (client-owned)

**The most surprising area of the repo, and absent from README.md.**

`film` and `session` are the **client's own Vista tables**, living in the QBusto
database. They are not QBusto tables and are not reshaped. Their columns keep
the source system's names because the client syncs against them; the Sequelize
models supply QBusto vocabulary purely through `field:` mappings.

### `film` (`backend/models/film.js`)

- Table `film`; **`timestamps: false`** (the table has only `Film_dtmStamp`).
- PK `code` ← `Film_strCode` **varchar(20)** — not an integer id of ours.
- Mapped: `title`←`Film_strTitle`, `certification`←`Film_strCensor`,
  `durationMinutes`←`Film_intDuration`, `imageUrl`←`Film_strURLforGraphic`,
  `status`←`Film_strStatus`, `nowShowingFlag`←`Film_strNowShowingFlag`,
  `openingDate`←`Film_dtmOpeningDate`.
- Only the columns QBusto needs are declared; ~30 others stay in the table,
  unread. The table also carries a stray `test_column nchar(1000)` (client test
  debris).
- `status` and `nowShowingFlag` are **passed through raw** — the client has not
  defined their vocabulary, and guessing which codes mean "active" would invent
  a rule.
- `Film.hasMany(Session)` on `filmCode`/`code`.

### `session` (`backend/models/session.js`)

- Table `session`; **`timestamps: false`**.
- **Composite PK** `(Code, Session_lngSessionId)` → `cinemaCode` + `sessionId`.
- `cinemaCode` FKs to **`cinemas.code`**, not `cinemas.id` — hence
  `Session.belongsTo(Cinema, { targetKey: 'code' })`.
- Mapped: `filmCode`, `screenNumber`←`Screen_bytNum`,
  `screenName`←`Screen_strName`, `startsAt`←`Session_dtmRealShow`,
  `endsAt`←`Session_dtmFinishShow`, `seatsAvailable`, `seatsTotal`, `status`.
- **There is no `screens.id` here.** The source system identifies the auditorium
  by number/name, so resolving a session to a QBusto screen is a lookup, not a
  join — and it is currently ambiguous because `screens` holds several rows per
  auditorium. Both columns are exposed as-is; **no resolution is attempted.**

### Session status values (client-defined, confirmed)

| Value | Meaning | Behaviour |
| --- | --- | --- |
| `O` | **Open** — selling | The only status a customer may order against |
| `C` | **Closed** — no longer selling | Excluded |
| `I` | **Inactive** — not in service | Excluded |

`SESSION_STATUS_OPEN = 'O'` in `consumer.service.js`. The exclusion is a **SQL
predicate**, not a step in the response mapping — so a non-Open session never
leaves the database. It cannot be bypassed by a client and cannot be lost to a
later refactor of the response shape.

### Consumer session picker (`getSessions`)

- `PROGRAMMING_DAY_START_HOUR = 6` — the programming day runs **06:00 → 06:00**,
  so a 01:00 screening belongs to the night before. Matches the client's own
  scheduling query.
- Window starts at **now**, not the start of the day: a screening already under
  way is not something food can be ordered against.
- Before 06:00, the running programming day started yesterday, so the window
  still closes at 06:00 today.
- `SESSIONS_PER_SCREEN = 2` — capped **per auditorium**, so one busy screen
  can't fill the picker and hide the others.
- Returns `screenName` **as text**; no screen id is derived (see grain conflict).
- Film join is `required: true`.

### Film/Session API surface

`film.routes.js` and `session.routes.js` expose **GET only**, guarded by
`authorize(MODULES.SETTINGS, ACTIONS.READ)`. There is no create/update/delete —
this data is the client's.

Dashboard has `FilmsPage.tsx` and `SessionsPage.tsx`.

### `screens` grain conflict — UNRESOLVED

QBusto's design: **one `screens` row = one auditorium**. `orders.screen_id` is a
FK to it, and screen names are unique within a cinema (enforced in
`screen.service.assertNameAvailable`, not by the database).

The client's data: **one row per seat row** — ~82 rows across ~27 distinct
(cinema, screen name) pairs, with:
- `screens.category` `nvarchar(50)` NULL — a **seat class** ("Platinum",
  "Recliner"), free text, not a screen class. The same auditorium carries more
  than one.
- `screens.seat_row` `nvarchar(2)` NULL — a **seat-row label** ("A".."N"), not a
  count. Two characters, so "AA" is possible. Matches the row half of
  `orders.seat_number` (e.g. "A5") and the consumer's `ROW_PATTERN`
  `/^[A-Za-z]{1,2}$/`.

Worked example: cinema 8 "Screen 1" occupies 10 rows — Platinum for rows A–I,
Recliner for row J.

This is a **semantic conflict, not an additive change**. Under the client's
grain there are ten "Screen 1" rows and it is undefined which one an order
should reference; `ScreenSelect` shows ten identical options; the name-uniqueness
rule breaks. **Blocked pending client clarification. Do not build on it.**

The two columns are now declared on `models/screen.js` (both nullable — rows
predating them carry NULL; the 21 originally seeded screens are the NULL ones).

### `screen_layout` (`backend/models/screenlayout.js`)

The client's **seat map**: one row per physical seat.
`id`, `cinema_id`, `screen_name`, `category`, `seat_row`, `seat_no` (text —
seat numbering is not always numeric), `is_active`, `created_by`, `updated_by`,
`created_at`, `updated_at`. FKs to `cinemas` and `users`.

- Identifies a screen by **`screen_name` text, not `screens.id`** — a
  normalisation weakness, left exactly as the client built it. Resolving the
  name is the reader's job, not something to fix by redesigning the table.
- **Currently empty (0 rows).**
- **Nothing in the application reads it.** QBusto neither sells nor allocates
  seats. The model exists so the table is reachable and covered by schema
  verification rather than sitting outside the application's view of the DB.

---

## 8. Payments — Cashfree implementation (migrated from Razorpay)

**Migration complete.** QBusto ran on Razorpay through August 2026, then
migrated fully to Cashfree; Razorpay is no longer integrated anywhere in the
codebase. `razorpay` was dropped from `package.json` and replaced with
`cashfree-pg` (official SDK, server-side only — no frontend npm package).
Node's built-in `crypto` is still used throughout for the webhook HMAC.

The provider-agnostic core — `applyPaidTransition`, `fulfilmentService.
confirmOnPayment`, `order.service.js`'s `PAYMENT_TRANSITIONS` + staff
`updatePaymentStatus`, and the entire `consumer/src/utils/paymentState.ts`
phase state machine — survived the migration **unchanged**, exactly as
predicted before the migration began. That is why the migration was tractable:
the payment *architecture* (three discovery paths converging on one CAS) is
provider-agnostic by design; only the provider-specific edges (order/session
creation, signature verification, webhook shape) had to be rewritten.

### Why Cashfree was chosen over Easebuzz / PayU

Evaluated against **this** codebase, not on generic merit, before implementing:

| Concern | Razorpay (previous) | Cashfree (current) | Easebuzz | PayU |
| --- | --- | --- | --- | --- |
| Init | `orders.create()` → order id | `orders.create()` → `payment_session_id` | Initiate Payment API → `access_key` | No server create; hash built locally |
| Frontend | opaque token `{key, order_id}` | opaque token `{paymentSessionId}` | opaque `access_key` | **full field set client-side** |
| Verify | 2 ids, SHA-256, no PII | server-to-server lookup, **no browser credential at all** | SHA-512 over PII + product text | SHA-512 over PII + product text |
| Webhook auth | header HMAC, raw body | header HMAC (`x-webhook-signature` + `x-webhook-timestamp`, HMAC-SHA256 over `timestamp+rawBody`, base64) | hash **inside** payload | hash **inside** payload |
| Idempotency | our own header | native `x-idempotency-key` | manual | manual |
| Reconciliation | `orders.fetchPayments` | `PGOrderFetchPayments` | Transaction API v1/v2.1 | Verify Payment API |
| Official Node SDK | yes | **yes (`cashfree-pg`)** | none found | none found |
| UPI Intent | native | native (+ dynamic QR) | native | **not in base checkout flow** |

Decisive points that held up through implementation:
1. **Header-based webhook HMAC over the raw body** ⇒ the existing
   `express.raw()` route mounting and `timingSafeEqual` pattern survived
   unchanged. Easebuzz/PayU put the signature *inside* the form payload, which
   would have forced ripping out the raw-body middleware.
2. **Opaque token handoff to the widget** ⇒ `PaymentPage.tsx` kept its shape;
   no customer PII or product text is marshalled into the browser or hashed.
   Cashfree's hosted checkout goes further than Razorpay's did: it hands the
   browser **no cryptographic credential at all**, so `payment-verify` takes
   nothing from the request body — it asks Cashfree directly, server-to-server.
3. **Official maintained Node SDK** ⇒ no hand-rolled HTTP client + hash logic.
4. Native idempotency key matches the pattern already used for order creation.

Industry note (unchanged since the decision): UPI Collect is being deprecated
(NPCI, ~Feb 2026) — this affects all providers equally, not Cashfree
specifically. UPI Intent (mobile) and UPI QR (desktop) are prioritised.

### Endpoints

```
POST /api/consumer/orders                                    (Idempotency-Key required)
POST /api/consumer/cinemas/:cinemaId/coupons/validate         (read-only preview, no order created)
POST /api/consumer/orders/:orderId/payment-init              (idempotent)
POST /api/consumer/orders/:orderId/payment-verify             (idempotent)
POST /api/webhooks/cashfree                                   (raw body, HMAC-authed, no JWT)
PUT  /api/orders/:id/payment-status                           (staff only)
GET/PUT/DELETE /api/payment-gateway-config                    (staff, Settings module - per-cinema Cashfree credentials)
GET/POST/PUT/DELETE /api/offers                                (staff, Offers module - coupons)
```

**POST-REVERT ADDITIONS (2026-08-25), superseding parts of §8.6/§8.13 below as
written:** two things were added on the same day as the Cashfree migration
work, described in full in their own new subsections (§8.14, §8.15) rather
than rewriting every paragraph below in place:

1. **Per-cinema Cashfree credentials** (§8.14) — `payment_gateway_config` is
   no longer "unused" (§8.13 below says otherwise; that line is now wrong).
2. **Coupons** (§8.15) — a pure-QBusto coupon system. An EARLIER version of
   this tried mirroring coupons into Cashfree's own offer system
   (`order_meta.offer_filters`, `CASHFREE_APPROVED_OFFER_CODES`, the whole
   "offer handling" paragraph in §8.6 below) and was **deliberately
   reverted** before ever reaching production — §8.6's offer-matching
   paragraph documents a design that no longer exists in the code. Left in
   place below, marked, rather than deleted outright: it is a real design
   that was tried, tested live, and rejected for a specific reason (a third
   party deciding what a customer owed), which is itself worth remembering.

### 8.1 Money units — the one thing that differs mechanically from Razorpay

QBusto still works in integer paise everywhere internally. Cashfree's API,
unlike Razorpay's, works in **rupees as a decimal** (`order_amount: 250.00`,
not `25000`). The conversion is confined entirely to
`backend/src/services/cashfree.client.js`: `toRupees()` on the way out,
`rupeesToPaise()` (rounds, not truncates — IEEE 754 float drift) on the way
back in. Nothing above that module ever sees a rupee float; every comparison
elsewhere is integer paise against integer paise.

### 8.2 `payment-init`

1. Load order; 404 if missing; **409 ConflictError** if
   `paymentStatus.code !== 'pending'`.
2. If `order.gatewayOrderId` is already set → idempotent short-circuit, but
   **first** runs `reconcilePaymentFromGateway(order)` (§8.6).
3. Otherwise calls `cashfree.client.createOrder()`, which:
   - builds a **deterministic** gateway order id, `qbusto_order_<orderId>`
     (not random — see below)
   - calls `PGCreateOrder` with `x-idempotency-key` set to that same
     deterministic id, so a create retried after a network timeout returns the
     original order rather than making a second one
   - sets `order_meta.notify_url`/`return_url` from `env.cashfree.notifyUrl`/
     `returnUrl`, only if configured (both optional)
4. Persists via **compare-and-set**:
   ```js
   Order.update({ gatewayOrderId }, { where: { id: orderId, gatewayOrderId: null } })
   ```
5. **Duplicate-order handling is provider-specific and non-obvious**: Cashfree
   signals "this gateway order already exists" **two different ways** —
   a plain `409`, and (verified against the live sandbox) a **`422` with
   `type: "idempotency_error"`** when the `x-idempotency-key` is reused.
   `isDuplicateOrderError()` treats both as "adopt the existing gateway order",
   never as a failure.
6. Cashfree unreachable/timeout → `Error('Cashfree API unavailable')` →
   controller maps to **ServiceUnavailableError (503)**.

Response exposes `orderId`, `gatewayOrderId`, `paymentSessionId` (short-lived;
**never stored**, always re-fetched), `amount` (paise), `currency`. There is no
key/secret to ever expose — Cashfree's hosted checkout issues no client-side
credential.

### 8.3 Checkout (frontend)

- `@cashfreepayments/cashfree-js`'s `loadCashfree({ mode })` — **not** a CDN
  `<script>` tag. `mode` comes from the **`payment-init` response**, not from
  the build: the backend resolves it from that cinema's own
  `payment_gateway_config.environment` (`cashfree.client.resolveCheckoutMode`,
  collapsing the column's four accepted words onto the SDK's two) and returns
  it alongside the session it was issued for. Unrecognised, absent, or a
  cinema with no active row all fall back to `sandbox` — an unknown value must
  never be the one that takes real money.
  The SDK is therefore loaded AFTER `payment-init` returns rather than on
  mount, which costs one serialised script fetch and buys the guarantee that
  session and mode always describe the same environment.
  This replaced a build-time `VITE_CASHFREE_MODE`, now **removed**. It was a
  second independent source for a fact the backend already knew: one build
  carried one mode while environment is per-cinema, so a deployment whose
  cinemas differed could only satisfy some of them, and any mismatch made the
  SDK reject the session id with no error the customer could act on.
- `payment-init` is called automatically on mount, once.
- On "Pay": `cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' })`
  — stays in-page as a modal in the normal case; the SDK only navigates away
  (`result.redirect`) for browsers that can't host the modal (in-app browsers).
- **A `PaymentAttempt` is written to `sessionStorage` BEFORE `checkout()` opens**
  (`consumer/src/utils/paymentAttempt.ts`) — survives a reload/crash mid-payment
  and prevents a double charge. Unlike the Razorpay attempt record, **no
  payment credential is stored** — Cashfree hands the browser none, so there is
  nothing to keep and nothing that could be replayed. Phases are just
  `opened | returned` (no `rejected` — there is no browser-held signature that
  could be permanently refused).

### 8.4 Frontend callbacks

- **On `checkout()` resolving:** phase → `returned`, then `payment-verify` is
  called (it takes no identity from the request — see §8.5). Success clears the
  attempt and navigates to `/confirmation/:orderId`.
- **`result.redirect` (SDK left the modal):** phase → `unresolved`, "Continuing
  your payment. Please do not pay again." — the attempt is preserved, not
  cleared.
- **PENDING at the gateway (the HIGH-severity fix, see §22 for context):**
  `payment-verify`'s 409 carries `details.gatewayPending`. `true` (a UPI
  collect not yet approved/declined) → phase `unresolved`, attempt **preserved**,
  Pay button structurally unrenderable (`unresolved` is absent from
  `MAY_START_NEW_PAYMENT`). `false` (every attempt reached a terminal
  non-success) → safe to clear and retry.
- **Recovery:** on mount, a stored attempt triggers `resolveAttempt()` before
  anything else. A "Check payment status" button and an `online` listener
  re-trigger it manually/on reconnect.
- **State machine** (`consumer/src/utils/paymentState.ts`) — **unchanged by the
  migration, confirmed provider-agnostic**: phases `idle | initializing | ready
  | opening | verifying | unresolved | confirmed | rejected | failed |
  cancelled | error`. `TRANSITIONS.verifying` includes `failed` (a fix made
  during the migration — cancelling checkout was leaving the screen stuck on
  the spinner with no controls before that). Stale/out-of-order responses are
  dropped by `attemptId` comparison.

### 8.5 `payment-verify` (backend)

Deliberately takes **nothing** from the request body — Cashfree's hosted
checkout gives the browser no cryptographic credential, so anything a client
supplied would be an unverifiable assertion. The request means only "my
checkout finished, please look."

1. 404 if order missing. **400** if `order.gatewayOrderId` is null (verify
   called before init ever ran).
2. Already `paid` → return success immediately (idempotent short-circuit).
3. Not `pending` → **409** `{paymentStatus}`.
4. Otherwise calls `reconcilePaymentFromGateway(order)` (§8.6) and maps its
   `{settled, reachable, gatewayPending}` result:
   - `settled` → 200, paid.
   - `!reachable` → **503** — "could not confirm with the provider, please
     retry." Deliberately **not** a 409: the caller must not treat "unknown" as
     "unpaid".
   - otherwise → **409** with `{paymentStatus: 'pending', gatewayPending}`.

### 8.6 Reconciliation

`reconcilePaymentFromGateway(order)` — triggered from inside `paymentInit`
(when an order already has a `gatewayOrderId`) and from `paymentVerify`.
**There is still no cron or poller** — same as the Razorpay implementation.

- Calls `cashfree.client.fetchOrderPayments()` (`PGOrderFetchPayments`,
  server-to-server), bounded by `CASHFREE_TIMEOUT_MS` (default 4000ms).
- A payment settles the order when `status === 'SUCCESS'` **and** currency
  matches (or is absent) **and** `amountPaise === toPaise(order.total)`
  **exactly, with no exceptions.** Integer paise both sides — Cashfree's
  rupee decimal is converted on the way in. `order.total` already reflects
  any coupon a customer applied (§8.15) — computed and subtracted entirely
  within QBusto before `payment-init` ever ran — so there is no second,
  gateway-side reason a payment could legitimately fall short; anything short
  of `expectedPaise` is refused as a mismatch, full stop.
- **[SUPERSEDED - kept for history, does not describe current code] Offer
  handling (added after a Cashfree sandbox demo offer,
  `testRetoolTPAPUPIoffer`/code `abcd15`, was found configured nowhere in the
  merchant's own Offers dashboard yet still redeemable at checkout).**
  `cashfree.client.fetchOrderPayments()` also returns each payment's
  `offers: [{offerCode, redemptionStatus, discountAmountPaise}]`, read from
  `PGOrderFetchPayments`'s `payment_offers[].offer_meta.offer_code` /
  `.offer_redemption.{redemption_status,discount_amount}` — **verified against
  a live sandbox response**, not assumed. `approvedOfferDiscountPaise(payment)`
  sums only offers with `redemptionStatus === 'SUCCESS'` **and** whose
  `offerCode` is in `env.cashfree.approvedOfferCodes` (a `Set` built once at
  boot from `CASHFREE_APPROVED_OFFER_CODES`, default empty — so by default NO
  offer is trusted and behaviour is unchanged from before offers were
  handled). The exact-amount match is checked FIRST and unconditionally: a
  payment already equal to the expected amount settles on that alone, so an
  offer redemption attached to it (even an approved one) is never applied.
  When an approved offer's discount is what closes the gap,
  `orders.discount`/`orders.total` are updated (via `toDecimalString`) to
  match what was actually collected, inside the same transaction as
  `applyPaidTransition` — `total` keeps meaning "what this order is worth";
  `subtotal` is untouched. The reason string on the resulting
  `payment_status_logs` row names the discount for audit.
  **Deliberately NOT extended to the webhook path**: the official `cashfree-pg`
  SDK's documented webhook `payment_offers` shape (flat `redemption_amount`/
  `offer_status`, no `offer_redemption` sub-object) **disagrees with** the REST
  shape actually observed live — the two API surfaces are inconsistent with
  each other, and only the REST shape has been directly verified, so offer
  matching only runs where that verified shape is used. A payment settled only
  via an approved offer and only ever confirmed by webhook (no browser
  return, no later `payment-init`/`payment-verify` retry) would not be
  recognised until reconciliation runs some other way — a known, accepted gap,
  not an oversight. **[END SUPERSEDED SECTION]** This entire design -
  `env.cashfree.approvedOfferCodes`, `CASHFREE_APPROVED_OFFER_CODES`,
  `approvedOfferDiscountPaise()`, the `offers` field on
  `fetchOrderPayments()`'s return shape - was removed in the revert of
  2026-08-25. See §8.15.
- **If nothing settled**, checks whether **any** attempt is `PENDING` —
  deliberately **not** amount-filtered, because an attempt Cashfree hasn't
  finished deciding may not carry a final amount yet, and the safe reading of
  any outstanding attempt is "do not invite a second payment." This is what
  `gatewayPending` reports to the caller.
- On any error (network, timeout, credentials) → logs a warning (message only,
  never payload/credentials), returns `{settled: false, reachable: false,
  gatewayPending: false}` — no claim is made about a pending attempt either,
  since the provider could not be asked.

### 8.7 Webhook

`POST /api/webhooks/cashfree`, mounted in `app.js` **before** the global
`express.json()`, using `express.raw({ type: '*/*', limit: '1mb' })` scoped to
this route — this matters *more* for Cashfree than it did for Razorpay: Cashfree
signs decimal amounts as sent (`170.00`), and a parse/re-serialise round trip
would turn that into `170`, breaking every signature. No `authenticate()`/
`authorize()` — the HMAC **is** the auth. Not behind the `/api` rate limiter.

- Headers read: `x-webhook-signature`, `x-webhook-timestamp` (**not optional**
  — unlike Razorpay's event-id header, the timestamp is part of the signed
  material, so without it no signature can be computed at all).
- **[UPDATED]** The controller now calls `webhookService.verifyIncomingWebhook(rawBody,
  signature, timestamp)`, which resolves WHICH cinema's secret to check
  against before calling `verifyWebhookSignature()` below - see §8.14 for the
  per-cinema resolution mechanism this added. `verifyWebhookSignature` itself
  is otherwise unchanged: signed payload is
  `timestamp + rawBody` **concatenated**, `HMAC-SHA256(secretKey, signedPayload)`
  encoded **base64** (not hex), compared with `crypto.timingSafeEqual` after a
  length check. **Three differences from Razorpay, each of which silently
  breaks verification if the old code were reused naively:** timestamp is
  signed material not just a header; digest is base64 not hex; the key is the
  API **secret key** — there is no separate webhook secret with Cashfree.
- **Timestamp freshness**: rejected if more than 15 minutes (`
  MAX_TIMESTAMP_SKEW_SECONDS`) old — turns the signature into a time-limited
  credential, so a delivery captured off the wire cannot be replayed later.
- **Events:**
  - `SUCCESS_EVENTS = ['PAYMENT_SUCCESS_WEBHOOK']` → drive `pending → paid`.
  - `INFORMATIONAL_EVENTS = ['PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK']`
    → recorded for audit/dedup but **never mutate order state** — same rule as
    Razorpay's `payment.failed` handling, now covering two events instead of one.
  - Anything else → `ignored` / `unsubscribed_event`.
- **Idempotency:** durable key = `${event}:${cfPaymentId || gatewayOrderId}`
  (Cashfree sends no dedicated event-id header, unlike Razorpay). Fast
  pre-check via `findOne`, but the real guarantee is the DB `UNIQUE` constraint
  on `event_id` — a concurrent duplicate insert throws
  `SequelizeUniqueConstraintError`, mapped to `outcome: ignored, reason:
  duplicate_event`. Verified live: 5 concurrent identical deliveries produce
  exactly 1 `applied` and 4 `ignored`.
- Amount/currency validated against the order (integer paise) before applying;
  a mismatch is logged at `error` and **ignored, never applied**. An unknown
  gateway order id is recorded and ignored (also verified live).
- **Response codes:** 400 = unverifiable/refused; 200 = verified and decided
  (applied / duplicate / permanently ignored); **5xx = transient (DB failure)
  so Cashfree retries**. A router-scoped body-parser error handler maps
  oversized/malformed raw bodies to 4xx to avoid a wrongly-signalled "retry me".

### 8.8 The payment transition seam — the core invariant (unchanged)

`backend/src/services/paymenttransition.service.js` →
`applyPaidTransition({ orderId, gatewayPaymentId, reason }, transaction)` — only
a parameter rename from the Razorpay version (`razorpayPaymentId` →
`gatewayPaymentId`); the compare-and-set logic itself was not touched.

```js
Order.update(
  { paymentStatusId: paidStatusId, ...(gatewayPaymentId && { gatewayPaymentId }) },
  { where: { id: orderId, paymentStatusId: pendingStatusId }, transaction }
)
```

Called by the same **three independent discovery paths** as before — browser
`payment-verify`, the webhook, and reconciliation. `rowsUpdated !== 1` → `{
transitioned: false }`, a normal outcome for the loser of a race. Only the
winner writes the `payment_status_logs` row and reaches the post-payment seam,
`fulfilmentService.confirmOnPayment` — **exactly one kitchen ticket regardless
of which source discovered the payment first**, verified live under 5-way
concurrent webhook delivery and concurrent `payment-verify` calls with no
duplicate log rows in either case.

Staff transitions still use the separate `order.service.updatePaymentStatus`
(`PUT /api/orders/:id/payment-status`), following `PAYMENT_TRANSITIONS`, also a
CAS, also calling `confirmOnPayment`. **This endpoint never accepts a
`gatewayPaymentId` and never touches gateway columns.**

### 8.9 Idempotency summary

| Concern | Mechanism |
| --- | --- |
| Duplicate order creation | `Idempotency-Key` header + `idempotency_keys` unique table |
| Duplicate gateway order | CAS on `gateway_order_id IS NULL` + **filtered UNIQUE index**, plus Cashfree's own `x-idempotency-key` on the deterministic order id |
| Repeat `payment-init` | Returns/adopts the same gateway order, no side effects |
| Repeat `payment-verify` | Already-`paid` short-circuit |
| Duplicate webhook | `payment_webhook_events.event_id` **UNIQUE** |
| Duplicate transition | The single shared CAS in `applyPaidTransition` |

### 8.10 Failed / abandoned / retry / PENDING

- **Provider failure:** webhook records an audit row only; **no gateway signal
  ever sets `paymentStatus` to `failed`** — staff-only, unchanged from Razorpay.
- **PENDING (new state Razorpay's model didn't surface the same way):** a UPI
  collect the customer has not approved yet is neither paid nor refusable.
  `gatewayPending: true` is the signal that stops the frontend from offering a
  second payment while one is genuinely still in flight — the HIGH-severity gap
  found in the adversarial payment-flow review (an in-flight UPI attempt being
  treated as safely retryable) and fixed by adding this flag end-to-end.
- **"Paid but never returns"** (closed tab, dead browser): the webhook +
  reconciliation exist to close this, same as before. **Depends on
  `CASHFREE_NOTIFY_URL` being set or an equivalent webhook being registered
  directly in the Cashfree Dashboard** — confirmed empty in this environment's
  `.env` during the adversarial test; see §17 (production requirements).
- **No expiry/cron job exists anywhere** — unchanged.
- **Retry:** supported on the same order; `payment-init` called again returns/
  adopts the same gateway order (idempotent, deterministic id). There is still
  **no** support for a second gateway order on the same QBusto order.

### 8.11 Refunds

**Unchanged: no refund gateway integration exists.** `refunded` is terminal,
reachable only from `paid`, settable only via the staff endpoint, a pure DB
status change. A refund must be issued manually in the Cashfree Dashboard.

### 8.12 Error handling

- Cashfree unreachable/timeout → **503 ServiceUnavailableError** (both
  `payment-init` and `payment-verify`).
- Reconciliation errors → fully swallowed, logged, `{reachable: false}` returned.
- No signature-verification-failure case exists on the browser side any more —
  there is no browser-held credential to fail verification, so
  `isSignatureVerificationFailure()` was removed from `formatApiError.ts`, along
  with `types/razorpay.d.ts`.
- Not-pending → **409** with object-shaped `details {orderId, paymentStatus,
  gatewayPending}`, read by `readConflictPaymentStatus()`/
  `isGatewayPaymentPending()`. Still the only way the consumer app learns "was
  this order already paid" — there is no `GET /consumer/orders/{id}` endpoint.
- Webhook: signature/parse/shape → 400 (no DB writes); DB/transaction failure →
  rethrown → 5xx so Cashfree retries.

### 8.13 Payment-related tables (renamed, not redesigned)

A rename-only migration, `20260825000100-rename-payment-columns-provider-
neutral.js`, moved the schema off Razorpay-specific names via `sp_rename` —
**applied to the live database and verified**. Two SQL Server quirks it had to
navigate: unqualified `sp_rename` source names fail with error 15225
(schema-qualify as `dbo.x`), and a filtered index predicate blocks a column
rename outright with an **empty** error message (drop the index before
renaming, recreate it after).

A follow-up migration, `20260825000200-rename-payment-webhook-events-
constraints.js`, closed a gap that migration left: `sp_rename` on a *table*
does not cascade to rename that table's SQL-Server-auto-generated PK/UQ/FK
constraint names, which still embedded the old table name
(`PK__razorpay__...`, `UQ__razorpay__...`, `FK__razorpay___order__...`) even
after `razorpay_webhook_events` became `payment_webhook_events`. Renamed to
`PK_payment_webhook_events`, `UQ_payment_webhook_events_event_id`,
`FK_payment_webhook_events_order_id` — confirmed via a live catalog query that
zero database objects anywhere in the schema still contain "razorpay" in their
name. One more SQL Server quirk found here: a table-owned constraint renames
with a **two-part** name (`schema.constraint_name`), not the three-part form
(`schema.table.constraint_name`) that columns and indexes use — the three-part
form fails outright with "Either the parameter @objname is ambiguous or the
claimed @objtype (OBJECT) is wrong."

**`payment_webhook_events`** (renamed from `razorpay_webhook_events`) —
durable audit + dedup ledger: `id`, `event_id` **VARCHAR(64) UNIQUE**, `event`
VARCHAR(50), `gateway_order_id` (nullable, renamed from `razorpay_order_id`),
`gateway_payment_id` (nullable, renamed from `razorpay_payment_id`), `order_id`
(nullable FK → orders, `NO ACTION`), `outcome` (`received|applied|ignored`),
`reason` VARCHAR(60), timestamps.

**`orders`** — `gateway_order_id`, `gateway_payment_id`, `gateway_signature`
(renamed from `razorpay_order_id`/`razorpay_payment_id`/`razorpay_signature`).
`gateway_signature` is present in the schema and model but **never written** —
kept because dropping a column is destructive and the rename migration is
rename-only by design. The filtered unique index is now
`UX_orders_gateway_order_id`.

**`payment_status_logs`** — append-only: `gateway_payment_id` (renamed from
`razorpay_payment_id`), otherwise unchanged.

`payment_gateway_config` table existed from the original client schema,
unused at the time this paragraph was written; it is **no longer unused** -
see §8.14. It gained an `environment` column
(`20260825000500-add-environment-to-payment-gateway-config.js`) alongside its
original `gateway_id`/`gateway_secret_encrypted`/`gateway_url` (still
genuinely unused) columns.

`offers` (new table, `20260825000300-create-offers.js`) and `orders.offer_id`
(new nullable FK, `20260825000600-revert-cashfree-offer-sync.js`) back the
coupon system - see §8.15.

### 8.14 Per-cinema Cashfree credentials

Cashfree `APP_ID`/`SECRET_KEY` stopped being a single global env-var pair.
Each cinema may run its own Cashfree merchant account, one **active** row per
cinema in `payment_gateway_config` (filtered unique index
`UQ_payment_gateway_config_active_cinema`, from the table's original
migration - the constraint predates this feature but was exactly what made
this design possible without a new migration for the uniqueness rule
itself).

- **Encryption**: `gateway_secret_encrypted` is AES-256-GCM ciphertext
  (`backend/src/utils/credentials.js`) - IV (12 bytes) + auth tag (16 bytes,
  GCM's own) + ciphertext, concatenated and base64-encoded in one column. The
  key, `CREDENTIALS_ENCRYPTION_KEY` (64 hex chars / 32 bytes, Joi-validated,
  boot throws in production if missing), lives **outside the database** -
  server config only, never a DB column, never logged. This was an explicit
  user decision made mid-build: the user's first answer to "how should
  credentials be stored" was "plaintext"; on discovering this table already
  had a `gateway_secret_encrypted` column with a pre-existing comment
  ("Ciphertext only. The encryption key lives outside the database") from the
  original schema, the question was re-raised and the user chose encryption,
  confirming explicitly: "we will follow encryption and not store plain
  text."
- **Resolution** (`cashfree.client.resolveCredentials(cinemaId)`): that
  cinema's active `payment_gateway_config` row, and nothing else. No row, or a
  row whose secret will not decrypt, throws `Cashfree is not configured for
  this cinema`, logged at `warn` (`cinemaId` included, never the credential),
  and payment-init answers 503. There is no env fallback behind it. `getClientForCinema()` builds a fresh `Cashfree` SDK instance
  per call rather than caching one - deliberately, since a cached client
  built from a since-rotated secret would keep authenticating with the old
  one until the process restarted, and constructing the SDK object is cheap.
- **Webhook signature verification is the hard case**: which secret to check
  a delivery against depends on which cinema it is about, which is not
  knowable until the body is read - but the body cannot be trusted until the
  signature verifies. Solved by `readUnverifiedGatewayOrderId()`: reads ONLY
  `data.order.order_id` out of the **unverified** raw body, used purely as a
  lookup key to find the QBusto order (and therefore cinema) it claims to be
  about - never trusted as fact. An attacker gains nothing by forging this
  field: they still cannot produce a valid signature without that specific
  cinema's secret. If the order is not found at all (genuinely unknown
  `order_id`), `resolveSigningSecret()` falls back to the global env secret
  directly (not via `resolveCredentials`, which requires a resolved cinema)
  so the legitimate "record as `unknown_gateway_order`, return 200" case
  still works instead of becoming an unconditional "unverifiable, 400".
- **Auth-error handling**: Cashfree's 401/403 (a wrong or revoked credential
  for the resolved cinema) is classified by `cashfree.client.isAuthError()`
  and folded into the same clean 503 a not-configured cinema gets, rather
  than leaking a raw provider stack trace to a customer-facing endpoint. Added
  after live-testing a corrupted DB secret and observing exactly that leak (a
  bare 500 with the full Axios error and stack, since a 401 matched neither
  `isTransientError` (5xx-only) nor `isDuplicateOrderError`).
- **Dashboard**: `Cinemas → (cinema) → Payment gateway` section in
  `CinemaDetailsDrawer.tsx` - status (`hasSecret`, `environment`,
  `gatewayId`), "Set up credentials"/"Replace credentials" (`Settings:edit`)
  opening `CinemaPaymentGatewayModal.tsx`, "Deactivate" (`Settings:delete`).
  There is no "edit in place" - every save is a full replace (old row
  deactivated, new one created), matching the backend's own model; `secretKey`
  is write-only end to end and never appears in any response.
- Live-verified: DB precedence over env fallback proven by temporarily
  corrupting cinema 1's stored secret (real Cashfree 401), confirming
  `payment-init` failed cleanly (503) rather than silently succeeding via a
  matching env fallback, then restoring it and confirming success resumed.
  The env-fallback path itself was verified against a cinema with no
  `payment_gateway_config` row at all.

### 8.15 Coupons - pure QBusto, no Cashfree involvement

**THE PIVOT.** An earlier version of this session's work tried mirroring
QBusto coupons into Cashfree's own offer system (`order_meta.offer_filters`
as an ALLOW list at `payment-init`, `CASHFREE_APPROVED_OFFER_CODES` /
`offers.cashfree_offer_id` at reconciliation - §8.6's superseded paragraph).
The user's explicit instruction reversed this completely: "WE ARE NOT
LETTING ANY COUPONS APPLY ON CASHFREE WE ARE REVERTING TO THE STRICT ARCH WE
HAD BEFORE" - while explicitly keeping the per-cinema credentials work
(§8.14): "but we have to keep the different id and secret key per cinema in
our db as we were doing we just have to revert the changes we did for
handling coupons in cashfree."

The model now: a coupon (`offers` table, cinema-scoped, `code` unique per
cinema) is validated and its discount computed **entirely within QBusto**
(`backend/src/services/coupon.service.js`), and folded into `orders.total`
**before `payment-init` is ever called**. Cashfree has no discount/offer
concept in this flow at all - `createOrder()`'s request carries no
`offer_filters`, and reconciliation/webhook both require an exact amount
match (§8.6, corrected).

- **Consumer flow**: "Apply coupon" in `CheckoutDrawer.tsx` calls
  `POST /api/consumer/cinemas/:cinemaId/coupons/validate` (read-only preview,
  no order created - `consumer.service.validateCouponPreview`, reuses
  `buildOrderLines()` for the same authoritative subtotal order creation
  would compute) before the order exists, so the preview is guaranteed to
  match what `createOrder` actually applies a moment later for an identical
  cart. `createOrder()` itself re-validates the code server-side - never
  trusts that the preview was still valid by the time of submission.
- **`discountType` vocabulary - a documented, deliberate choice, not
  specified by the user**: `'percentage'` (case-insensitive) treats
  `discAmount` as a percent of the subtotal, capped by `maxDiscAmount` if
  set; anything else, **including `'flat'`**, is a flat rupee amount. Chosen
  specifically so a coupon created without careful thought about this field
  defaults to the less-surprising "flat" interpretation rather than silently
  computing a percentage of an unrelated magnitude. Either way, the discount
  is capped at the subtotal (`Math.max(0, Math.min(discountPaise,
  subtotalPaise))`) - a coupon can never make an order negative.
- **Validation rules** (`coupon.service.validateCoupon`): `status` must be
  `'active'` (case-insensitive); `validFrom`/`validUntil` window;
  `minTxnAmount`/`maxTxnAmount` gate eligibility against the subtotal;
  `maxTxnLimit` caps total redemptions, counted via `Order.count({ where:
  { offerId, paymentStatusId: paidStatusId } })` - **only PAID orders count**,
  so an abandoned or still-pending attempt never took the coupon's slot.
  **Known accepted race**: the limit is checked at order-creation time, not
  re-checked at payment-settlement time (recall inherently cannot be, without
  refusing to honour a payment Cashfree already actually collected - see
  `paymenttransition.service.js`'s CAS design, which settles unconditionally
  once money has moved) - two near-simultaneous checkouts can each pass the
  check before either pays, and both later pay, over-redeeming a hard
  `maxTxnLimit` by at most the number of orders racing at that instant. Not
  fixed; documented as an accepted, standard e-commerce-coupon tradeoff,
  distinct in kind from the payment-amount matching, which has zero tolerance
  by design.
- **`orders.offer_id`** (nullable FK, `NO ACTION` on delete/update) records
  which coupon an order used - set once at `createOrder`, never changed
  afterward, matching how `filmTitle`/`showTime` freeze what an order was
  actually placed against. `offer.service.deleteOffer` guards the FK at the
  application level: any order (paid or not) referencing an offer blocks a
  hard delete with a 409, not a raw DB constraint error - the operator sets
  `status: 'inactive'` on a used coupon instead.
- **The zero-total edge case, found live, not anticipated**: a flat coupon
  can discount an order down to exactly ₹0 (e.g. a flat-200 coupon against a
  ₹180 cart, capped at the subtotal). Calling Cashfree's `PGCreateOrder` with
  `order_amount: 0.00` is rejected outright (verified live: a real 400 from
  Cashfree), which without a fix left a fully-covered order permanently
  unpayable - `payment-init` returned a raw 500 and the customer was stuck.
  Fixed by short-circuiting in `paymentInit`: when `toPaise(order.total) ===
  0`, the order is settled immediately via the same `applyPaidTransition` CAS
  every other discovery path uses (so it still drives the kitchen-ticket
  side effect exactly once), with no gateway order ever created. The
  response carries `paymentStatus: 'paid'` with `gatewayOrderId`/
  `paymentSessionId` both `null` and `amount: 0`; `PaymentPage.tsx` checks
  this before checking for a session and navigates straight to confirmation,
  skipping the Pay button entirely. This became the system's **fourth**
  `applyPaidTransition` caller (browser verify, webhook, reconciliation, and
  now this).
- **Dashboard**: `Offers` tab (`OffersPage.tsx`, table + filters;
  `OfferFormModal.tsx`, field set - code, name, discountType, description,
  tnc, status, discAmount, maxDiscAmount, minTxnAmount, maxTxnAmount,
  maxTxnLimit, validFrom/validUntil). `maxDiscAmount` is shown only when
  `discountType` is `'percentage'` - meaningless for a flat coupon, which is
  already a fixed amount - and cleared automatically when switching away
  from percentage so a stale value can't be silently submitted.
  `paymentModes`/`offerCategory` were removed from BOTH the form and the
  database (`20260825000700-drop-unused-offer-fields.js`) on 2026-08-25:
  neither was ever read by any calculation, and a repository-wide search
  found nothing outside the Offers CRUD path referencing them - pure
  leftover vocabulary from the abandoned Cashfree-offer-mirroring design.
  Required adding `'Offers'` to the `UserPermissionModuleName`
  enum in `swagger.js` - it was already in the DB CHECK constraint and every
  backend `authorize()` call, but had been missed in the OpenAPI schema, so
  the generated dashboard types and `hasPermission()` could not see it until
  fixed and regenerated. `module: 'Offers'` in `dashboard/src/routes/
  modules.tsx`'s `NAV_MODULES` must match `MODULES.OFFERS` in
  `backend/src/constants.js` exactly.
- Live-verified end to end against the real Cashfree sandbox: coupon preview
  → order creation with discount applied → payment-init sending only the
  discounted amount (`order_meta.offer_filters` confirmed `null` via
  `PGFetchOrder`) → webhook settlement at the exact discounted total →
  `offerId`/redemption-count correctly recorded. The zero-total path
  separately verified: order settles to `paid`/`confirmed` with no gateway
  order created at all. Test data cleaned up after each run via direct SQL
  delete in FK-safe order.
- **Test coverage**: `tests/coupon.service.test.js` (new, 16 cases - status/
  validity window/min-max/redemption-limit/percentage-vs-flat/subtotal-cap)
  and two cases added to `tests/consumer.payment.test.js` (the zero-total
  short-circuit; the auth-error-to-503 mapping).

### 8.16 Two bugs found by an adversarial security review (2026-08-25), fixed same day

**BLOCKER - empty cart auto-confirmed as a free, zero-item paid order.**
`POST /api/consumer/orders` had NO `validate()` Joi middleware in front of it
at all - the body went straight to `consumerService.createOrder()` with only
ad-hoc checks inside the service, and `buildOrderLines()` never required a
non-empty `items` array. The endpoint's own published OpenAPI contract
already documented `items` as `required` with `minItems: 1`; nothing
enforced it. Combined with §8.15's zero-total short-circuit, an anonymous
request with `items: []` produced a ₹0 order that `payment-init` then
confirmed as `paid`/`confirmed` immediately - no payment, no auth, fully
repeatable, real kitchen-display impact. Fixed by adding
`backend/src/validators/consumer.validators.js` (new file, mirrors
`order.validators.js`'s `create.items` shape exactly:
`Joi.array().items({productId, quantity}).min(1).max(50).required()`),
wired via `validate(consumerValidators.createOrder)` on both
`POST /api/consumer/orders` and `POST /api/consumer/cinemas/:cinemaId/coupons/validate`
(same `items` concern). Controllers updated to read `req.validated.body`
instead of raw `req.body`, matching the rest of the codebase's convention.
The legitimate zero-total-via-coupon path is unaffected and still verified
working - it now simply can never be reached with zero items.

**HIGH - independently-capped discounts could sum past the subtotal.**
`pricing.service.unitDiscountPaise` caps a product/source discount at 100%
of that line (per-line, so `productDiscountPaise` can reach the full
subtotal); `coupon.service.computeDiscountPaise` separately caps a coupon's
discount at the full GROSS subtotal too. Nothing capped their SUM, so a
heavy promotional price (e.g. a QR-only 100%-off line) stacked with a
generous coupon could push `totalPaise` negative. `orders.total`'s
Sequelize-level `validate: {min: 0}` (backed by the redundant SQL CHECK
`CK_orders_total`) already made this impossible to persist - so this was
never a financial-integrity gap, only a customer-facing error-quality one:
a negative total surfaced as Sequelize's generic "Validation min on total
failed" naming a field the customer never touched. Fixed with a two-line,
call-site-only change in `consumer.service.createOrder` (coupon.service.js
itself untouched, so its 16-case test suite needed no changes):
`discountPaise = Math.min(productDiscountPaise + couponDiscountPaise, subtotalPaise)`,
plus a belt-and-suspenders `if (totalPaise < 0) throw new ValidationError(...)`
immediately after, so any future arithmetic mistake fails as a clean, named
error instead of Sequelize's generic one.

**Regression tests** (4 new cases in `tests/consumer.catalog.test.js`,
alongside the existing availability-recheck describe block): empty array
rejected with 400 before any DB call; missing `items` field rejected;
a real cart fully covered by a coupon still creates at `total: 0`
(proves the empty-cart fix didn't regress the legitimate zero-total path);
a 100%-off product discount plus a full coupon on top is clamped at the
subtotal, never negative. Full suite: 696/696 passing before this fix,
698/698 after Part 3's cinema-credentials tests were added the same day
(see §10).

---

## 9. Kitchen Display System

`kitchen/` — reads **paid** orders and walks them `confirmed → preparing →
ready → delivered`. Orders become visible only via
`fulfilment.confirmOnPayment()`. No screens/catalogue access. Backed by
`kitchen.routes.js` / `kitchen.service.js`, tested in
`backend/tests/kitchen.routes.test.js`.

## 10. Dashboard

Pages: Banners, Categories, Chains, Cinemas, ComingSoon, Dashboard, Films,
Forbidden, Login, NotFound, Offers, Orders, Pricing, Products, Screens,
Sessions, Users. Films/Sessions are read-only views over client data. Reports
and POS Integrations are `ComingSoonPage` placeholders. Offers (§8.15) is a
plain page with local `useState`, not a Zustand store like Banners/
Categories - nothing else in the Dashboard needs to read the offers list, so
a store would only add indirection. Per-cinema Cashfree credentials (§8.14)
are not a page of their own - a "Payment gateway" section inside
`CinemaDetailsDrawer.tsx`, AND (added 2026-08-25) a mandatory section inside
`CinemaFormModal.tsx` on create.

### 10.1 Cinema creation now requires Cashfree credentials (2026-08-25)

Backend investigation confirmed the payment flow already fully supported
per-cinema credentials (§8.14, built earlier the same session) - what was
missing was any way to set them AT creation time; the only path was the
separate `payment_gateway_config` endpoints, used after the fact. Extended
rather than duplicated:

- `cinema.validators.js`'s `create` schema gained `gatewayId`/`secretKey`/
  `environment`, all required, reusing the SAME Joi field definitions
  `paymentgatewayconfig.validators.js` uses for its own `setCredentials`
  schema (that file now exports the individual pieces, not just the composed
  schema, specifically so this one definition of "what a valid credential
  looks like" cannot drift into two).
- `cinema.service.createCinema` wraps `Cinema.create` and a direct
  `PaymentGatewayConfig.create` (encrypted via the same `utils/credentials.js`
  used everywhere else) in ONE `sequelize.transaction` - a cinema is either
  created payable from the start, or not created at all, never left silently
  depending on the global env fallback because a second, separate request
  happened to fail. `update` deliberately does NOT accept credential fields -
  replacing an existing cinema's credentials stays on the existing, separate
  `PUT /api/payment-gateway-config` endpoint.
- `CinemaFormModal.tsx`: create mode shows a mandatory "Payment gateway"
  section (APP ID, secret key, environment); edit mode shows the current
  credential's STATUS only (via `paymentGatewayConfig.service.getActiveConfig`)
  plus a "Replace credentials" button that opens the SAME
  `CinemaPaymentGatewayModal` the details drawer already uses - a completely
  separate save from the cinema's own fields, so editing an address never
  requires re-entering a secret. There is no "edit in place" for a secret
  that already exists, because it cannot be read back to prefill a field.
- Live-verified: created a real cinema via the API with credentials, confirmed
  `payment_gateway_config` held the encrypted row, and confirmed
  `cashfree.client.resolveCredentials(newCinemaId)` - the exact function
  `payment-init` calls - returned the correct decrypted secret, not the env
  fallback. Test cinema cleaned up after.
- Tests: 2 new cases in `tests/cinema.routes.test.js` (payment_gateway_config
  created in the same transaction with the secret encrypted, not plaintext;
  missing credentials rejected with 400 naming both fields) plus every
  existing `POST /api/cinemas` test updated to send valid credentials (a
  `CREDENTIALS_ENCRYPTION_KEY` fixed test value added at the top of the file,
  matching the pattern `consumer.payment.test.js` already used for Cashfree's
  own env vars).

### 10.2 Required-field asterisks (2026-08-25, UI only)

Every form in the Dashboard (13 of them) explicitly set `requiredMark={false}`
on its `<Form>`, which suppresses antd's automatic red asterisk in front of a
required field's label - antd derives that asterisk directly from the
field's own `rules={[{required: true, ...}]}`, so the fix was simply
removing the prop everywhere (one line per file), not writing any new
required-detection logic. Zero validation behaviour changed - this is
display-only, and the asterisk is guaranteed to match what `rules` already
says is required, nothing else. Files: `BannerFormModal`, `CategoryFormModal`,
`ChainFormModal`, `ChangePasswordModal`, `CinemaFormModal`,
`CinemaPaymentGatewayModal`, `LoginPage`, `OfferFormModal`, `PricingFormModal`,
`ProductFormModal`, `ScreenFormModal`, `AvailabilityFormModal`,
`UserFormModal`.

**Follow-up (2026-08-26): moved the asterisk from before the label to after
it, in `global.scss`.** This surfaced a genuinely non-obvious antd trap worth
remembering:

- First attempt: hide antd's own `::before` asterisk (`display: none`) and
  render a new asterisk on `::after` instead. Result: NOTHING showed, not
  even in the wrong place. Cause, found by reading antd's actual CSS-in-JS
  source (`node_modules/antd/es/form/style/index.js`), not by guessing:
  every form label ALSO uses `::after` for its own purpose - the trailing
  colon character, `content: ":"`, present UNCONDITIONALLY unless the form
  passes `colon={false}` (none of this app's forms do). Two rules wanting
  the same pseudo-element on the same element is not a "higher specificity
  wins" situation to route around - only one `::after` can exist at all, so
  the asterisk's content lost outright regardless of `!important`.
  A second wrong theory along the way: assumed the colon was suppressed by
  `layout="vertical"` and reached for `.ant-form-item-no-colon::after`
  instead - but `no-colon` is controlled by the `colon` PROP being `false`,
  not by vertical layout (vertical layout only skips stripping a trailing
  ":" character a caller typed into a string label). That class is never
  applied here either, so that attempt matched nothing and changed nothing -
  confirmed by inspecting the live DOM in the browser (the class list on the
  label was plainly just `ant-form-item-required`), not by more guessing.
- Working fix: leave `::after` (the colon) alone entirely, and instead
  reorder the EXISTING `::before` asterisk. The label is `display:
  inline-flex` (same antd source file), so `::before`/`::after` are flex
  items and obey `order` like any other child - the label's text is an
  anonymous flex item at the default `order: 0`, so `.ant-form-item-required
  ::before { order: 1; margin-inline-start: 4px; }` alone moves the
  asterisk after the text without touching what `::after` renders anywhere.
  The colon's own box was still visible SPACE between the text and the
  reordered asterisk (its `content` is real, non-zero-width, confirmed via
  the browser inspector, not assumed) even though colon isn't rendered
  as a visible ":" in this app's own screens - so
  `.ant-form-item-required::after { content: none !important; margin: 0
  !important; }` was added too, scoped to required fields only so optional
  fields' colon (never reported as a problem) is untouched.
- Lesson for next time a pseudo-element fight comes up: read the actual
  library CSS-in-JS source for the real selector and the real property
  before writing an override, and confirm the applied CLASS LIST in the
  browser's own inspector before assuming why something isn't matching -
  two different wrong theories were tried and shipped (each looking
  individually plausible) before checking the source and the live DOM
  settled it in one look.

### 10.3 Shell layout - sidebar/header no longer scroll with the table (2026-08-25)

Root cause: `.app-shell` used `min-height: 100vh` instead of a fixed
`height: 100vh`, so a tall table grew the WHOLE shell past one viewport, and
the browser's own `html`/`body` scrollbar ended up scrolling everything in
it together - sidebar and header included, since they were just earlier
siblings in that same scrolling box. Fixed in `global.scss` +
`DashboardLayout.tsx`: `.app-shell` is now `height: 100vh; overflow: hidden`;
the inner `<Layout>` wrapping Header+Content got a new `app-shell__main`
class (`display:flex; flex-direction:column; height:100vh`) so it is bounded
independently of the Sider beside it; `.app-shell__content` is
`flex:1 1 auto; min-height:0; overflow-y:auto` - `min-height:0` is the
specific flexbox trap this depended on: without it a flex child defaults to
"at least as tall as its content," which silently defeats `overflow-y:auto`
by never letting the box get short enough to need to scroll. The header's
`position:sticky` was removed as no longer needed - it now lives outside the
one scrolling region entirely, so it is always visible without any special
positioning. `Sider` gained `app-shell__sider` (`height:100vh; overflow-y:
auto`) defensively, so a longer nav list in the future scrolls internally
too rather than repeating the same bug.

### 10.4 Scrollbar theming, modal header, coupon case-sensitivity, cinema ID (2026-08-26)

Smaller follow-ups, all in `global.scss` unless noted:

- Dashboard-wide themed scrollbars (`--qb-primary-500` thumb, `--qb-page-bg`
  track, both via `scrollbar-color` for Firefox and `::-webkit-scrollbar*`
  pseudo-elements for Chromium/Safari) - deliberately UNSCOPED (not
  `.app-shell *`), because a Modal/Drawer/Select dropdown's scrollable body
  is portaled to `document.body` by antd, outside `.app-shell` in the DOM
  entirely, so a scoped rule would miss every one of them.
- The sidebar's own defensive overflow scroll (§10.3) is hidden entirely
  (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) -
  still scrollable by wheel/touch, just no visible scrollbar chrome on a
  nav rail.
- A table's own horizontal scroll stayed the OS default grey despite the
  above: antd's `table/style/index.js` sets `scrollbar-color` DIRECTLY on
  `.ant-table` using antd's own grey theme tokens, and a directly-set
  property on an element always wins over an inherited value from an
  ancestor (`html`, in this case) regardless of selector specificity.
  Fixed by restating `scrollbar-color` on `.ant-table-wrapper .ant-table`
  itself, `!important`, using `--qb-border` (not the brand orange - a subtle
  grey scrollbar was the actual ask once the default was pointed out) rather
  than `--qb-primary-500`.
- `.ant-modal-header` gained a real `border-bottom: 1px solid var(--qb-border)`
  plus `margin-bottom: 20px` (initially too tight, widened once flagged) so
  a Modal's title reads as a header instead of just the form's first line;
  `.ant-modal-title` bumped to 18px.
- `OfferFormModal.tsx`'s percentage/flat check (`isPercentage`, and the
  submit handler's `maxDiscAmount` clamp) was comparing `discountType` with
  exact-case `===`, while `coupon.service.js` and `OffersPage.tsx`'s table
  both compare case-insensitively - found in a code review, not reported by
  the user. An offer stored as anything other than exactly lowercase
  `'percentage'` had its `maxDiscAmount` field hidden in the edit form, and
  saving ANY unrelated change on that record silently nulled the field out.
  Fixed on both sides: the form's two comparisons are now
  `.toLowerCase() === 'percentage'`, and `offer.validators.js`'s
  `discountType` schema gained `.lowercase()` so every future write is
  normalised regardless of what casing a direct API call sends - closing the
  root cause, not just the symptom. Regression test:
  `tests/offer.validators.test.js` (new, 4 cases) proves both create and
  update normalise casing, and specifically that an update payload shaped
  like the fixed form now sends (unrelated field changed, mixed-case
  `discountType`, real `maxDiscAmount`) validates with `maxDiscAmount`
  intact. No Dashboard test infrastructure exists (no Vitest/Jest, zero
  component tests anywhere in the repo) to also cover the form-level fix
  directly - verified live instead (create with `"PERCENTAGE"` → stored as
  `"percentage"`, `maxDiscAmount` preserved) and cleaned up the test row.
- `CinemaDetailsDrawer.tsx` gained an `ID` row (copyable, matching `Code`'s
  own style) as the first `Descriptions.Item`, ahead of `Name` - a plain
  ask, no design decision behind it beyond matching the existing pattern.

## 11. Consumer app

Pages: Catalog, Confirmation, NotFound, Payment, Screensaver. Public and
unauthenticated. Splits a seat like "A5" into row + seat using
`ROW_PATTERN = /^[A-Za-z]{1,2}$/`.

---

## 12. OpenAPI & generated clients

```
backend route annotations
      │  cd backend && npm run gen:spec        (scripts/generate-openapi.js)
      ▼
shared/openapi.json
      │  npm run gen:api  in each frontend     (Orval)
      ▼
{consumer,dashboard,kitchen}/src/api/generated/
```

`make gen-api` runs the spec + all three clients.

**Never hand-edit** `shared/openapi.json` or anything under
`src/api/generated/`. Change an endpoint ⇒ regenerate the spec, then the
affected clients. Regenerate **once** at the end of a change, not repeatedly.

`backend/src/config/swagger.js` holds component schemas (including `Screen`,
`Film`, `Session`).

---

## 13. Image upload / storage architecture

`backend/src/services/upload.service.js`.

- Entity allowlist → permission module: `banners`→Banners, `films`→Settings,
  `categories`→Categories, `chains`→Settings, `products`→Products. This is the
  **only** source of directory names, so a caller can never introduce a folder
  and `..`/absolute paths can never reach `path.join`.
- multer uses **memory storage** — nothing reaches disk until the bytes are
  validated. Writing first would leave a window where an unvalidated file exists
  under a served directory.
- Accepted by **magic-number signature**: JPEG, PNG, GIF, WebP. The extension
  and browser MIME type are attacker-controlled and both untrusted; the stored
  extension is derived from the detected signature.
- **SVG is deliberately excluded** — it is XML, can carry script, and serving it
  from the application origin would be a stored-XSS vector.
- Filename = `crypto.randomBytes(16).toString('hex')` + detected extension,
  written with flag `wx` (fails rather than truncating). Carries nothing from
  the upload — kills collisions, traversal and "innocuous name, nasty content"
  in one step.
- DB stores the **application path** `/uploads/<entity>/<file>` in the **same
  VARCHAR(500) column as external URLs** — both are valid values, one field, no
  second column, no discriminator, no migration.
- `parseLocalUpload()` uses a strict regex
  `^\/uploads\/([a-z]+)\/([a-f0-9]{32}\.(?:jpg|png|gif|webp))$` so a crafted
  value can never reach the filesystem. Anything else is treated as external and
  left alone — including a URL merely *containing* `/uploads/`.
- Deletion never fails the surrounding request; a missing file is not an error
  (an orphan on disk is recoverable, a failed save is visible to the user).
- `shared/` is the one shared storage location — `openapi.json` beside
  `uploads/`. `FILE_STORAGE_PATH` (default `shared/uploads`) is resolved once,
  absolutely, against the repo root. `openapi.json` is unaffected by it.

---

## 15. Environment configuration

`backend/src/config/env.js` — Joi-validated, **throws at boot** on bad config,
exports a frozen object. Everything reads from here, not `process.env`.

**The Razorpay-era `process.env` inconsistency no longer exists.** Every
Cashfree value is read through `env.cashfree.*` — `cashfree.client.js` and
`paymentwebhook.service.js` both import `../config/env` and never touch
`process.env` directly.

Variables: `NODE_ENV`, `PORT` (4000), `API_BASE_URL`; `DB_HOST`, `DB_PORT`
(1433), `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`,
`DB_TRUST_SERVER_CERTIFICATE`; `JWT_SECRET` (**≥32 chars enforced in
production**, warned below that in development), `JWT_EXPIRES_IN` (1d),
`JWT_ISSUER` (qbusto); `CORS_ALLOWED_ORIGINS`, `CORS_ALLOW_CREDENTIALS`;
`LOG_LEVEL`, `LOG_DIR`; `RATE_LIMIT_WINDOW_MS` (15 min), `RATE_LIMIT_MAX` (300);
`SWAGGER_ENABLED`; `FILE_STORAGE_PATH`, `MAX_UPLOAD_SIZE_MB` (5, max 50);
`CASHFREE_NOTIFY_URL` (optional), `CASHFREE_RETURN_URL` (optional),
`CASHFREE_FALLBACK_CUSTOMER_PHONE` (default `9999999999`),
`CASHFREE_TIMEOUT_MS` (default 4000, max 30000).
`CREDENTIALS_ENCRYPTION_KEY` (64 hex chars / 32 bytes, required - encrypts
`payment_gateway_config.gateway_secret_encrypted`, see §8.14).

**There are NO Cashfree credential env vars.** `CASHFREE_APP_ID`,
`CASHFREE_SECRET_KEY` and `CASHFREE_ENVIRONMENT` were removed: §8.14's
per-cinema `payment_gateway_config` is the only source of credentials and
environment anywhere in the system. A cinema with no active row cannot take
payments and says so at payment-init (503). The deployment-wide pair was
deliberately deleted rather than kept as a fallback — a global credential
standing in for a cinema nobody finished configuring routes that cinema's
money into another merchant account while every signal looks healthy. What
remains above is transport and call shape only; none of it can authenticate
anything. (`CASHFREE_APPROVED_OFFER_CODES`, which briefly existed during the
offer-in-Cashfree design, was removed entirely in the revert - see §8.15.)

**There is no separate webhook secret with Cashfree** — the cinema's own
secret key both authenticates API calls and is the key Cashfree signs webhooks
with. This is the biggest operational difference from Razorpay's model, where
`RAZORPAY_WEBHOOK_SECRET` was a distinct value generated per-webhook.

**There are no Cashfree boot guards, and that is deliberate.** Five of them
existed (production + missing credentials → throw; production + non-prod
environment → throw; non-production + prod environment → warn; half-configured
pair → warn; short secret → warn). All five inspected values this process no
longer holds. Credentials and environment now live in rows that change while
the process runs, so a boot-time check could only assert something it cannot
see. The equivalent failure is per-cinema instead: a cinema configured for
`test` takes no real money, visible in its Dashboard payment settings and in
the `environment` column. **This is a genuine loss of a safety net** — the
"production deploy pointed at sandbox, food goes out, no money taken" case is
no longer caught anywhere automatically.

Confirmed live during the adversarial payment-flow test: `CASHFREE_NOTIFY_URL`
and `CASHFREE_RETURN_URL` were **both empty** in this environment's `.env`.
Neither is enforced at boot (both Joi-optional), but an empty `notify_url` with
no dashboard-level webhook registered either is a real availability gap — see
§17 (production requirements).

---

## 16. Testing

Backend only. Jest + supertest, ~22 suites in `backend/tests/`:
`auth.routes`, `authenticate`, `authorize`, `availability.routes`,
`banner.routes`, `category.routes`, `chain.routes`, `cinema.routes`,
`cinemaproduct.routes`, `consumer.catalog`, `consumer.payment`,
`consumer.sessions`, `cashfree.webhook`, `jwt`, `kitchen.routes`,
`order.routes`, `pos.adapter`, `pricing.routes`, `product.routes`,
`screen.routes`, `upload.routes`, `user.routes`, plus `setup.js`.

They exercise the real Express stack — permission checks, tenant scoping,
pricing, transition rules, audit logging, and the payment race conditions.

**The frontends have no test suites** (no `test` script in any of the three).
They are verified by `npm run typecheck`, `npm run lint`, `npm run build`
(`build` runs `tsc --noEmit` first).

---

## 17. Commands

```bash
make install / setup / clean
make db-create | migrate | migrate-undo | seed
make verify-schema | healthcheck | verify
make gen-spec | gen-api | gen-api-consumer | gen-api-dashboard | gen-api-kitchen
make dev-backend | dev-consumer | dev-dashboard | dev-kitchen
make build (all three frontends)

cd backend && npm run dev | start | test | test:watch | test:coverage
                  lint | lint:fix | format | format:check
                  gen:spec | seed:dev | seed:banners
                  verify-schema | healthcheck
```

Make targets wrap the equivalent npm/sequelize-cli command; Make is a
convenience, not a requirement.

**`npm run db:migrate` does not exist.** Use `make migrate` or
`npx sequelize-cli db:migrate` from `backend/`.
(`backend/docs/client-database-changes.md` §6 still references the missing
script.)

Dev servers: consumer **5173**, dashboard **5174**, kitchen **5175**, backend
**4000**. Ports are **fixed** by `PORT` in each `.env` rather than
auto-shifting: a clash fails startup instead of quietly moving the app to an
origin the backend's CORS list would reject.

Helper scripts in `backend/scripts/`: `create-dev-user.js`, `seed-dev-data.js`,
`seed-dev-dataset.js`, `seed-dev-orders.js`, `seed-dev-banners.js`,
`generate-openapi.js`, `verify-schema.js`, `healthcheck.js`,
`inspect-legacy-schema.js`, `inspect-legacy-samples.js` (+ their JSON outputs).

---

## 17. Production requirements

- **HTTPS everywhere.** Cashfree's webhook must be reachable over HTTPS from
  Cashfree's servers, and browser payment features expect a secure context.
  Unlike Razorpay, the webhook route also requires that nothing in front of it
  (reverse proxy, CDN) re-serialises the body — Cashfree signs the raw bytes,
  decimal formatting included, and a round-trip through a JSON-aware proxy can
  break every signature.
- Explicit `CORS_ALLOWED_ORIGINS` list; a wildcard is a development convenience
  and is warned about at startup.
- `JWT_SECRET` ≥ 32 characters (enforced).
- **Every production cinema has its own active `payment_gateway_config` row,
  with `environment` set to `prod`/`production`.** There are no global
  credentials to inherit and nothing checks this at boot, so it is a manual
  pre-flight item: a cinema left on `test` takes no real money while checkout,
  webhooks and order status all look healthy, and a cinema with no row at all
  fails visibly at payment-init with a 503. **Not enforced, but required in
  practice:** either `CASHFREE_NOTIFY_URL` is set, or an
  equivalent webhook URL is registered directly in the Cashfree Dashboard
  (Developers → Webhooks) — without one of the two, a payment where the
  customer's browser never returns has no automatic settlement path.
  `CASHFREE_RETURN_URL` is genuinely optional; the Consumer recovers on its own
  via `payment-verify` regardless of how the browser returns, since the order
  id is read from `sessionStorage`, not the URL.
- `CREDENTIALS_ENCRYPTION_KEY` generated (64 hex chars / 32 bytes) and backed
  up somewhere durable, **outside the database** — every cinema's stored
  Cashfree secret is encrypted with this exact key, and losing or rotating it
  makes every one of them undecryptable.
- **No Consumer-side Cashfree configuration.** Switching a cinema between test
  and production is a change to its `payment_gateway_config.environment` row
  alone — the Consumer takes the SDK mode from the `payment-init` response, so
  there is no build-time value to keep in step and no rebuild to remember.
- Migrations and seeders applied before starting.
- `FILE_STORAGE_PATH` set to a directory **outside the application directory**,
  created, writable by the service account, and **added to the backup
  schedule**. Staff-uploaded images live only there — a redeploy replacing the
  application directory would otherwise delete them, and the database holds only
  the path, never the file.
- Frontends bake `VITE_API_URL` in at **build time** — repointing a deployment
  at a different backend requires a **rebuild**.
- Serve frontend bundles with an `index.html` fallback so client-side routes
  resolve on direct visit or refresh.
- The repository includes **no** process manager, container definition,
  reverse-proxy config or CI pipeline.

---

## 18. POS architecture (deferred)

`backend/src/pos/` — `adapter.js` (contract + `assertPosAdapter`),
`providerRegistry.js`, `posErrors.js`, `externalShow.js`.

A `Map` from `pos_integrations.provider` → adapter. Chosen over a factory or
base-class hierarchy deliberately (`docs/pos-integration.md` §5); architecture
rules forbid adding layers without demonstrated need.

- **The registry is empty.** `getAdapter()` throws
  `PosProviderNotSupportedError` for every provider.
- **Database support ≠ application support.** `pos_integrations.provider`
  accepts `vista`, `showbizz`, `impact`, `qbusto`. **Note the double-z in
  `showbizz`** — it is what the frozen CHECK constraint contains and the
  application must not "correct" it. None has an adapter.
- Failing loudly is the point: an integration row that quietly synced nothing
  would look, from the Dashboard and the consumer dropdown, exactly like a
  cinema with no shows scheduled.
- Two failure cases are distinguished because they need different fixes:
  unknown provider value (bad data / schema change not mirrored into
  `constants.js`) vs known value with no adapter (phase not done).
- Error messages deliberately **do not enumerate providers** —
  `AppError.message` is returned to the client verbatim.
- `registerAdapter` rejects duplicate registration, so behaviour never depends on
  `require` order. `unregisterAdapter` exists **only** for test cleanup.
- **No route or service reads or writes a POS table.** `shows` is still empty.
- `providerRegistry.js` is the **only** place in the backend that reads the
  provider value; adding Vista/Showbizz later must not require an edit above
  that line.

Deferred: POS integration with Vista and Showbizz. Reports and POS Integrations
are Dashboard navigation placeholders.

---

## 19. README.md drift (verified)

Confirmed **outdated or incomplete** in README.md:

1. **No mention of `film` / `session` / `screen_layout` at all** — the entire
   client-owned data area, the `O`/`C`/`I` session vocabulary, the read-only
   Film/Session API, and the Dashboard Films/Sessions pages are absent. Largest
   gap.
2. **No mention of the `screens` grain conflict** or the `category`/`seat_row`
   columns — an unresolved architectural blocker.
3. ~~Architecture diagram and technology table named Razorpay only~~ —
   corrected in the same documentation pass that added this file; both now name
   Cashfree.
4. **No mention of `db_export/`** (`qbusto.bak`, `qbusto.sql`).
5. **Undocumented scripts:** `create-dev-user.js`, `seed-dev-dataset.js`,
   `seed-dev-orders.js`, `seed-dev-banners.js`, the two `inspect-legacy-*.js`.
6. **README embeds a development username and password in plain text** — not
   reproduced here; worth removing from README.
7. Claims about seeders and Make targets are **accurate** and were verified.
8. "Automated tests currently cover the backend / frontends have no suites" is
   **accurate**.

Also inconsistent: `backend/docs/client-database-changes.md` is an explicitly
point-in-time audit. Its §8/§10 instructions are **superseded** by the two
alignment migrations (a status note at its top says so), and its §6 reference to
`npm run db:migrate` names a script that does not exist.

---

## 20. Pitfalls & conventions

1. Never hand-edit `shared/openapi.json` or `src/api/generated/**`.
2. Never add a QBusto-owned `films`/`sessions` table — `film`/`session` are
   canonical. Earlier duplicating migrations were removed on purpose.
3. Never rename provider columns inside `film`/`session`.
4. Don't assume one `screens` row = one auditorium.
5. Never let a gateway signal set payment status `failed` — staff-only.
6. Never route the webhook through `express.json()` — it needs the raw body for
   HMAC verification.
7. Never bypass `applyPaidTransition()` for a `pending → paid` move.
8. Out-of-scope resource ⇒ **404, not 403**.
9. `make migrate`, not `npm run db:migrate`.
10. Rebuild frontends to change `VITE_API_URL`.
11. Update `constants.js` and the DB CHECK constraint together.
12. Client sends only `productId` + `quantity`; never trust client-side prices.
13. `showbizz` has two z's — do not "fix" it.
14. Regenerate the API contract once at the end of a change, not per-edit.
15. `SVG` uploads are rejected by design.
16. `env.js` is the config boundary — don't read `process.env` in new code. The
    Razorpay-era exception (`consumer.service.js` reading `RAZORPAY_KEY_ID`/
    `RAZORPAY_KEY_SECRET` directly) no longer exists; every Cashfree value goes
    through `env.cashfree.*` with no exceptions.
17. Never give Cashfree any role in a coupon/discount decision — no
    `order_meta.offer_filters`, no "short payment matches a known discount"
    branch anywhere in reconciliation or the webhook. QBusto computes the
    discount and subtracts it before `payment-init`; Cashfree only ever sees
    the final amount. Tried the other way once (§8.6's superseded paragraph),
    reverted deliberately — see §8.15.
18. Never store a payment gateway secret in plaintext, and don't add a second
    column/table it could live in — `payment_gateway_config
    .gateway_secret_encrypted`, encrypted via `utils/credentials.js`, is the
    only one. `CREDENTIALS_ENCRYPTION_KEY` lives outside the database.
19. A payment amount of exactly zero cannot be sent to Cashfree's
    `PGCreateOrder` (rejected with a 400, verified live) — a fully-covered
    coupon order must be settled by `payment-init` itself, not passed
    through to the gateway at all. See §8.15's zero-total note.

---

## 21. Unverified / open questions

- **`screens` grain** — one row per auditorium or per seat row? Blocking;
  `orders.screen_id` semantics depend on it.
- Why do `category`/`seat_row` sit on `screens` when `screen_layout` already has
  both plus `seat_no`? Staging area, or is `screen_layout` the destination?
- Will `screen_layout` be populated, and by what? It links by `screen_name` text
  rather than `screens.id`.
- Is `category` a controlled vocabulary (only "Platinum"/"Recliner" observed) or
  free text? Currently modelled as free text.
- Can `seat_row` exceed one character? The column allows two.
- `Film.test_column nchar(1000)` — appears to be client test debris.
- Are the Vista `film`/`session` tables permanent residents of the QBusto
  database, or a staging copy for a future POS sync?
- `Film_strStatus` / `Film_strNowShowingFlag` vocabularies remain **undefined by
  the client** and are passed through raw.
- Cashfree operational unknowns that remain even after implementation and live
  sandbox testing: whether a dashboard-level webhook is registered for the
  *production* account (sandbox and production have separate webhook configs);
  whether pre-authorization is enabled on the account (the `authorization`
  entity on a payment is never inspected — becomes a real gap only if pre-auth
  is turned on, since an authorized-but-not-captured payment would currently
  read the same as any other non-`SUCCESS` status).
- Row counts cited in §7 come from `backend/docs/client-database-changes.md`
  (a point-in-time audit); the live database was **not** queried while writing
  this file.
