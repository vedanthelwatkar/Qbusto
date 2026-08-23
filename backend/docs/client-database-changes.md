# Client Database Change Review

Audit only. No application code, model, migration, seed or database object was
changed while producing this document.

**Source of truth for this review:** `Qbusto.bak`, a full backup of the database
`qbusto` taken 2026-08-23 16:47:27 (compatibility level 150, collation
`SQL_Latin1_General_CP1_CI_AS`). It was restored into an isolated database,
`qbusto_client_review`, on the same instance. The development database was not
overwritten, and the backup was not copied into the repository.

Only the `qbusto` database is in scope. The instance also hosts
`Vista_PopExpress`; it was not examined.

---

**Status update, post-review.** This document is the original point-in-time
audit and is left as written below. Two things it flagged have since moved:

- The naming alignment it recommended (`Film` → `film`, `Session` → `session`,
  `screens.Category` → `category`, `screens.SeatRow` → `seat_row`,
  `screen_layout` columns to snake_case) was implemented in
  `20260823001000-align-client-naming.js`.
- §8's "Apply the pending migrations" step could not be satisfied as written,
  because the old `films`/`sessions` migrations it referred to created a
  *separate, QBusto-owned* pair of tables that would have duplicated the
  client's own `film`/`session`. Those migrations were removed instead, and
  `20260824000100-provision-client-schema.js` now creates the client's actual
  tables (and `screen_layout`, and `screens.category`/`seat_row`) when they are
  absent, so a fresh database ends up with the same objects this database has.
  See `docs/schema-explained.md` for the current architecture.

`Session_strStatus` has since been defined by the client - `O`=Open,
`C`=Closed, `I`=Inactive - and the Consumer now offers Open sessions only.
`Film_strNowShowingFlag` remains undefined and is passed through raw, without
interpretation. See `docs/schema-explained.md` for the current state of each.

---

## 1. Executive Summary

Three things need to be understood before any work is planned.

**The backup and the live `qbusto` database are schema-identical.** A full
object-by-object comparison found **zero** differences in tables, columns, data
types, nullability, defaults, primary keys, foreign keys, unique constraints,
indexes, check constraints, identity properties, computed columns, views,
stored procedures, functions, triggers, sequences and schemas. The live
development database already *is* the client's updated database.

**The client's database does not contain the Phase 1 `films` and `sessions`
tables.** `SequelizeMeta` stops at `20260817000200`, so the three most recent
repository migrations — `20260823000100-create-cinema-shows`,
`20260823000200-create-films-and-sessions` and `20260823000300-drop-cinema-shows`
— have never been applied to it. Those two tables now exist in the repository's
models but not in the database. This is the single largest gap and it blocks the
backend from starting a Session query.

**The client models screens at seat-row granularity, which conflicts with ours.**
The two new columns are not merely additive. `screens` holds 82 rows for only 27
distinct (cinema, screen name) pairs, because the client has added one row per
seat row. QBusto treats one `screens` row as one auditorium and `orders.screen_id`
is a foreign key to it. This needs a decision before anything is implemented.

There is no evidence of any other schema change. The client also added an empty
`screen_layout` table and loaded the Vista `Film` and `Session` tables with real
data.

---

## 2. Known Changes

### `screens.Category`

| | |
| --- | --- |
| Type | `nvarchar(50)`, NULL |
| Distinct values | `Platinum` (54 rows), `Recliner` (7 rows), `NULL` (21 rows) |
| In current QBusto DB | **Yes** — the live database is the client's |
| In Sequelize model | **No** — `models/screen.js` does not declare it |
| In migrations | **No** — no migration creates it |
| Referenced in code | **No** — zero references anywhere in the repository |

The 21 `NULL` rows are the original QBusto seeded screens (ids 1–21); every row
the client added has a value.

`Category` is a **seat class**, not a screen class. The values are the names
cinemas give to seating tiers, and the same auditorium carries more than one:
cinema 8 "Screen 1" is `Platinum` for rows A–I and `Recliner` for row J. It is
therefore not a property of the auditorium at all.

### `screens.SeatRow`

| | |
| --- | --- |
| Type | `nvarchar(2)`, NULL |
| Distinct values | Single letters `A` through `N`, plus `NULL` (21 rows) |
| In current QBusto DB | **Yes** |
| In Sequelize model | **No** |
| In migrations | **No** |
| Referenced in code | **No** |

`SeatRow` is a **seat-row label**, not a count and not a configuration blob. The
width (2 characters) matches a row label like `A` or `AA`, and matches the
`ROW_PATTERN` (`/^[A-Za-z]{1,2}$/`) the Consumer already uses when it splits a
seat such as `A5` into row and seat.

