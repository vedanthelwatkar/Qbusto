# Backend Setup and Verification

> How to bring the QBusto backend up from nothing, and how to confirm it is healthy afterwards.
> Database structure itself is documented in [schema.md](./schema.md).

---

## Development setup

From the repository root:

```bash
make setup
```

`make setup` runs the whole first-time sequence in order:

1. `npm install` - installs backend dependencies
2. `npx sequelize-cli db:create` - creates the database named by `DB_NAME`
3. `npx sequelize-cli db:migrate` - applies all 27 migrations
4. `npx sequelize-cli db:seed:all` - loads the status master data
5. `npm run verify-schema` - confirms the Sequelize layer is sound
6. `npm run healthcheck` - confirms the deployment is ready

Before running it, copy `.env.example` to `.env` and fill in real values. `make setup` will fail at step 2 if the database credentials are wrong, and at step 6 if `JWT_SECRET` or `PORT` are missing.

To install dependencies only, without touching the database:

```bash
cd backend && npm install
```

---

## Database

These targets are for when you already have a working install and want to drive the database directly.

| Command | What it does |
| ------- | ------------ |
| `make db-create` | Creates the database named by `DB_NAME`. Safe to re-run; no-ops if it exists. |
| `make migrate` | Applies any migrations not yet recorded in `SequelizeMeta`. |
| `make migrate-undo` | Rolls back the single most recent migration. |
| `make seed` | Inserts the `order_statuses` and `payment_statuses` master rows. |

Migrations are timestamp-ordered to match real foreign-key dependency order, so `make migrate` on an empty database always succeeds in one pass.

`make seed` is not idempotent - running it twice inserts duplicate status rows, which the unique index on `code` will reject. Seed once per fresh database.

---

## Verification

Two scripts, with deliberately different scopes.

| Command | Scope |
| ------- | ----- |
| `npm run verify-schema` | The Sequelize layer - models, associations, initialization |
| `npm run healthcheck` | The deployment - connectivity, migrations, seed data, environment, server version |
| `make verify` | Both, in that order |

Both exit `0` on success and `1` on failure, so they drop straight into CI or a deploy gate.

### verify-schema

```bash
cd backend && npm run verify-schema
```

Verifies:

- **Sequelize initialization** - the connection authenticates, and every model is bound to the same sequelize instance with a resolved table name and a non-empty attribute set
- **Models** - every file under `models/` loaded through `models/index.js`; each is printed as it is checked
- **Associations** - every association registered by a model's `static associate(models)` resolves to a model that is itself loaded, and any model declaring `associate()` actually registered at least one

Then prints totals for models and associations.

It does **not** query the live database structure. A passing `verify-schema` means the code is internally consistent, not that the database matches it.

Expected output:

```
✓ Connected to SQL Server

Models:
  ✓ banners
  ✓ categories
  ...

✓ Associations loaded successfully

Models:       26
Associations: 120
```

**When to use it:** after `make migrate`, after adding or editing a model, and after any change to associations. It is the fast check - it catches a typo'd alias or a model that failed to load before you find out through a confusing runtime error.

### healthcheck

```bash
cd backend && npm run healthcheck
```

Verifies:

- **Database connectivity** - authenticates against `DB_HOST:DB_PORT/DB_NAME`
- **Migrations** - compares the files in `migrations/` against the `SequelizeMeta` table. Reports migrations that are pending, and also migrations recorded in the database but missing from disk (deployed code older than the database)
- **Seed data** - confirms `order_statuses` contains `initiated, confirmed, preparing, ready, delivered, rejected` and `payment_statuses` contains `pending, paid, failed, refunded`
- **Environment variables** - `PORT`; `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; `JWT_SECRET`. When Razorpay is enabled it also requires `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- **SQL Server version** - reported for the record; an unreadable version does not fail the run

Every check runs even when an earlier one failed, so one run reports everything that is wrong rather than making you fix problems one at a time. Checks that need a live connection are reported as skipped-and-failed when the connection is down.

Expected output:

```
✓ Database connected
✓ Migrations up to date (27 applied)
✓ Seed data present
✓ Environment variables valid
✓ SQL Server version: 17.0.1000.7 (RTM, Standard Developer Edition (64-bit))

Healthcheck passed.
```

**Razorpay detection:** if `RAZORPAY_ENABLED` is set, it is honoured directly (`true`/`false`). If it is absent, Razorpay counts as enabled when any `RAZORPAY_*` variable is non-empty - so a half-configured integration is caught rather than silently skipped.

**When to use it:** after deploying to any environment, before pointing traffic at it, and as a post-deploy gate in CI. Also use it when the app misbehaves on startup - it distinguishes "database unreachable" from "migrations not run" from "environment variable missing" in a single run.

---

## API contract

The OpenAPI document is generated from the JSDoc `@openapi` blocks on the route files, and the dashboard's API client is generated from that document. Neither is written by hand.

```bash
cd backend   && npm run gen:spec   # route JSDoc -> shared/openapi.json
cd dashboard && npm run gen:api    # shared/openapi.json -> src/api/generated/
```

Run both after adding or changing an endpoint. `gen:spec` prints the number of paths it wrote, which is the quickest confirmation that a new route was picked up; if a route is missing from the count, its `@openapi` block is malformed rather than absent from the router.

`dashboard/src/api/generated/` is never edited directly. When the generated contract is wrong, the fix belongs in the route documentation.

### Resource map

Business endpoints live under `/api`. Note the ownership chain in the catalog:

```
/api/auth/login, /logout, /me, /change-password

/api/chains -> /api/cinemas -> /api/screens

/api/categories -> /api/products
                     -> /api/cinema-products        (product carried at a cinema)
                          -> /api/product-availability-hours   (when it is orderable there)

/api/product-pricing   (keyed on cinema + product + day, not on cinema-products)
/api/banners
/api/users

/api/orders -> /api/order-statuses, /api/payment-statuses

/api/consumer/*        (public, unauthenticated: catalog, order create, payment)
```

Not yet built: reports, POS integrations and settings, though their tables exist.
POS integration has no endpoint yet. Its `shows` table (B1) and its provider
adapter boundary in `src/pos/` (B2) exist; no provider adapter is registered and
nothing synchronizes. See [pos-integration.md](./pos-integration.md) and the
phase tracker in [../phases.md](../phases.md).

`/api/cinema-products` is what makes availability addressable: a window is attached to a `cinemaProductId`, and that id is resolved by listing `/api/cinema-products?cinemaId=&productId=`, which returns one row or none because the pair is unique.

---

## Choosing between them

| Situation | Command |
| --------- | ------- |
| Just edited a model or an association | `npm run verify-schema` |
| Just ran `make migrate` | `npm run verify-schema` |
| Just added or changed a route | `npm run gen:spec` then `gen:api` |
| Just deployed to staging or production | `npm run healthcheck` |
| App fails to start and you want the cause | `npm run healthcheck` |
| Fresh clone, setting up locally | `make setup` (runs both) |
| Pre-merge or post-deploy CI gate | `make verify` |

Rule of thumb: `verify-schema` answers *"is the code consistent?"*, `healthcheck` answers *"is this environment ready to serve traffic?"*.
