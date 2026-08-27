---
name: gen-api
description: Regenerate the OpenAPI spec and all three frontend API clients (make gen-api), then typecheck each frontend. Reports only failures.
disable-model-invocation: true
---

Run this exact sequence, in order, and stop at the first failure:

1. `make gen-api` (run from the repo root) — this runs `gen:spec` in
   `backend/` then `gen:api` (Orval) in `consumer/`, `dashboard/`, and
   `kitchen/` in turn. See [generated.md](../../rules/generated.md) for what
   this touches — `shared/openapi.json` and each app's
   `src/api/generated/**`. **Never hand-edit any of those files** if the
   generation step fails; fix the source (route annotations in
   `backend/src/routes/**` or `backend/src/config/swagger.js`) and rerun.
2. `cd consumer && npm run typecheck` (`tsc --noEmit`)
3. `cd dashboard && npm run typecheck`
4. `cd kitchen && npm run typecheck`

If a session earlier touched a file matching `backend/src/routes/**/*.js`,
a hook will have written `.claude/.spec-dirty`. After step 1 succeeds,
delete that marker file — it exists specifically to stop a session from
finishing with an unregenerated spec.

Report **only failures** — which step failed and the exact error output. If
all four steps pass, say so in one line; don't paste passing output.