### What the two columns mean together

The client has repurposed `screens` as a **seat-row band table**:

```
one row per (cinema, screen name, seat category, seat row)
```

Evidence: 82 rows across 27 distinct (cinema, screen) pairs; contiguous row
letters per screen; category changing between rows of the same screen.

Worked example — cinema 8, "Screen 1" (10 rows for one auditorium):

| id | cinema_id | name | Category | SeatRow |
| --- | --- | --- | --- | --- |
| 22 | 8 | Screen 1 | Platinum | A |
| 23 | 8 | Screen 1 | Platinum | B |
| … | 8 | Screen 1 | Platinum | … |
| 30 | 8 | Screen 1 | Platinum | I |
| 31 | 8 | Screen 1 | Recliner | J |

This is a **semantic conflict**, not an additive change. In QBusto one `screens`
row is one auditorium: `orders.screen_id` and `sessions.screen_id` are foreign
keys to it, and screen names are unique within a cinema. Under the client's
usage there are ten "Screen 1" rows at cinema 8, and it is undefined which one an
order should reference.

---

## 3. Complete Schema Differences

`Current QBusto` below means the repository — migrations, models and
`docs/schema.md`. `Client Backup` means the restored database, which is also the
live development database.

| Object | Current QBusto | Client Backup | Difference | Required Action |
| --- | --- | --- | --- | --- |
| `screens.Category` | absent | `nvarchar(50)` NULL | Column added | Decide semantics, then model + migration + docs |
| `screens.SeatRow` | absent | `nvarchar(2)` NULL | Column added | Decide semantics, then model + migration + docs |
| `screens` grain | one row per auditorium | one row per seat row | **Semantic conflict** | Clarify with client before any code |
| `screen_layout` | absent | table, 11 columns, 0 rows | Table added, empty | Clarify intent; no code yet |
| `Film` | absent (we have `films`) | Vista table, 44 cols, 69 rows | Client table present | No QBusto change — map in Phase 2 |
| `Session` | absent (we have `sessions`) | Vista table, 24 cols, 133 rows | Client table present | No QBusto change — map in Phase 2 |
| `films` | model + migration exist | **absent** | Migration not applied | Apply pending migrations |
| `sessions` | model + migration exist | **absent** | Migration not applied | Apply pending migrations |
| `cinema_shows` | dropped by migration | absent | Consistent | None |
| `SequelizeMeta` | 32 migrations | 29 rows | 3 migrations unapplied | Run `db:migrate` |
| `Film.test_column` | n/a | `nchar(1000)` NULL | Leftover test column | Query client |
| Tables (other) | — | — | **No difference** | None |
| Columns (other) | — | — | **No difference** | None |
| Data types | — | — | **No difference** | None |
| Nullability | — | — | **No difference** | None |
| Defaults | — | — | **No difference** | None |
| Primary keys | — | — | **No difference** | None |
| Foreign keys | — | — | **No difference** | None |
| Unique constraints | — | — | **No difference** | None |
| Indexes | — | — | **No difference** | None |
| Check constraints | — | — | **No difference** | None |
| Identity properties | — | — | **No difference** | None |
| Computed columns | — | — | none in either | None |
| Views / procs / functions / triggers | none | **none** | No difference | None |
| Sequences | none | none | No difference | None |
| Schemas | `dbo` | `dbo` | No difference | None |
| Collation | `SQL_Latin1_General_CP1_CI_AS` | same | No difference | None |

Two apparent differences were investigated and dismissed:

- `users.password` appears in the model but not the database. It is a
  **write-only virtual attribute** that a hook hashes into `password_hash`; it
  was never a column. Not a gap.
- `cinemas.code` carries `UQ_cinemas_code`, which the client's
  `FK_Session_cinemas` depends on. That unique key is ours and already exists.
  Not a change.

---

## 4. Table-by-Table Changes

### Table: `screens`

**Current (repository — migration `20260809000800`, `models/screen.js`, `docs/schema.md`):**

```
id, cinema_id, name, is_active, created_by, updated_by, created_at, updated_at
```
One row = one auditorium. Name unique within a cinema (enforced in
`screen.service`, not by the database). `orders.screen_id` and
`sessions.screen_id` are foreign keys to it.

**Client:**

```
id, cinema_id, name, Category nvarchar(50) NULL, SeatRow nvarchar(2) NULL,
is_active, created_by, updated_by, created_at, updated_at
```
82 rows, 27 distinct (cinema, name) pairs — one row per seat row.

