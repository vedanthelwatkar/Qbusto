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
POST /api/consumer/orders                          (Idempotency-Key required)
POST /api/consumer/orders/:orderId/payment-init    (idempotent)
POST /api/consumer/orders/:orderId/payment-verify  (idempotent)
POST /api/webhooks/cashfree                         (raw body, HMAC-authed, no JWT)
PUT  /api/orders/:id/payment-status                (staff only)
```

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
  `<script>` tag. `mode` is `VITE_CASHFREE_MODE` (`sandbox`|`production`),
  which **must match** the backend's `CASHFREE_ENVIRONMENT` or the session id
  is rejected by the SDK.
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
- A payment settles the order only when `status === 'SUCCESS'` **and**
  `amountPaise === toPaise(order.total)` exactly **and** currency matches (or is
  absent). Integer paise both sides — Cashfree's rupee decimal is converted on
  the way in.
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
- `verifyWebhookSignature(rawBody, signature, timestamp)`: signed payload is
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

`payment_gateway_config` table exists from the original schema, still unused.

---

## 9. Kitchen Display System

`kitchen/` — reads **paid** orders and walks them `confirmed → preparing →
ready → delivered`. Orders become visible only via
`fulfilment.confirmOnPayment()`. No screens/catalogue access. Backed by
`kitchen.routes.js` / `kitchen.service.js`, tested in
`backend/tests/kitchen.routes.test.js`.

## 10. Dashboard

Pages: Banners, Categories, Chains, Cinemas, ComingSoon, Dashboard, Films,
Forbidden, Login, NotFound, Orders, Pricing, Products, Screens, Sessions, Users.
Films/Sessions are read-only views over client data. Reports and POS
Integrations are `ComingSoonPage` placeholders.

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
`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENVIRONMENT` (`test|
sandbox|prod|production`, default `test`), `CASHFREE_NOTIFY_URL` (optional),
`CASHFREE_RETURN_URL` (optional), `CASHFREE_FALLBACK_CUSTOMER_PHONE` (default
`9999999999`), `CASHFREE_TIMEOUT_MS` (default 4000, max 30000).

**There is no separate webhook secret with Cashfree** — `CASHFREE_SECRET_KEY`
both authenticates API calls and is the key Cashfree signs webhooks with. This
is the biggest operational difference from Razorpay's model, where
`RAZORPAY_WEBHOOK_SECRET` was a distinct value generated per-webhook.

**Boot guards (each exists because the failure is otherwise silent):**

1. **production + missing `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY` → throw.**
   Without both, no payment can be taken and no webhook could be verified even
   if one were configured.
2. **production + `CASHFREE_ENVIRONMENT` not `prod`/`production` → throw.**
   Checkout works, webhooks verify, orders are marked paid, food goes out — and
   no real money is taken. Nothing downstream can detect it.
3. **non-production + `CASHFREE_ENVIRONMENT` = `prod`/`production` → warn.** A
   developer copying a production `.env` would charge real cards from their
   laptop. A warning, not a throw, because live-credential debugging is
   occasionally legitimate.
4. **only one of the credential pair set → warn.** Payments are disabled until
   both are present; failing loudly at boot beats a payment endpoint that fails
   on first use and looks like an outage.
5. **production + short `CASHFREE_SECRET_KEY` → warn.** Catches a truncated
   copy-paste without rejecting a legitimately short but valid credential.

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
- `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY` configured and `CASHFREE_ENVIRONMENT`
  set to `prod`/`production` (both enforced — boot fails otherwise). **Not
  enforced, but required in practice:** either `CASHFREE_NOTIFY_URL` is set, or
  an equivalent webhook URL is registered directly in the Cashfree Dashboard
  (Developers → Webhooks) — without one of the two, a payment where the
  customer's browser never returns has no automatic settlement path.
  `CASHFREE_RETURN_URL` is genuinely optional; the Consumer recovers on its own
  via `payment-verify` regardless of how the browser returns, since the order
  id is read from `sessionStorage`, not the URL.
- `VITE_CASHFREE_MODE` (consumer, build-time) must match `CASHFREE_ENVIRONMENT`
  (backend) — `production`/`prod` together, or the SDK rejects the session id.
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
