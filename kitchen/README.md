# QBusto Kitchen Display System

The kitchen-facing order board. It runs on a screen in the kitchen or at a
service counter and shows the orders that have been paid for and are waiting to
be prepared, prepared and handed over.

---

## Purpose

The KDS is a working display, not a management tool. It answers two questions:
what needs making now, and did a given order go out. Staff advance an order
through the workflow with a single large control per card.

It is designed to be read from two or three metres away, so type is large, the
palette is high-contrast, and touch targets are sized for a gloved hand.

---

## Workflow

The board has three live queues and a strip of completed work:

```
NEW (confirmed)  →  PREPARING  →  READY  →  DELIVERED
```

Each card offers exactly one forward action, matching the order's current
status:

| Current status | Action shown |
| --- | --- |
| `confirmed` | Start preparing |
| `preparing` | Mark ready |
| `ready` | Mark delivered |
| `delivered` | none |

The kitchen can only set `preparing`, `ready` and `delivered`. It cannot reject
an order — that is a commercial decision made in the Dashboard — and it cannot
mark an order confirmed, because confirmation follows payment. **The KDS can
never change payment status.**

The backend validates every transition against the order's current status, so a
stale screen cannot skip a step. If another display or the Dashboard has already
moved an order, the server reports the conflict and the board replaces its copy
with the authoritative state.

### Which orders appear

An order is shown when it is **paid** and its fulfilment status is one the
kitchen owns (`confirmed`, `preparing`, `ready`). Delivered orders move to the
completed strip.

Both conditions are enforced by the backend on every request, with no parameter
that relaxes them, so an unpaid or cancelled order can never reach a kitchen
screen. An order is not created here and payment is never verified here; the
board reads the state the backend has already settled.

### Urgency

Cards are flagged when an order has been waiting too long, measured from when it
was placed. The thresholds are constants in `src/config.ts` — a warning level
and a late level — and are not scattered through components.

Urgency is shown by colour, a text flag and the elapsed time together, never by
colour alone. A delivered order's clock stops at the time fulfilment actually
took and is never marked late.

---

## Technology

- React 19 with TypeScript
- Vite as build tool and dev server, with the React Compiler enabled
- Zustand for client state (session and board)
- Axios, through a generated API client
- Sass for styling

There is no routing library: the board is a single screen, and the order detail
view is an overlay.

---

## Prerequisites

- Node.js LTS
- A running QBusto backend
- A staff account assigned to a cinema, with `Orders` read and edit permission

---

## Installation

```bash
cd kitchen
npm install
cp .env.example .env      # then edit .env
```

---

## Environment configuration

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Origin of the QBusto backend — scheme, host and port, no trailing path |
| `PORT` | Dev-server port. Defaults to `5175`. |

The application appends its own paths (`/api/auth/*`, `/api/kitchen/*`), so a
value ending in `/api` produces `/api/api/...` and will fail.

Vite reads `.env` **at startup only**. After changing a value, restart the dev
server; for a deployed build, rebuild. `VITE_` variables are inlined into the
client bundle and are therefore public — never put a secret in this file.

Operational tuning — poll interval, delay thresholds, how long completed orders
stay visible — lives in `src/config.ts` rather than in environment variables.

---

Each frontend runs on its own fixed port so all three can be developed at once:

| Application | Port |
| --- | --- |
| Consumer | 5173 |
| Dashboard | 5174 |
| Kitchen | 5175 |

The port is fixed rather than auto-shifting. If it is already in use the server
fails to start instead of quietly moving to another port, which would put the
app on an origin the backend's `CORS_ALLOWED_ORIGINS` list does not allow.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check with no emit |
| `npm run lint` | ESLint |
| `npm run gen:api` | Regenerate the API client from `shared/openapi.json` |

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

- The API origin is baked in at build time, so pointing a display at a
  different backend requires a rebuild.
- The display should be run full-screen in a browser in kiosk mode.
- Because the session is held in `sessionStorage`, closing the browser signs the
  display out. A terminal that must survive a restart unattended needs to be
  signed in again.
- No push channel is used; the board polls, so it tolerates brief network
  interruptions and recovers on its own.

---

## Authentication and scoping

Sign-in uses a normal staff account. There is no shared kiosk key: every request
is authorised against that account's `Orders` permission, and every status
change is recorded against that user in the backend's audit trail. The session
token is kept in `sessionStorage`.

**Cinema scope is derived from the signed-in account, never from the client.** A
kitchen account assigned to a cinema sees and can act on that cinema's orders
only. Supplying a different cinema in a request cannot widen that scope, and an
order id from another cinema is reported as not found on both read and write.

Accounts with no cinema assigned are treated as follows:

| Account | Scope |
| --- | --- |
| Assigned to a cinema | That cinema only |
| `owner`, no cinema | All chains |
| `chain_admin`, no cinema | All cinemas in their chain |
| Any other role, no cinema | Refused, with a message asking an administrator to assign a cinema |

The last case is deliberate: an empty board looks like a quiet shift, which
would hide the misconfiguration.

---

## Backend communication

All requests go through a generated API client produced by Orval from the
backend's OpenAPI document:

```
backend route annotations → shared/openapi.json → npm run gen:api → src/api/generated/
```

Files under `src/api/generated/` are never edited by hand — regenerate them
instead.

Endpoints used:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/login` | Sign in |
| `GET /api/auth/me` | Validate a stored session on reload |
| `GET /api/kitchen/orders` | Board, filtered and sorted server-side |
| `GET /api/kitchen/orders/:id` | One order in full |
| `PATCH /api/kitchen/orders/:id/status` | Advance the workflow |

### Refresh behaviour

The board polls at the interval set in `src/config.ts`. The implementation:

- never starts a poll while one is still in flight, so a slow network cannot
  produce a backlog of requests;
- carries a request token so a superseded response can never overwrite a newer
  one;
- skips polling while the browser tab is hidden, and refreshes immediately when
  it becomes visible again;
- keeps the last known board on a failed request rather than blanking the
  screen, and marks the board as not updating if several polls fail in a row;
- applies the status returned by the server after a transition, rather than
  assuming the requested one, so a display that loses a race corrects itself.

Elapsed times tick continuously between polls, so the board never looks frozen.

---

## Project structure

```
src/
├── api/             Generated API client and the axios instance
├── components/      Board, lanes, cards, detail overlay, sign-in
├── hooks/           Clock tick and polling
├── services/        API access and response adaptation
├── stores/          Zustand stores (session, board)
├── styles/          Sass stylesheet
├── types/           Domain types
├── utils/           Time, workflow and error helpers
└── config.ts        Poll interval, delay thresholds, page size
```
