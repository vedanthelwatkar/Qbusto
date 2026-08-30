---
paths:
  - backend/models/film.js
  - backend/models/session.js
  - backend/models/screenlayout.js
  - backend/models/screen.js
  - backend/src/routes/film.routes.js
  - backend/src/routes/session.routes.js
  - backend/src/routes/screen.routes.js
  - backend/src/services/film.service.js
  - backend/src/services/session.service.js
  - backend/src/services/screen.service.js
  - backend/src/controllers/film.controller.js
  - backend/src/controllers/session.controller.js
  - backend/src/controllers/screen.controller.js
  - backend/src/validators/film.validators.js
  - backend/src/validators/session.validators.js
  - backend/src/validators/screen.validators.js
  - dashboard/src/pages/FilmsPage.tsx
  - dashboard/src/pages/SessionsPage.tsx
  - dashboard/src/pages/ScreensPage.tsx
  - dashboard/src/components/films/FilmSelect.tsx
  - dashboard/src/components/films/FilmDetailsDrawer.tsx
  - dashboard/src/components/sessions/SessionDetailsDrawer.tsx
  - dashboard/src/components/screens/ScreenSelect.tsx
  - dashboard/src/components/screens/ScreenFormModal.tsx
  - dashboard/src/components/screens/ScreenDetailsDrawer.tsx
---

# Films, Sessions, Screens — the client-owned area

**This is the least README-documented and most surprising part of the repo.**

`film` and `session` are the **client's own Vista tables**, not QBusto tables.
They keep their provider column names (`Film_strCode`, `Session_lngSessionId`,
`Session_dtmRealShow`, …) because the client syncs against them. Models supply
QBusto vocabulary via `field:` mappings only.

- `film` PK = `Film_strCode` (varchar), **not** an integer id.
- `session` PK = composite `(Code, Session_lngSessionId)`; `Code` FKs to
  `cinemas.code`, not `cinemas.id`.
- **There is deliberately no second `films`/`sessions` table.** Earlier
  migrations that created QBusto-owned duplicates were **removed**.
- `session` has **no `screens.id`** — only `Screen_bytNum`/`Screen_strName`.
  Session responses return `screenName` as text, plus a `screenId` resolved
  from it by name (`resolveScreenIdsByName`, lowest active id wins on a
  duplicate name) so an order records the screen of the show the customer
  actually picked rather than whichever screen their QR was printed for.

**Session status (`Session_strStatus`) — client-defined:**

| Value | Meaning | Consumer behaviour |
| --- | --- | --- |
| `O` | Open | **The only status offered to customers** |
| `C` | Closed | Excluded in SQL |
| `I` | Inactive | Excluded in SQL |

The filter is a **SQL predicate**, not a mapping step — a non-Open session never
leaves the database. `SESSION_STATUS_OPEN = 'O'` in `consumer.service.js`.
It cannot be bypassed by a client and cannot be lost to a later refactor of
the response shape.

Consumer session picker (`getSessions`): offers screenings starting within
**3 hours either side of now** (`SESSION_WINDOW_HOURS = 3`) — a flat window
around the current moment, deliberately **not** tied to a calendar or
programming day, so a 23:45 screening is still offered at 01:30 the next
morning. The **lookback half is intentional**: a screening already under way
is offered, because someone twenty minutes into a film is the customer most
likely to want food. (This reverses the earlier rule, which started the
window at `now` and ran to the next 06:00.) Capped at **2 per screen**
(`SESSIONS_PER_SCREEN = 2`) so one busy auditorium can't crowd out the rest;
with the lookback, one of a screen's two slots may be a show already running.
Returns `screenName` as text **and** a resolved `screenId` (see grain conflict
below). Film join is `required: true`.

`startsAt`/`endsAt` carry **no model getters** — and must not gain any. These
`datetime` columns hold cinema-local (IST) wall clock with no offset, and the
connection now sets `useUTC: false` (see the timezone section in CLAUDE.md), so
tedious already parses them as process-local, with the process pinned to IST by
`APP_TIMEZONE`. An earlier fix corrected the value in an `asLocalWallClock`
getter because the connection then parsed it as UTC; once that moved to the
driver, the getter became a **second** conversion and was removed. Same rule for
any other offset-less client `datetime` column: the driver handles it, the model
does not.

Film/Session API routes are **read-only** (`GET` only, `Settings:read`) —
there is no create/update/delete, this data is the client's.
`Film_strNowShowingFlag` and `Film_strStatus` are passed through **raw** —
their vocabulary is undefined by the client, so no meaning is invented.

## `screens` grain conflict — UNRESOLVED

QBusto's design: **one `screens` row = one auditorium**. `orders.screen_id`
is a FK to it, and screen names are unique within a cinema (enforced in
`screen.service.assertNameAvailable`, not by the database).

The client's data: **one row per seat row** — ~82 rows across ~27 distinct
(cinema, screen name) pairs, with:
- `screens.category` `nvarchar(50)` NULL — a **seat class** ("Platinum",
  "Recliner"), free text, not a screen class. The same auditorium carries more
  than one.
- `screens.seat_row` `nvarchar(2)` NULL — a **seat-row label** ("A".."N"), not
  a count. Two characters, so "AA" is possible. Matches the row half of
  `orders.seat_number` (e.g. "A5") and the consumer's `ROW_PATTERN`
  `/^[A-Za-z]{1,2}$/`.

Worked example: cinema 8 "Screen 1" occupies 10 rows — Platinum for rows A–I,
Recliner for row J.

This is a **semantic conflict, not an additive change**. Under the client's
grain there are ten "Screen 1" rows and it is undefined which one an order
should reference; `ScreenSelect` shows ten identical options; the
name-uniqueness rule breaks. **Blocked pending client clarification. Do not
build on it.** The two columns are declared on `models/screen.js` (both
nullable — rows predating them carry NULL; the 21 originally seeded screens
are the NULL ones).

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

## Open questions (unverified, from memory.md §21)

- Why do `category`/`seat_row` sit on `screens` when `screen_layout` already
  has both plus `seat_no`? Staging area, or is `screen_layout` the
  destination?
- Will `screen_layout` be populated, and by what?
- Is `category` a controlled vocabulary or free text? Currently modelled as
  free text.
- Can `seat_row` exceed one character? The column allows two.
- Are the Vista `film`/`session` tables permanent residents of the QBusto
  database, or a staging copy for a future POS sync?
