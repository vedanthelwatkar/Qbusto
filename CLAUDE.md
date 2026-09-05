# CLAUDE.md — QBusto

Authoritative startup context. Read this before scanning the repo.
Fuller backup copy: [memory.md](./memory.md).

> **README.md is partially outdated.** It predates the session/show-source
> work, the client-database alignment and the Cashfree decision. Where README.md and the
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
  Full detail, including which services actually have it today:
  [.claude/rules/tenancy-auth.md](./.claude/rules/tenancy-auth.md).
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
  Catalogue edits must never rewrite history. Both are read off the `session`
  row the customer picked, server-side, never from the request body.
- **Client-side prices are never trusted.** The consumer sends only
  `productId` + `quantity`; the backend computes everything.

---

## Payments & coupons

QBusto has fully migrated from Razorpay to **Cashfree**; no Razorpay code,
dependency or configuration remains anywhere. Coupons are validated and
applied **entirely within QBusto**, before `payment-init` is ever called —
Cashfree has zero involvement in discount decisions. Full architecture (the
four `applyPaidTransition()` discovery paths, webhook signature algorithm,
per-cinema credentials, coupon rules): see "Scoped rules" below —
[payments.md](./.claude/rules/payments.md) /
[coupons.md](./.claude/rules/coupons.md).

## Show data — `session` is the only source

There is exactly one table of screenings: **`session`**. No `film` table, no
`shows` table, no `session_old`, no per-provider copy — all were dropped by
`20260904000100-session-sole-show-source.js`. The film title is a column on
`session` (`Film_strName`), not a join.

```
POS provider -> adapter -> showSync.service -> session -> QBusto APIs -> apps
```

**No frontend ever calls ShowBiz, Vista or any other POS.** Provider base URLs
and credentials exist only on the backend; Consumer, Dashboard and Kitchen read
`session` through QBusto's own endpoints.

The show a customer is sitting in is chosen **by the server**: the Consumer
sends the QR's `screenId` and nothing else, and the backend matches it against
its own clock (`startsAt <= now < endsAt`). A client-supplied time is never
accepted, and the customer can still change the selection. Detail:
[client-tables.md](./.claude/rules/client-tables.md).

## Timezone — IST everywhere, storage included

**The database stores IST wall clock, not UTC.** A client requirement, and the
one place it is easy to break silently.

Two settings in `backend/config/config.js` are a **matched pair** — change one
without the other and every timestamp corrupts:

| Setting | Governs | Value |
| --- | --- | --- |
| `timezone` | **writes** (Sequelize renders the literal itself) | `'+05:30'` |
| `dialectOptions.options.useUTC` | **reads** (tedious parses the column) | `false` |

Verified against the live DB — only this pair stores IST *and* preserves the
instant; the other three combinations each break one half. `tests/
timezone.storage.test.js` pins both halves and fails if either drifts.

- `APP_TIMEZONE` (`src/config/env.js`) pins `process.env.TZ` and **refuses to
  boot** if the runtime resolves elsewhere. `useUTC:false` means "parse as
  process-local", so this is load-bearing for reads, not cosmetic.
- The client's `session` columns already stored IST and are untouched.
  `models/session.js` has **no** `asLocalWallClock` getters — the driver now
  parses them correctly, so a getter would be a *second* conversion.
- Columns stay **`datetime2(7)`**. Do not convert to `datetime`: Sequelize
  renders `DATE` as `DATETIMEOFFSET`, which `datetime` rejects outright, so
  every ORM write would fail. Type carries no timezone meaning either way.
- API responses stay ISO-8601 `Z` (an unambiguous instant); frontends render
  in `Asia/Kolkata` via each app's `utils/datetime` / kitchen `time.ts`.
- Historical rows were converted by
  `20260830000100-store-qbusto-datetimes-as-ist.js` — **not re-runnable**, see
  its header. `node scripts/tz-inventory.js` reports the current surface.

## Database & migrations

SQL Server. 43 migrations in `backend/migrations/`. Sequelize CLI reads
`backend/config/config.js` (via `.sequelizerc`), **not** `src/config/env.js`.
Seeders load **only** status master data — no user account, create one
first. Detail: [migrations.md](./.claude/rules/migrations.md).

## Generated files — never hand-edit

`shared/openapi.json` (← `npm run gen:spec`) and
`{consumer,dashboard,kitchen}/src/api/generated/**` (← `npm run gen:api`,
Orval). Change a route ⇒ regenerate spec, then all three clients
(`make gen-api` or the `/gen-api` skill), **once at the end**, not per-edit.
Detail: [generated.md](./.claude/rules/generated.md).

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

## Environment

Validated by Joi in `backend/src/config/env.js`, **throws at boot** on
misconfiguration. Read only from this module, never `process.env` directly.
Cashfree vars/boot guards: [payments.md](./.claude/rules/payments.md). Other
key vars: `DB_*`, `JWT_SECRET` (≥32 chars in prod), `CORS_ALLOWED_ORIGINS`,
`FILE_STORAGE_PATH`, `MAX_UPLOAD_SIZE_MB`. Never commit values.

## Image uploads

