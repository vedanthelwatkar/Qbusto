# CLAUDE.md — QBusto Development Guide

## Project Overview
QBusto is an on-premise cinema food-ordering platform replacing the legacy Vista PopExpress workflow.

Core areas:
- Backend: Node.js API, SQL Server, JWT, Sequelize-style models/services/controllers/routes.
- Dashboard: React + TypeScript + Ant Design administrative frontend.
- Consumer/KDS/POS functionality: implemented progressively.

QBusto is multi-tenant:

```text
Chain
 └── Cinema
      └── Screen

Chain
 └── Categories
      └── Products
           └── Cinema Product
                └── Availability Hours
```

Pricing is deliberately *not* under Cinema Product. `product_pricing` is keyed on
`(cinema_id, product_id, day_of_week)` directly, so the two are parallel
representations of "product at a cinema" rather than nested:

```text
Cinema + Product
 ├── Cinema Product  → Availability Hours
 └── Pricing         (per day)
```

The backend is the source of truth for authorization, validation, tenant isolation and business rules.

## Technology Decisions

### Backend
- Node.js
- JavaScript
- Express
- Sequelize / SQL Server
- Microsoft SQL Server
- Joi validation
- JWT authentication
- Swagger/OpenAPI
- Orval for frontend API generation

Architecture:

```text
Route → Controller → Service → Model/Sequelize → SQL Server
```

Do not introduce repositories, factories, generic CRUD abstractions, base services, or new architectural layers unless explicitly required.

### Dashboard
- React
- TypeScript
- Vite
- Ant Design
- Zustand
- Axios
- React Router
- Sass
- Orval generated API clients
- Day.js where required by Ant Design

Frontend flow:

```text
Pages → Stores → Services → Generated Orval client → Backend
```

Use Ant Design for UI. Do not introduce another UI component library.

## API Client Rule — IMPORTANT

The frontend must use the generated Orval client.

Do NOT manually write API URLs, request parameter types, request body types, or duplicate backend response types.

Flow:

```text
Backend OpenAPI
    ↓
shared/openapi.json
    ↓
npm run gen:api
    ↓
dashboard/src/api/generated/
    ↓
frontend services
```

Services may unwrap envelopes or adapt generated responses for UI needs, but they must call generated functions.

Before implementing frontend API integration:
1. Inspect the generated Orval function.
2. Use generated request/response/body/query types.
3. Never invent an endpoint or parameter.
4. If the API contract is wrong, fix the backend/OpenAPI contract instead of creating a permanent frontend workaround.

When OpenAPI changes:
```text
npm run gen:spec
npm run gen:api
```

Never manually edit `dashboard/src/api/generated/`.

## Standard Workflow

Before coding:
1. Read this file.
2. Inspect the existing implementation.
3. Find the closest existing feature and follow its pattern.
4. Inspect the database/model/schema and API contract.
5. Decide whether the task is backend, frontend, or a vertical slice.
6. Do not invent fields, endpoints, permissions, or relationships.

Prefer vertical slices:

```text
DB/model
 → validator
 → service
 → controller
 → route/OpenAPI
 → generated client
 → frontend service
 → store
 → page/component
```

After implementation:
1. Run relevant tests.
2. Run OpenAPI generation when applicable.
3. Run lint/typecheck/build.
4. Test real SQL Server behavior where mocks cannot prove it.
5. Perform a focused code review.
6. Clean all temporary probe data.
7. Report files, APIs, generated functions, architecture decisions, validation and remaining issues.
8. Suggest a scoped commit message.

Typical validation commands:
```text
npm run gen:spec
npm run gen:api
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
npm run verify-schema
npm run healthcheck
```
Only run commands that actually exist in the relevant workspace.

## Security and Authorization

Frontend permission checks are UX only. Backend authorization is authoritative.
Never rely on hidden/disabled frontend controls for security.

### Roles
Current roles:
- owner
- chain_admin
- cinema_admin
- kitchen_staff
- kitchen_accountant

Roles are NOT a hierarchy.

Do not introduce `ROLE_RANK`, role scores, or role-to-role comparisons.

Access is module/action based.

Explicit owner rules:
- Only an owner can create/promote an account to the owner role.
- Owner accounts are protected from modification by non-owners.

### Permissions
Permissions use:
```text
canRead
canEdit
canDelete
```

Modules:
```text
Dashboard
Orders
Products
Categories
Pricing
Banners
Users
Reports
POS Integrations
Settings
```

Owners bypass normal permission-row checks because owners do not have `user_permissions` rows.

## Tenant Isolation

QBusto is multi-tenant. Non-owners must never access another chain's data.

Out-of-scope resources should generally return `404`, not reveal existence with `403`.

