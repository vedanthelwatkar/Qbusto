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

| Document                                                       | Scope                                               |
| -------------------------------------------------------------- | --------------------------------------------------- |
| [docs/schema.md](./docs/schema.md)                             | The frozen database schema as it exists today       |
| [docs/schema-explained.md](./docs/schema-explained.md)         | Why the schema is shaped the way it is              |
| [docs/backend-verification.md](./docs/backend-verification.md) | Setup, verification and the API contract workflow   |
| [docs/pos-integration.md](./docs/pos-integration.md)           | POS/show architecture — §4 built (B1), rest planned |

---

## Existing backend (historical record)

This section records what was already built before this tracker existed. It is
a record, not a plan, and should not be rewritten.

| Area             | State                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema           | 26 migrations, all 25 tables created; `order_statuses` and `payment_statuses` seeded. (Phase B1 later added a 27th migration and the `shows` table.) |
| Models           | 25 Sequelize models under `models/`, verified by `npm run verify-schema`. (Phase B1 later added `Show`, making 26.)                                  |
| Auth             | JWT login/logout/me/change-password; module + action permission checks                                                                               |
| Master data APIs | chains, cinemas, screens, categories, products, cinema-products, product-availability-hours, product-pricing, banners, users                         |
| Orders           | `/api/orders`, `/api/order-statuses`, `/api/payment-statuses`                                                                                        |
| Consumer API     | `/api/consumer/*` — cinema, screen, categories, products, banners, order create, payment-init, payment-verify                                        |
| Payments         | Razorpay order creation and HMAC signature verification; idempotency keys                                                                            |
| Contract         | OpenAPI generated from route JSDoc into `shared/openapi.json`                                                                                        |
| Tests            | 450 Jest tests across 15 suites                                                                                                                      |

**Not built:** POS integrations, Reports, Settings, file/media storage. Their
tables exist; no application code reads or writes the POS tables.

---

## POS / Show Integration — phase progress

**B0 and B1 are complete. B2–B10 are PLANNED and have not been started.**

- [x] Phase B0 — POS architecture and source-of-truth (COMPLETE — 2026-08-13)
- [x] Phase B1 — `shows` data model and migration (COMPLETE — 2026-08-13,
      VALIDATED AGAINST REAL SQL SERVER)
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

**Next: Phase B2 — POS adapter abstraction. Status: NOT STARTED.**

B1 delivered the `shows` table and model only. No POS route, controller,
service, adapter, sync or Consumer endpoint exists, and no OpenAPI or generated
client changed.

B2 can begin without external input. B3 and B4 cannot — they are blocked on
Vista/Showbiz documentation and credentials (§12.3).

---

### Phase B0 — POS architecture and source-of-truth — COMPLETE (2026-08-13)

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
- [x] Decisions resolved (2026-08-13) — recorded in the §12 decision register

**Decisions taken (2026-08-13).**

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §12.1  | **Cinema timezone: a `cinemas.timezone` IANA column** (for example `Asia/Kolkata`), not a global `CINEMA_TIMEZONE` environment variable. Checked against the existing architecture before accepting: the schema freeze permits a migration where a task requires one; `cinemas` already carries per-cinema operational settings; and no global-timezone pattern exists to contradict. No strong reason against was found. **Scheduled for Phase B5**, where the sync service first reads it — the column is not needed to create or use `shows`, whose `show_time` is already a UTC instant. Rationale in `docs/pos-integration.md` §9.4. |
| §9.3   | Show time semantics unchanged: POS supplies cinema-local wall clock, adapter returns it unconverted, sync service converts centrally, `shows.show_time` stores the UTC instant, API returns ISO UTC, client formats for display. No provider-specific timezone behaviour.                                                                                                                                                                                                                                                                                                                                                                 |
| §12.3  | **POS API contracts remain BLOCKED.** No Vista or Showbiz endpoint, authentication scheme, response format or field was invented, and no fake provider response or show data exists in the repository.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| §12.4  | **Scheduler deliberately not selected.** Deferred to Phase B5, after the POS architecture and deployment environment are confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| §12.11 | Consumer Show Time behaviour recorded in `docs/pos-integration.md` §12.11 — required, never prefilled from QR, sourced from the B6 shows API, server-side ±3h inclusive window, chronological, `200 []` when empty, Consumer shows an empty state. Backend-side record only; **no Consumer code was changed.**                                                                                                                                                                                                                                                                                                                            |

**Dependencies.** None.

