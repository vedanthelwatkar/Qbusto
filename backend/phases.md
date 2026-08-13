# Backend Development Phases

This file is the progress ledger and phase gate for the QBusto **backend**.
It is the backend counterpart to `consumer/phases.md` and does not govern
Consumer, Dashboard or Kitchen work.

Before starting any backend work:

1. Read this file first.
2. Read `CLAUDE.md`, then the relevant document under `backend/docs/`.
3. Do not skip ahead to a later phase.
4. Complete **and validate** the current phase before marking it complete.
5. Do not mark a phase complete because code was written. The phase's stated
   validation must also have happened.
6. If implementation contradicts the architecture, stop and fix the
   architecture document before continuing.

Related documents:

| Document                                                       | Scope                                                |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/schema.md](./docs/schema.md)                             | The frozen database schema as it exists today        |
| [docs/schema-explained.md](./docs/schema-explained.md)         | Why the schema is shaped the way it is               |
| [docs/backend-verification.md](./docs/backend-verification.md) | Setup, verification and the API contract workflow    |
| [docs/pos-integration.md](./docs/pos-integration.md)           | POS/show architecture — **planned, not implemented** |

---

## Existing backend (historical record)

This section records what was already built before this tracker existed. It is
a record, not a plan, and should not be rewritten.

| Area             | State                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Schema           | 26 migrations, all 25 tables created; `order_statuses` and `payment_statuses` seeded                                         |
| Models           | 25 Sequelize models under `models/`, verified by `npm run verify-schema`                                                     |
| Auth             | JWT login/logout/me/change-password; module + action permission checks                                                       |
| Master data APIs | chains, cinemas, screens, categories, products, cinema-products, product-availability-hours, product-pricing, banners, users |
| Orders           | `/api/orders`, `/api/order-statuses`, `/api/payment-statuses`                                                                |
| Consumer API     | `/api/consumer/*` — cinema, screen, categories, products, banners, order create, payment-init, payment-verify                |
| Payments         | Razorpay order creation and HMAC signature verification; idempotency keys                                                    |
| Contract         | OpenAPI generated from route JSDoc into `shared/openapi.json`                                                                |
| Tests            | 450 Jest tests across 15 suites                                                                                              |

**Not built:** POS integrations, Reports, Settings, file/media storage. Their
tables exist; no application code reads or writes the POS tables.

---

## POS / Show Integration — phase progress

**All phases below are PLANNED. None has been started.**

- [ ] Phase B0 — POS architecture and source-of-truth (**IN PROGRESS — PLANNING**)
- [ ] Phase B1 — `shows` data model and migration (NOT STARTED)
- [ ] Phase B2 — POS adapter abstraction (NOT STARTED)
- [ ] Phase B3 — Vista adapter (NOT STARTED — **externally blocked**)
- [ ] Phase B4 — Showbiz adapter (NOT STARTED — **externally blocked**)
- [ ] Phase B5 — Sync orchestration and reconciliation (NOT STARTED)
- [ ] Phase B6 — Consumer shows API (NOT STARTED)
- [ ] Phase B7 — Consumer UI integration (NOT STARTED — tracked in `consumer/phases.md`)
- [ ] Phase B8 — Dashboard POS Integrations module (NOT STARTED)
- [ ] Phase B9 — Reports integration (NOT STARTED)
- [ ] Phase B10 — Testing, reconciliation and production hardening (NOT STARTED)

## Current phase

**Phase B0 — POS architecture and source-of-truth. Status: IN PROGRESS / PLANNING.**

No implementation, no migration, no generated-code change has been made.

---

### Phase B0 — POS architecture and source-of-truth

**Goal.** Establish the correct backend architecture for POS-sourced show data
before any code is written.

**Scope.** Investigation and documentation only.

**Deliverables.**

- [x] Audit of existing POS support — five tables and models exist, zero
      application code (`docs/pos-integration.md` §2)
- [x] Audit of existing show-related models — no show, session, film or seat
      table exists (§3)
- [x] Decision on whether a new table is required — **yes**, `shows` (§4)
- [x] Normalized provider-neutral model and adapter boundary (§5)
- [x] Synchronization strategy (§6)
- [x] Consumer API proposal (§7)
- [x] Three-hour window design (§8)
- [x] Timezone strategy and the `cinemas.timezone` gap (§9)
- [x] Dashboard and Reports implications (§10, §11)
- [x] Open questions and risks recorded (§12, §13)
- [x] This tracker created

**Dependencies.** None.

**API / data-model implications.** None yet. The design proposes one new table
and one additive request field; neither has been created.

**Validation.** Documentation consistency only. No code changed, so no lint,
typecheck, build or test run applies.