Tenant isolation must be enforced across chains, cinemas, screens, categories, products, cinema_products, pricing, banners, availability, users and future orders/POS data.

Be especially careful with Sequelize joins and scope objects. Never allow a tenant-scope spread to overwrite the requested resource ID.

## Soft Delete and Parent Lifecycle

Most master-data resources use `is_active = false`. DELETE is generally idempotent and leaves the row in the database.

Product availability hours are different: they have no `is_active` column, so DELETE is a hard delete.

Current lifecycle decision:
- Deactivating a chain does not cascade to cinemas.
- Deactivating a cinema does not cascade to screens.
- Deactivating a cinema product does not cascade to its availability hours.
- Existing children remain readable/editable.
- Creating new children under a deactivated parent is rejected where the backend currently enforces it.

Enforced today by:
- screens, against a deactivated cinema
- cinema products, against a deactivated cinema *or* a deactivated product

Both return `409`, not `400`: the ids are well-formed and the rows exist, so what
fails is their relationship to stored state.

Do not invent cascading behavior.

## Pagination, Search and Selectors

Use server-side pagination/search/filtering whenever the API supports it.

Do not fetch an arbitrary `limit: 100` and assume it contains all records.

Selectors should use:
- server-side search
- pagination
- by-ID lookup for a selected value outside the loaded page

Existing examples:
- ChainSelect
- CinemaSelect
- CategorySelect
- AddonParentSelect
- ProductSelect

Main tables remain server-paginated.

## Forms and Validation

Backend validation is authoritative.

Use the shared `src/utils/validation.ts` for mapping backend validation details to form fields.

Do not discard service-raised validation errors merely because they have no `source`.

Be careful with Ant Design Select:
- clearing normally produces `undefined`
- only send `null` where the backend explicitly accepts null
- do not assume UI nullability equals API nullability

## Dashboard UI

Use Ant Design throughout.

Layout:
```text
Sidebar
Header
Main content
```

No footer.

Responsive behavior:
- desktop → sidebar
- smaller screens → drawer

Theme: `dashboard/src/theme.ts`

`PALETTE` is the single source of truth for colors. Current visual direction is dark/ink sidebar, orange primary/accent, light page background and restrained table/header colors. Do not scatter arbitrary hex colors throughout components.

## Frontend Feature Structure

Typical CRUD feature:
```text
feature.service.ts
feature.store.ts
FeaturePage.tsx
FeatureFormModal.tsx
FeatureDetailsDrawer.tsx
```

Existing structure:
```text
src/
├── api/generated/
├── components/
├── layouts/
├── pages/
├── routes/
├── services/
├── stores/
├── styles/
├── types/
└── utils/
```

Avoid generic abstractions unless they solve a real repeated architectural problem.

## Current Frontend Status

Completed:
- Dashboard foundation
- Users
- Categories
- Products
- Chains
- Cinemas
- Screens
- Pricing
- Banners

Remaining:
- Cinema Products (backend exists, no UI yet)
- Product Availability Hours
- Orders
- Reports
- POS Integrations
- Settings
- File/media handling

Chains, Cinemas and Screens live under Settings because the frozen permission-module constraint has no separate modules for them.

Cinema Products has no sidebar module either. Like Availability Hours it belongs inside
the Products workflow, and it uses the same `Products` permission module.

## Product Availability Hours

Availability hours belong inside the **Products workflow**. They are NOT a separate top-level navigation module.

Relationship:
```text
Product
  ↓
Cinema Product
  ↓
Product Availability Hours
```

A product can have multiple windows per day:
```text
Monday
  10:00 - 13:00
  18:00 - 22:00

Tuesday
  12:00 - 16:00
```

Schema fields:
```text
cinema_product_id
day_of_week
start_time
end_time
```

`day_of_week = 0` means every day.

The API uses `cinemaProductId`, not only `productId`, because availability is cinema-specific.

Resolve it through `/api/cinema-products`:

```text
GET /api/cinema-products?cinemaId=<id>&productId=<id>
```

`(cinema_id, product_id)` is unique, so that returns one row or none. None means the
cinema does not carry the product yet - create the link with `POST /api/cinema-products`
before adding windows. Do not assume every cinema carries every product.

Current backend rule:
```text
startTime < endTime
```

Therefore overnight windows such as `22:00 → 02:00` are currently rejected.

Do not create Monday/Tuesday/etc. columns. The legacy system had denormalized day-specific columns; QBusto deliberately normalizes this into rows.

Frontend UX:
```text
Products → Edit/View Product → Availability Hours
```
not a separate sidebar module.

## Pricing

Pricing is cinema/product/day specific.

The API currently has no text search parameter. Use supported filters such as cinema, product, day, type and status. Do not invent query parameters.

