# Backend Development Guide

Engineering conventions specific to the QBusto backend. Platform-wide
conventions are in [CONTRIBUTING.md](../../CONTRIBUTING.md) at the repository
root; this document covers what applies to the API server.

---

## Role of the backend

The backend is the source of truth for authorisation, validation, tenant
isolation, business rules, pricing, orders, payments and integrations. No
client is trusted to enforce any of these.

---

## Stack

Node.js, Express, Sequelize, Microsoft SQL Server, Joi, JWT, Swagger/OpenAPI,
Jest. Do not introduce an alternative framework, ORM, validation library, HTTP
client or job framework.

---

## Architecture

```
Route → Controller → Service → Model (Sequelize) → SQL Server
```

- **Routes** define HTTP behaviour, middleware and OpenAPI annotations.
- **Controllers** handle request and response concerns only, and stay thin.
- **Services** hold business rules and cross-entity validation.
- **Models** describe database structure and relationships.

Do not introduce repositories, generic CRUD abstractions, base classes or
factories without a demonstrated need.

---

## Before starting work

1. Inspect the existing implementation.
2. Find the closest existing feature and follow its conventions.
3. Inspect the relevant models, migrations, schema documentation, permissions,
   tests and OpenAPI annotations.
4. Identify dependencies and constraints before writing code.

---

## API and OpenAPI

Implementation and OpenAPI must agree. When changing an API:

1. Update the route annotations.
2. Regenerate with `npm run gen:spec`.
3. Regenerate the frontend clients where applicable.
4. Validate the result.

Never edit generated API clients by hand, and do not add a frontend workaround
for a contract that is itself wrong.

---

## Validation

Validate all externally supplied input at the boundary using the existing Joi
conventions. `validate()` runs with `stripUnknown`, so unsupported fields are
discarded rather than rejected — this is how prices and totals sent by a client
are prevented from reaching a service.

Backend validation must enforce every business constraint regardless of what a
client does.

---

## Authorisation

Never trust client-side route protection, client-supplied roles, hidden
interface controls, or an id without an ownership check.

Follow the existing authentication, authorisation and permission-module
conventions. Do not invent a new permission where an existing module applies —
the module list mirrors a database `CHECK` constraint and is not freely
extensible.

---

## Tenant isolation

Foreign keys alone do not prove tenant ownership. Whenever entities are
combined, verify they belong to the same tenant context before reading
sensitive data or writing records.

Orders have no `chain_id`; scope is applied through the owning cinema, as it is
for screens, banners, pricing and availability hours.

For POS data:

- `shows.cinema_id` must match the cinema belonging to `shows.pos_integration_id`.
- A non-null `shows.screen_id` must belong to the show's cinema.
- `screen_id = null` is valid for an unmapped POS screen.
- Never associate a show with another cinema's screen; reject or mark
  unresolved per documented behaviour.

Tenant isolation is enforced in services and must be tested explicitly.

---

## Database and migrations

Before creating a migration, inspect the existing schema, check whether the
table or column already exists, and review current constraints, indexes,
associations and delete/update behaviour.

Migrations should be explicit and reversible where practical. Validate against
a real SQL Server instance when mocks cannot prove the behaviour:

```
migration → schema verification → real-database validation → tests → rollback → re-apply
```

Do not create a new table merely because an interface needs a value, when an
existing normalised model already represents the concept.

