# QBusto Consumer App

The customer-facing ordering application. A cinema guest scans a QR code at
their seat or in the lobby, browses the food catalogue for that cinema, places
an order and pays — without creating an account or signing in.

It replaces the customer-facing half of the legacy Vista PopExpress workflow.

---

## Purpose and scope

- **Audience:** unauthenticated cinema customers
- **Entry point:** a QR code, or a direct URL carrying cinema context
- **Devices:** mobile phones first; also used on kiosk displays
- **Outcome:** a paid order, confirmed on screen

There is no sign-in, no customer account and no order history. Once payment is
confirmed the customer sees a confirmation reference; tracking an order onward
is a staff function handled by the Dashboard and the Kitchen Display System.

---

## User flow

```
Screensaver  →  Catalogue + checkout sheet  →  Payment  →  Confirmation
    /                    /catalog              /payment    /confirmation/:orderId
```

1. **Screensaver** — an idle attract screen with a call to action.
2. **Catalogue** — products for the current cinema, grouped by category, with
   search and category filtering. Listing, searching and paging are all
   performed by the server; the app never loads the whole catalogue and filters
   it locally.
3. **Checkout** — a sheet over the catalogue rather than its own route, opened
   from the cart. It holds the cart itself, one show picker, row and seat,
   mobile and an optional email. The menu stays mounted and visible behind it,
   so the customer never loses sight of what they are buying, and closing the
   sheet leaves the cart exactly as it was.
4. **Payment** — Cashfree hosted checkout, opened as an in-page modal.
5. **Confirmation** — the order reference and a summary.

Any unmatched URL renders a not-found page rather than a blank screen.

### Payment behaviour

The payment step is built on the principle that **a network failure or timeout
does not mean the payment failed**. The app distinguishes three outcomes —
definitely paid, definitely not paid, and unknown — and never encourages a
customer to pay twice when the result is unknown. The backend is the sole
authority on payment state; the app reports what the server confirms.

If the customer returns to a page mid-payment, or reloads, the app recovers the
authoritative state from the backend rather than assuming.

### Shared-device behaviour

The app is also used on shared kiosk terminals. After an order is placed,
customer-specific details (seat, show time, film) are cleared from storage, and
the cinema context is retained so the terminal remains usable for the next
guest. An idle period also resets the session and returns the app to the
screensaver.

---

## Entry context (QR and URL parameters)

The app has no login, so everything it knows about where the customer is comes
from the URL it was opened with. `src/utils/parseUrlParams.ts` reads these
query parameters on first load and stores them in the context store
(`src/stores/context.store.ts`), persisted to `localStorage` under
`qbusto_order_context`.

| Parameter    | Type         | Required | Notes                                                 |
| ------------ | ------------ | -------- | ----------------------------------------------------- |
| `cinemaId`   | integer      | **Yes**  | Which cinema's catalogue and pricing to show          |
| `screenId`   | integer      | No       | Auditorium. Null for lobby, kiosk and counter orders  |
| `seatNumber` | string       | No       | Combined row and seat, e.g. `A5`                      |
| `showTime`   | ISO datetime | No       | Screening the customer is attending                   |
| `filmTitle`  | string       | No       | Display only                                          |
| `source`     | enum         | No       | `qr`, `seat_qr`, `kiosk`, `counter`. Defaults to `qr` |

An unrecognised `source` falls back to `qr` rather than failing, and every
optional parameter that is absent is stored as `null`.

Example URL:

```
https://order.example.com/?cinemaId=63&screenId=8&seatNumber=A5&source=seat_qr
```

The resulting context:

```json
{
  "cinemaId": 63,
  "screenId": 8,
  "seatNumber": "A5",
  "showTime": null,
  "filmTitle": null,
  "source": "seat_qr"
}
```

A lobby QR carries only the cinema, which is the common case:

```json
{
  "cinemaId": 63,
  "screenId": null,
  "seatNumber": null,
  "showTime": null,
  "filmTitle": null,
  "source": "qr"
}
```

### How seat details reach the order

There is **no separate row field anywhere in the system**. The database stores
one `seatNumber` string per order (`VARCHAR(20)`), so row and seat travel
together as a single value such as `A5`.

The checkout form splits that into two inputs, because two short fields are
easier to fill on a phone than one combined one:

- **Prefill** — `splitSeat("A5")` in `CheckoutDrawer.tsx` matches letters then
  digits and fills Row `A` and Seat `5`.
- **Submit** — the two inputs are rejoined as `` `${row}${seat}` `` and sent as
  a single `seatNumber`.

So the prefill only happens when the entry URL actually carried a seat, which
in practice means `source=seat_qr`. For `qr`, `kiosk` and `counter` the seat is
null on arrival, both fields start empty, and the customer types their row and
seat at checkout — the form requires both. That is why a lobby-QR context shows
`"seatNumber": null` and why you will not find a row value in `localStorage`:
there is nothing to store until the customer provides it, and once they do it
is stored as the combined string.

If the customer enters a seat different from the one in the QR, the context
store is updated with the value they entered, so the confirmation and the
kitchen ticket both show where the food is actually going.

### Choosing a show