If generated OpenAPI says decimals are strings but the running API returns numbers, fix the contract rather than maintaining a permanent frontend workaround.

## Banners

Banners are cinema-specific. The database has a singular image URL/reference per banner row. Multiple banners are represented by multiple rows. Sequence is per cinema. Do not invent a JSON array of images.

## File/Image Storage Decision

QBusto is on-premise. Chosen strategy:

```text
Server filesystem
       +
SQL Server metadata/reference
```

Do NOT use S3, cloud blob storage, or SQL Server BLOB/VARBINARY for normal uploaded media.

The app is expected to handle relatively small images/files, not large videos.

Use a configurable environment variable:
```env
FILE_STORAGE_PATH=D:\QBusto\data\uploads
```

Do not store uploads inside the source-code/project directory.

Store only a relative file key in SQL Server, for example:
```text
banners/8f3a2c.webp
```

Never store an absolute filesystem path in the database.

Recommended storage shape:
```text
uploads/
├── banners/
├── products/
└── ...
```

When file storage is implemented, do it as a full-stack vertical slice.

## Legacy System

QBusto replaces Vista PopExpress. Legacy data is denormalized and contains Vista-specific identifiers.

Do NOT blindly reproduce the legacy schema.

Modernization principle:
```text
Legacy business requirement
        ↓
QBusto normalized relational model
        ↓
Provider-neutral domain
```

Examples:
- legacy day-specific pricing columns → normalized pricing rows
- legacy Vista identifiers → POS integration/mapping layer
- mutable product data → order snapshots for historical accuracy

When legacy behavior matters, inspect the legacy documentation/schema before deciding.

## OpenAPI Rules

OpenAPI is the frontend/backend contract.

When changing an API:
1. Update backend route documentation.
2. Run `npm run gen:spec`.
3. Validate the generated spec.
4. Run `npm run gen:api`.
5. Fix frontend compilation issues caused by the contract.
6. Remove temporary frontend workarounds.

Do not disable OpenAPI validation to make Orval pass.

## Real Database Testing

Mocked tests cannot prove everything. Use a temporary real-SQL probe for behavior involving joins, tenant isolation, SQL constraints, TIME/DATE/DECIMAL behavior, pagination, sorting, duplicate handling and foreign keys.

Probe requirements:
1. Use temporary uniquely named data.
2. Exercise the real HTTP API.
3. Verify status AND resulting database state.
4. Test cross-tenant/security cases.
5. Delete all probe data.
6. Confirm the database is clean.
7. Delete the probe script.

Never leave test/probe rows behind.

## Known Deferred Items

Do not expand scope unless explicitly requested.

Known deferred items:
- login timing side-channel
- dedicated login rate limiting
- LIKE `%` / `_` escaping
- check-then-write duplicate races where schema is frozen
- JWT secret hardening before production
- dashboard bundle/code splitting
- existing npm audit findings
- developer-only operational/admin access

## Schema Freeze

The existing schema is considered frozen unless a task explicitly requires a migration.

Do not casually add permission modules, columns, indexes, tables or relationships.

If the schema conflicts with a requested feature:
1. Identify the conflict.
2. Explain the consequence.
3. Prefer a correct implementation using the existing schema.
4. Propose a migration only when genuinely necessary.

## Review Checklist

Before declaring a feature complete, check:
- backend authorization exists
- tenant isolation is correct
- permissions are checked server-side
- frontend API calls use Orval
- request/response types are generated
- pagination is server-side
- selectors are searchable/paginated rather than capped
- forms are safe if a load fails
- disabled actions have usable explanations
- service validation errors map to fields
- null/undefined semantics are correct
- soft-delete semantics are correct
- parent lifecycle rules are respected
- OpenAPI matches runtime behavior
- real SQL Server testing happened where necessary
- all probe rows were removed
- docs were updated for architectural changes
- a code review was performed

## Completion Report Format

When finishing a feature, report:
1. Files created/modified.
2. APIs/endpoints integrated.
3. Generated Orval functions used.
4. Important architectural decisions.
5. Tests and real-database probes.
6. Validation commands/results.
7. Known issues/deferred decisions.
8. Suggested commit message.

If a probe finds a real defect:
- explain it
- show reproduction
- fix it if in scope
- rerun validation
- delete the probe
- confirm database cleanup

Never claim real verification if only mocks were run.

## Development Philosophy

Prefer:
```text
inspect → implement → integrate → verify → review → commit
```

over:
```text
build everything → integrate at the end
```

Build vertical slices so backend and frontend contracts are continuously verified.

Keep implementation simple and consistent with the existing codebase. Do not optimize prematurely. Do not invent abstractions for hypothetical future requirements.

When uncertain about business behavior, inspect the existing schema/documentation/legacy behavior and flag the ambiguity rather than silently choosing a new rule.
