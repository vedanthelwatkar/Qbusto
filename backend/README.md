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
    ├── pos/         POS adapter contract, unused in this release (Phase 2)
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
| Availability hours       | Per-cinema, per-day serving windows, overnight windows allowed  |
| Pricing                  | One row per cinema/product, seven day prices, each with its own discount |
| Banners                  | Cinema-specific promotional images                             |
| Offers / coupons         | Per-cinema Offers on/off switch plus coupon codes               |
| Image uploads            | Authenticated image upload, storage and serving                |
| Orders                   | Staff-facing order listing, creation and status transitions    |
| Consumer API             | Public, unauthenticated catalogue, sessions and ordering       |
| Kitchen API              | Kitchen Display System board and fulfilment transitions        |
| Webhooks                 | Cashfree payment notifications                                 |
| POS integration          | Adapter contract and schema only — not implemented (Phase 2)   |

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
- A Cashfree account if payment features are required

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

### Creating the first user

The seeders load status master data only — **they do not create any user
account**, so a freshly migrated database has nothing to sign in with. The
Dashboard and the Kitchen Display System both require a staff login, so one
account has to be created before either is usable.

For development, the sample-data seeder creates an owner account along with
example chains, cinemas, products and pricing:

```bash
npm run seed:dev
```

It creates the owner `qbusto-admin` with password `qbusto-password` and every
module permission. Re-running it is safe; it skips anything already present.

**Do not use this on a production database.** It inserts sample catalogue data
and a well-known password. For a real deployment, create the first owner
account directly against the database, then sign in and use the Dashboard's
Users module for everyone else — an owner can create any role, and each user
may only grant permissions they hold themselves.

Password hashing is done by the `User` model's `beforeValidate` hook, so an
account created through the API or through a script that sets the model's
virtual `password` field is hashed the same way. Never insert a plaintext
password into `users.password_hash`.

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
- `CORS_ALLOWED_ORIGINS=*` produces a warning; set an explicit origin list.

There are deliberately **no Cashfree startup rules**, because there are no
Cashfree credentials in the environment. Credentials and environment live per
cinema in `payment_gateway_config`, encrypted with `CREDENTIALS_ENCRYPTION_KEY`,
and rows change while the process is running — so nothing at boot can see what
any cinema is actually configured for. The cost is real and worth stating: a
cinema left on `test` in production collects no money while checkout, webhooks
and order status all look healthy. Verify each cinema's environment in the
Dashboard before go-live; nothing else will.

