---
name: drift
description: Re-check the README-drift claims recorded in CLAUDE.md / memory.md §19 against the current code and report which are still true.
---

`CLAUDE.md`'s "README drift" section and `memory.md` §19 record specific
claims about what `README.md` is missing or gets wrong. Re-verify each
claim against the **current** `README.md` and codebase — don't assume the
list is still accurate just because it's written down.

Claims to re-check (from memory.md §19):

1. No mention of `film`/`session`/`screen_layout`, the `O`/`C`/`I` session
   vocabulary, the read-only Film/Session API, or the Dashboard
   Films/Sessions pages.
2. No mention of the `screens` grain conflict or the `category`/`seat_row`
   columns.
3. Whether the architecture diagram/technology table name Cashfree
   correctly (this one was previously corrected — confirm it's still
   correct, not that it regressed back to naming Razorpay).
4. No mention of `db_export/` (`qbusto.bak`, `qbusto.sql`).
5. Undocumented scripts: `create-dev-user.js`, `seed-dev-dataset.js`,
   `seed-dev-orders.js`, `seed-dev-banners.js`, the two
   `inspect-legacy-*.js` scripts.
6. Whether README still embeds a development username/password in plain
   text.
7. Whether README's claims about seeders and Make targets are still
   accurate (they were verified accurate as of §19's writing — confirm
   `Makefile` and `backend/seeders/` haven't diverged from what README
   says).
8. Whether "automated tests currently cover the backend / frontends have
   no suites" is still accurate — check `backend/tests/` exists and each
   frontend's `package.json` still has no `test` script.

Also spot-check `backend/docs/client-database-changes.md` — it's noted as
an explicitly point-in-time audit whose §6 references `npm run db:migrate`
(a script that has never existed) and whose §8/§10 are superseded by the
two alignment migrations in
[.claude/rules/migrations.md](../../rules/migrations.md).

For each of the 8 items: report **STILL TRUE**, **NO LONGER TRUE**
(README/code changed — say what changed), or **CANNOT VERIFY** (rare —
only if the referenced file/script genuinely can't be found either way).
