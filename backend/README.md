# QBusto Backend

The API server behind the QBusto cinema food-ordering platform. It is the single
source of truth for authorisation, validation, tenant isolation, pricing, orders
and payments. Every client application — Consumer, Dashboard and Kitchen —
depends on it and holds no business rules of its own.

---

## Architecture

Requests flow through one path, with no additional layers:

```
Route → Controller → Service → Model (Sequelize) → SQL Server
```

- **Routes** declare HTTP concerns: method, path, middleware, OpenAPI documentation.
- **Controllers** translate between HTTP and the service layer. They stay thin.
- **Services** hold business rules and cross-entity validation.
- **Models** describe tables and associations.

```
backend/
├── config/          Sequelize CLI configuration
├── migrations/      Schema migrations, applied in order
├── models/          Sequelize models and associations
├── seeders/         Master data (order and payment statuses)
├── scripts/         Operational scripts (see "Scripts" below)
├── docs/            Schema and integration documentation
├── tests/           Jest + supertest suites
└── src/
    ├── config/      Environment validation, database, logger, Swagger
    ├── controllers/
    ├── middleware/  Authentication, authorisation, validation, error handling
    ├── pos/         POS provider adapters (Phase 2)
    ├── routes/
    ├── services/
    ├── utils/       Errors, response envelopes, JWT helpers
    └── validators/  Joi request schemas
```

### Multi-tenancy

The platform is multi-tenant. Data belongs to a chain, and cinemas and screens
hang beneath it:

```
Chain → Cinema → Screen
```

Orders carry no `chain_id` of their own, so tenant scope is applied through the
owning cinema on every query. A resource outside the caller's chain is reported
as **404**, not 403 — the API does not confirm that another tenant's records
exist.

---

## Main modules

| Area                     | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| Authentication           | Login, token issue, current user, password change              |
| Users & permissions      | Staff accounts and per-module access grants                    |
| Chains, cinemas, screens | Tenant hierarchy                                               |
| Categories & products    | Catalogue, including add-on products                           |
| Cinema products          | Which products a given cinema carries                          |
| Availability hours       | Per-cinema, per-day serving windows                            |
| Pricing                  | Per cinema, product and day of week, with per-source discounts |
| Banners                  | Cinema-specific promotional images                             |
| Orders                   | Staff-facing order listing, creation and status transitions    |
| Consumer API             | Public, unauthenticated catalogue and ordering endpoints       |
| Kitchen API              | Kitchen Display System board and fulfilment transitions        |
| Webhooks                 | Razorpay payment notifications                                 |
| POS integration          | Provider adapters and show synchronisation (Phase 2)           |

---

## Technology

- Node.js with Express 5
- Sequelize ORM against Microsoft SQL Server (`tedious` driver)
- Joi for request validation
- JSON Web Tokens for authentication, `bcrypt` for password hashing
- Winston for logging
- Helmet, CORS and `express-rate-limit` for transport hardening
- `swagger-ui-express` for API documentation
- Jest and supertest for automated tests

---

## Prerequisites

- Node.js LTS
- Microsoft SQL Server, reachable from the application host (Express edition is
  sufficient for development)
- A Razorpay account if payment features are required

---

## Installation

```bash
cd backend
npm install
cp .env.example .env      # then edit .env
```

`.env.example` documents every supported variable, its default and any
production-only requirement.

---

## Database setup

Create the database and apply the schema:

```bash
npx sequelize-cli db:create
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

The seeders load master data — the order and payment status tables — which the
application requires in order to run. Status codes are part of the API contract;
application logic addresses them by `code`, never by numeric id.

### Migration commands

```bash
npx sequelize-cli db:migrate            # apply pending migrations
npx sequelize-cli db:migrate:status     # list applied and pending migrations
npx sequelize-cli db:migrate:undo       # roll back the most recent migration
```

---

## Configuration

All environment variables are validated at startup by `src/config/env.js`. The
process refuses to boot if a required value is missing or malformed, rather than
failing later at the first request.

Required with no default: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`JWT_SECRET`.

Production-only rules enforced at startup:

- `JWT_SECRET` must be at least 32 characters.
- `RAZORPAY_WEBHOOK_SECRET` is required and must be at least 32 characters.
- A Razorpay **test** key is rejected outright.
- A Razorpay **live** key outside production produces a warning.
- `CORS_ALLOWED_ORIGINS=*` produces a warning; set an explicit origin list.

See `.env.example` for the full list.

---

## Scripts

| Command                 | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Start with nodemon and reload on change                 |
| `npm start`             | Start the server                                        |
| `npm test`              | Run the Jest suite                                      |
| `npm run test:watch`    | Run tests in watch mode                                 |
| `npm run test:coverage` | Run tests with a coverage report                        |
| `npm run lint`          | ESLint                                                  |
| `npm run lint:fix`      | ESLint with autofix                                     |
| `npm run format`        | Prettier, writing changes                               |
| `npm run format:check`  | Prettier in check mode                                  |
| `npm run gen:spec`      | Regenerate `shared/openapi.json` from route annotations |
| `npm run seed:dev`      | Load development sample data                            |
| `npm run verify-schema` | Confirm models and associations load cleanly            |
| `npm run healthcheck`   | Report deployment readiness                             |

---

## Local development

```bash
npm run dev
```

The server listens on `PORT` (default 4000). Operational endpoints:

| Endpoint       | Purpose                                   |
| -------------- | ----------------------------------------- |
| `GET /health`  | Liveness, including database connectivity |
| `GET /ready`   | Readiness                                 |
| `GET /version` | Build and version information             |

---

## Production startup

```bash
NODE_ENV=production npm start
```

Before deploying:

1. Apply migrations and seeders on the target database.
2. Set an explicit `CORS_ALLOWED_ORIGINS` list.
3. Set a `JWT_SECRET` of at least 32 characters.
4. Configure live Razorpay keys and the webhook secret if payments are enabled.
5. Consider `SWAGGER_ENABLED=false` on a publicly reachable deployment.
6. Terminate TLS in front of the application. Razorpay requires an HTTPS
   webhook URL.

The repository does not include a process manager, container definition or
reverse-proxy configuration; choose these to suit the target environment.

---

## API documentation

When `SWAGGER_ENABLED` is true, the running server serves:

- **Swagger UI** at `/api/docs`
- **OpenAPI document** at `/api/docs.json`

The specification is generated from annotations on the route files. The
generated copy at `shared/openapi.json` is the contract from which the frontend
API clients are produced:

```
route annotations → npm run gen:spec → shared/openapi.json → npm run gen:api (per frontend)
```

After changing any request or response shape, regenerate the specification and
then the affected frontend clients. Generated client code is never edited by
hand.

---

## Authentication and authorisation

Clients authenticate with `POST /api/auth/login` and send the returned token as
`Authorization: Bearer <token>` on subsequent requests. The user record and its
permissions are loaded fresh on every request, so a revoked permission or a
deactivated account takes effect immediately rather than at token expiry.

Roles are **not** a hierarchy and are never compared to one another:

`owner`, `chain_admin`, `cinema_admin`, `kitchen_staff`, `cinema_accountant`

Access is granted per module and action. Modules are:

`Dashboard`, `Orders`, `Products`, `Categories`, `Pricing`, `Banners`, `Users`,
`Reports`, `POS Integrations`, `Settings`

Each grant carries `canRead`, `canEdit` and `canDelete`. The `owner` role
bypasses the permission table entirely. Two additional rules apply to user
management: only an owner may create or promote an owner, and a user may only
grant permissions they hold themselves.

Frontend permission checks are presentation only. Authorisation is enforced
server-side on every endpoint.

---

## Payments

Razorpay is integrated for customer payments placed through the Consumer app.
The flow is:

1. The Consumer app requests payment initialisation for an order.
2. The backend creates a Razorpay order and returns its identifier.
3. The customer completes payment in the Razorpay checkout.
4. The payment is confirmed on the server.

A payment can be discovered three ways — the browser posting a signature back,
a Razorpay webhook, or reconciliation against Razorpay's records when neither
arrived. All three converge on a single transition in
`src/services/paymenttransition.service.js`, which moves the order from pending
to paid with a conditional update. Whichever source arrives first performs the
transition; the others are told it already happened. Anything that must occur
exactly once per paid order belongs at that point and nowhere else.

Payment status and fulfilment status are independent. Marking an order paid
never advances it through the kitchen workflow beyond making it eligible for
fulfilment, and the kitchen can never mark an order paid.

---

## Webhook configuration

The webhook endpoint is `POST /api/webhooks/razorpay`. It is mounted before the
JSON body parser because signature verification requires the exact raw bytes
Razorpay sent.

In the Razorpay Dashboard, under **Settings → Webhooks**:

1. Set the webhook URL to `https://<your-host>/api/webhooks/razorpay`.
2. Generate a signing secret and set it as `RAZORPAY_WEBHOOK_SECRET`.
3. Subscribe to the `payment.captured` and `payment.failed` events.

Delivery handling:

- Signatures are verified with a timing-safe comparison. An unverifiable
  request is rejected with 400.
- Every processed event is recorded, so a redelivery of the same event is
  recognised and ignored rather than applied twice.
- The endpoint acknowledges only after the transaction commits. A transient
  failure returns 5xx so Razorpay retries.

The endpoint must be reachable over HTTPS from Razorpay's servers.

---

## Testing

```bash
npm test
```

The suites exercise the real Express stack with supertest. The model layer is
mocked, so they assert the decisions the code makes — permission checks, tenant
scoping, pricing, transition rules, audit logging and transaction boundaries —
rather than the SQL it emits.

Behaviour that mocks cannot prove (constraints, indexes, join semantics,
`DECIMAL` and `DATETIME2` handling) should be verified against a real SQL Server
instance. Any temporary data created for such a check must be removed
afterwards.

---

## Further documentation

| Document                                                       | Contents                                          |
| -------------------------------------------------------------- | ------------------------------------------------- |
| [docs/schema.md](./docs/schema.md)                             | The database schema as it exists today            |
| [docs/schema-explained.md](./docs/schema-explained.md)         | Why the schema is shaped the way it is            |
| [docs/schema.dbml](./docs/schema.dbml)                         | Schema in DBML form, for diagram tools            |