Use database constraints — `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys,
indexes — where appropriate. Cross-table tenant invariants that constraints
cannot safely express are enforced in the service layer and documented.

---

## Transactions

Use a transaction when multiple related writes must succeed or fail together:
an order and its items, a status change and its audit row, any atomic state
transition. Do not wrap simple reads in transactions.

---

## Money

The backend is authoritative for subtotals, discounts, taxes, totals and
payment amounts. Never trust a client-calculated total. Perform payment-unit
conversion server-side according to the established contract.

---

## Idempotency

Operations that can be retried and produce side effects need an explicit
idempotency strategy.

For order creation, respect the existing `Idempotency-Key` contract: reusing a
key must not create a duplicate logical order, a replacement key must not be
generated silently, and a key must not be reusable for materially different
input.

Internal idempotency does not imply provider-side idempotency. Never blindly
retry an ambiguous external request unless the provider guarantees it.

---

## External integrations

Keep provider-specific behaviour behind the smallest useful adapter boundary:

```
Business Service → Provider Adapter → External system
```

Do not scatter provider-specific branches through business services.

Where provider documentation is unavailable, do not invent endpoints,
authentication or payload shapes — document the blocker instead.

For POS show synchronisation, timezone conversion belongs in the service layer,
not in individual adapters:

```
POS local wall-clock → provider-neutral adapter value → central timezone
conversion → UTC instant in database → ISO UTC API response
```

### Reliability

External integrations must use timeouts, distinguish definitive failures from
ambiguous outcomes, avoid unsafe retries, log useful diagnostics without
credentials, and sanitise provider payloads before persistent logging.

A timeout after a request may mean the request still reached the provider. Do
not assume it is safe to retry.

---

## Error handling

Use the existing error classes and error middleware. Client-facing errors
should use the established envelope, be deterministic, and avoid stack traces,
infrastructure details and secrets. Map external failures into safe,
documented application errors rather than surfacing provider errors directly.

---

## Logging

Never log passwords, API keys, access tokens, payment secrets, full
authentication headers, or unnecessary customer data.

For integrations, log safe identifiers, operation, provider, outcome, duration
and a sanitised error. Do not persist complete external request and response
bodies by default.

---

## Response consistency

Follow the existing response envelopes and status-code conventions. A
successful list endpoint returns an empty array rather than 404. Status codes
must describe the actual failure type. Do not introduce a new response shape
without a clear reason.

---

## No silent data loss

Never discard valid input because it cannot currently be mapped. Preserve it
where the schema permits, mark it unresolved where appropriate, and log the
mapping issue.

For example, an unmapped POS screen must not cause a valid show to disappear
when `screen_id = null` is an allowed state.

---

## Testing

Test behaviour rather than implementation detail. Cover happy paths, validation
failures, authorisation failures, tenant isolation, idempotency, duplicate
prevention, state transitions, database constraints and integration failures.

Use real SQL Server validation for SQL-specific behaviour: `DATETIME2`
handling, constraints, indexes, foreign keys and transactions. Any temporary
verification script and the data it creates must be removed afterwards.

---

## Generated files

Generated artefacts must be reproducible from their source and are never edited
by hand:

```
route annotations / OpenAPI → generation → generated files
```

---

## Documentation

Keep `backend/docs/` current. When behaviour changes, update the relevant
document. Distinguish clearly between implemented, planned, deferred and
blocked work, and record external blockers.

---

## Validation workflow

Run the relevant checks before considering work complete:

```bash
npm run lint
npm run format:check
npm test
```

And where applicable:

```bash
npm run gen:spec
npm run verify-schema
npm run healthcheck
npx sequelize-cli db:migrate
```

Report a check as passing only if it was actually run.

---

## Review checklist

- Tenant isolation
- Authorisation
- Input validation
- Error handling
- Idempotency
- Race conditions and duplicate writes
- Transaction boundaries
- SQL Server-specific behaviour
- Sensitive-data exposure
- External retry safety
- OpenAPI consistency
- Generated-file consistency
- Unnecessary abstractions and scope creep

---

## Core principles

1. The backend is authoritative.
2. Tenant isolation is mandatory.
3. Do not invent contracts.
4. Follow existing project patterns.
5. Keep the architecture simple.
6. Validate at the boundary.
7. Use database constraints where appropriate.
8. Put cross-entity business rules in services.
9. Treat external retries as potentially dangerous.
10. Never lose data silently.
11. Document important decisions.
12. Test business behaviour.
13. State clearly what has and has not been verified.
