# QBusto Dashboard

The staff-facing management application for the QBusto platform. Owners, chain
administrators and cinema administrators use it to manage the catalogue,
pricing, promotional banners, staff accounts and orders.

---

## Purpose

The Dashboard is the administrative surface of the platform. It does not hold
business rules of its own: every action is validated and authorised by the
backend, and the interface reflects what the current user is permitted to do.

---

## Modules

| Module     | Contents                                                             |
| ---------- | -------------------------------------------------------------------- |
| Dashboard  | Landing overview                                                     |
| Orders     | Order listing and detail, with order and payment status transitions  |
| Categories | Product categories per chain                                         |
| Products   | Products, including add-on products                                  |
| Pricing    | Price per cinema, product and day of week, with per-source discounts |
| Banners    | Cinema-specific promotional banners                                  |
| Users      | Staff accounts and their per-module permissions                      |
| Settings   | Chains, cinemas and screens                                          |

Reports and POS Integrations appear in the navigation as placeholders and are
not implemented.

Chains, cinemas and screens live under Settings because the permission model
defines no separate modules for them.

---

## Technology

- React 19 with TypeScript
- Vite as build tool and dev server, with the React Compiler enabled
- Ant Design component library
- React Router for routing
- Zustand for client state
- Axios, through a generated API client
- Day.js for the date handling Ant Design requires
- Sass for supplementary styling

---

## Prerequisites

- Node.js LTS
- A running QBusto backend
- A staff account with the appropriate permissions

---

## Installation

```bash
cd dashboard
npm install
cp .env.example .env      # then edit .env
```

---

## Environment configuration

| Variable       | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `VITE_API_URL` | Origin of the QBusto backend — scheme, host and port, no trailing path |
| `PORT`         | Dev-server port. Defaults to `5174`.                                   |

The backend mounts its router at `/api` and the generated client already
includes that prefix, so a value ending in `/api` produces `/api/api/...` and
will fail.

Vite reads `.env` **at startup only**. After changing a value, restart the dev
server; for a deployed build, rebuild. `VITE_` variables are inlined into the
client bundle and are therefore public — never put a secret in this file.

---

Each frontend runs on its own fixed port so all three can be developed at once:

| Application | Port |
| ----------- | ---- |
| Consumer    | 5173 |
| Dashboard   | 5174 |
| Kitchen     | 5175 |

The port is fixed rather than auto-shifting. If it is already in use the server
fails to start instead of quietly moving to another port, which would put the
app on an origin the backend's `CORS_ALLOWED_ORIGINS` list does not allow.

---

## Scripts

| Command                | Purpose                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Start the dev server, exposed on the local network (`--host`) |
| `npm run build`        | Type-check, then produce a production build in `dist/`        |
| `npm run preview`      | Serve the production build locally                            |
| `npm run typecheck`    | TypeScript check with no emit                                 |
| `npm run lint`         | ESLint                                                        |
| `npm run format`       | Prettier, writing changes                                     |
| `npm run format:check` | Prettier in check mode                                        |
| `npm run gen:api`      | Regenerate the API client from `shared/openapi.json`          |

---

## Local development

```bash
npm run dev
```

The backend must be running and reachable at `VITE_API_URL`, and its
`CORS_ALLOWED_ORIGINS` must include this app's origin.

---

## Production build

```bash
npm run build
```

`build` runs `tsc --noEmit` first, so a type error fails the build. The output
in `dist/` is a static bundle and can be served by any static file server.

Deployment notes:

- Serve over HTTPS.
- Configure the static host to serve `index.html` for unmatched paths, so
  client-side routes resolve on a direct visit or refresh.
- The API origin is baked in at build time, so targeting a different backend
  requires a rebuild.
- The bundle is currently produced as a single chunk; code splitting has not
  been applied.

---

## Authentication and permissions

Staff sign in with a username and password. The returned token is attached to
every subsequent request, and a 401 from a non-credential endpoint ends the
session.

Access is granted per module and action (`read`, `edit`, `delete`) rather than
by role. Navigation entries and controls are shown, hidden or disabled
according to the signed-in user's permissions, and routes are guarded so a user
cannot reach a module they lack read access to.

The `owner` role bypasses the permission table. Only an owner may create or
promote another owner, and a user may only grant permissions they already hold.

**Interface permission checks are presentation only.** Authorisation is enforced
by the backend on every request; a hidden or disabled control is a usability
measure, never a security boundary.

---

## Backend communication

All requests go through a generated API client produced by Orval from the
backend's OpenAPI document:

```
backend route annotations → shared/openapi.json → npm run gen:api → src/api/generated/
```

Request and response types come from that generated code. Endpoint paths and
payload shapes are never hand-written, and files under `src/api/generated/` are
never edited by hand — regenerate them instead.

Services may unwrap the response envelope or adapt a response for display, but
they always call the generated functions. Listing, searching, filtering and
paging are performed server-side.

Failures are normalised into a single error type by `src/services/api.ts`, so
components do not have to distinguish an HTTP error from a network failure.

---

## Project structure

```
src/
├── api/generated/   Generated API client (do not edit)
├── components/      Shared and feature components
├── layouts/         Application shell
├── pages/           One component per route
├── routes/          Route definitions and navigation model
├── services/        API access and error normalisation
├── stores/          Zustand stores
├── styles/          Sass stylesheets
├── types/           Shared TypeScript types
├── utils/           Helpers, including validation-error mapping
└── theme.ts         Ant Design theme and colour palette
```

`theme.ts` holds the colour palette and is the single source of truth for
colour. Components should not introduce one-off hex values.
