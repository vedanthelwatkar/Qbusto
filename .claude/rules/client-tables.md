---
paths:
  - backend/models/session.js
  - backend/models/screenlayout.js
  - backend/models/screen.js
  - backend/src/routes/session.routes.js
  - backend/src/routes/screen.routes.js
  - backend/src/services/session.service.js
  - backend/src/services/screen.service.js
  - backend/src/services/showSync.service.js
  - backend/src/controllers/session.controller.js
  - backend/src/controllers/screen.controller.js
  - backend/src/validators/session.validators.js
  - backend/src/validators/screen.validators.js
  - dashboard/src/pages/SessionsPage.tsx
  - dashboard/src/pages/ScreensPage.tsx
  - dashboard/src/components/sessions/SessionDetailsDrawer.tsx
  - dashboard/src/components/screens/ScreenSelect.tsx
  - dashboard/src/components/screens/ScreenFormModal.tsx
  - dashboard/src/components/screens/ScreenDetailsDrawer.tsx
---

# Sessions and Screens — the client-owned area

**This is the least README-documented and most surprising part of the repo.**

## `session` is the ONE source of showtimes

There is exactly one table of screenings, and it is `session`. There is no
`film` table, no `shows` table, no `session_old`, and no provider-specific
copy of either — all of them were dropped by
`20260904000100-session-sole-show-source.js`. Every POS provider's showtimes
are normalised into this one table by `showSync.service`; nothing downstream
knows or cares which provider a row came from.

```
POS provider -> adapter (src/pos/) -> showSync.service -> session
                                                            |
                                              QBusto APIs (consumer + staff)
                                                            |
                                       Consumer / Dashboard / Kitchen / Reports
```

**A frontend never calls a POS.** Consumer and Dashboard read `session`
through QBusto's own endpoints; the ShowBiz/Vista base URLs and credentials
exist only on the backend.

**Writing to `session` needs raw SQL, not the model.** Its date columns are
`datetime`, which carries no offset, and Sequelize binds a JS Date as an
offset-bearing literal that SQL Server refuses to convert - the statement fails
with "Conversion failed when converting date and/or time from character
string". Verified against the live table. `showSync.service.writeSessionRow`
formats the three datetimes with `utils/sqlDate.toSqlDateTime` and binds
everything else as a parameter. The same constraint `utils/sqlDate.js`
documents for comparisons applies to writes.

**The POS sync will not reconcile on an incomplete view.** Closing "every
session the POS did not report" is only meaningful when every row it DID
report was representable. A sync that skipped rows, or that got an empty
response, closes nothing and says so (`summary.reconciled = false`). Today no
adapter supplies an end time, so every row is skipped - without this guard a
successful sync would close a cinema whole open schedule, including the rows
the client loaded directly.

`session` keeps its provider column names (`Session_lngSessionId`,
`Session_dtmRealShow`, ...) because the client syncs against it. The model
supplies QBusto vocabulary via `field:` mappings only. Its ten columns:

| Column | Model field | Notes |
| --- | --- | --- |
| `Code` | `cinemaCode` | FK to `cinemas.code`, **not** `cinemas.id` |
| `Session_lngSessionId` | `sessionId` | `int`; PK is the composite `(Code, Session_lngSessionId)` |
| `Film_strCode` | `filmCode` | Provider's film code. NOT a FK — there is nothing to point at |
| `Film_strName` | `filmTitle` | **The title lives here.** Backfilled from the old `film` table before it was dropped |
| `Screen_bytNum` | `screenNumber` | |
| `Screen_strName` | `screenName` | Text. **No `screens.id`** — see the grain conflict below |
| `Session_strStatus` | `status` | See the status table below |
| `Session_dtmRealShow` | `startsAt` | NOT NULL |
| `Session_dtmFinishShow` | `endsAt` | NOT NULL. Load-bearing for current-show selection |
| `Session_dtmStamp` | `stampedAt` | Provider's own row timestamp |

Why the title is a **column** and not a join: the old shape joined `film` with
`required: true`, which silently DROPPED any screening whose film row was
missing. A denormalised title cannot do that.

- **There is deliberately no second `sessions` table** and no QBusto-owned
  `films` table. Earlier migrations that created duplicates were removed.
- `session` associates only to `Cinema`, on `cinemaCode -> cinemas.code`.

**Session status (`Session_strStatus`) — client-defined:**

| Value | Meaning | Consumer behaviour |
| --- | --- | --- |
| `O` | Open | **The only status offered to customers** |
| `C` | Closed | Excluded in SQL |
| `I` | Inactive | Excluded in SQL |

The live table also contains a small number of rows with an **undocumented
`Y`**. It is not interpreted anywhere: because it is not `'O'` it is simply
never offered. Do not invent a meaning for it.

The filter is a **SQL predicate**, not a mapping step — a non-Open session
never leaves the database. `SESSION_STATUS_OPEN = 'O'` in
`consumer.service.js`. It cannot be bypassed by a client and cannot be lost to
a later refactor of the response shape.

## Consumer session picker (`getSessions`)

Offers screenings starting within **3 hours either side of now**
(`SESSION_WINDOW_HOURS = 3`) — a flat window around the current moment,
deliberately **not** tied to a calendar or programming day, so a 23:45
screening is still offered at 01:30 the next morning. The **lookback half is
intentional**: a screening already under way is offered, because someone
twenty minutes into a film is the customer most likely to want food. Capped at
**2 per screen** (`SESSIONS_PER_SCREEN = 2`) so one busy auditorium can't
crowd out the rest.

### The current show is chosen by the SERVER

