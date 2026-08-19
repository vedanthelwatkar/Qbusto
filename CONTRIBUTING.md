# Engineering Guidelines

Conventions for working on the QBusto platform. These describe decisions that
have already been made and the reasoning behind them, so that new work stays
consistent with the existing codebase.

---

## Platform overview

QBusto is an on-premise cinema food-ordering platform. It consists of a backend
API and three frontend applications; see the [README](./README.md) for the
overall architecture.

The backend is the source of truth for authorisation, validation, tenant
isolation and business rules. No frontend holds a business rule of its own.

### Domain model

```
Chain
 └── Cinema
      └── Screen

Chain
 └── Categories
      └── Products
           └── Cinema Product
                └── Availability Hours
```

Pricing is deliberately not nested under Cinema Product. `product_pricing` is
keyed on `(cinema_id, product_id, day_of_week)` directly, so the two are
parallel representations of "product at a cinema":

```
Cinema + Product
 ├── Cinema Product  → Availability Hours
 └── Pricing         (per day)
```

---

## Backend conventions

### Architecture

```
Route → Controller → Service → Model (Sequelize) → SQL Server
```

Do not introduce repositories, factories, generic CRUD abstractions, base
services or additional architectural layers. Add them only when a concrete,
repeated problem demands it.

### Technology

Node.js, Express, Sequelize against SQL Server, Joi validation, JWT
authentication, Swagger/OpenAPI. Do not introduce an alternative framework,
ORM, validation library or HTTP client.

### Validation

Validate all external input at the boundary using the existing Joi patterns.
Frontend validation is never a security boundary.

### Transactions

Use a transaction wherever multiple related writes must succeed or fail
together — an order and its items, a status change and its audit row, any
atomic state transition.

### Money

The backend is authoritative for subtotals, discounts, totals and payment
amounts. Prices sent by a client are discarded before reaching the service
layer. Perform payment-unit conversion server-side.

### Errors and responses

Use the existing error classes, error middleware and response envelopes:

```
success    { success: true,  message, data, meta }
paginated  { success: true,  message, data, meta: { pagination } }
error      { success: false, error: { code, message, details } }
```

Client-facing errors must not leak stack traces, infrastructure details or
provider errors. Status codes must describe the actual failure.

### Logging

Never log passwords, API keys, tokens, payment secrets or full authorisation
headers. For integrations, log safe identifiers, operation, provider, outcome
and duration.

---

## Security and authorisation

Frontend permission checks are presentation only. Backend authorisation is
authoritative.

### Roles

`owner`, `chain_admin`, `cinema_admin`, `kitchen_staff`, `cinema_accountant`

**Roles are not a hierarchy.** Do not introduce role ranking, scores or
role-to-role comparisons. Access is module and action based.

Owner rules:

- Only an owner may create or promote an account to the owner role.
- Owner accounts are protected from modification by non-owners.
- Owners bypass permission-row checks and therefore have no `user_permissions`
  rows.

A user may only grant permissions they hold themselves.

### Permissions

Each grant carries `canRead`, `canEdit`, `canDelete` against a module:

`Dashboard`, `Orders`, `Products`, `Categories`, `Pricing`, `Banners`, `Users`,
`Reports`, `POS Integrations`, `Settings`

---

## Tenant isolation

Non-owners must never access another chain's data. Out-of-scope resources
return **404**, not 403 — the API does not confirm that another tenant's
records exist.

Isolation applies across chains, cinemas, screens, categories, products, cinema
products, pricing, banners, availability, users and orders.

Orders carry no `chain_id`, so their scope is applied through the owning cinema
join. Be careful with Sequelize includes and scope objects: never let a
tenant-scope spread overwrite the requested resource id.

The Kitchen API narrows further, to the cinema on the signed-in account. The
staff order API remains chain-level; this difference is deliberate and
documented in `backend/src/services/order.service.js`.

---

## Soft delete and parent lifecycle

Most master-data resources use `is_active = false`. DELETE is idempotent and
leaves the row in place.

Product availability hours are the exception: they have no `is_active` column,
so DELETE is a hard delete.

Lifecycle rules:

