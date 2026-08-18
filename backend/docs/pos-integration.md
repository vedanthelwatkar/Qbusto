# POS Integration Architecture

> **Status: Phases B1 and B2 IMPLEMENTED. Phases B3–B10 PLANNED / NOT STARTED.**
>
> Sections are labelled so the distinction is unambiguous:
>
> | Label | Meaning |
> | ----- | ------- |
> | **Existing** | Was in the repository before this work |
> | **Implemented** | Built and validated in a completed phase |
> | **Planned** | Designed, not built |
> | **Blocked** | Cannot be built until external input arrives |
>
> §4 (the `shows` table) and §5 (the adapter boundary) are Implemented.
> Everything describing synchronization, the Consumer API, the Dashboard and
> Reports remains Planned or Blocked, and must not be read as existing code.
>
> §5 being Implemented means the **boundary** exists — the contract, the
> normalized shape, the registry and the error taxonomy. **No provider adapter
> exists.** The registry is empty, so every provider currently resolves to a
> failure; Vista (B3) and Showbiz (B4) are blocked on §12.3.
>
> Table definitions that
> exist today are in [schema.md](./schema.md) and [schema.dbml](./schema.dbml).

---

## 1. Purpose

QBusto needs a list of shows so the Consumer checkout can present a **Show Time
dropdown**. Show data originates in the cinema's POS (Vista or Showbiz). The
Consumer must never talk to a POS directly.

```
Vista / Showbiz
      ↓ (backend adapter)
Normalized QBusto show data
      ↓ (Consumer API)
Consumer Show Time dropdown
      ↓
Dashboard + Reports (same normalized data)
```

Provider differences stop at the adapter boundary. Consumer, Dashboard and
Reports must not be able to tell whether a show came from Vista or Showbiz.

---

## 2. Existing POS support

The schema layer is substantially built. The application layer is not.

### 2.1 What exists

| Table | Model | Purpose |
| ----- | ----- | ------- |
| `pos_integrations` | `models/posintegration.js` | One POS connection per cinema per provider. Holds `provider`, `external_cinema_id`, `api_url`, `credential_ref`, `config`, `is_active`. |
| `screen_pos_mappings` | `models/screenposmapping.js` | QBusto `screen_id` ↔ `external_screen_id`. Unique on `(pos_integration_id, screen_id)`. |
| `product_pos_mappings` | `models/productposmapping.js` | QBusto `product_id` ↔ `external_item_id` / `external_group_id`. |
| `order_pos_context` | `models/orderposcontext.js` | Per-order external identifiers: `external_session_id`, `external_film_id`, `external_screen_id`, `external_booking_id`. One row per order, immutable. |
| `pos_transactions` | `models/postransaction.js` | Audit trail of POS API attempts **for an order**. `order_id` is NOT NULL. |

`provider` is constrained to `vista`, `showbizz`, `impact`, `qbusto` — both in
the model validator and the database CHECK constraint. Note the schema spells it
**`showbizz`**, with two z's.

`POS Integrations` is already one of the ten frozen permission modules
(`src/constants.js` → `MODULES.POS_INTEGRATIONS`).

### 2.2 What does not exist

Verified by inspection of `src/routes/`, `src/controllers/`, `src/services/`,
`src/validators/` and `src/routes/api.routes.js`:

> **Historical — this is the state as surveyed in Phase B0.** Two bullets have
> since changed and are kept as written rather than rewritten: B1 created the
> `shows` table (§4), and B2 created the provider abstraction in `src/pos/`
> (§5). Everything else below is still accurate — in particular there is still
> no POS route, controller, service or validator, no Vista or Showbiz client, no
> credential resolution, and no synchronization.

- **No POS service, controller, route, or validator.** No `/api/pos-*` endpoint
  is mounted. The five POS models are loaded and associated, and nothing reads
  or writes them.
- **No provider abstraction.** There is no adapter, driver, or registry concept
  anywhere in the backend.
- **No Vista or Showbiz client.** No HTTP client dependency at all
  (`package.json` has no axios/node-fetch; Node 24 provides global `fetch`).
- **No credential resolution.** `pos_integrations.credential_ref` is documented
  as a pointer to external secret storage. Nothing resolves that pointer.
- **No synchronization of any kind.** No polling, no webhook receiver, no
  import script.
- **No scheduled/background job infrastructure.** No `node-cron`, `bull`,
  `agenda`, or equivalent. The process is a plain Express server.
- **No show, session, film, or movie table.** This is the central gap — see §4.

### 2.3 What the legacy system did

