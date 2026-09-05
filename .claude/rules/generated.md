---
paths:
  - shared/openapi.json
  - consumer/src/api/generated/**
  - dashboard/src/api/generated/**
  - kitchen/src/api/generated/**
---

# Generated files — never hand-edit

- `shared/openapi.json` ← `cd backend && npm run gen:spec`
  (`scripts/generate-openapi.js`)
- `consumer|dashboard|kitchen/src/api/generated/**` ← `npm run gen:api`
  (Orval), run inside each frontend directory

```
backend route annotations
      │  cd backend && npm run gen:spec
      ▼
shared/openapi.json
      │  npm run gen:api  in each frontend
      ▼
{consumer,dashboard,kitchen}/src/api/generated/
```

`backend/src/config/swagger.js` holds component schemas (including
`Screen`, `Session`, `ConsumerSession`).

**Never hand-edit** `shared/openapi.json` or anything under
`src/api/generated/`. Change an endpoint ⇒ regenerate the spec, then the
affected clients. **Regenerate once at the end of a change, not
repeatedly** — `make gen-api` runs the spec + all three clients in one go
(also available as the `/gen-api` skill).

If you edit a backend route file mid-session, a hook marks
`.claude/.spec-dirty` and blocks session completion until `make gen-api`
has been run and the marker removed.