**Changes:** two nullable columns added; no constraint, index, key or type change.
All three existing foreign keys are intact.

**QBusto impact:** high, and not proportional to the size of the change. Adding
the two columns to the model is trivial. Accepting the client's *grain* is not:
it would break the one-auditorium-per-row assumption that `orders.screen_id`,
`sessions.screen_id`, `ScreenSelect`, the Consumer's session picker and
`screen.service`'s name-uniqueness rule all rest on. **Blocked pending
clarification.**

### Table: `screen_layout` (new)

**Current:** does not exist.

**Client:**

| Column | Type | Null |
| --- | --- | --- |
| id | int identity | NOT NULL |
| cinema_id | int | NOT NULL |
| ScreenName | varchar(50) | NOT NULL |
| Category | varchar(50) | NOT NULL |
| SeatRow | varchar(2) | NOT NULL |
| SeatNo | varchar(3) | NOT NULL |
| is_active | bit | NOT NULL |
| created_by / updated_by | int | NULL |
| created_at / updated_at | datetime2 | NOT NULL |

Foreign keys to `cinemas` and `users` (created_by, updated_by). **0 rows.**

**Changes:** whole table added, structure only.

**QBusto impact:** none today. This is a **seat map** — one row per physical
seat — and it is the natural home for the seat-level data currently sitting on
`screens`. It links to the screen by `ScreenName` string rather than by
`screens.id`, which is a normalisation weakness worth raising. QBusto does not
sell or allocate seats, so nothing in Phase 1 needs it.

### Table: `Film` (client, Vista)

**Current:** we have `films` (id, title, certification, duration_minutes,
language, image_url, is_active, audit columns).

**Client:** the raw Vista `Film` table — 44 columns, `Film_strCode varchar(20)`
primary key, 69 rows. Includes `Film_strTitle`, `Film_strCensor`,
`Film_intDuration`, `Film_strURLforGraphic`, gross money columns, alternate-language
columns, and a stray **`test_column nchar(1000)`**.

**Changes:** table present in the client database, absent from ours.

**QBusto impact:** none for Phase 1. `CONTRIBUTING.md` is explicit that the
legacy schema is not reproduced and that Vista identifiers belong in the POS
mapping layer. `films` already covers what an order and a picker need. In Phase 2
the POS sync maps `Film_strCode` → `films` through a mapping table. **Do not
recreate this table.**

### Table: `Session` (client, Vista)

**Current:** we have `sessions` (cinema_id, screen_id, film_id, starts_at,
ends_at, seats_total, seats_available, status, audit columns).

**Client:** the raw Vista `Session` table — 24 columns, composite primary key
`(Code, Session_lngSessionId)`, 133 rows. Foreign keys to `Film`
(`Film_strCode`) and to `cinemas` (`Code` → `cinemas.code`).

**Changes:** table present in the client database, absent from ours.

**QBusto impact:** none for Phase 1, for the same reason as `Film`. It does
confirm the Phase 2 mapping: `Session.Code` → `cinemas.code`,
`Session.Film_strCode` → film, `Session_dtmRealShow` → `starts_at`,
`Session_dtmFinishShow` → `ends_at`, `Session_intSeatsAvail`/`Total` → seats,
`Session_strStatus` → status. That is exactly the mapping `sessions` was
designed around. **Do not duplicate the Session concept.**

### Tables: `films`, `sessions` (ours, missing from the client database)

**Current:** created by migration `20260823000200`; models, services, routes,
Dashboard pages and the Consumer picker all depend on them.

**Client:** absent. `SequelizeMeta` has 29 rows and ends at `20260817000200`.

**QBusto impact:** **immediate and breaking.** Any Session or Film request
against this database fails at the SQL layer. Running `npm run db:migrate` (or
`npx sequelize-cli db:migrate`) applies the three pending migrations and
restores them; `20260823000300` will also drop `cinema_shows`, which is already
absent here, so that step is a no-op in effect but will error if the table does
not exist — see §10.

### All other tables

`banners`, `categories`, `chains`, `cinema_categories`, `cinema_products`,
`cinemas`, `idempotency_keys`, `order_items`, `order_pos_context`,
`order_status_logs`, `order_statuses`, `orders`, `payment_gateway_config`,
`payment_status_logs`, `payment_statuses`, `pos_integrations`, `pos_transactions`,
`product_availability_hours`, `product_pos_mappings`, `product_pricing`,
`products`, `razorpay_webhook_events`, `screen_pos_mappings`, `shows`,
`user_permissions`, `users` — **no schema change of any kind**.

