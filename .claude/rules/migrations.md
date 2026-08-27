---
paths:
  - backend/migrations/**/*.js
  - backend/config/config.js
  - backend/.sequelizerc
---

# Database & migrations

SQL Server. 37 files in `backend/migrations/`, timestamp-ordered. The
Sequelize CLI reads `backend/config/config.js` (wired via
`backend/.sequelizerc`) — **not** `src/config/env.js`. `src/config/
database.js` relates the two. Nothing under `src/` should read DB connection
settings from `env.js`.

Two recent alignment migrations are the current state of the art:

## `20260823001000-align-client-naming.js`

**Renames only.** Not one row inserted/updated/deleted/moved; no type,
nullability, key, index or constraint change.

| From | To |
| --- | --- |
| `Film` (table) | `film` |
| `Session` (table) | `session` |
| `screens.Category` | `screens.category` |
| `screens.SeatRow` | `screens.seat_row` |
| `screen_layout.ScreenName` | `screen_name` |
| `screen_layout.Category` | `category` |
| `screen_layout.SeatRow` | `seat_row` |
| `screen_layout.SeatNo` | `seat_no` |

**Deliberately NOT changed:** provider columns inside `film`/`session`
(`Film_strCode`, `Session_lngSessionId`, `Session_dtmRealShow`, …). Those
names are the source system's contract; renaming them would break the
mapping the client syncs against. See [client-tables.md](./client-tables.md).

Uses `sp_rename` so every row, key, index, default and FK survives in place.
Constraint names (`FK_Session_Film`, `PK_Film`, `PK_Session`,
`DF_Film_Film_dtmStamp`) are independent of the table name and keep working.
Each rename is guarded by an existence check, so the migration is
re-runnable.

## `20260824000100-provision-client-schema.js`

Creates `film`, `session`, `screen_layout`, `screens.category` and
`screens.seat_row` **only when absent**.

Why: those objects reached the dev database only because the client's `.bak`
was restored into it. No migration ever created them, so a database
provisioned from this repo's migrations alone (fresh install, CI, disaster
recovery) would be 5 objects short of what the models declare, and every
Film/Session/Screen query would fail with "Invalid object name".

- Not a schema change — reproduces the client's exact DDL (same table names,
  provider column names, types, nullability, keys).
- `film`/`session` DDL comes from client-supplied CREATE TABLE scripts,
  reproduced verbatim including named constraints (`PK_Film`, `PK_Session`,
  `DF_Film_Film_dtmStamp`, `DF_Session_Session_dtmStamp`, `FK_Session_Film`,
  `FK_Session_cinemas`).
- `screen_layout` constraints are left **unnamed**, matching the client's
  copy (whose constraints carry SQL Server auto-generated hash names).
- Every step is guarded → running against the client's database is a
  **verified no-op** (0 rows, 0 objects changed).
- `film` is created before `session` (FK dependency).

`down()` is deliberately conservative:
- `session`/`film` dropped **only if empty**; `session` first (holds the FK).
- `screens.category`/`seat_row` dropped **only if every value is NULL**.
- `screen_layout` is **never auto-dropped**, even when empty — an empty table
  can't be distinguished between "this migration created it" and "the client
  supplied it empty", and the second case is real.
- Anything it declines to remove is logged via `console.warn`, not raised.

## Payment-schema rename migrations

`20260825000100-rename-payment-columns-provider-neutral.js` — rename-only,
via `sp_rename`, off Razorpay-specific names. Two SQL Server quirks it had to
navigate: unqualified `sp_rename` source names fail with error 15225
(schema-qualify as `dbo.x`), and a filtered index predicate blocks a column
rename outright with an **empty** error message (drop the index before
renaming, recreate it after).

`20260825000200-rename-payment-webhook-events-constraints.js` — closed a gap
that migration left: `sp_rename` on a *table* does not cascade to rename
that table's SQL-Server-auto-generated PK/UQ/FK constraint names. Renamed to
`PK_payment_webhook_events`, `UQ_payment_webhook_events_event_id`,
`FK_payment_webhook_events_order_id`. One more SQL Server quirk: a
table-owned constraint renames with a **two-part** name
(`schema.constraint_name`), not the three-part form
(`schema.table.constraint_name`) that columns and indexes use — the
three-part form fails outright with "Either the parameter @objname is
ambiguous or the claimed @objtype (OBJECT) is wrong."

## Seeders

Only two, in `backend/seeders/`: order-status and payment-status master data.
No user account — create one before anything can log in
(`backend/scripts/create-dev-user.js`).

## Conventions for any new migration (see also `/migration` skill)

1. Guard every DDL statement with an existence check — migrations here are
   expected to be re-runnable against a database that may already have the
   objects (the client's restored `.bak`).
2. Use `sp_rename` for renames, never drop+recreate — preserves rows, keys,
   indexes, defaults and FKs in place.
3. `down()` must refuse to drop anything holding data, and must never
   auto-drop a table that could legitimately have arrived empty from the
   client (see `screen_layout` above).
4. Never rename a provider column inside `film`/`session`.
5. Never create a QBusto-owned `films`/`sessions` duplicate table — earlier
   ones were removed on purpose.