**API / data-model implications.** None from B0 itself. The design proposes one
new table (built in B1), one additive request field (B6), and one column on
`cinemas` (B5).

**Validation.** Documentation consistency only. No code changed in B0, so no
lint, typecheck, build or test run applied to it.

**Deferred.** The still-open items in the §12 register: §12.2 film master table,
§12.5 persisted sync audit, §12.6 Consumer QR contract, §12.7 empty-dropdown
behaviour, §12.8 cancelled shows, §12.9 sync cadence, §12.10 unmapped screens.

---

### Phase B1 — `shows` data model and migration — COMPLETE (2026-08-13)

**Goal.** A queryable catalog of shows, independent of orders.

**Scope.** One migration, one model, association wiring. No service, no route,
no adapter.

**Deliverables — all delivered.**

- [x] Migration `20260813000100-create-shows.js` creating `shows` exactly per
      `docs/pos-integration.md` §4.1
- [x] `UQ_shows_external_session` unique on `(pos_integration_id, external_session_id)`
- [x] `IX_shows_cinema_show_time` on `(cinema_id, show_time)`
- [x] `CK_shows_status` restricting `status` to `scheduled` / `cancelled`
- [x] `models/show.js` — `Show belongsTo Cinema | Screen | PosIntegration`
- [x] Reverse `hasMany` associations added to `Cinema`, `Screen`,
      `PosIntegration`, matching the existing association style
- [x] `docs/schema.md`, `docs/schema.dbml`, `docs/schema-explained.md` updated
- [x] Timezone decision (§12.1) recorded in `docs/pos-integration.md` §9.4

**Files.**

| File                                        | Change                                      |
| ------------------------------------------- | ------------------------------------------- |
| `migrations/20260813000100-create-shows.js` | created                                     |
| `models/show.js`                            | created                                     |
| `models/cinema.js`                          | `Cinema.hasMany(Show, as: 'shows')`         |
| `models/screen.js`                          | `Screen.hasMany(Show, as: 'shows')`         |
| `models/posintegration.js`                  | `PosIntegration.hasMany(Show, as: 'shows')` |

**Implementation notes.**

- Model file placed at `models/show.js`, matching every other model. The Phase B1
  brief said `src/models/show.js`; that directory does not exist, so the existing
  convention was followed.
- `screen_id` is nullable, so its FK is declared nullable rather than being
  omitted — a show can arrive before its external screen is mapped.
- All three foreign keys use `ON DELETE NO ACTION, ON UPDATE NO ACTION`,
  matching every other table in the schema.
- No `created_by` / `updated_by`: these rows are machine-written by the future
  sync. Matches `order_pos_context` and `pos_transactions`.
- No `is_active`: lifecycle is `status` + `last_synced_at`.
- Raw type strings (`'VARCHAR(100)'`, `'DATETIME2'`) and the
  `ALTER TABLE ... ADD CONSTRAINT ... CHECK` pattern follow
  `20260809002400-create-pos-transactions.js`.

**Dependencies.** B0, including the §12.1 timezone decision. Satisfied.

**API / data-model implications.** First migration since the schema freeze.
CLAUDE.md permits this where a task explicitly requires it; the justification is
`docs/pos-integration.md` §4. **No API endpoint, OpenAPI change, or generated
client change** — `shared/openapi.json` and every generated client are untouched.
No change to `orders`.

**Validation — actually run, 2026-08-13.**

| Check                          | Result                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `npm run lint`                 | pass, 0 errors, 0 warnings                                              |
| `npm run format:check`         | pass, all files match Prettier style                                    |
| `npx sequelize-cli db:migrate` | applied against the real SQL Server (0.095s)                            |
| `npm run verify-schema`        | pass — 26 models, 120 associations, `shows` listed                      |
| `npm run healthcheck`          | pass — 27 migrations applied, SQL Server 17.0.1000.7                    |
| `npm test`                     | **450 passed / 450**, 15 suites, no regression                          |
| Real-database probe            | **42 assertions, 42 passed, 0 failed**                                  |
| Rollback                       | `db:migrate:undo` reverted cleanly; `shows` dropped; re-applied cleanly |

Probe coverage against the real database (temporary uniquely-named fixtures,
exercised through the Sequelize layer and raw SQL):

1. migration applies — confirmed
2. model loads, all attributes present, no audit fields — confirmed
3. all six associations resolve, and eager loading of
   cinema/screen/posIntegration returns the right rows — confirmed
4. duplicate `(pos_integration_id, external_session_id)` **rejected**; the same
   `external_session_id` under a _different_ integration is **accepted** —
   confirmed, so the natural key scopes per provider as intended
