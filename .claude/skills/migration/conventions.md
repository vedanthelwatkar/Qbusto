# Migration conventions

Drawn from `backend/migrations/20260823001000-align-client-naming.js`,
`backend/migrations/20260824000100-provision-client-schema.js`, and the
follow-up payment-rename migrations. See
[.claude/rules/migrations.md](../../rules/migrations.md) for the full
narrative; this file is the condensed checklist for writing a new one.

## 1. Guard every DDL statement

Databases in this project (dev, and anything restored from the client's
`.bak`) may already contain the object a migration is about to create.
Every `CREATE TABLE`, `ADD COLUMN`, `sp_rename`, or constraint-creation
statement must be preceded by an existence check, e.g.:

```js
const [existing] = await queryInterface.sequelize.query(`
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'loyalty_points'
`);
if (existing.length === 0) {
  await queryInterface.addColumn('orders', 'loyalty_points', { ... });
}
```

This makes the migration **re-runnable** — running it twice, or against a
database that already has the object, is a no-op, not an error.

## 2. Renames use `sp_rename`, never drop+recreate

```js
await queryInterface.sequelize.query(
  `EXEC sp_rename 'dbo.old_table.OldColumn', 'new_column', 'COLUMN'`
);
```

Two SQL Server quirks, verified live:
- Unqualified `sp_rename` source names fail with error 15225 — always
  schema-qualify as `dbo.table.column`.
- A filtered index predicate blocks a column rename outright with an
  **empty** error message — drop the index first, recreate it after.
- `sp_rename` on a **table** does not cascade to that table's
  SQL-Server-auto-generated PK/UQ/FK constraint names. If you rename a
  table, check whether a follow-up rename of its constraints is also
  needed (see `20260825000200-rename-payment-webhook-events-constraints.js`
  for the pattern) — and note constraint renames use a **two-part** name
  (`schema.constraint_name`), not the three-part form columns/indexes use.

## 3. `down()` must be conservative

- Check row/value counts before dropping anything that could hold data.
- Log via `console.warn` (not throw) when declining to remove something —
  the migration should still "succeed," just leave the object in place.
- Never assume an empty table is safe to drop unconditionally — an empty
  table can mean either "this migration created it" or "it arrived empty
  from the client," and only the first case is safe to reverse.

## 4. Never touch `film`/`session` provider columns

Columns like `Film_strCode`, `Session_lngSessionId`, `Session_dtmRealShow`
are the client's Vista source-system contract. Never `sp_rename` or `ALTER
COLUMN` them, no matter how tempting the naming inconsistency looks.

## 5. Never create a QBusto-owned `films`/`sessions` duplicate

`film`/`session` (lowercase) are the canonical client-owned tables. Earlier
migrations that created duplicate QBusto-owned `films`/`sessions` tables
were removed on purpose — don't reintroduce them.