`backend/scripts/legacy-schema-output.json` shows `DAE_Orders` carried
`Session_lngSessionId`, `Film_strTitle`, `Film_strCode` and
`Session_dtmRealShow` directly on the order row, and `Cinema_strID` as a
*string* external cinema id (samples: `"1074"`, `"1128"`).

There is no legacy shows table. PopExpress denormalized the selected session
onto the order and read live session data from Vista at selection time. QBusto
already models the per-order half of this correctly (`orders.film_title`,
`orders.show_time`, `order_pos_context.*`). It does not yet model the catalog
half.

---

## 3. Existing data model relevant to shows

| Model | Fields that matter here | Can it represent a show? |
| ----- | ----------------------- | ------------------------ |
| `Cinema` | `id`, `chain_id`, `code`, `name`. `code` is QBusto-owned and explicitly *not* the POS cinema id. **No timezone column.** | No. It is the tenant anchor a show hangs off. |
| `Screen` | `id`, `cinema_id`, `name` (varchar 50), `is_active`. No number column — the "screen number" is the name. | No. It is the show's location. |
| Film / Movie | **Does not exist.** | — |
| Show / Session | **Does not exist.** | — |
| `Order` | `film_title` varchar(200), `show_time` datetime2 — both documented as "Provider-neutral display snapshot". Nullable. | Per-order snapshot only. Cannot be listed as available shows; a show with no orders would not exist. |
| `OrderPosContext` | `external_session_id`, `external_film_id`, `external_screen_id`, `pos_integration_id`. | Per-order only, and immutable. Same limitation. |
| `OrderItem` | `pos_item_id` — snapshot of the external POS item id. | Unrelated to shows. |

**No seat table exists.** Seats are free text: `orders.seat_number` varchar(20).
Row + Seat are concatenated by the Consumer into that single column. Nothing in
this design changes that.

---

## 4. Decision: a new table is required — **IMPLEMENTED (Phase B1)**

**Yes.** A new `shows` table is required.