5. both indexes exist with the expected columns, order and uniqueness, read from
   `sys.indexes` — confirmed
6. `screen_id = NULL` insert succeeds and eager-loads `screen` as `null` —
   confirmed
7. `DATETIME2` round trip: `2026-08-13T05:00:00.000Z` stored and read back
   identically, and the raw column value is `2026-08-13T05:00:00` — the UTC wall
   clock, with no local offset applied — confirmed
8. rollback works — confirmed
9. cleanup verified by row counts: 0 probe rows in `shows`, `pos_integrations`,
   `cinemas`, `screens`, `chains`; `shows` table left empty

Additionally confirmed: `CK_shows_status` rejects an invalid status at the
**database** level (not only via the model validator), the three FKs point at
`cinemas` / `screens` / `pos_integrations`, every column's nullability, type and
length matches the design, `status` defaults to `scheduled`, and no
`created_by` / `updated_by` / `is_active` column exists.

The probe script was deleted after the run. No probe data remains.

**Deferred.** Retention policy. Any `films` table. The `cinemas.timezone`
column — decided in B0, scheduled for B5 where it is first read.

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

- **Migration adding `cinemas.timezone`** (IANA string, e.g. `Asia/Kolkata`),
  per the B0 decision on §12.1. This phase is where the column is first read, so
  it is created here rather than sitting unused since B1. Settle at the same
  time: default for existing rows, nullability, and whether the Dashboard
  exposes it for editing.
- `showSync.service` — per-integration upsert on the natural key
- Timezone normalization, in exactly one place (§9.3), reading
  `cinemas.timezone`
- Screen mapping via `screen_pos_mappings`, tolerating unmapped screens
- Reconciliation per §6.3, including the rule that a failed sync cancels nothing
- Scheduling mechanism, per the decision on §12.4
- Manual sync entry point for the Dashboard
- Failure isolation — one integration's failure must not stop the others
- **Tenant-consistency enforcement (see below)**

**Tenant-consistency enforcement — mandatory.**

The database does not enforce these relationships, and `showSync.service` is the
only component that writes `shows`, so enforcement lives here. Documented in
`docs/schema.md` under "Tenant-consistency invariants". Required by CLAUDE.md,
which mandates tenant isolation across "future orders/POS data".

- Validate `show.cinemaId === posIntegration.cinemaId` **before** every upsert.
  Reject the row on mismatch; never write it.
- When resolving `screenId` from `screen_pos_mappings`, verify the resolved
  screen belongs to the same cinema as the integration and the show
  (`screens.cinemaId === show.cinemaId`). `screen_pos_mappings` does not
  constrain this itself, so a mapping created against the wrong cinema can
  resolve to a foreign screen.
- **Never associate a show from one cinema with another cinema's screen.** On a
  cross-cinema screen resolution, do not attach the screen; treat it as
  unresolved and surface it as a mapping error.
- A missing or unmapped screen MUST yield `screenId = null` and the show MUST
  still be written and remain visible. Dropping the show is not an acceptable
  fallback — it silently loses a real show from the Consumer dropdown.

**Dependencies.** B2, plus at least one of B3 / B4.

**API / data-model implications.** Writes `shows`. Adds one column to `cinemas`.
No new table.

**Validation.** Unit tests for every reconciliation rule. A real-database probe
covering: first sync inserts; repeated sync does not duplicate; a changed show
time updates in place; a disappeared show is cancelled; a failed sync leaves rows
untouched. Probe data deleted and the database confirmed clean.

Tenant-isolation tests are required and must cover, at minimum:

| #   | Case                                               | Expected                                                             |
| --- | -------------------------------------------------- | -------------------------------------------------------------------- |
| a   | Correct integration + correct cinema               | Accepted; show written with `cinemaId` matching the integration      |
| b   | Integration / cinema mismatch                      | **Rejected**; no row written                                         |
| c   | Screen mapping resolves to another cinema's screen | **Rejected / not associated**; the show is not linked to that screen |
| d   | Unmapped screen                                    | Show written with `screenId = null` and remains visible              |

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
| Consumer QR contract decision (§12.6)             | B7                   |
| Empty-dropdown product decision (§12.7)           | B7                   |

The cinema timezone decision (§12.1) is **resolved** and no longer blocks
anything: `cinemas.timezone` is the agreed design, scheduled for B5.

**Nothing blocks Phase B2** — the adapter abstraction can be built against a stub
without any provider documentation.
