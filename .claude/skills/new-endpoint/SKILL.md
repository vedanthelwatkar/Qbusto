---
name: new-endpoint
description: Scaffold a new backend endpoint for a module - route, swagger annotation, Joi validator, service with tenantScope, and a test - then regenerate the API spec/clients. Argument is the module name, e.g. "Banners".
disable-model-invocation: true
argument-hint: <ModuleName>
---

Build a new endpoint for module `$ARGUMENTS` in this exact order — each step
depends on the previous one, don't reorder or skip:

1. **Route** — add to (or create) `backend/src/routes/<module>.routes.js`.
   Wire `authenticate()` then `authorize(MODULES.<MODULE>, ACTIONS.<action>)`
   — `authorize()` validates the module/action name **at mount time**, so a
   typo throws at boot rather than silently denying every request. Confirm
   the module name exists in `backend/src/constants.js`'s `MODULES` first;
   if it doesn't, that's a separate change (constants.js + DB CHECK
   constraint together — a hook will remind you when you touch
   constants.js).
2. **Swagger annotation** — add the JSDoc `@swagger` block above the route
   so `backend/src/config/swagger.js`'s component schemas and
   `npm run gen:spec` pick it up. This is the contract
   `shared/openapi.json` and the generated clients are built from — see
   [.claude/rules/generated.md](../../rules/generated.md).
3. **Joi validator** — add to `backend/src/validators/<module>.validators.js`,
   wired via `validate(...)` middleware in the route, matching exactly what
   the swagger annotation just claimed (`required`, `min`, etc.) — a
   mismatch between the two is exactly the gap that produced the §8.16
   BLOCKER (empty-array `items` documented as required but never enforced).
4. **Service** — add to `backend/src/services/<module>.service.js`. Apply
   `tenantScope(actor)` if this resource is chain-scoped (see
   [.claude/rules/tenancy-auth.md](../../rules/tenancy-auth.md)):
   `owner` gets `{}`, everyone else gets `{ chainId: actor.chainId }`.
   **Out-of-scope resource ⇒ 404, never 403** — existence itself must not be
   disclosed across a tenant boundary. A caller-supplied `chainId` filter
   may narrow within scope but must never widen it.
5. **Test** — add to `backend/tests/<module>.routes.test.js`, exercising the
   real Express stack (permission checks, tenant scoping, the 404-not-403
   behavior for an out-of-scope resource).
6. **Regenerate** — run the `/gen-api` skill (or `make gen-api` directly),
   then typecheck the frontends that will consume the new endpoint.

Don't hand-edit anything under `src/api/generated/` — that only happens via
step 6.
