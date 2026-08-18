# QBusto — Cinema Food Ordering & Management Platform

A multi-tenant platform for cinema chains to run in-seat and lobby food
ordering, with role-based management for staff and a kitchen order board for
fulfilment. It is designed to run on-premise, replacing the legacy Vista
PopExpress workflow.

---

## Applications

| Directory | Application | Description |
| --- | --- | --- |
| [`backend/`](./backend) | API server | Express and Sequelize against SQL Server. The source of truth for authorisation, validation, tenant isolation, pricing, orders and payments. |
| [`consumer/`](./consumer) | Customer ordering app | Public, unauthenticated. A guest scans a QR code, browses the catalogue, orders and pays. |
| [`dashboard/`](./dashboard) | Management dashboard | Staff administration of catalogue, pricing, banners, users and orders. |
| [`kitchen/`](./kitchen) | Kitchen Display System | Wall-mounted board showing paid orders through preparation to hand-over. |
| [`shared/`](./shared) | Shared contract | `openapi.json`, generated from the backend and consumed by all three frontends. |

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
                        Razorpay
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

---

## Technology

| Layer | Technology |
| --- | --- |
| Backend | Node.js, Express, Sequelize, Joi, JWT, Winston |
| Database | Microsoft SQL Server |
| Consumer | React, TypeScript, Vite, Zustand, React Hook Form, Zod, Sass |
| Dashboard | React, TypeScript, Vite, Ant Design, Zustand, Sass |
| Kitchen | React, TypeScript, Vite, Zustand, Sass |
| API client | Orval, generated from OpenAPI |
| Payments | Razorpay |
| Testing | Jest, supertest (backend) |

---

## Prerequisites

- Node.js LTS
- Microsoft SQL Server (Express edition is sufficient for development)
- A Razorpay account if payment features are required
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
   fill in the database credentials, a JWT secret, and Razorpay keys if
   payments are needed. Every variable is documented in that file.

3. **Create the database and load the schema:**

   ```bash
   make db-create
   make migrate
   make seed
   ```

   The seeders load the order and payment status master data, which the
   application requires in order to run.

4. **Configure each frontend.** Copy the `.env.example` in `consumer/`,
   `dashboard/` and `kitchen/` to `.env` and set `VITE_API_URL` to the
   backend's origin.

5. **Run the applications**, each in its own terminal:

   ```bash
   make dev-backend
   make dev-consumer
   make dev-dashboard
   make dev-kitchen
   ```

   Each frontend runs on its own fixed port, so all three can run at once:

   | Application | Dev URL |
   | --- | --- |
   | Consumer | http://localhost:5173 |
   | Dashboard | http://localhost:5174 |
   | Kitchen | http://localhost:5175 |

   The port is set by `PORT` in each app's `.env` and is fixed rather than
   auto-shifting: if it is already in use the server fails to start instead of
   quietly moving elsewhere, which would put the app on an origin the backend
   does not allow.

   The backend must be running before any frontend is useful, and its
   `CORS_ALLOWED_ORIGINS` must list the frontend origins you are using. The
   defaults in `backend/.env.example` already cover all three ports.

---

## Make targets

| Target | Purpose |
| --- | --- |
| `make install` | Install dependencies in all four applications |
| `make setup` | First-time setup: install, create database, migrate, seed, verify |
| `make dev-backend` / `dev-consumer` / `dev-dashboard` / `dev-kitchen` | Start one dev server |
| `make build` | Production build of all three frontends |
| `make db-create` | Create the database named by `DB_NAME` |
| `make migrate` | Apply pending migrations |
| `make migrate-undo` | Roll back the most recent migration |
| `make seed` | Load master data |
| `make verify-schema` | Confirm models and associations load cleanly |
| `make healthcheck` | Report deployment readiness |
| `make verify` | Schema verification and health check together |
| `make gen-spec` | Regenerate `shared/openapi.json` from the backend |
| `make gen-api` | Regenerate the spec and all three frontend API clients |
| `make clean` | Remove build output and dependencies |

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

- Serve all applications over HTTPS. Razorpay requires an HTTPS webhook URL,
  and browser payment features expect a secure context.
- Set an explicit `CORS_ALLOWED_ORIGINS` list on the backend. A wildcard is a
  development convenience only and is warned about at startup.
- Set a `JWT_SECRET` of at least 32 characters; this is enforced in production.
- Configure `RAZORPAY_WEBHOOK_SECRET`; it is required in production.
- Apply migrations and seeders on the target database before starting.
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

Deferred: POS integration with Vista and Showbizz. The provider adapter
boundary and show synchronisation architecture exist under `backend/src/pos/`,
but the integration itself is not part of the current release. Reports and POS
Integrations appear in the Dashboard navigation as placeholders.

---

## Further documentation

| Document | Contents |
| --- | --- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Engineering conventions across the platform |
| [backend/README.md](./backend/README.md) | Backend setup, configuration and API overview |
| [backend/docs/schema.md](./backend/docs/schema.md) | Database schema |
| [backend/docs/schema-explained.md](./backend/docs/schema-explained.md) | Design rationale behind the schema |
| [consumer/README.md](./consumer/README.md) | Consumer app |
| [dashboard/README.md](./dashboard/README.md) | Dashboard |
| [kitchen/README.md](./kitchen/README.md) | Kitchen Display System |