Note in particular that `orders`, `order_items`, the payment tables and the
image columns are untouched, so the order snapshot architecture, payment
architecture and image storage architecture are unaffected.

---

## 5. Data Differences

Data changes are the client's own and are treated here as informational only —
this review is about schema. No credentials, tokens, hashes or personal data were
read or are reproduced below; counts and non-sensitive labels only.

| Table | Rows | Note |
| --- | --- | --- |
| `Film` | 69 | Real Vista film catalogue |
| `Session` | 133 | Real Vista session data |
| `screen_layout` | **0** | Structure only — nothing populated |
| `screens` | 82 | 21 original + 61 client seat-row rows |
| `cinemas` | 10 | |
| `products` | 40 | |
| `orders` | 11 | Unchanged shape |
| `users` | 2 | Not inspected beyond the count |
| `shows` | 0 | POS mirror, still empty |

The only data point that carries schema meaning is the `screens` distribution —
82 rows over 27 (cinema, screen) pairs — which is what establishes the grain
conflict in §2.

---

## 6. Application Impact

### `screens.Category` / `screens.SeatRow`

**Backend**

- *Model* — `models/screen.js` would need both attributes. Not present today.
- *Migration* — a new `addColumn` migration would be required to bring a clean
  database in line. **None exists**, so any freshly migrated environment lacks
  these columns while this one has them: the repository and this database have
  drifted apart.
- *Service* — `screen.service.js` would need them in `PUBLIC_ATTRIBUTES` to
  return them, and its name-uniqueness rule (`assertNameAvailable`) would have to
  change if the client's grain is adopted, because duplicate names become normal.
- *Controller* — no change; it passes through.
- *API / OpenAPI* — `Screen` schema and the create/update bodies in
  `screen.routes.js` would gain two optional fields.

**Dashboard**

- *UI / forms* — `ScreenFormModal` would gain two inputs.
- *Tables* — `ScreensPage` columns.
- *Details drawers* — `ScreenDetailsDrawer` rows.
- *Selectors* — `ScreenSelect` labels would become ambiguous under the client's
  grain: ten identically named options per auditorium.

**Consumer**

- *API/client* — regenerate only if the `Screen` schema changes.
- *UI* — no change for Phase 1. The session picker shows `screenName`; under the
  client's grain that value repeats across ten rows and the picker breaks.

**Kitchen**

- No impact. Kitchen reads orders, not screens.

### `screen_layout`

No impact anywhere until a decision is taken. No model, migration, service,
route, client or UI work is implied by an empty table.

### `Film` / `Session` (Vista tables)

No impact on Phase 1 code. They inform the Phase 2 POS mapping only.

### Missing `films` / `sessions`

Everything built for Phase 1 is affected until the migrations are applied:
`film.service`, `session.service`, both controllers, both route files,
`consumer.service.getSessions`, the Dashboard Films and Sessions pages, and the
Consumer checkout picker.

---

## 7. Phase Classification

| Change | Class |
| --- | --- |
| Apply the 3 pending migrations (`films`, `sessions`) | **A — Required for Phase 1** |
| `screens.Category` / `SeatRow` — add to model + migration | **E — Requires clarification** (grain must be settled first) |
| `screens` seat-row grain | **E — Requires clarification** |
| `screen_layout` table | **E — Requires clarification**; likely **B/D** |
| `Film` (Vista) | **B — Phase 2 / POS** |
| `Session` (Vista) | **B — Phase 2 / POS** |
| `Film.test_column` | **E — Requires clarification** (looks like debris) |
| `shows` still empty | **C — Informational** |
| All other tables | **F — No QBusto change required** |

Nothing here requires changing the order snapshot design, the payment
architecture or the image storage architecture.

---

## 8. Required Changes

Not implemented — this is the list to work from once §9 is answered.

**Unblocked, safe to do now**

1. Apply the pending migrations so `films` and `sessions` exist in this database
   (see §10 for the `cinema_shows` caveat).

**Blocked on client clarification**

2. `migrations/` — new `addColumn` migration for `screens.Category` and
   `screens.SeatRow` (exact types: `nvarchar(50)` NULL and `nvarchar(2)` NULL).
3. `models/screen.js` — two attributes.
4. `src/validators/screen.validators.js` — create and update bodies.
5. `src/services/screen.service.js` — `PUBLIC_ATTRIBUTES`; revisit
   `assertNameAvailable` if the grain changes.
