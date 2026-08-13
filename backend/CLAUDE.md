# CLAUDE.md — QBusto Backend Development Rules

## 1. Purpose

These are the generic rules for backend development in QBusto.

The backend is the source of truth for authorization, validation, tenant isolation, business rules, pricing, orders, payments, and integrations.

## 2. Backend Stack

Use the existing stack:
- Node.js
- JavaScript
- Express
- Sequelize
- Microsoft SQL Server
- Joi
- JWT
- Swagger/OpenAPI
- Jest

Do not introduce a new framework, ORM, validation library, HTTP client, job framework, or architectural layer unless explicitly required.

## 3. Architecture

Default flow:

```text
Route → Controller → Service → Model/Sequelize → SQL Server
```

Routes define HTTP behavior and middleware. Controllers handle request/response concerns. Services contain business rules and cross-entity validation. Models represent database structure and relationships.

Do not introduce repositories, generic CRUD abstractions, base services/controllers, factories, or other architectural layers without a demonstrated need.

## 4. Before Coding

Always:
1. Read this file.
2. Read the relevant phase and architecture documentation.
3. Inspect the existing implementation.
4. Find the closest existing feature and follow its conventions.
5. Inspect models, migrations, schema, permissions, tests, and OpenAPI.
6. Identify dependencies, blockers, and scope.
7. Do not invent fields, endpoints, permissions, relationships, or external contracts.

## 5. API and OpenAPI

Backend implementation and OpenAPI must agree.

When changing an API:
1. Update the source implementation/OpenAPI definition.
2. Regenerate the OpenAPI artifact using the project workflow.
3. Regenerate frontend clients when applicable.
4. Validate the generated result.

Never manually edit generated API clients.

Never create frontend workarounds for an incorrect backend contract when the contract itself should be fixed.

## 6. Validation

Validate all externally supplied input at the backend boundary using the existing Joi conventions.

Frontend validation is never a security boundary.

Backend validation must enforce all required business constraints regardless of what the frontend does.

## 7. Authorization

Authorization is enforced by the backend.

Never trust client-side route protection, client-provided roles, hidden UI controls, or IDs without ownership checks.

Follow existing authentication, authorization, and permission-module conventions.

Do not invent new permissions when an existing permission applies.

## 8. Tenant Isolation — CRITICAL

QBusto is multi-tenant:

```text
Chain
 └── Cinema
      └── Screen
```

Foreign keys alone do not prove tenant ownership.

Whenever multiple tenant-owned entities are combined, verify that they belong to the same valid tenant context before reading sensitive data or writing records.

For POS data:
- `shows.cinema_id` must match the cinema belonging to `shows.pos_integration_id`.
- A non-null `shows.screen_id` must belong to the show's cinema.
- `screen_id = null` is valid for an unmapped POS screen.
- Never associate a show with another cinema's screen.
- Cross-cinema mappings must be rejected or treated as unresolved according to documented behavior.

Tenant isolation must be enforced in services and tested explicitly.

## 9. Database and Migrations

Before creating a migration:
- Inspect the existing schema.
- Check whether the table/column already exists.
- Check existing constraints, indexes, associations, and delete/update behavior.
- Follow existing SQL Server conventions.

Migrations should be explicit and reversible where practical.

For database changes, validate against real SQL Server when mocks cannot prove the behavior.

Typical lifecycle:

```text
Migration → schema verification → real DB validation → tests → rollback → re-apply
```

Do not create a new table merely because a UI needs a value if an existing normalized model already represents the concept.

## 10. Database Integrity

Use database constraints where appropriate:
- NOT NULL
- UNIQUE
- CHECK
- FOREIGN KEY
- Indexes

Cross-table tenant invariants may require service-layer enforcement when database constraints cannot safely express them.

Document important invariants.

## 11. Transactions

Use transactions when multiple related writes must succeed or fail together.

Examples:
- Order + order items
- Atomic state transitions
- Related multi-record updates

Do not use transactions unnecessarily for simple reads.

## 12. Money

Backend calculations are authoritative for:
- Subtotals
- Discounts
- Taxes
- Final totals
- Payment amounts

Never trust frontend-calculated totals.

Perform payment-unit conversions on the backend according to the established contract.

## 13. Idempotency

Operations that can be retried and create side effects must have an explicit idempotency strategy.

For order creation:
- Respect the existing `Idempotency-Key` contract.
- Reusing a key must not create a duplicate logical order.
- Do not silently generate a replacement key when the API contract requires the client to provide one.
- Ensure a key cannot safely be reused for materially different input.

For external POS operations, internal idempotency does not guarantee provider-side idempotency.

Never blindly retry an ambiguous external request unless provider idempotency is confirmed.

## 14. External Integrations / POS

Keep provider-specific behavior isolated behind the smallest useful adapter boundary.

Preferred shape:

```text
Business Service → Provider Adapter → External POS
```

Do not scatter provider-specific branches throughout business services.

If provider documentation is unavailable:
- Do not invent endpoints.
- Do not invent authentication.
- Do not invent request/response shapes.
- Do not fabricate provider behavior.
- Document the blocker.

For POS show synchronization:

```text
POS local wall-clock
      ↓
Provider-neutral adapter value
      ↓
Central timezone conversion
      ↓
UTC instant in database
      ↓
ISO UTC API response
```

