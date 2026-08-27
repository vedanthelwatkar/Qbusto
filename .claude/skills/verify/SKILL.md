---
name: verify
description: Run the full local verification suite - backend schema/health checks, backend tests, and typecheck/lint for each frontend - and report one summary table.
---

Run each of the following, capturing pass/fail (don't stop early on a
single failure — run everything so the summary is complete):

1. `make verify` (repo root) — runs `backend`'s `verify-schema` (models,
   associations, Sequelize init) then `healthcheck` (connection, migrations,
   seeds, env vars).
2. `cd backend && npm test` — Jest + supertest, ~22 suites
   (`backend/tests/`).
3. `cd consumer && npm run typecheck && npm run lint`
4. `cd dashboard && npm run typecheck && npm run lint`
5. `cd kitchen && npm run typecheck && npm run lint`

Note: none of the three frontends has a `test` script — there are no
frontend test suites in this repo (`CLAUDE.md`: "Frontends have no test
suites; they are verified by typecheck, lint, build"). Don't try to invent
one or report its absence as a failure.

Report one summary table: check name → pass/fail → one-line detail on
failure (error type/count, not the full stack trace unless asked). Keep the
report itself short — this skill's job is to save you from re-running four
separate commands and reading their full output, not to reproduce that
output verbatim.
