---
name: migration
description: Scaffold a new Sequelize migration in backend/migrations/ following this repo's conventions (existence-guarded DDL, sp_rename for renames, conservative down()). Argument is a short kebab-case description, e.g. "add-loyalty-points".
disable-model-invocation: true
argument-hint: <kebab-case-description>
---

Read [conventions.md](./conventions.md) in this skill's directory first —
it's drawn directly from the two reference migrations
(`20260823001000-align-client-naming.js`,
`20260824000100-provision-client-schema.js`) and from the payment-rename
migrations' documented SQL Server quirks.

Scaffold a new file at `backend/migrations/<timestamp>-$ARGUMENTS.js`:

- `<timestamp>` follows this repo's existing pattern: `YYYYMMDD` + a 6-digit
  sequence that increments in steps of 100 within a day (e.g. `000100`,
  `000200`, ...). Look at the highest existing timestamp in
  `backend/migrations/` for today's date (or the most recent date if
  nothing exists for today) and pick the next one in sequence.
- `$ARGUMENTS` becomes the kebab-case suffix, e.g.
  `20260828000100-add-loyalty-points.js`.
- The file exports `up(queryInterface, Sequelize)` and
  `down(queryInterface, Sequelize)`, both guarded per conventions.md.

Do not run the migration (`make migrate`) as part of this skill — scaffold
only. Show the generated file and ask before running it against any shared
database, since `make migrate` is not reversible in the way a local dry run
would be.

If the migration touches `session`/`screen`/`screen_layout`, also
read [.claude/rules/client-tables.md](../../rules/client-tables.md) — those
tables have rules (provider columns never renamed, one and only one table of
showtimes, `screens` grain conflict) this skill will not itself enforce.