Timezone conversion belongs in the sync/service layer, not individual adapters.

## 15. External API Reliability

External integrations must:
- Use appropriate timeouts.
- Distinguish definitive failures from ambiguous outcomes.
- Avoid unsafe blind retries.
- Log useful diagnostic information.
- Never log credentials, tokens, or secrets.
- Sanitize provider payloads before persistent logging.

A timeout after a request may have reached the provider. Do not automatically assume it is safe to retry.

## 16. Error Handling

Use the existing error classes and error middleware.

Client-facing errors should:
- Use the established response envelope.
- Be deterministic.
- Avoid stack traces and infrastructure details.
- Avoid exposing secrets.
- Provide useful validation details where appropriate.

Do not expose raw provider errors directly to customers.

Map external failures into safe, documented application-level errors.

## 17. Logging

Never log:
- Passwords
- API keys
- Access tokens
- Payment secrets
- Full authentication headers
- Sensitive customer data unnecessarily

For integrations, log safe identifiers, operation IDs, provider, outcome, duration, and sanitized errors.

Do not persist complete external request/response bodies by default.

## 18. API Response Consistency

Follow existing response envelopes and status-code conventions.

For successful list endpoints, return an empty list rather than 404 when that is the documented contract.

Do not introduce a new response shape without a clear reason.

HTTP status codes must describe the actual failure type.

## 19. Tests

Test behavior, not merely implementation details.

Cover where applicable:
- Happy paths
- Validation failures
- Authorization failures
- Tenant-isolation failures
- Idempotency
- Duplicate prevention
- Important state transitions
- Database constraints
- External integration failures
- Ambiguous external outcomes

Use real SQL Server validation for SQL-specific behavior such as:
- DATETIME2 behavior
- Constraints
- Indexes
- Foreign keys
- Transactions

Temporary probe scripts must be deleted after use and must not leave probe data behind.

## 20. No Silent Data Loss

Never silently discard valid input because it cannot currently be mapped.

If external data cannot be mapped:
- Preserve it where the schema permits.
- Mark it unresolved when appropriate.
- Record/log the mapping issue.
- Follow documented fallback behavior.

Example: an unmapped POS screen should not cause a valid show to disappear when `screen_id = null` is an allowed state.

## 21. Generated Files

Never manually edit generated artifacts.

Use:

```text
Source/OpenAPI
    ↓
Generation
    ↓
Generated files
```

Generated files must be reproducible from their source.

## 22. Documentation

Use:
- `backend/phases.md`
- `backend/docs/`

for project architecture, decisions, phase status, and important behavior.

When behavior changes:
- Update the relevant source-of-truth documentation.
- Do not rewrite historical phase records just to make them match current code.
- Clearly distinguish implemented, planned, deferred, and blocked work.
- Record important external blockers.

## 23. Phase Discipline

Do not implement future-phase work simply because it is convenient.

Before coding, identify:
- Current phase
- Scope
- Dependencies
- Blockers
- Deferred work

If external documentation or credentials are unavailable, stop at the appropriate architecture boundary and document the blocker.

Do not mark a phase complete until its acceptance criteria have actually been validated.

## 24. Validation Workflow

Run the relevant project checks, typically:

```bash
npm run lint
npm run format:check
npm test
```

When applicable:

```bash
npm run gen:spec
npm run gen:api
npm run db:migrate
npm run verify-schema
npm run healthcheck
```

Do not report a check as passed unless it was actually run.

## 25. Code Review Checklist

Before declaring backend work complete, review for:
- Tenant isolation
- Authorization
- Input validation
- Error handling
- Idempotency
- Race conditions
- Duplicate writes
- Transaction boundaries
- SQL Server-specific behavior
- Sensitive-data exposure
- External API retry safety
- OpenAPI consistency
- Generated-file consistency
- Unnecessary abstractions
- Scope creep

Fix real issues unless explicitly deferred. Document deferred findings and why they were not changed.

## 26. Verification Honesty

Clearly distinguish:
- Implemented
- Static-analysis verified
- Unit/integration tested
- Real-database verified
- External-provider verified
- Not tested
- Blocked

Never claim Vista/Showbiz behavior is verified without actual provider documentation/test access.

Never claim an end-to-end flow was tested without an appropriate environment.

## 27. Final Report

For substantial backend work, report:
1. Files created/modified
2. APIs added/changed
3. Database changes
4. Business rules
5. Authorization and tenant-isolation behavior
6. Tests and validation results
7. External blockers
8. Deferred issues
9. OpenAPI/generated-file status
10. Confirmation that unrelated scope was not changed

Do not commit unless explicitly requested.

## 28. Core Principles

When in doubt:

1. Backend is authoritative.
2. Tenant isolation is mandatory.
3. Do not invent contracts.
4. Follow existing project patterns.
5. Keep architecture simple.
6. Validate at the backend boundary.
7. Use database constraints where appropriate.
8. Use services for cross-entity business rules.
9. Treat external retries as potentially dangerous.
10. Never silently lose data.
11. Document important decisions.
12. Test business behavior.
13. Never claim unverified results.
14. Stay within the current phase.
15. Do not add complexity without a demonstrated need.