**Deferred.** Every decision in §12 of the architecture document. Phase B1
cannot start until §12.1 (cinema timezone) is decided.

---

### Phase B1 — `shows` data model and migration

**Goal.** A queryable catalog of shows, independent of orders.

**Scope.** One migration, one model, association wiring. No service, no route,
no adapter.

**Deliverables.**

- Migration creating `shows` per `docs/pos-integration.md` §4.1, including the
  unique index on `(pos_integration_id, external_session_id)` and
  `IX_shows_cinema_show_time`
- `models/show.js` with associations to `Cinema`, `Screen`, `PosIntegration`
- Reverse associations added to those three models
- `docs/schema.md`, `docs/schema.dbml` and `docs/schema-explained.md` updated to
  include the new table
- Timezone decision (§12.1) recorded in the architecture document

**Dependencies.** B0. Blocked on open question §12.1.

**API / data-model implications.** First migration since the schema freeze.
CLAUDE.md permits this where a task explicitly requires it; the justification is
`docs/pos-integration.md` §4.

**Validation.** `npm run verify-schema`; `npm run healthcheck` reports the new
migration count; a real SQL Server probe confirming the unique index rejects a
duplicate `(pos_integration_id, external_session_id)` and that a `DATETIME2`
round trip preserves the UTC instant (§9.1). All probe rows deleted afterward.

**Deferred.** Retention policy. Any `films` table.

---

### Phase B2 — POS adapter abstraction

**Goal.** A provider boundary such that nothing above it branches on
`vista` vs `showbizz`.

**Scope.** The adapter contract, the provider registry, credential resolution
from `pos_integrations.credential_ref`, and error normalization. No real
provider yet.

**Deliverables.**

- `ExternalShow` contract and `fetchShows(integration, range)` signature
  (§5)
- Provider registry keyed on `pos_integrations.provider`
- Credential resolution — decides what `credential_ref` actually points at
- Normalized POS error taxonomy (unreachable / auth failed / bad response)
- Unit tests against a stub adapter

**Dependencies.** B1.

**API / data-model implications.** None. Internal only.

**Validation.** Jest unit tests. Lint. No live POS call.

**Deferred.** Every real provider call. Product and screen sync — this phase
covers shows only.

---

### Phase B3 — Vista adapter

**Goal.** Fetch real sessions from Vista.

**Scope.** One adapter implementing the B2 contract.

**Deliverables.** Vista client, response mapping to `ExternalShow`,
authentication, timeout and retry behaviour, adapter tests against recorded real
responses.

**Dependencies.** B2. **Externally blocked** on open question §12.3 — Vista API
documentation, endpoints and sandbox credentials. No contract may be invented
and no fake show data may be introduced.

**API / data-model implications.** None beyond B1.

**Validation.** Adapter tests. One live fetch against a real Vista instance,
compared field by field against what the POS UI displays for the same show —
especially the show time, to prove the timezone assumption (§9).

**Deferred.** Vista order/booking submission. This phase reads shows only.

---

### Phase B4 — Showbiz adapter

**Goal.** The same, for Showbiz.

Identical in shape to B3. Note the schema spells the provider **`showbizz`**.
**Externally blocked** on the same open question. Independent of B3 — either may
be built first.

---

### Phase B5 — Sync orchestration and reconciliation

**Goal.** Keep `shows` a faithful mirror of POS state.

**Scope.** The sync service, the reconciliation rules, the scheduling mechanism,
and a manual trigger.

**Deliverables.**

- `showSync.service` — per-integration upsert on the natural key
- Timezone normalization, in exactly one place (§9.3)
- Screen mapping via `screen_pos_mappings`, tolerating unmapped screens
- Reconciliation per §6.3, including the rule that a failed sync cancels nothing
- Scheduling mechanism, per the decision on §12.4
- Manual sync entry point for the Dashboard
- Failure isolation — one integration's failure must not stop the others

**Dependencies.** B2, plus at least one of B3 / B4.

**API / data-model implications.** Writes `shows`. No new table.

**Validation.** Unit tests for every reconciliation rule. A real-database probe
covering: first sync inserts; repeated sync does not duplicate; a changed show
time updates in place; a disappeared show is cancelled; a failed sync leaves rows
untouched. Probe data deleted and the database confirmed clean.

**Deferred.** Persisted sync audit (§12.5). Retention.

---

### Phase B6 — Consumer shows API

**Goal.** `GET /api/consumer/cinemas/{cinemaId}/shows` and `showId` on order
creation.

**Scope.** Route, controller, service, validator, OpenAPI annotation.

**Deliverables.**

- The endpoint per §7, with the ±3h window per §8
- Provider fields excluded from the response
- Optional `showId` on `POST /api/consumer/orders`, with the backend deriving
  `film_title`, `show_time` and `screen_id` and writing `order_pos_context`