6. `src/routes/screen.routes.js` — OpenAPI request/response bodies.
7. `src/config/swagger.js` — `Screen` component schema.
8. `npm run gen:spec`, then `npm run gen:api` in dashboard, consumer, kitchen.
9. `dashboard/src/components/screens/ScreenFormModal.tsx` — two inputs.
10. `dashboard/src/components/screens/ScreenDetailsDrawer.tsx` — two rows.
11. `dashboard/src/pages/ScreensPage.tsx` — columns and possibly filters.
12. `backend/docs/schema.md`, `schema-explained.md`, `schema.dbml` — the two
    columns, and `screen_layout` if adopted.
13. `backend/scripts/seed-dev-data.js` — only if screens gain required fields.
14. `backend/scripts/seed-dev-sessions.js` — only if the screen grain changes,
    since it schedules one session per screen.

**Explicitly not required**

- Recreating `Film` or `Session` as QBusto tables.
- Reintroducing `cinema_shows`.
- Any POS integration work.

---

## 9. Client Clarifications

1. **Is `screens` meant to hold one row per auditorium, or one per seat row?**
   The data says seat row; QBusto's foreign keys say auditorium. This is the
   blocking question — everything else about the screens change depends on it.
   If seat rows are intended, we need to know what `orders.screen_id` should
   point at.
2. **Why are `Category` and `SeatRow` on `screens` when `screen_layout` already
   has both, plus `SeatNo`?** They look like the same data at two grains. Is
   `screens` a staging area, or is `screen_layout` the intended destination?
3. **Is `screen_layout` going to be populated, and by what?** It is empty, and it
   links to a screen by `ScreenName` text rather than by `screens.id`.
4. **Is `Category` a fixed set?** Only `Platinum` and `Recliner` appear. If it is
   a controlled vocabulary we would model it as an enum or a lookup; if cinemas
   invent their own tiers it stays free text. Recommendation below assumes the
   latter until told otherwise.
5. **Can `SeatRow` ever exceed one character?** The column allows two. Confirm
   whether `AA`-style labels occur.
6. **Was `Film.test_column nchar(1000)` intentional?** It appears to be test
   debris and should probably be dropped on their side.
7. **Are the Vista `Film` and `Session` tables meant to live permanently in the
   QBusto database, or are they a staging copy for the Phase 2 sync?** They are
   currently the only populated schedule data.
8. **Should the client's database receive our pending migrations?** They are
   working on a database that is three migrations behind the repository.

---

## 10. Recommended Implementation Order

1. **Answer §9.1 first.** Nothing about the screens change should be built until
   the grain is settled; building against the wrong grain touches foreign keys.
2. **Restore Phase 1 parity.** Apply the three pending migrations to this
   database so `films` and `sessions` exist again. Note that
   `20260823000300-drop-cinema-shows` drops a table this database does not have;
   verify `20260823000100` runs first and recreates it, which the ordering does.
   Then re-seed development sessions if needed.
3. **Confirm the application boots and the Consumer picker works** against the
   client's data before layering anything new on top.
4. **Only then, add the two screen columns** — migration, model, validator,
   service, OpenAPI, regenerate clients, Dashboard UI, documentation — in that
   order, so the contract is regenerated once rather than repeatedly.
5. **Leave `screen_layout` alone** until §9.2 and §9.3 are answered. If it is
   adopted, it is a new vertical slice, not an edit to screens.
6. **Leave `Film` and `Session` alone.** Revisit at Phase 2, where they become
   the source for the POS sync that populates `films` and `sessions` through the
   mapping layer.

---

## 12. Final Output

| Metric | Count |
| --- | --- |
| 1. Changed tables | **2** (`screens` altered, `screen_layout` added) — plus 2 client tables present that we do not model (`Film`, `Session`), and 2 of our tables missing (`films`, `sessions`) |
| 2. Added columns | **2** (`screens.Category`, `screens.SeatRow`) |
| 3. Removed columns | **0** |
| 4. Changed columns / types | **0** |
| 5. Changed indexes | **0** |
| 6. Changed foreign keys | **0** |
| 7. Changed constraints | **0** |
| 8. Meaningful data changes | Client data loaded (69 films, 133 sessions, 61 screen rows); deliberate, out of scope for this review |
| 9. Phase 1 changes | **1 blocking** (apply pending migrations); 2 columns pending clarification |
| 10. Phase 2 changes | **2** (`Film`, `Session` mapping — no work now) |
| 11. Client clarification questions | **8** (§9) |
| 12. Files needing later change | 14, listed in §8 |

**Nothing in the repository was modified except this document. Nothing was
committed. The development database and the restored copy were left as found.**