> **Implemented in Phase B1.** Migration `20260813000100-create-shows.js`, model
> `models/show.js`. The as-built table is documented in
> [schema.md](./schema.md#shows); the design below is what was built, unchanged.
> Validated against a real SQL Server instance.

**Why.** The dropdown needs to list shows that have no orders yet. Every existing
representation of a show (`orders.show_time`, `order_pos_context.*`) is created
*as a consequence of* an order and is immutable afterward. There is no table that
can answer "what is playing at cinema 5 between 11:00 and 17:00". No combination
of existing fields can answer it, so this is not a case where an existing model
can be reused or extended.

**Why not extend `orders`.** `orders` is a transaction record. Adding a
scheduling role to it would make every order-listing query filter on rows that
represent no sale, and would make show synchronization write to the order table.

### 4.1 The table (CREATED — Phase B1)

Named `shows`, not `pos_shows`: following the platform's modernization principle, the
domain stays provider-neutral, and the POS-ness is carried by
`pos_integration_id` + the `external_*` columns.

```
Table shows {
  id                  int           [pk, increment]
  cinema_id           int           [not null, note: 'FK cinemas.id. Denormalized from pos_integrations for query and tenant scoping.']
  screen_id           int           [note: 'Nullable FK screens.id. Null when the external screen is not mapped yet.']
  pos_integration_id  int           [not null, note: 'FK pos_integrations.id. Identifies provider and external cinema.']
  external_session_id varchar(100)  [not null, note: 'Provider session/show identifier. Vista SessionId or Showbiz equivalent.']
  external_screen_id  varchar(50)   [note: 'As returned by the POS, before mapping.']
  external_film_id    varchar(50)
  film_title          varchar(200)  [not null, note: 'Display snapshot. Matches orders.film_title width.']
  show_time           datetime2     [not null, note: 'UTC instant. See §9.']
  status              varchar(20)   [not null, default: 'scheduled', note: 'Allowed values: scheduled, cancelled.']
  last_synced_at      datetime2     [not null, note: 'Last time the POS confirmed this show exists.']
  created_at          datetime2     [not null]
  updated_at          datetime2     [not null]

  indexes {
    (pos_integration_id, external_session_id) [unique, name: 'UQ_shows_external_session']
    (cinema_id, show_time)                    [name: 'IX_shows_cinema_show_time']
  }
}
```

**Uniqueness.** `(pos_integration_id, external_session_id)` is the natural key
and the entire duplicate-prevention mechanism. Sync is an upsert on it. A show
identified by the same provider session id is the same show, whatever else
changed.

**Index rationale.** `(cinema_id, show_time)` is exactly the shape of the
three-hour window query (§8). No other index is proposed until a query needs it.

**No `created_by` / `updated_by`.** These rows are machine-written by the sync,
not authored by a user. This matches `order_pos_context` and `pos_transactions`,
which also omit audit FKs, and differs from master-data tables, which have them.

**No `is_active`.** The soft-delete convention applies to staff-managed master
data. A show is not managed by staff; it is a mirror of external state. `status`
plus `last_synced_at` carries the lifecycle instead (§6.3).

**Lifecycle.** Insert on first sight; update `film_title`, `show_time`,
`screen_id`, `status` and `last_synced_at` on every subsequent sight; mark
`cancelled` when the POS stops returning it. Never hard-deleted while any order
may reference it.

### 4.2 No change to `orders` is needed

This is the significant finding. `orders.film_title` and `orders.show_time`
already exist as snapshots, and `order_pos_context` already stores
`pos_integration_id` + `external_session_id` — which is precisely the natural key
of the proposed `shows` table.

So an order links to a show through a clean composite join on a unique key:

```
order_pos_context (pos_integration_id, external_session_id)
    → shows (pos_integration_id, external_session_id)
```

No `orders.show_id` column, no migration against a frozen transactional table,
and Reports can still aggregate sales per show. The Consumer sends a `showId`;
the backend resolves it and writes the snapshot plus the POS context. `showId`
is a request field, never a stored column.

### 4.3 Deliberately not created

- **A `films` / `movies` table.** The only stated requirement is a display title
  in a dropdown. A film master introduces cross-provider identity matching (the
  same film has different ids in Vista and Showbiz) for no current benefit.
  Reports can group by `external_film_id` within a provider, or by
  `film_title`. Revisit if a real requirement appears. Open item §12.2.
- **A `seats` table.** Nothing requires it. Seats stay free text.
- **`orders.show_id`.** See §4.2.
- **A `pos_sync_runs` table.** See §6.7 — deferred, not rejected.

---

## 5. Normalized model and adapter boundary — **IMPLEMENTED (Phase B2)**

```
                    ┌──────────────────────────────────┐
   Vista API  ──▶   │  VistaAdapter                    │
                    │    fetchShows(integration, range)│──┐
   Showbiz API ──▶  │  ShowbizAdapter                  │  │  normalized
                    │    fetchShows(integration, range)│──┘  ExternalShow[]
                    └──────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │  showSync.service                │  upsert on natural key
                    │  (mapping + timezone + status)   │  screen mapping
                    └──────────────────────────────────┘
                                   │
                                   ▼
                              shows table
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        Consumer API         Dashboard API          Reports
```

### 5.1 The adapter contract (BUILT — Phase B2)

Built in `src/pos/`. Five files, no framework:

| File                          | Role                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `src/pos/adapter.js`          | `PosAdapter` and `ShowWindow` typedefs; `assertPosAdapter`, `assertShowWindow` |
| `src/pos/externalShow.js`     | `ExternalShow` typedef; `normalizeExternalShow(s)`, `normalizeShowTimeLocal` |
| `src/pos/posErrors.js`        | Provider-neutral error taxonomy                                            |
| `src/pos/providerRegistry.js` | `provider` → adapter lookup                                                |
| `src/constants.js`            | `POS_PROVIDERS`, mirroring `CK_pos_integrations_provider`                   |

`src/pos/` is not a new architectural layer. The development guide already names
`Business Service → Provider Adapter → External POS` as the required shape for
integrations; this is that adapter layer, sitting beside `src/services/`. The B5
sync service will be an ordinary service that consumes it.

The signature, unchanged from the B0 design:

```
fetchShows(integration, { fromUtc, toUtc }) → ExternalShow[]

ExternalShow {
  externalSessionId : string   // required, stable, the natural key
  externalScreenId  : string | null
  externalFilmId    : string | null
  filmTitle         : string
  showTimeLocal     : string   // provider wall-clock, no offset
  cancelled         : boolean
}
```

An adapter is a **plain object** with a `provider` string and a `fetchShows`
method. There is no base class to extend and no factory to call. Everything
provider-specific — transport, authentication, retries, pagination, response
quirks, error mapping — lives inside `fetchShows`, and nothing above the adapter
reads `provider` except the registry.

`assertPosAdapter` checks the shape at registration time, so a malformed adapter
fails when the process wires itself up rather than on the first sync tick.
`assertShowWindow` rejects a missing, non-`Date` or backwards window identically
for every provider.

### 5.2 `ExternalShow` — what crosses the boundary

Every field maps to a column that already exists on `shows`:

| Field               | Type            | `shows` column        |
| ------------------- | --------------- | --------------------- |
| `externalSessionId` | string          | `external_session_id` |
| `externalScreenId`  | string \| null  | `external_screen_id`  |
| `externalFilmId`    | string \| null  | `external_film_id`    |
| `filmTitle`         | string          | `film_title`          |
| `showTimeLocal`     | string          | `show_time`, after B5 converts it |
| `cancelled`         | boolean         | `status`              |

Nothing else. Seat maps, pricing, ratings, runtime and booking counts are all
things a POS could return and none has a column, so accepting them would create
a field with no meaning downstream. `cancelled` is not speculative — §6.3
requires a POS-cancelled show to become `status = 'cancelled'` rather than
vanish, and that cannot be derived from absence alone.

`normalizeExternalShow` enforces the shape: required fields, optional screen and
film ids, and **rejection rather than truncation** when a value is wider than
its column, since a truncated `externalSessionId` would silently corrupt the
natural key. A malformed row raises `PosMalformedResponseError` at the boundary
instead of failing as a constraint violation during the B5 upsert.

### 5.3 Provider registry

Selection is by `pos_integrations.provider` through a `Map`. No factory
framework, no base class — no new architectural layers beyond
Route → Controller → Service → Model.

```js
const adapter = getAdapter(integration.provider);
const shows = await adapter.fetchShows(integration, { fromUtc, toUtc });
```

**The registry ships empty.** `pos_integrations.provider` accepts four values —
`vista`, `showbizz` (note the double z, which is what the frozen CHECK
constraint contains), `impact`, `qbusto` — and none of them has an adapter.
Database support is not application support: a provider being storable says the
schema will hold the row, not that the application can talk to that POS.

So `getAdapter` currently throws for every provider. Failing loudly is the
point — an integration that quietly synced nothing would look, from the
Dashboard and the Consumer dropdown, exactly like a cinema with no shows
scheduled. Two cases are distinguished because they need different fixes:

| Case                                  | Message                              | Fix                                           |
| ------------------------------------- | ------------------------------------ | --------------------------------------------- |
| Value the database would reject       | `Unknown POS provider "…"`           | Bad data, or a schema change not mirrored into `src/constants.js` |
| Known value, no adapter registered    | `… has no adapter implemented`       | The phase implementing it is not done (B3/B4) |

`hasAdapter(provider)` exists for callers that must skip or report an
unsupported integration rather than fail — a B5 sync run iterating every active
integration, or the B8 Dashboard health view.

### 5.4 Error semantics

Four outcomes, distinguishable by `posCode` without knowing the provider:

| Outcome                          | Class                           | `posCode`                    |
| -------------------------------- | ------------------------------- | ---------------------------- |
| Provider failed or unreachable   | `PosProviderUnavailableError`   | `POS_PROVIDER_UNAVAILABLE`   |
| Integration configured wrongly   | `PosConfigurationError`         | `POS_INVALID_CONFIGURATION`  |
| Answered, but unusable payload   | `PosMalformedResponseError`     | `POS_MALFORMED_RESPONSE`     |
| No adapter for the provider      | `PosProviderNotSupportedError`  | `POS_PROVIDER_NOT_SUPPORTED` |

**Zero shows is none of these.** A successful call returning `[]` is the normal
state outside opening hours. §6.3 depends on the distinction: only a
*successful* sync may cancel shows absent from the window, so an adapter that
threw on an empty result would both look like an outage and suppress the
cancellation pass.

Neutrality rules, all enforced by tests:

- The class is chosen from the taxonomy, never from an HTTP status, SOAP fault
  or provider error string. No class name, code or default message mentions a
  provider or a transport.
- Credentials, tokens, auth headers and raw provider payloads never appear in
  `message`, per the external-integration and logging conventions. The underlying error is attached as `cause`
  for diagnostics and is deliberately kept **off** `details`, which is the only
  part the error middleware serializes to a client.
- `toLogContext()` returns identifiers only: `posCode`, `provider`,
  `integrationId`, `operation`.

The classes extend `AppError` so that if one ever escapes to a route — a manual
sync endpoint in B5, the health view in B8 — the existing error middleware
handles it safely instead of leaking a 500. The HTTP status on each is a safe
default, not a contract: **`posCode` is the discriminator**, and mapping POS
failures onto HTTP responses is B5/B8's decision, not the adapter's.

`PosProviderUnavailableError` also carries `ambiguous`, for the case where an
adapter cannot tell whether a request reached the provider. `fetchShows` is a
read and is safe to retry; the flag exists so the same taxonomy can carry write
operations later without violating the idempotency and reliability conventions.

### 5.5 Timezone responsibility — enforced, not merely documented

The adapter returns provider wall-clock and does **not** convert timezones.
Conversion is centralized in the sync service so both providers cannot drift
apart (§9.3, and the adapter-boundary convention).

B2 makes this a rule the code enforces. `normalizeShowTimeLocal` accepts only
`YYYY-MM-DDTHH:mm[:ss]` (a space separator is tolerated) and rejects:

- any value carrying a `Z` or a `±HH:MM` offset — an offset means the value has
  been pinned to an absolute instant;
- a JavaScript `Date` — a `Date` *is* an instant, so its presence proves the
  adapter already converted;
- an impossible date such as `2026-02-30T10:00:00`, rather than letting it roll
  over into March.

An adapter that converts therefore cannot pass its own normalizer. The output is
byte-identical to the provider's wall clock and is unaffected by the server's
process timezone.

The request window is the mirror image: `{ fromUtc, toUtc }`, computed from the
server clock (§6.6) and identical for every provider, which is why it is
expressed in UTC rather than in any cinema's local time. If a provider's API
requires a *local-time* window, the sync service must supply it — deriving it
inside the adapter would put timezone logic straight back where this rule
removed it. How B5 supplies it is open item §12.13 and is deliberately not
decided here.

### 5.6 What B5 consumes from B2

The sync service needs exactly four things, and nothing about any provider:

1. `getAdapter(integration.provider)` — resolution, or a clear failure.
2. `adapter.fetchShows(integration, { fromUtc, toUtc })` → `ExternalShow[]`.
3. `posCode` on any thrown `PosAdapterError`, to decide whether the run failed
   (leave rows untouched, cancel nothing, retry next tick — §6.5) or the
   integration is misconfigured (retrying cannot help).
4. An empty array meaning "successful, quiet window", which is what licenses the
   §6.3 cancellation pass.

Everything else is B5's own work: timezone conversion, screen mapping,
tenant-consistency validation, the natural-key upsert, reconciliation and
scheduling. B2 deliberately implements none of it.

---

## 6. Synchronization strategy

### 6.1 Direction: scheduled polling, not webhooks

Vista and Showbiz are on-premise POS systems. Neither is assumed to be able to
call out to QBusto, and the legacy system read sessions live rather than
receiving pushes. **Assume polling until POS documentation proves a webhook is
available** (§12.3 — blocked on external input).

### 6.2 Recommended shape: scheduled poll + manual trigger

| Option | Verdict |
| ------ | ------- |
| Fetch from POS on each dropdown request | Rejected as the primary path. Dropdown latency becomes POS latency, checkout breaks whenever the POS is down, and Reports get no history. |
| Scheduled background poll into `shows` | **Recommended.** Dropdown reads local rows only. Survives POS downtime with a staleness signal. |
| Manual "Sync now" from the Dashboard | **Recommended as a supplement.** Needed for operations and for the first sync after configuring an integration. |

Poll interval: **every 5 minutes per active integration** is the starting
proposal — well inside the granularity of a ±3h window, cheap for a handful of
cinemas. Not yet validated against real POS rate limits.

Sync **window**: fetch the current day plus the next day, not just ±3h. Wider
than the query window so the query is always served from complete local data,
and so Reports accumulate history. Confirm against POS API limits.

**Scheduler selection is deferred to Phase B5 (§12.4).** No job infrastructure
exists and no dependency may be added. Candidates: an in-process `setInterval`
behind an env flag (simplest, correct for a single on-premise instance), or a
`scripts/sync-shows.js` invoked by Windows Task Scheduler (keeps the API process
free of background work). Recommendation leans to the script plus an optional
in-process timer.

### 6.3 Reconciliation rules

| Situation | Rule |
| --------- | ---- |
| Show seen for the first time | Insert. `status = 'scheduled'`, `last_synced_at = now`. |
| Show seen again, unchanged | Update `last_synced_at` only. |
| Show time changed | Update `show_time`. Same row — the session id did not change. |
| Film or screen changed | Update the field. Same row. |
| Show marked cancelled by POS | `status = 'cancelled'`. Never deleted. |
| Show absent from a successful sync covering its time range | `status = 'cancelled'`. Absence is only meaningful when the sync **succeeded**; a failed sync must never cancel anything. |
| Show is stale (`last_synced_at` far behind) | Not cancelled. Surfaced to the Dashboard as a health signal. |
| Duplicate arrives | Impossible by construction — unique index on the natural key. |

### 6.4 Identity mapping

| External | Maps to | Mechanism |
| -------- | ------- | --------- |
| Cinema | `cinemas.id` | Already solved: `pos_integrations.external_cinema_id`. The sync runs *per integration*, so the cinema is known before any POS call. |
| Screen | `screens.id` | Already solved: `screen_pos_mappings`. Unmapped → `screen_id` stays null; the show still appears, with a null screen name. Hiding it would silently lose shows. |
| Film | — | Not mapped. Title stored directly (§4.3). |
| Product | `products.id` | Already solved: `product_pos_mappings`. Not used by the show flow. |

### 6.5 Failure handling

A sync failure must be inert: log, leave existing rows untouched, do not cancel
anything, retry on the next tick. A single integration's failure must not stop
the others.

### 6.6 Clock

Both `now` and the sync window are computed from the **server** clock. POS clock
skew is a real risk (§13).

### 6.7 Sync state and audit — deferred

`pos_transactions` cannot record a show sync: `order_id` is NOT NULL and a sync
has no order. Options are to relax that column (a migration on a frozen table),
add `pos_sync_runs`, or rely on structured winston logging plus
`shows.last_synced_at`.

**Recommendation: start with logging + `last_synced_at`,** and add
`pos_sync_runs` only when operations actually need a queryable history. Open
item §12.5.

---

## 7. Consumer API (planned)

Following the existing convention in `src/routes/consumer.routes.js`, where
every cinema-scoped resource is `/api/consumer/cinemas/{cinemaId}/<resource>`:

```
GET /api/consumer/cinemas/{cinemaId}/shows
```

Public and unauthenticated, like the other consumer endpoints. No request
parameters — the window is server-defined (§8).

Response, in the standard `success()` envelope:

```json
{
  "success": true,
  "data": [
    {
      "id": 412,
      "screenId": 7,
      "screenName": "Screen 1",
      "filmTitle": "Movie A",
      "showTime": "2026-08-13T05:00:00.000Z"
    }
  ],
  "meta": {}
}
```

`screenId` and `screenName` are null when the external screen is unmapped.

**Not exposed:** `posIntegrationId`, `provider`, `externalSessionId`,
`externalFilmId`, `externalScreenId`, `status`, `lastSyncedAt`. The Consumer must
not be able to tell which POS produced a show.

**Not paginated,** deliberately. The platform conventions require server-side pagination for
browsable lists; this is a bounded window at a single cinema (tens of rows at
most) that exists only to fill one dropdown. Revisit if a real dataset disproves
the bound.

**Order creation.** `POST /api/consumer/orders` gains an optional `showId`. When
present the backend loads the show, verifies it belongs to `cinemaId`, and
derives `film_title`, `show_time` and `screen_id` from it, then writes
`order_pos_context`. Client-supplied `filmTitle`/`showTime` are then ignored, so
show data on an order is always backend-derived. This is additive and requires no
change to the `orders` table (§4.2). It does change the Consumer contract — see
§12.6.

---

## 8. Three-hour window

All filtering is server-side. The Consumer receives only relevant shows.

| Concern | Decision |
| ------- | -------- |
| Where | Backend, in the service, as part of the query. |
| Current time | Computed **server-side**. Never accepted from the client — a client-controlled `now` is untrustworthy and makes the endpoint untestable. |
| Window | `now - 3h` … `now + 3h`. |
| Boundaries | **Inclusive on both ends.** A show starting exactly now must be selectable. |
| Filter | `cinema_id = :cinemaId AND status = 'scheduled' AND show_time BETWEEN :from AND :to`. |
| Sort | `show_time ASC`, then screen name ASC as a stable tiebreak. |
| No shows | `200` with `data: []`. Not `404` — the cinema exists and the answer is "none right now". Unknown cinema stays `404`, consistent with the other consumer endpoints. |
| Configurable | Not initially. Three hours is hardcoded as one named constant. If it becomes cinema-specific it belongs in configuration, not a query parameter. |

---

## 9. Timezone strategy

This is the highest-risk part of the design. A mistake here shifts every show by
five and a half hours.

### 9.1 Verified current behaviour

- `backend/config/config.js` sets **no `timezone` option** in any environment.
  (Sequelize's `timezone` option is a MySQL/Postgres feature and is ignored by
  the mssql dialect regardless.)
- `dialectOptions.options` sets only `encrypt` and `trustServerCertificate`, so
  tedious keeps its default `useUTC: true`.
- Consequence: a JS `Date` is written using its **UTC** components and read back
  as the same instant. `DATETIME2` stores no offset, but the round trip is
  offset-consistent.
- Therefore `orders.show_time` behaves today as an **absolute UTC instant**,
  which matches the Consumer's ISO handling (`consumer/README.md` §checkout).

This was derived from configuration, not from a query against a live database.
It should be confirmed with a real SQL Server probe before the sync is built.

### 9.2 The gap

**`cinemas` has no timezone column.** There is no way to know a cinema's local
timezone today.

### 9.3 Recommended strategy

Normalize once, at the sync boundary:

```
POS returns local wall-clock  "2026-08-13 10:30:00"   (no offset — legacy
                                                       Session_dtmRealShow was
                                                       plain `datetime`)
        ↓  convert using the cinema's IANA timezone
shows.show_time (UTC instant)  2026-08-13T05:00:00Z
        ↓
API emits ISO with Z; every consumer formats to local for display
```

Everything above the adapter deals only in UTC instants. Node's built-in `Intl`
supports IANA zones, so no dependency is needed for the conversion.

### 9.4 DECIDED (2026-08-13): `cinemas.timezone`

**A `cinemas.timezone` column holding an IANA timezone string (for example
`Asia/Kolkata`). A global `CINEMA_TIMEZONE` environment variable is rejected as
the permanent architecture.**

Rationale: QBusto is explicitly multi-tenant, with `Chain → Cinema → Screen`.
A chain may eventually span timezones, and POS showtimes are cinema-local, so
the timezone is a property of the cinema and belongs on the cinema row. An
environment variable would make a per-cinema fact global — the same class of
mistake as the legacy day-specific pricing columns that QBusto deliberately
normalized away.

Compatibility with the existing architecture was checked before accepting:

- The schema freeze permits a migration where a task explicitly requires one,
  and this one is required by §9.2.
- `cinemas` already carries per-cinema operational settings (`sms_enabled`,
  `whatsapp_enabled`, `gst_number`, `fssai_number`), so a per-cinema
  configuration column is consistent, not novel.
- Nothing in the codebase reads a global timezone today, so there is no
  environment-variable pattern being contradicted.

No strong reason against it was found.

**Not implemented in B1.** The column is not needed to create or use `shows` —
`shows.show_time` is already a UTC instant and nothing converts yet. It is
scheduled for **Phase B5**, where the sync service performs the conversion and
first reads it. Pulling it into an earlier phase would add an unused column.

Open items recorded with the decision: default value for existing rows,
nullability, and whether the Dashboard exposes it for editing. These are settled
in B5.

**Display.** The API returns the ISO instant. Formatting to cinema-local time is
the client's job, and each client already has a locale. If server-side formatted
strings turn out to be needed for the dropdown label, add a `showTimeLabel`
field rather than changing `showTime`'s meaning.

---

## 10. Dashboard implications

The `POS Integrations` permission module exists and has no UI (see the platform conventions,
"Remaining"). The same normalized data serves it:

- **Integrations CRUD** — `pos_integrations` per cinema. Secrets are never
  entered or displayed; `credential_ref` points elsewhere.
- **Screen mapping UI** — `screen_pos_mappings`, with unmapped external screens
  from the last sync highlighted, since those produce shows with a null screen.
- **Product mapping UI** — `product_pos_mappings`.
- **Shows viewer** — read-only list for a cinema and date, with `status` and
  `last_synced_at`. This is the operational answer to "why is the dropdown
  empty".
- **Manual sync** — triggers a sync for one integration, requires
  `POS Integrations: canEdit`.

Tenant isolation applies unchanged: a cinema-scoped user sees only their
cinema's integrations and shows; out-of-scope ids return `404`.

---

## 11. Reports implications

The proposed table carries everything a POS/show report needs:

| Reports need | Source |
| ------------ | ------ |
| POS source / provider | `pos_integrations.provider` via `shows.pos_integration_id` |
| External show id | `shows.external_session_id` |
| External cinema id | `pos_integrations.external_cinema_id` |
| Cinema | `shows.cinema_id` |
| Screen | `shows.screen_id` → `screens.name`, plus raw `external_screen_id` |
| Film | `shows.film_title`, `shows.external_film_id` |
| Scheduled show time | `shows.show_time` |
| Status | `shows.status` |
| Sync timestamp | `shows.last_synced_at` |
| Sales attributed to a show | join `order_pos_context` on `(pos_integration_id, external_session_id)` |

The last row is why the natural key was chosen as it was: sales-per-show works
without adding a foreign key to the frozen `orders` table.

**Retention.** `shows` grows without bound. A retention or archival policy is
required before this runs for a year in production — deferred, but recorded
(§13).

---

## 12. Decision register

Item numbers are stable. A resolved item keeps its number and gains a decision
rather than being removed, so references elsewhere stay valid.

| # | Item | Status |
| - | ---- | ------ |
| §12.1 | **Cinema timezone** | **DECIDED 2026-08-13** — a `cinemas.timezone` IANA column, *not* a global environment variable. Implemented in Phase B5, where it is first read. See §9.4. |
| §12.2 | **Film master table** — denormalized `film_title`, or a `films` table with cross-provider identity? | OPEN (§4.3) |
| §12.3 | **POS API access** — Vista and Showbiz endpoints, authentication, request/response shapes, rate limits, test credentials | **BLOCKED** on external input. Entirely unknown; no contract may be invented. Blocks B3 and B4 completely. |
| §12.4 | **Scheduler mechanism** — in-process interval, OS scheduler, or a new dependency (currently disallowed)? | **DEFERRED to Phase B5** by decision, after the POS architecture and deployment environment are confirmed (§6.2) |
| §12.5 | **Persisted sync audit** — logging only, or a `pos_sync_runs` table? | OPEN (§6.7) |
| §12.6 | **Consumer QR contract** — do existing seat QR codes stop carrying `showTime`, or is it accepted and ignored? | OPEN. Blocks B7. See §12.11. |
| §12.7 | **Empty dropdown vs required field** — Show Time is required; if the POS is down or no show falls in the window, checkout is blocked. Intended, or does Show Time become optional? | OPEN — **product decision, not technical**. Blocks B7. |
| §12.8 | **Cancelled show with an existing order** — what happens to an order whose show the POS later cancels? | OPEN |
| §12.9 | **Sync frequency and horizon** — 5 minutes / two days are proposals | OPEN, unvalidated against real POS limits |
| §12.10 | **Unmapped screens** — appear with no screen name (recommended), or be hidden? | OPEN |
| §12.12 | **Credential resolution** — what does `pos_integrations.credential_ref` point at? Which secret store, and what lookup shape? | OPEN. **Moved out of B2 into B3** — the answer depends on what Vista/Showbiz actually authenticate with, which is §12.3. Resolution happens inside an adapter, which already receives the whole integration row, so the B2 boundary is unaffected. |
| §12.13 | **Local-time request window** — if a provider's API needs the sync window as cinema-local wall clock rather than UTC instants, how does B5 supply it without putting timezone logic back into the adapter? | OPEN. Cannot be decided before §12.3: whether any provider needs this is unknown. The B2 contract passes `{ fromUtc, toUtc }` (§5.5). |

### 12.11 Consumer Show Time contract

Recorded here as the backend's understanding. The Consumer truth files own the
UI side and are unchanged by this phase.

- Show Time is **required** at checkout.
- Show Time is **never prefilled from the QR**. Only Row and Seat may be
  prefilled from a seat QR.
- Show Time options come from the backend shows API (Phase B6), never from the
  POS directly and never hardcoded.
- The backend filters to **now − 3h … now + 3h, inclusive on both ends**, with
  `now` computed server-side.
- The backend sorts chronologically.
- An empty result is `200` with `[]`, not `404`.
- The Consumer shows an appropriate empty state when no shows are available.

This supersedes the current `consumer/README.md` statement that `showTime` is
prefilled from the seat QR. **The Consumer truth files have not yet been
updated** — that belongs to Phase B7, together with the decision on whether
existing seat QR codes stop carrying the parameter or it is accepted and
ignored (§12.6).

Row No. becoming an A–Z dropdown is a Consumer UI concern with no backend
dependency: Row and Seat continue to be combined by the Consumer into the
existing `orders.seat_number` value, and no schema change is involved.

---

## 13. Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| POS API contracts unknown | Every downstream estimate is provisional; adapters cannot be written | Obtain documentation and sandbox credentials before Phase B3 |
| Timezone conversion wrong | Every show off by the UTC offset; silently plausible-looking | One conversion helper, real-database probe, verify against a known real show |
| POS unavailable → empty dropdown | Checkout blocked, since Show Time is required | Decide §12.7; surface staleness in the Dashboard |
| `external_session_id` not stable across syncs | Duplicate shows despite the unique index | Verify stability with real POS data before trusting the natural key |
| POS/server clock skew | Window edges select the wrong shows | Server clock is authoritative; monitor drift |
| `shows` grows unbounded | Query and storage degradation over time | Retention policy before production |
| Sync failure interpreted as cancellation | Shows wrongly disappear from the dropdown | Absence only cancels after a **successful** sync covering the range (§6.3) |
| Show data supplied by the client | Orders carry unverifiable film/time | Backend derives everything from `showId` (§7) |
| Provider leakage above the adapter | Consumer/Dashboard branch on `vista` vs `showbizz` | Provider fields are never serialized to the Consumer (§7) |
