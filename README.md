# QBusto — Cinema Food Ordering & Management Platform

A multi-tenant platform for cinema chains to run in-seat and lobby food
ordering, with role-based management for staff and a kitchen order board for
fulfilment. It is designed to run on-premise, replacing the legacy Vista
PopExpress workflow.

---

## Applications

| Directory                   | Application            | Description                                                                                                                                  |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`backend/`](./backend)     | API server             | Express and Sequelize against SQL Server. The source of truth for authorisation, validation, tenant isolation, pricing, orders and payments. |
| [`consumer/`](./consumer)   | Customer ordering app  | Public, unauthenticated. A guest scans a QR code, browses the catalogue, orders and pays.                                                    |
| [`dashboard/`](./dashboard) | Management dashboard   | Staff administration of catalogue, pricing, banners, users and orders.                                                                       |
| [`kitchen/`](./kitchen)     | Kitchen Display System | Wall-mounted board showing paid orders through preparation to hand-over.                                                                     |
| [`shared/`](./shared)       | Shared contract        | `openapi.json`, generated from the backend and consumed by all three frontends.                                                              |

Each application has its own README with full setup and configuration details.

---

## Architecture

```
                      ┌──────────────┐
   Consumer app ─────▶│              │
   Dashboard    ─────▶│   Backend    │────▶  SQL Server
   Kitchen      ─────▶│   (Express)  │
                      └──────┬───────┘
                             │
                        Cashfree
```

The three frontends are static bundles. They hold no business rules: every
rule, permission check and calculation lives in the backend, which each client
reaches over HTTP using a generated, typed API client.

### Multi-tenancy

```
Chain → Cinema → Screen
```

Data belongs to a chain. Non-owner staff never see another chain's data, and a
resource outside the caller's scope is reported as not found rather than
forbidden.

### API contract

The OpenAPI document is generated from the backend's route annotations and is
the contract between backend and frontends:

```
backend route annotations
        │  npm run gen:spec
        ▼
shared/openapi.json
        │  npm run gen:api  (in each frontend)
        ▼
src/api/generated/
```

Generated client code is never edited by hand. When an endpoint changes,
regenerate the specification and then the affected clients.

### Shared storage

`shared/` is the one storage location the platform shares. Alongside the
generated `openapi.json` it holds uploaded images, under `shared/uploads/`
grouped by entity. Only the backend reads or writes it — the Dashboard uploads
through `POST /api/uploads/{entity}` and the Consumer and Kitchen read images
through `GET /uploads/...`, so no frontend has an upload directory of its own.

The location is configurable with `FILE_STORAGE_PATH`; on a server it is set to
a persistent, backed-up path outside the source tree. `openapi.json` is
unaffected by that setting and stays where it is.

---

## Technology

| Layer      | Technology                                                   |
| ---------- | ------------------------------------------------------------ |
| Backend    | Node.js, Express, Sequelize, Joi, JWT, Winston               |
| Database   | Microsoft SQL Server                                         |
| Consumer   | React, TypeScript, Vite, Zustand, React Hook Form, Zod, Sass |
| Dashboard  | React, TypeScript, Vite, Ant Design, Zustand, Sass           |
| Kitchen    | React, TypeScript, Vite, Zustand, Sass                       |
| API client | Orval, generated from OpenAPI                                |
| Payments   | Cashfree (Hosted Checkout, `cashfree-pg` SDK)                 |
| Testing    | Jest, supertest (backend)                                    |

---

## Prerequisites

- Node.js LTS
- Microsoft SQL Server (Express edition is sufficient for development)
- A Cashfree account if payment features are required
- GNU Make, if you want to use the convenience targets below

---

## Getting started

1. **Install dependencies for all four applications:**

   ```bash
   make install
   ```

   Without Make, run `npm install` in `backend/`, `consumer/`, `dashboard/` and
   `kitchen/`.

2. **Configure the backend.** Copy `backend/.env.example` to `backend/.env` and
   fill in the database credentials, a JWT secret, and Cashfree credentials if
   payments are needed. Every variable is documented in that file.

3. **Create the database and load the schema:**

   ```bash
   make db-create
   make migrate
   make seed
   ```

   The seeders load the order and payment status master data, which the
   application requires in order to run.

