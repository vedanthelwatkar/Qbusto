---
paths:
  - backend/src/middleware/authenticate.js
  - backend/src/middleware/authorize.js
  - backend/src/services/**/*.js
  - backend/models/userpermission.js
---

# Multi-tenancy, authentication & authorization

## Multi-tenancy

Hierarchy: **Chain → Cinema → Screen**.

Implemented as a `tenantScope(actor)` helper duplicated in each staff
service — confirmed (not a shared util) in `cinema.service.js`,
`product.service.js`, `category.service.js`, `chain.service.js`,
`user.service.js`:

```js
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}
```

- `owner` → `{}` (unrestricted).
- Every other role → filtered to their own `chainId`.
- A caller-supplied `chainId` filter can **narrow** within scope but never
  **widen** it (guarded by `actor.role === ROLES.OWNER`).
- **A resource outside the caller's scope is reported as 404 Not Found, not
  403 Forbidden** — existence itself is not disclosed across a tenant
  boundary. Apply the same `tenantScope` pattern to any new service that
  reads/writes a chain-scoped resource, even though today only 5 services
  have it.

## Authentication & permissions

**`authenticate()`** (`backend/src/middleware/authenticate.js`)
- Expects `Authorization: Bearer <token>`.
- Verifies the JWT (issuer-checked), then **reloads the User and their
  permissions from the database on every request** — so a revoked
  permission or a deactivated account takes effect immediately rather than
  at token expiry.
- Attaches `req.user` (model instance, `passwordHash` excluded) and
  `req.auth` (decoded payload).
- Status codes: **401** for no/malformed/expired token or a subject that no
  longer exists (the credential is unusable); **403** with
  `ACCOUNT_INACTIVE` when the token is valid but the account is
  deactivated.

**`authorize(moduleName, action)`** (`backend/src/middleware/authorize.js`)
- Validates module and action names **when the middleware is built** (at
  mount time), so `authorize('Product', 'read')` throws at **startup**
  instead of silently denying every request in production.
- `owner` bypasses the permission table unconditionally.
- Everyone else needs a `user_permissions` row with the relevant
  `can_read`/`can_edit`/`can_delete` flag.
- Missing `req.user` is treated as a **programming error** (authorize
  mounted without authenticate) → AuthenticationError.

## Roles

`owner`, `chain_admin`, `cinema_admin`, `kitchen_staff`,
`cinema_accountant`. Actions: `read`/`edit`/`delete`.

## Constants (`backend/src/constants.js`)

Mirrors DB CHECK constraints deliberately, so a typo fails at boot rather
than matching nothing: `MODULES`, `ROLES`, `ACTIONS`,
`ORDER_STATUSES`/`PAYMENT_STATUSES`/`ORDER_SOURCES`/`POS_PROVIDERS`,
`ERROR_CODES`, `PAGINATION`. **If the schema changes, `constants.js` must be
updated in the same change** — a hook fires a reminder on every edit to
this file.