- Show verified to belong to the requested cinema; out-of-scope → `404`
- `npm run gen:spec`, then `gen:api` in the Consumer

**Dependencies.** B1 for the schema; **B5 plus a real adapter for meaningful
validation**, since no fake show data may be introduced.

**API / data-model implications.** One new public endpoint. One additive
request field. No response-shape change to existing endpoints. No `orders`
column added (§4.2).

**Validation.** Route tests. A real-database probe covering the window
boundaries (a show exactly at `now - 3h` and `now + 3h` must be included, one
just outside must not), chronological ordering, the empty-window `200 []` case,
an unknown cinema `404`, and a `showId` belonging to another cinema `404`.
OpenAPI regenerated and the Consumer client compiled.

**Deferred.** Pagination (§7). Any cinema-specific window length.

---

### Phase B7 — Consumer UI integration

**Goal.** The Show Time dropdown, and Row No. as an A–Z dropdown.

Frontend work. **Tracked in `consumer/phases.md`, not here.** Listed only to
record the dependency and the contract changes it forces:

- Show Time becomes a dropdown fed by B6, sorted chronologically, labelled
  `time — screen — film`
- Show Time is **never** prefilled from the QR (open question §12.6)
- Row No. becomes an A–Z dropdown; Row and Seat continue to combine into the
  single `seat_number` field
- Behaviour when the dropdown is empty depends on open question §12.7

**Dependencies.** B6.

---

### Phase B8 — Dashboard POS Integrations module

**Goal.** Make integrations configurable and syncs observable by staff.

**Scope.** Staff APIs for `pos_integrations`, `screen_pos_mappings`,
`product_pos_mappings`; a read-only shows viewer; a manual sync trigger.

**Deliverables.** Routes, controllers, services and validators following the
existing master-data pattern; `POS Integrations` permission enforcement; tenant
isolation with `404` for out-of-scope resources; secrets never returned in any
response; OpenAPI regenerated.

**Dependencies.** B1, B2. Manual sync additionally needs B5.

**Validation.** Route tests including permission and cross-tenant cases. A real
SQL Server probe for the filtered unique index allowing only one active
integration per cinema.

**Deferred.** Dashboard frontend, which is tracked separately.

---

### Phase B9 — Reports integration

**Goal.** Show-aware reporting.

**Scope.** Report queries joining `orders` → `order_pos_context` → `shows` on
`(pos_integration_id, external_session_id)`.

**Deliverables.** Sales per show, per film and per screen; POS sync health;
`Reports` permission enforcement; tenant isolation.

**Dependencies.** B5 for populated data. Independent of B6.

**Validation.** Real-database probes with known orders, verifying totals against
hand-computed values.

**Deferred.** Report export and scheduled report delivery.

---

### Phase B10 — Testing, reconciliation and production hardening

**Goal.** Prove the integration survives real conditions.

**Scope.** Failure injection, reconciliation under adverse conditions, and
operational readiness.

**Deliverables.** POS-down, POS-slow and malformed-response behaviour; clock
skew handling; duplicate-prevention proof against real POS data; `shows`
retention policy; a decision on persisted sync audit (§12.5); credential
handling review confirming no secret is logged or returned; the load profile of
the sync at the real cinema count.

**Dependencies.** All previous phases.

**Validation.** End-to-end against a real POS: a show visible in the POS appears
in the Consumer dropdown at the correct local time, is selectable, and produces
an order whose `order_pos_context` carries the correct external session id.

**Deferred.** Anything not required to run in production safely.

---

## Dependency graph

```
B0 ─▶ B1 ─▶ B2 ─┬─▶ B3 (Vista)   ─┐
                │                 ├─▶ B5 ─┬─▶ B6 ─▶ B7 (consumer/phases.md)
                └─▶ B4 (Showbiz) ─┘       │
                │                         └─▶ B9
                └─▶ B8
```

- B3 and B4 are independent of each other and both externally blocked.
- B5 needs B2 and at least one working adapter.
- B6 can be _written_ after B1 but cannot be _validated_ without real synced
  data, because no fake show data may be introduced.
- B8 needs only B1 and B2, except for its manual-sync action.
- B9 needs B5, not B6.

## Blocked on external input

| Blocker                                           | Blocks               |
| ------------------------------------------------- | -------------------- |
| Vista API documentation, endpoints, credentials   | B3, and therefore B5 |
| Showbiz API documentation, endpoints, credentials | B4                   |
| Cinema timezone decision (§12.1)                  | B1                   |
| Consumer QR contract decision (§12.6)             | B7                   |
| Empty-dropdown product decision (§12.7)           | B7                   |
