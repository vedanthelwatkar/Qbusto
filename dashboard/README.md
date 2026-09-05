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
| Pricing    | One weekly editor per cinema and product: seven day prices, each with its own optional discount |
| Offers     | Coupon codes, plus the per-cinema Offers on/off switch (in Cinema settings) |
| Banners    | Cinema-specific promotional banners                                  |
| Users      | Staff accounts and their per-module permissions                      |
| Settings   | Chains, cinemas, screens and sessions                                 |

Reports and POS Integrations appear in the navigation as placeholders and are
not implemented.

Chains, cinemas, screens and sessions live under Settings because the
permission model defines no separate modules for them. Its module list mirrors
a CHECK constraint on the database, so adding one is a schema change rather
than a configuration change.

**Sessions** are **read-only**. They live in the client's own `session` table
and arrive from their source system or the POS sync, so the Dashboard lists them
but does not create or edit them - a write here would not survive the next sync.
Sessions are chain-scoped through their cinema.

There is no Films page. `session` carries the film title as a column, so there
is no separate film catalogue to browse.

---

## Tables — the row is the detail trigger

**Clicking anywhere on a table row opens that row's details.** Every list works
this way: Chains, Cinemas, Screens, Sessions, Categories, Products, Pricing,
Banners, Offers, Orders and Users. The details shown are exactly what the first
column's link used to open; that link is now plain text, because it was only
ever a small target for something the whole row can do.

Controls inside a row keep their own behaviour. Edit, Deactivate, toggles,
dropdowns, checkboxes and real navigation links all act normally and do not
also open the drawer, and selecting text in a cell does not either — copying an
order reference has to keep working. Modifier-clicks and middle-clicks are left
alone so "open in a new tab" still means that.

One implementation, `src/utils/rowClick.tsx` (`detailRowProps`), applied as
`onRow` on the Table. Adding a new list means passing it the same handler the
details drawer already uses — not writing another click rule.

The three tables inside drawers (order items, and the two permission grids) are
deliberately untouched: their rows have no detail view to open.

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
- A staff account with the appropriate permissions. A freshly migrated
  database has none — see
  [backend/README.md](../backend/README.md#creating-the-first-user)

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

## Images

Banners, categories, products and the chain logo each have one image field, and
it accepts either of two things:

- **Image URL** — an external address, saved exactly as typed. Nothing is
  downloaded or copied; the image stays wherever it is hosted.
- **Upload image** — a file sent to the QBusto server. The server stores it and
  returns a path such as `/uploads/products/9f2c….webp`, which is saved into
  the same field.

The form shows both as tabs with a preview beneath. Editing a record opens on
whichever mode matches what is already stored, and switching between them —
replacing an uploaded image with a URL or the reverse — is just a different
value in the one field. Remove clears it.

Uploading requires **edit** permission on the module that owns the record, the
same permission as saving the change. A file that is not a JPEG, PNG, GIF or
WebP is rejected by the server, as is one over the configured size limit; the
reason is shown against the field.

Because uploaded images are served by the backend, the value is displayed by
prefixing `VITE_API_URL` — `src/utils/imageUrl.ts` does this, and everything
that renders an image goes through it. External URLs pass through untouched.

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