4. **Create a login.** The seeders load status master data only — no user
   account — so nothing can sign in to the Dashboard or the Kitchen display
   yet. For development:

   ```bash
   cd backend && npm run seed:dev
   ```

   This creates the owner `qbusto-admin` / `qbusto-password` together with
   sample chains, cinemas, products and pricing. **It is not for production
   use**; see [backend/README.md](./backend/README.md#creating-the-first-user)
   for the production path.

5. **Configure each frontend.** Copy the `.env.example` in `consumer/`,
   `dashboard/` and `kitchen/` to `.env` and set `VITE_API_URL` to the
   backend's origin.

6. **Run the applications**, each in its own terminal:

   ```bash
   make dev-backend
   make dev-consumer
   make dev-dashboard
   make dev-kitchen
   ```

   Each frontend runs on its own fixed port, so all three can run at once:

   | Application | Dev URL               |
   | ----------- | --------------------- |
   | Consumer    | http://localhost:5173 |
   | Dashboard   | http://localhost:5174 |
   | Kitchen     | http://localhost:5175 |

   The port is set by `PORT` in each app's `.env` and is fixed rather than
   auto-shifting: if it is already in use the server fails to start instead of
   quietly moving elsewhere, which would put the app on an origin the backend
   does not allow.

   The backend must be running before any frontend is useful, and its
   `CORS_ALLOWED_ORIGINS` must list the frontend origins you are using. The
   defaults in `backend/.env.example` already cover all three ports.

---

## Make targets

| Target                                                                | Purpose                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `make install`                                                        | Install dependencies in all four applications                     |
| `make setup`                                                          | First-time setup: install, create database, migrate, seed, verify |
| `make dev-backend` / `dev-consumer` / `dev-dashboard` / `dev-kitchen` | Start one dev server                                              |
| `make build`                                                          | Production build of all three frontends                           |
| `make db-create`                                                      | Create the database named by `DB_NAME`                            |
| `make migrate`                                                        | Apply pending migrations                                          |
| `make migrate-undo`                                                   | Roll back the most recent migration                               |
| `make seed`                                                           | Load master data                                                  |
| `make verify-schema`                                                  | Confirm models and associations load cleanly                      |
| `make healthcheck`                                                    | Report deployment readiness                                       |
| `make verify`                                                         | Schema verification and health check together                     |
| `make gen-spec`                                                       | Regenerate `shared/openapi.json` from the backend                 |
| `make gen-api`                                                        | Regenerate the spec and all three frontend API clients            |
| `make clean`                                                          | Remove build output and dependencies                              |

Every target simply runs the equivalent `npm` command inside one application,
so Make is a convenience rather than a requirement.

---

## Testing

Automated tests currently cover the backend:

```bash
cd backend && npm test
```

The suites exercise the real Express stack, asserting permission checks, tenant
scoping, pricing, transition rules and audit logging. The frontends are
verified by TypeScript and ESLint (`npm run typecheck`, `npm run lint`,
`npm run build` in each) and do not yet have automated test suites.

---

## Production notes

- Serve all applications over HTTPS. Cashfree requires an HTTPS webhook URL,
  and browser payment features expect a secure context.
- Set an explicit `CORS_ALLOWED_ORIGINS` list on the backend. A wildcard is a
  development convenience only and is warned about at startup.
- Set a `JWT_SECRET` of at least 32 characters; this is enforced in production.
- Give every cinema its own active `payment_gateway_config` row, with
  `environment` set to `prod`/`production`. There are no global Cashfree
  credentials and nothing checks this at startup, so it is a manual step: a
  cinema left on `test` collects no real money while looking entirely healthy,
  and a cinema with no row cannot take payments at all. Set
  `CREDENTIALS_ENCRYPTION_KEY` (64 hex chars) before entering any of them.
  Register a webhook URL — either `CASHFREE_NOTIFY_URL` or an
  equivalent endpoint added directly in the Cashfree Dashboard — before
  go-live, or a payment where the customer never returns to the app has no
  automatic way to settle.
- Apply migrations and seeders on the target database before starting.
- Uploaded images have one shared storage location for the whole platform,
  named by `FILE_STORAGE_PATH` and defaulting to `shared/uploads` beside the
  generated `shared/openapi.json`. Only the backend touches it; the frontends
  upload and read through its API.
- Set `FILE_STORAGE_PATH` to a directory **outside the application directory**,
  create it, give the backend service account read and write access, and add it
  to the backup schedule. Staff-uploaded images live only there — a redeploy
  that replaces the application directory would otherwise delete them, and the
  database holds only the path, never the file. See the backend README for the
  full requirements.
- The frontends bake `VITE_API_URL` in at build time, so pointing a deployment
  at a different backend requires a rebuild.
- Serve the frontend bundles with an `index.html` fallback so client-side
  routes resolve on a direct visit or refresh.

The repository does not include a process manager, container definition,
reverse-proxy configuration or CI pipeline; choose these to suit the target
environment.

---

## Project status

Implemented and in use: the backend API, the Consumer ordering and payment
flow, the Dashboard modules listed in its README, and the Kitchen Display
System.

Deferred: POS integration with Vista and Showbizz. The database tables and a
provider adapter contract exist under `backend/src/pos/`, but **no provider is
implemented and nothing in the running application uses them** — no routes, no
services, and no code path reads or writes a POS table. Reports and POS
Integrations appear in the Dashboard navigation as placeholders.

---

## Further documentation

| Document                                                               | Contents                                      |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                                   | Engineering conventions across the platform   |
| [backend/README.md](./backend/README.md)                               | Backend setup, configuration and API overview |
| [backend/docs/schema.md](./backend/docs/schema.md)                     | Database schema                               |
| [backend/docs/schema-explained.md](./backend/docs/schema-explained.md) | Design rationale behind the schema            |
| [consumer/README.md](./consumer/README.md)                             | Consumer app                                  |
| [dashboard/README.md](./dashboard/README.md)                           | Dashboard                                     |
| [kitchen/README.md](./kitchen/README.md)                               | Kitchen Display System                        |