Image uploads are configured by `FILE_STORAGE_PATH` and `MAX_UPLOAD_SIZE_MB`;
both have defaults that work for local development. See
[Images and uploads](#images-and-uploads) for what production requires.

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
4. Set `CREDENTIALS_ENCRYPTION_KEY`, then enter each cinema's production
   Cashfree credentials in the Dashboard with `environment` set to `prod`.
   Register a webhook URL, either via `CASHFREE_NOTIFY_URL` or directly in the
   Cashfree Dashboard, if payments are enabled.
5. Consider `SWAGGER_ENABLED=false` on a publicly reachable deployment.
6. Terminate TLS in front of the application. Cashfree requires an HTTPS
   webhook URL, and nothing in front of it may re-serialise the request body.

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

## Images and uploads

Banners, categories, products and the chain logo each carry a single image. The
column that holds it accepts either of two things, and every application reads
that one column the same way:

| Stored value                      | Meaning                                      |
| --------------------------------- | -------------------------------------------- |
| `https://example.com/popcorn.jpg` | An external address, kept exactly as entered |
| `/uploads/products/9f2c….webp`    | A file uploaded to this server               |

Nothing is ever downloaded or copied from an external address; it is stored
verbatim and served by whoever hosts it. Existing records that use external
URLs are unaffected by uploads existing.

### Where the files live

There is **one shared storage location for the whole platform**, and only the
backend touches it. `FILE_STORAGE_PATH` names it. A relative value is resolved
against the repository root — the same anchor `scripts/generate-openapi.js`
uses for `shared/openapi.json` — so the default, `shared/uploads`, puts images
in the shared directory that already holds the generated specification:

```
shared/
├── openapi.json          ← unchanged, still generated here
└── uploads/
    ├── banners/
    ├── categories/
    ├── chains/
    └── products/
```

Resolving from the repository root rather than the working directory means
running the backend as a Windows service or a systemd unit behaves the same as
running it by hand. An absolute `FILE_STORAGE_PATH` is used exactly as given,
which is what a production server sets.

The Dashboard, Consumer and Kitchen have **no upload directory of their own**
and no filesystem access. The Dashboard uploads through
`POST /api/uploads/{entity}`; the Consumer and Kitchen read images through
`GET /uploads/...`. A frontend rebuild touches none of this, because the files
are not inside any frontend.

Each entity subdirectory is created on first use. Filenames are 16 random bytes
plus the extension, so two staff members uploading at the same moment cannot
collide and no upload can overwrite an existing file.

**On a production server:**

- Set `FILE_STORAGE_PATH` to an absolute path **outside the source tree**.
  Deploying a new version replaces the application directory; images kept
  inside it would be destroyed. The repository-relative default is a
  development convenience, not a deployment layout.
- Create the directory before starting the backend, and give the service
  account read and write access to it. The backend creates the per-entity
  subdirectories itself, but not the root.
- Put it on persistent storage — not a container layer, a RAM disk, or a
  temporary volume.
- **Include it in the backup schedule.** These files exist in exactly one
  place. The database holds only the path, so a database restore alongside a
  lost uploads directory produces records pointing at images that are gone.
- The path is not recorded in the database, so it may be changed later by
  moving the directory and updating the variable. Nothing needs to be migrated.

`MAX_UPLOAD_SIZE_MB` caps a single upload; the default is 5 and the maximum
accepted is 50.

### Uploading

`POST /api/uploads/{entity}` where `{entity}` is `banners`, `categories`,
`chains` or `products`. The body is `multipart/form-data` with the image in a
`file` field.

It requires a valid token and the **edit** permission for the module that owns
the entity — Banners, Categories, Products, and Settings for the chain logo.
Uploading an image for a product is treated as editing products, because that
is what it is for.

The response is the value to store:

```json
{
  "success": true,
  "data": {
    "path": "/uploads/products/9f2c1a7b4d8e6f30a1b2c3d4e5f60718.webp",
    "mimeType": "image/webp",
    "bytes": 48213
  }
}
```

Uploading and assigning are separate steps. The client saves the returned
`path` into the record through the normal update endpoint, so an image can be
chosen while a form is still being filled in and a failed save does not lose
the file.

### What is accepted

JPEG, PNG, GIF and WebP, identified by the leading bytes of the file itself.
The declared content type and the submitted filename are both ignored for this
decision, so renaming a script or an executable to `.png` and declaring it
`image/png` does not get it stored. SVG is rejected outright: it is XML and can
carry script.

The file is validated in memory and only reaches the disk once it has passed,
so a rejected upload never exists as a file at all.

### Serving

`GET /uploads/<entity>/<filename>` serves the stored files. Only the four
entity directories are reachable, dotfiles are refused, directory listing is
off, and anything else — a traversal attempt, a missing file — returns the
standard `404` envelope without revealing whether a path exists. Responses
carry `X-Content-Type-Options: nosniff` and a restrictive
`Content-Security-Policy`, so an uploaded file is delivered as data and cannot
execute.

### Replacing and removing

Changing a record's image replaces the value in its column. Clearing it empties
the column.

The previous file is **left on disk**. Nothing in the schema records which
records reference which file, so deleting on replacement could remove a file
another record — or a restored backup, or an audit trail — still points at. An
orphaned image costs disk space; a wrongly deleted one is unrecoverable, and
the safe choice is taken deliberately.

External URLs are never touched. Removing a banner that pointed at
`https://example.com/a.jpg` does not attempt to delete anything anywhere.

Reclaiming space, when it is ever needed, is an operational task: compare the
filenames under `FILE_STORAGE_PATH` with the values in the four image columns
and remove what nothing references, with a backup taken first.

---

## Payments

Cashfree Hosted Checkout is integrated for customer payments placed through
the Consumer app (migrated from Razorpay; no Razorpay code or dependency
remains). The flow is:

1. The Consumer app requests payment initialisation for an order.
2. The backend creates a Cashfree order and returns a short-lived
   `paymentSessionId`.
3. The customer completes payment in Cashfree's hosted checkout, opened as an
   in-page modal.
4. The payment is confirmed on the server — the browser holds no payment
   credential to verify, so `payment-verify` asks Cashfree directly,
   server-to-server, whether the order was paid.

A payment can be discovered three ways — the browser calling `payment-verify`,
a Cashfree webhook, or reconciliation against Cashfree's records when neither
arrived. All three converge on a single transition in
`src/services/paymenttransition.service.js`, which moves the order from pending
to paid with a conditional update. Whichever source arrives first performs the
transition; the others are told it already happened. Anything that must occur
exactly once per paid order belongs at that point and nowhere else.

Payment status and fulfilment status are independent. Marking an order paid
never advances it through the kitchen workflow beyond making it eligible for
fulfilment, and the kitchen can never mark an order paid.

A UPI collect the customer has not yet approved or declined is reported
separately as `gatewayPending: true` on a 409 from `payment-verify` — this
state must never be treated as a safely-retryable failure, since the
outstanding attempt can still succeed and a retry risks a double charge.

---

## Webhook configuration

The webhook endpoint is `POST /api/webhooks/cashfree`. It is mounted before the
JSON body parser because signature verification requires the exact raw bytes
Cashfree sent — this matters more for Cashfree than for most providers, since
it signs decimal amounts as sent (`170.00`) and a parse/re-serialise round trip
would turn that into `170`, breaking every signature.

In the Cashfree Dashboard, under **Developers → Webhooks** (configured
separately for the Test and Production environments — switching environments
in the dashboard does not carry a webhook configuration across):

1. Click **Add Webhook Endpoint**.
2. Set the URL to `https://<your-host>/api/webhooks/cashfree`.
3. Subscribe to at least the payment-success event; also subscribe to the
   failed/dropped events if you want them recorded for audit (they never
   change order state either way).
4. There is no separate signing secret to generate — Cashfree signs with the
   same secret key that cinema already uses to authenticate API calls.

Delivery handling:

- Signatures are verified with a timing-safe comparison over
  `timestamp + rawBody`, HMAC-SHA256, base64-encoded. A delivery with no
  timestamp, an invalid signature, or a timestamp more than 15 minutes old is
  rejected with 400.
- Every processed event is recorded, so a redelivery of the same event is
  recognised and ignored rather than applied twice.
- The endpoint acknowledges only after the transaction commits. A transient
  failure returns 5xx so Cashfree retries.

The endpoint must be reachable over HTTPS from Cashfree's servers, and nothing
in front of it may re-serialise the request body.

**Setting `CASHFREE_NOTIFY_URL` is an alternative to the dashboard
registration above**, not a replacement requirement — it overrides the webhook
URL on a per-order basis, which is what makes a local tunnel (ngrok, Cloudflare
Tunnel) work during development without touching the shared dashboard
configuration. In production, use one or both; without either, a payment where
the customer's browser never returns has no automatic way to settle.

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

| Document                                               | Contents                               |
| ------------------------------------------------------ | -------------------------------------- |
| [docs/schema.md](./docs/schema.md)                     | The database schema as it exists today |
| [docs/schema-explained.md](./docs/schema-explained.md) | Why the schema is shaped the way it is |
| [docs/schema.dbml](./docs/schema.dbml)                 | Schema in DBML form, for diagram tools |

---

## Sessions - the one source of showtimes

`GET /api/consumer/cinemas/{cinemaId}/sessions` returns the screenings a cinema
has scheduled within three hours either side of now, earliest first, capped at
two per auditorium. The window is flat rather than tied to a calendar day, and
reaches backwards on purpose: a customer twenty minutes into a film is exactly
who wants food. The Consumer offers them as a single picker at checkout.

```
cinemas --< session        (joined by code, not by id)
```

**`session` is the only table of screenings.** There is no `film` table, no
`shows` table and no per-provider copy: whatever a POS returns is normalized
into `session` by `showSync.service`, so nothing downstream knows which
provider a screening came from, and **no frontend ever calls a POS**. The film
title is a column on the session row (`Film_strName`), not a join.

It is the client's own table, renamed from `Session` for naming consistency and
reshaped to ten columns in `20260904000100-session-sole-show-source.js`. QBusto
reads it and writes it only through the POS sync: `GET /api/sessions` and
`GET /api/sessions/{id}` are the whole staff surface, authorised against the
**Settings** module, and the Dashboard lists them read-only.

A session is addressed by its numeric session id, which is unique within a
cinema.

### Which show is running right now

Pass the QR's screen as `?screenId=`. The backend resolves it to an auditorium
NAME within that cinema, matches `startsAt <= now < endsAt` against **its own
clock**, and flags that one entry `isCurrent: true`; the Consumer preselects it
and the customer can still change it. No client-supplied time is accepted on
this path, so a device with a wrong clock cannot select a different show. An
unknown screen simply means "no current show".

At order time the backend re-reads the session by `(cinemaCode, sessionId)`,
refuses a non-`O` status with a 409, and derives the film title, the show time
and the screen from that row - never from the request body.

**A session does not carry a screen id.** It names the auditorium instead, so
the order's `screenId` is resolved from the screen name plus the seat row the
customer entered.

Orders are unaffected by any of this: an order snapshots `screenId`,
`filmTitle` and `showTime` when it is placed, so a schedule change cannot
rewrite what a customer bought.

There is no seed command for this data; the client's sync is its source.