`POST /api/uploads/{entity}` (dashboard) → disk; read via `GET /uploads/...`.
Entity allowlist: `banners`, `categories`, `chains`, `cinemas`, `products`.
Magic-number validated, SVG rejected, random filenames, path stored in the
same column as external URLs. Detail: [uploads.md](./.claude/rules/uploads.md).

## POS — one adapter, showtimes only

`backend/src/pos/` holds the adapter contract (`adapter.js`), a registry
(`providerRegistry.js`), an error taxonomy (`posErrors.js`), the normalized
show shape (`externalShow.js`) and **one** implementation, `showbizAdapter.js`.
DB accepts `vista`, `showbizz` (double-z, matches the CHECK constraint — do
not "fix"), `impact`, `qbusto`; every provider without an adapter still throws
from `getAdapter()`.

The only thing a POS does today is supply showtimes, which `showSync.service`
normalizes into `session`. Ordering, payment and fulfilment are entirely
QBusto's. Reports remain a Dashboard placeholder.

## Scoped rules (`.claude/rules/`)

These load automatically only when a file matching their `paths:` frontmatter
enters context — they hold the detail this file used to carry in full:

| File | Loads for |
| --- | --- |
| [payments.md](./.claude/rules/payments.md) | Cashfree client/services/webhook, payment routes/controllers, per-cinema credentials, Consumer payment UI |
| [coupons.md](./.claude/rules/coupons.md) | Coupon/offer service, validators, Dashboard Offers UI, Consumer checkout |
| [client-tables.md](./.claude/rules/client-tables.md) | `session`/`screen`/`screen_layout` models, routes, services, show sync, Dashboard Sessions/Screens UI |
| [migrations.md](./.claude/rules/migrations.md) | Anything under `backend/migrations/`, `backend/config/config.js`, `.sequelizerc` |
| [tenancy-auth.md](./.claude/rules/tenancy-auth.md) | `authenticate`/`authorize` middleware, all backend services |
| [uploads.md](./.claude/rules/uploads.md) | Upload service/controller/route/middleware |
| [generated.md](./.claude/rules/generated.md) | `shared/openapi.json`, all three `src/api/generated/**` |
| [antd.md](./.claude/rules/antd.md) | Any Dashboard `.tsx` file |

Also available: three read-only review subagents in `.claude/agents/`
(`payment-invariant-auditor`, `adversarial-reviewer`, `migration-reviewer`),
and skills in `.claude/skills/` (`/gen-api`, `/verify`, `/migration`,
`/new-endpoint`, `/security-review`, `/preflight`, `/drift`).

## Pitfalls

1. Don't hand-edit generated API clients or `openapi.json`.
2. Don't add a second table of showtimes — no `films`, no `sessions`, no
   `shows`, no per-provider copy. `session` is the one source, and every
   duplicate that was tried has been dropped.
3. Don't rename provider columns inside `session`.
4. Don't assume one `screens` row = one auditorium (see grain conflict).
5. Don't let a gateway signal set payment status `failed` — that's staff-only.
6. Don't route the webhook through `express.json()`; it needs the **raw body**.
7. Don't bypass `applyPaidTransition()` for a `pending → paid` move.
8. Out-of-scope resource ⇒ **404, not 403**.
9. `make migrate`, not `npm run db:migrate` (that script doesn't exist).
10. Rebuild frontends to change `VITE_API_URL` — it's baked in at build time.
11. Don't give Cashfree any role in a coupon/discount decision — no
    `order_meta.offer_filters`, no "short payment matches a known offer"
    branch. QBusto computes the discount, subtracts it before `payment-init`,
    and Cashfree only ever sees the final amount. This was tried once and
    reverted; see [.claude/rules/coupons.md](./.claude/rules/coupons.md).
12. Don't store a Cashfree secret in plaintext, and don't add a second place
    credentials can live — `payment_gateway_config.gateway_secret_encrypted`,
    encrypted via `utils/credentials.js`, is the only column.
13. Don't let `POST /api/consumer/orders` accept an empty `items` array —
    a zero-line, zero-total order gets auto-confirmed by the same
    zero-total path a legitimately fully-discounted order uses. Enforced by
    `consumer.validators.js`, not the frontend; this was a real BLOCKER
    found live, not a hypothetical.
14. Don't set `requiredMark={false}` on a Dashboard `<Form>` — it hides
    every field's asterisk, not just the ones that shouldn't have one.
    Leave the prop off entirely and let antd derive it from `rules`.
15. Don't fight antd for a form label's `::after` — it's already used
    unconditionally for the trailing colon (`form/style/index.js`), colon
    visible or not, `layout="vertical"` or not. Only `::before` is free on
    that element; use `order` (the label is `inline-flex`) to reposition it
    instead of relocating content into `::after`. Verified live via
    `node_modules/antd/es/form/style/index.js` and the browser's own
    inspector, not assumed — see
    [.claude/rules/antd.md](./.claude/rules/antd.md) for the two wrong
    guesses that came first.

## README drift (verified against code)

- No mention of `session`/`screen_layout`, session `O`/`C`/`I`, or the
  `screens` grain conflict — the largest gap.
- Doesn't mention `db_export/`, or the `create-dev-user.js` /
  `seed-dev-*.js` scripts.
- Embeds a development username/password in plain text.
- `backend/docs/client-database-changes.md` §6 references `npm run db:migrate`,
  which **does not exist** in `backend/package.json`.