An order carries three separate values for the show — `orders.screen_id`,
`orders.film_title` and `orders.show_time` — but they are not three decisions.
A customer knows which show they are sitting in, not which auditorium id it
maps to, so checkout asks once:

```
Show   [ Interstellar — 23 Aug — 7:30 PM (Audi 3)   ▾ ]
```

The options come from `GET /api/consumer/cinemas/:cinemaId/sessions`, and the
selected session supplies all three values at submit time. Because they are read
off one object they cannot drift apart, and a customer cannot pair a film with
a screen that is not showing it.

The backend still validates each value and answers **404 Screen not found** if
the screen does not belong to this cinema; the whole order is rolled back in
that case and nothing is written. Since there is no longer a screen input of
its own, that failure — and any about the film or the time — is shown against
the show picker, which is the control the customer can actually act on.

If a cinema has no upcoming shows the picker says so rather than presenting an
empty dropdown. The schedule comes from the cinema's own source system and is
read-only in QBusto - the Dashboard shows it under **Settings → Films** and
**Settings → Sessions** but does not edit it.

The selected session supplies the film and the show time. It does **not** supply
a screen: the schedule names its auditorium rather than referencing a screen id,
so the order takes `screenId` from the entry context instead - the QR the
customer scanned is physically at their screen.

### Kiosk behaviour

The context store separates **installation** fields from **customer** fields:

- Installation — `cinemaId`, `screenId`, `source`. Configured once when the
  device is set up and preserved between customers, so a kiosk does not need
  re-provisioning after every order.
- Customer — `seatNumber`, `showTime`, `filmTitle`. Cleared after an order is
  placed and on idle reset, so the next customer never sees the previous one's
  seat.

On a phone the same reset is harmless, because a fresh QR scan re-supplies
every value.

---

## Technology

- React 19 with TypeScript
- Vite as build tool and dev server, with the React Compiler enabled
- React Router for routing
- Zustand for client state (cart, cinema context, UI)
- React Hook Form with Zod for form validation
- Axios, through a generated API client
- Sass for styling

---

## Prerequisites

- Node.js LTS
- A running QBusto backend

---

## Installation

```bash
cd consumer
npm install
cp .env.example .env      # then edit .env
```

---

## Environment configuration

| Variable       | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `VITE_API_URL` | Origin of the QBusto backend — scheme, host and port, no trailing path |
| `PORT`         | Dev-server port. Defaults to `5173`.                                   |

The application appends its own paths, so a value ending in `/api` produces
`/api/api/...` and will fail.

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

| Command             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Start the dev server, exposed on the local network (`--host`) |
| `npm run build`     | Type-check, then produce a production build in `dist/`        |
| `npm run preview`   | Serve the production build locally                            |
| `npm run typecheck` | TypeScript check with no emit                                 |
| `npm run lint`      | ESLint                                                        |
| `npm run gen:api`   | Regenerate the API client from `shared/openapi.json`          |

---

## Local development

```bash
npm run dev
```

`--host` is enabled so the app can be opened from a phone on the same network,
which is the realistic way to test the QR entry flow and the mobile layout.

The backend must be running and reachable at `VITE_API_URL`, and its
`CORS_ALLOWED_ORIGINS` must include this app's origin.

---

## Production build

```bash
npm run build
```

`build` runs `tsc --noEmit` first, so a type error fails the build. The output
in `dist/` is a static bundle and can be served by any static file server.

Because the API origin is baked in at build time, a deployment targeting a
different backend requires a rebuild, not just a configuration change.

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

The app calls the public `/api/consumer/*` endpoints, which require no
authentication. Server-side validation is authoritative: the backend calculates
every price and total, and a price sent by the client is discarded.

Product, category and banner images arrive as one field that holds either an
external address or a path on the QBusto server, such as
`/uploads/products/9f2c….webp`. `src/utils/imageUrl.ts` prefixes the second
form with `VITE_API_URL` and leaves the first alone, so both display the same
way. This is why `VITE_API_URL` has to be reachable from the customer's phone
and not only from the venue network.

---

## Project structure

```
src/
├── api/generated/   Generated API client (do not edit)
├── components/      Shared UI components
├── pages/           One component per route
├── services/        API calls and response adaptation
├── stores/          Zustand stores (cart, context, UI)
├── styles/          Sass stylesheets
├── types/           Shared TypeScript types
└── utils/           Formatting, error handling, payment helpers
```

---

## Deployment notes

- Serve over HTTPS. Cashfree checkout and browser payment features expect a
  secure context.
- **The Cashfree environment is not configured here.** `payment-init` returns
  the environment its session was issued in (`mode`: `sandbox`/`production`),
  resolved from that cinema's own `payment_gateway_config.environment`, and
  the SDK is loaded with it. So switching a cinema between test and production
  is a change to that row alone — no `VITE_*` value, no rebuild, and cinemas
  on different environments are served correctly by one build.

  This replaced a build-time `VITE_CASHFREE_MODE`, which was a second
  independent source for the same fact: when the two disagreed the SDK
  rejected the payment session id and the checkout silently never opened.
- Configure the static host to serve `index.html` for unmatched paths, so
  client-side routes such as `/confirmation/:orderId` resolve on a direct visit
  or a page refresh.
- The backend's `CORS_ALLOWED_ORIGINS` must list the deployed origin.