`GET /api/consumer/cinemas/:cinemaId/sessions?screenId=...` takes the QR's
screen id and flags at most one entry `isCurrent: true`. The Consumer
preselects that entry, and the customer can still change it.

- The screen id is resolved to a **name** (`screens.id -> screens.name`,
  scoped to the cinema and `is_active`), because `session` holds only the
  name. An unknown or out-of-scope screen means "no current session", not an
  error.
- The match is `startsAt <= now < endsAt` against `Session_dtmFinishShow`,
  with `now` read from the **server's** clock. No client-supplied time is
  accepted anywhere on this path — a phone with a wrong clock must not be able
  to select a different show.
- The comparison uses `utils/sqlDate.sqlDateTimeLiteral()`, because these are
  offset-less `datetime` columns.
- Rows where `endsAt <= startsAt` are excluded from auto-selection. The live
  table has some (a provider data fault); they stay hand-selectable, and are
  **not** repaired by QBusto.
- Overlapping screenings on one auditorium exist, so candidates are ordered
  `startsAt DESC` and the most recently begun wins.
- The entry is merged back into the response even if the 3h / 2-per-screen
  filters would have dropped it, so `isCurrent` is never advertised and then
  missing.

At order time the backend re-reads the session by `(cinemaCode, sessionId)`,
rejects a non-`O` status with a 409, and takes `filmTitle`, `showTime` and the
screen name **from that row** — a payload cannot put one film's title on
another film's screening.

### No model getters on the datetimes

`startsAt`/`endsAt` carry **no model getters** — and must not gain any. These
`datetime` columns hold cinema-local (IST) wall clock with no offset, and the
connection sets `useUTC: false` (see the timezone section in CLAUDE.md), so
tedious already parses them as process-local, with the process pinned to IST
by `APP_TIMEZONE`. An earlier fix corrected the value in an `asLocalWallClock`
getter because the connection then parsed it as UTC; once that moved to the
driver, the getter became a **second** conversion and was removed. Same rule
for any other offset-less client `datetime` column: the driver handles it, the
model does not.

Session API routes are **read-only** (`GET` only, `Settings:read`) — there is
no create/update/delete through the API; rows arrive from the POS sync or from
the client directly.

## `screens` grain conflict — RESOLVED for the consumer order path

QBusto's design: **one `screens` row = one auditorium**. `orders.screen_id`
is a FK to it, and screen names are unique within a cinema (enforced in
`screen.service.assertNameAvailable`, not by the database).

The client's data: **one row per seat row** — cinema 8 ("NOIDA") holds 61
rows across 4 distinct screen names, with:
- `screens.category` `nvarchar(50)` NULL — a **seat class** ("Platinum",
  "Recliner"), free text, not a screen class. The same auditorium carries more
  than one.
- `screens.seat_row` `nvarchar(2)` NULL — a **seat-row label** ("A".."N"), not
  a count. Two characters, so "AA" is possible. Matches the row half of
  `orders.seat_number` (e.g. "A5") and the consumer's `ROW_PATTERN`
  `/^[A-Za-z]{1,2}$/`.

Worked example: cinema 8 "Screen 1" occupies 10 rows — Platinum for rows A–I,
Recliner for row J.

**The resolution**, confirmed by the client: `(cinema_id, name, seat_row)` is
unique across the whole table — verified live (e.g. cinema 8 + "Screen 2" +
row A is exactly one row, id 32). The consumer order path resolves on it:

- `getSessions` returns, per screen name, either a single `screenId` (the
  auditorium-grain shape — name alone is unique, `seatRows` empty) or a list
  of `seatRows` (the seat-row-grain shape — `screenId` null until a row is
  chosen).
- `CheckoutDrawer`'s row field becomes a `<select>` of exactly those rows
  when `seatRows` is non-empty, otherwise the existing free-text input.
- `consumer.service.resolveScreenId(cinemaId, screenName, seatRow)` does the
  actual lookup **at order-creation time** — the first moment both parts
  exist — never trusting a client-supplied `screenId` directly. A screenName
  with no match, or a seat-row-grain screen with no matching row, is a 400
  naming the `seatRow` field; nothing is guessed.

Note that the `screenId` on the **sessions** request is a different thing: it
is the QR's screen, used only to decide which show is running, never to decide
which `screens` row an order is filed against.

Any **other** consumer of `screens` (e.g. the Dashboard `ScreensPage` /
`ScreenSelect`, which still assume one row per auditorium) is **not** covered
by this resolution and must not assume it without doing the same
by-name-and-row analysis first.

## `screen_layout` (`backend/models/screenlayout.js`)

The client's **seat map**: one row per physical seat. `id`, `cinema_id`,
`screen_name`, `category`, `seat_row`, `seat_no` (text — seat numbering is
not always numeric), `is_active`, `created_by`, `updated_by`, `created_at`,
`updated_at`. FKs to `cinemas` and `users`.

- Identifies a screen by **`screen_name` text, not `screens.id`** — a
  normalisation weakness, left exactly as the client built it. Resolving the
  name is the reader's job, not something to fix by redesigning the table.
- **Currently empty (0 rows).**
- **Nothing in the application reads it.** QBusto neither sells nor
  allocates seats. The model exists so the table is reachable and covered
  by schema verification rather than sitting outside the application's view
  of the DB.

## Open questions (unverified)

- Why do `category`/`seat_row` sit on `screens` when `screen_layout` already
  has both plus `seat_no`? Staging area, or is `screen_layout` the
  destination?
- Will `screen_layout` be populated, and by what?
- Is `category` a controlled vocabulary or free text? Currently modelled as
  free text.
- Can `seat_row` exceed one character? The column allows two.
- What does `Session_strStatus = 'Y'` mean?