- Deactivating a chain does not cascade to cinemas.
- Deactivating a cinema does not cascade to screens.
- Deactivating a cinema product does not cascade to its availability hours.
- Existing children remain readable and editable.
- Creating a new child under a deactivated parent is rejected where the backend
  enforces it — currently screens under a deactivated cinema, and cinema
  products under a deactivated cinema or product.

Those rejections return **409**, not 400: the ids are well-formed and the rows
exist; what fails is their relationship to stored state.

Do not add cascading behaviour.

---

## Orders and fulfilment

Order status and payment status are independent columns and move on separate
axes. An order can be `(paid, preparing)` or `(pending, confirmed)`.

The fulfilment graph is owned by `backend/src/services/fulfilment.service.js`
and is the single authoritative copy — the Dashboard and the Kitchen both
validate against it:

```
initiated → confirmed → preparing → ready → delivered
```

`rejected` is reachable from any non-terminal state. `delivered` and `rejected`
are terminal.

Transitions are applied as a conditional update matching the status that was
read, so two concurrent writers cannot both succeed. The loser is told the row
moved and re-reads.

Payment confirmation converges on a single transition in
`paymenttransition.service.js`. Anything that must happen exactly once per paid
order belongs at that point and nowhere else — attaching it to the individual
discovery paths (browser callback, webhook, reconciliation) produces duplicates.

---

## Frontend conventions

### API client

Frontends must use the generated Orval client.

```
backend OpenAPI → shared/openapi.json → npm run gen:api → src/api/generated/
```

Do not hand-write API URLs, request parameter types, request body types, or
duplicate backend response types. Never edit generated directories.

Before implementing an integration, inspect the generated function and use its
types. If the API contract is wrong, fix the backend contract rather than
adding a permanent frontend workaround.

### Pagination, search and selectors

Use server-side pagination, search and filtering wherever the API supports it.
Do not fetch a large arbitrary page and treat it as the complete set.

Selectors should use server-side search, pagination, and a by-id lookup for a
selected value outside the loaded page. Existing examples: `ChainSelect`,
`CinemaSelect`, `CategorySelect`, `AddonParentSelect`, `ProductSelect`.

### Forms and validation

Backend validation is authoritative. Map backend validation details to form
fields using the shared helper in `dashboard/src/utils/validation.ts`. Do not
discard service-raised validation errors merely because they carry no source
field.

With Ant Design `Select`, clearing normally produces `undefined`. Send `null`
only where the backend explicitly accepts it — interface nullability is not the
same as API nullability.

### Dashboard UI

Ant Design throughout; do not introduce a second component library. Layout is
sidebar, header and main content, with the sidebar becoming a drawer on smaller
screens. `dashboard/src/theme.ts` holds the palette and is the single source of
truth for colour — do not scatter one-off hex values through components.

### Feature structure

A typical Dashboard CRUD feature:

```
feature.service.ts
feature.store.ts
FeaturePage.tsx
FeatureFormModal.tsx
FeatureDetailsDrawer.tsx
```

Avoid generic abstractions unless they solve a real repeated problem.

---

## Product availability hours

Availability hours belong to the Products workflow, not to a separate
navigation module:

```
Product → Cinema Product → Product Availability Hours
```

A product may have multiple windows per day. Schema fields are
`cinema_product_id`, `day_of_week`, `start_time`, `end_time`, where
`day_of_week = 0` means every day.

Availability is cinema-specific, so the API is keyed on `cinemaProductId`, not
`productId`. Resolve it through:

```
GET /api/cinema-products?cinemaId=<id>&productId=<id>
```

`(cinema_id, product_id)` is unique, so this returns one row or none. None
means the cinema does not carry the product yet; create the link with
`POST /api/cinema-products` before adding windows.

The backend requires `startTime < endTime`, so overnight windows such as
22:00–02:00 are currently rejected.

Days are normalised into rows. Do not add day-specific columns; the legacy
system denormalised this and QBusto deliberately does not.

---

## Pricing

Pricing is specific to cinema, product and day. The API has no free-text search
parameter; use the supported filters (cinema, product, day, type, status).

If the generated contract disagrees with runtime behaviour — for example
decimals typed as strings but returned as numbers — fix the contract rather
than maintaining a frontend workaround.

---

## Banners

Banners are cinema-specific. Each row has a single image reference, and
multiple banners are multiple rows. Sequence is per cinema. There is no JSON
array of images.

---

## File and image storage

The platform is on-premise. The chosen strategy is the server filesystem for
the file itself with metadata in SQL Server. Do not use cloud object storage or
SQL Server `VARBINARY` for uploaded media.

The storage root is configurable, for example:

```
FILE_STORAGE_PATH=D:\QBusto\data\uploads
```

Uploads must not live inside the source tree. Store only a relative key in the
database, such as `banners/8f3a2c.webp`, never an absolute filesystem path.

Suggested layout:

```
uploads/
├── banners/
└── products/
```

File storage is not yet implemented; when it is, build it as a full vertical
slice.

---

## Legacy system

QBusto replaces Vista PopExpress. Legacy data is denormalised and carries
Vista-specific identifiers. Do not reproduce the legacy schema.

```
Legacy business requirement → normalised relational model → provider-neutral domain
```

Examples: legacy day-specific pricing columns become normalised pricing rows;
Vista identifiers move to the POS mapping layer; mutable product data is
snapshotted onto orders for historical accuracy.

---

## OpenAPI workflow

The specification is the contract. When changing an API:

1. Update the route documentation.
2. Run `npm run gen:spec`.
3. Validate the generated specification.
4. Run `npm run gen:api` in each affected frontend.
5. Fix any resulting compilation errors.
6. Remove temporary frontend workarounds the change makes unnecessary.

Do not disable specification validation to make generation pass.

---

## Testing

Automated tests cover the backend. They exercise the real Express stack with
supertest and mock the model layer, so they assert the decisions the code makes
rather than the SQL it emits.

Cover, where applicable: happy paths, validation failures, authorisation
failures, tenant isolation, idempotency, duplicate prevention, state
transitions and external integration failures.

Mocks cannot prove everything. Behaviour involving joins, SQL constraints,
`TIME`/`DATE`/`DECIMAL` handling, pagination, sorting, duplicate handling and
foreign keys should be checked against a real SQL Server instance. When doing
so:

1. Use uniquely named temporary data.
2. Exercise the real HTTP API.
3. Verify both the response and the resulting database state.
4. Include cross-tenant cases.
5. Delete all temporary data and confirm the database is clean afterwards.

Never leave test data behind.

---

## Schema management

The existing schema is treated as frozen unless a task explicitly requires a
migration. Do not casually add permission modules, columns, indexes, tables or
relationships.

Where the schema conflicts with a requested feature: identify the conflict,
explain the consequence, prefer a correct implementation using the existing
schema, and propose a migration only when genuinely necessary.

Before writing a migration, inspect the current schema, check whether the
object already exists, and follow the existing SQL Server conventions.
Migrations should be explicit and reversible where practical.

---

## Review checklist

Before considering a feature complete:

- Backend authorisation exists and is enforced server-side
- Tenant isolation is correct
- Frontend API calls use the generated client
- Pagination is server-side; selectors are searchable rather than capped
- Forms behave safely when a load fails
- Disabled actions carry a usable explanation
- Service validation errors map to fields
- Null and undefined semantics are correct
- Soft-delete and parent-lifecycle rules are respected
- OpenAPI matches runtime behaviour
- Real-database verification happened where mocks are insufficient
- Any temporary data was removed
- Documentation was updated for architectural changes

---

## Known deferred items

- Login timing side-channel
- Dedicated login rate limiting
- `LIKE` wildcard escaping for `%` and `_`
- Check-then-write duplicate races where the schema is frozen
- Dashboard bundle code splitting
- Existing `npm audit` findings
- POS integration with Vista and Showbizz (Phase 2)

---

## Working principles

- Build vertical slices so that backend and frontend contracts are continuously
  verified, rather than integrating everything at the end.
- Prefer inspect → implement → integrate → verify → review.
- Keep implementations simple and consistent with the surrounding code.
- Do not optimise prematurely or add abstractions for hypothetical
  requirements.
- Where business behaviour is unclear, inspect the schema, documentation and
  legacy behaviour, and raise the ambiguity rather than silently choosing a new
  rule.
