'use strict';

/**
 * Consumer session selection.
 *
 * A customer may only order food against a screening that is actually
 * selling. The client defines `session.Session_strStatus` as:
 *
 *   O = Open      - selling
 *   C = Closed    - no longer selling
 *   I = Inactive  - not in service
 *
 * Before this filter existed the picker offered all three, so a customer could
 * pay for food against a screening that was closed or out of service.
 *
 * The model layer is mocked, but `Session.findAll` here is not a stub that
 * returns a fixed list - it applies the `where` clause it was given to a
 * fixture set, the way the database would. That matters: a mock that ignored
 * `where` would return whatever the test handed it and the "closed is not
 * offered" assertions would pass even if the service had no filter at all.
 * Asserting the emitted predicate as well pins the filtering to SQL rather
 * than to a post-query `.filter()` a refactor could quietly drop.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    Cinema: { findByPk: jest.fn(), findOne: jest.fn() },
    Session: { findAll: jest.fn() },
    Screen: { findAll: jest.fn() },
    Film: {},
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models } = require('../src/config/database');
const createApp = require('../src/app');

const app = createApp();

const CINEMA_ID = 8;
const CINEMA_CODE = 'NOIDA';

/**
 * A Sunday, 10:00 local. Fixed so the window does not depend on when the suite
 * runs: the picker offers screenings starting within three hours either side
 * of now, so at 10:00 that is 07:00 to 13:00.
 */
const NOW = new Date(2026, 7, 23, 10, 0, 0);

/**
 * The cinema's screens, as `Screen.findAll` returns them. The schedule names
 * its auditorium rather than referencing an id, so the service resolves
 * `screenName` against these to put a real `screens.id` on each session.
 */
const SCREENS = [
  { id: 22, name: 'SCREEN 1' },
  { id: 23, name: 'SCREEN 2' },
];

/** A session row as `Session.findAll` returns it, with its film loaded. */
function buildSession(overrides = {}) {
  const { film = {}, ...rest } = overrides;

  return {
    sessionId: 1001,
    cinemaCode: CINEMA_CODE,
    filmCode: 'HO00012070',
    screenName: 'SCREEN 1',
    status: 'O',
    startsAt: new Date(2026, 7, 23, 20, 0, 0),
    endsAt: new Date(2026, 7, 23, 22, 30, 0),
    seatsAvailable: 120,
    film: {
      code: 'HO00012070',
      title: 'Interstellar',
      certification: 'UA',
      durationMinutes: 169,
      ...film,
    },
    ...rest,
  };
}

/**
 * Serve `rows` through a `findAll` that honours the `where` it is handed, so
 * the status predicate the service emits is what decides the result.
 */
function serveSessions(rows, screens = SCREENS) {
  models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, code: CINEMA_CODE, isActive: true });
  models.Screen.findAll.mockResolvedValue(screens);

  models.Session.findAll.mockImplementation(async ({ where }) => {
    return rows
      .filter((row) => (where.status === undefined ? true : row.status === where.status))
      .filter((row) =>
        where.cinemaCode === undefined ? true : row.cinemaCode === where.cinemaCode
      )
      .sort((a, b) => a.startsAt - b.startsAt);
  });
}

/** The `where` object the service passed to the database on the last call. */
function emittedWhere() {
  return models.Session.findAll.mock.calls[0][0].where;
}

/**
 * The two `startsAt` bounds as the wall-clock text they are emitted as.
 *
 * They are Sequelize literals rather than bound Dates - `session` stores show
 * times as offset-less `datetime`, so the service formats local wall clock
 * itself (see utils/sqlDate) - which is exactly the form worth asserting.
 */
function emittedBounds() {
  const startsAt = emittedWhere().startsAt;
  const [gte, lt] = Object.getOwnPropertySymbols(startsAt).map(
    (symbol) => startsAt[symbol].val
  );

  return { from: gte.replace(/'/g, ''), to: lt.replace(/'/g, '') };
}

const listSessions = () => request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/sessions`);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// The status filter
// ---------------------------------------------------------------------------

describe('consumer session status filtering', () => {
  it('offers an Open session', async () => {
    serveSessions([buildSession({ sessionId: 1001, status: 'O' })]);

    const response = await listSessions();

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(1001);
  });

  it('does not offer a Closed session', async () => {
    serveSessions([buildSession({ sessionId: 2002, status: 'C' })]);

    const response = await listSessions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('does not offer an Inactive session', async () => {
    serveSessions([buildSession({ sessionId: 3003, status: 'I' })]);

    const response = await listSessions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('offers only the Open sessions from a mixed schedule', async () => {
    serveSessions([
      buildSession({ sessionId: 1001, status: 'O', screenName: 'SCREEN 1' }),
      buildSession({ sessionId: 2002, status: 'C', screenName: 'SCREEN 2' }),
      buildSession({ sessionId: 3003, status: 'I', screenName: 'SCREEN 3' }),
      buildSession({ sessionId: 1002, status: 'O', screenName: 'SCREEN 4' }),
    ]);

    const response = await listSessions();

    expect(response.body.data.map((session) => session.id).sort()).toEqual([1001, 1002]);
  });

  it('excludes non-Open sessions in SQL rather than after the query', async () => {
    serveSessions([buildSession()]);

    await listSessions();

    // The predicate itself, so the exclusion cannot be undone by a client and
    // cannot be lost if the response mapping is rewritten.
    expect(emittedWhere().status).toBe('O');
  });
});

// ---------------------------------------------------------------------------
// The filtering that was already there, still intact
// ---------------------------------------------------------------------------

describe('consumer session cinema and time-window filtering', () => {
  it('scopes the query to the requested cinema by its code', async () => {
    serveSessions([buildSession()]);

    await listSessions();

    expect(emittedWhere().cinemaCode).toBe(CINEMA_CODE);
  });

  it('bounds the query to three hours either side of now', async () => {
    serveSessions([buildSession()]);

    await listSessions();

    // The emitted bounds themselves, not just their presence: the lookback
    // half is the whole point of the window and an off-by-one there would
    // silently hide the screening the customer is sitting in.
    expect(emittedBounds()).toEqual({
      from: '2026-08-23 07:00:00.000',
      to: '2026-08-23 13:00:00.000',
    });
  });

  /**
   * The case the flat window exists for: at 01:30 the previous evening's
   * 23:45 screening is still within three hours, and a day-boundary window
   * would have dropped it.
   */
  it('reaches back into the previous day when asked after midnight', async () => {
    jest.setSystemTime(new Date(2026, 7, 24, 1, 30, 0));

    serveSessions([buildSession()]);

    await listSessions();

    expect(emittedBounds()).toEqual({
      from: '2026-08-23 22:30:00.000',
      to: '2026-08-24 04:30:00.000',
    });
  });

  it('404s for a cinema that does not exist', async () => {
    models.Cinema.findByPk.mockResolvedValue(null);

    const response = await listSessions();

    expect(response.status).toBe(404);
    expect(models.Session.findAll).not.toHaveBeenCalled();
  });

  it('still caps the listing at two screenings per screen', async () => {
    serveSessions([
      buildSession({
        sessionId: 1,
        screenName: 'SCREEN 1',
        startsAt: new Date(2026, 7, 23, 12, 0),
      }),
      buildSession({
        sessionId: 2,
        screenName: 'SCREEN 1',
        startsAt: new Date(2026, 7, 23, 15, 0),
      }),
      buildSession({
        sessionId: 3,
        screenName: 'SCREEN 1',
        startsAt: new Date(2026, 7, 23, 18, 0),
      }),
      buildSession({
        sessionId: 4,
        screenName: 'SCREEN 2',
        startsAt: new Date(2026, 7, 23, 13, 0),
      }),
    ]);

    const response = await listSessions();

    // The third screening on SCREEN 1 is dropped; SCREEN 2 keeps its own slot.
    expect(response.body.data.map((session) => session.id)).toEqual([1, 4, 2]);
  });
});

// ---------------------------------------------------------------------------
// Which two screenings survive the per-screen cap
// ---------------------------------------------------------------------------

describe('per-screen cap picks the screenings nearest to now', () => {
  it('keeps the upcoming show over an older one that already started', async () => {
    // NOW is 10:00. The window reaches back to 07:00, so all three are in it.
    // Taking the first two of a start-ascending list would keep 07:30 and
    // 08:15 - both long since started - and drop the 11:00 the customer is
    // actually about to sit in.
    serveSessions([
      buildSession({ sessionId: 1, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 7, 30) }),
      buildSession({ sessionId: 2, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 8, 15) }),
      buildSession({ sessionId: 3, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 11, 0) }),
    ]);

    const response = await listSessions();

    const ids = response.body.data.map((session) => session.id);
    expect(ids).toContain(3);
    expect(ids).toHaveLength(2);
  });

  it('still returns them in start order, not proximity order', async () => {
    // Selection is by proximity; presentation stays chronological, because the
    // picker reads as a schedule.
    serveSessions([
      buildSession({ sessionId: 1, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 9, 45) }),
      buildSession({ sessionId: 2, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 10, 30) }),
    ]);

    const response = await listSessions();

    expect(response.body.data.map((session) => session.id)).toEqual([1, 2]);
  });

  it('caps each screen independently', async () => {
    serveSessions([
      buildSession({ sessionId: 1, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 9, 0) }),
      buildSession({ sessionId: 2, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 9, 30) }),
      buildSession({ sessionId: 3, screenName: 'SCREEN 1', startsAt: new Date(2026, 7, 23, 10, 15) }),
      buildSession({ sessionId: 4, screenName: 'SCREEN 2', startsAt: new Date(2026, 7, 23, 9, 15) }),
    ]);

    const response = await listSessions();

    const byScreen = response.body.data.reduce((acc, session) => {
      acc[session.screenName] = (acc[session.screenName] || 0) + 1;
      return acc;
    }, {});

    expect(byScreen['SCREEN 1']).toBe(2);
    expect(byScreen['SCREEN 2']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Resolving a schedule's screen name to a QBusto screen id
// ---------------------------------------------------------------------------

/**
 * The `screens` table holds two shapes. Rows created through screen.service
 * are one per auditorium, with a name unique per cinema (enforced by
 * assertNameAvailable) and category/seat_row NULL. Rows bulk-loaded from the
 * client are ONE PER SEAT ROW, so a single auditorium name covers many rows -
 * on the live database cinema 8's "Screen 1" is ten of them.
 *
 * These fixtures carry no `seatRow`, so they exercise the auditorium-grain
 * path only: `getSessions` still resolves `screenId` directly by name when it
 * is unique, and returns null (with `seatRows` empty) when it is ambiguous or
 * absent - the row-bearing shape's own resolution
 * (`resolveScreenId`/`summariseScreensByName` picking a `screens.id` once a
 * seat row is known) is covered in consumer.catalog.test.js instead, where the
 * seat row is available.
 */
describe('screen id resolution from the schedule name', () => {
  it('resolves a name that identifies exactly one active screen', async () => {
    serveSessions([buildSession({ sessionId: 1, screenName: 'SCREEN 1' })], [
      { id: 22, name: 'SCREEN 1' },
      { id: 23, name: 'SCREEN 2' },
    ]);

    const response = await listSessions();

    expect(response.body.data[0].screenId).toBe(22);
    expect(response.body.data[0].screenName).toBe('SCREEN 1');
  });

  it('returns null rather than an arbitrary row when the name is ambiguous', async () => {
    // The client's seat-row shape: ten rows, all called "SCREEN 1". Picking
    // the lowest id would store "Screen 1, Platinum, row A" as the show's
    // screen.
    const seatRows = Array.from({ length: 10 }, (_, i) => ({
      id: 22 + i,
      name: 'SCREEN 1',
    }));

    serveSessions([buildSession({ sessionId: 1, screenName: 'SCREEN 1' })], seatRows);

    const response = await listSessions();

    expect(response.body.data[0].screenId).toBeNull();
    // The external identifier is what the caller uses instead.
    expect(response.body.data[0].screenName).toBe('SCREEN 1');
  });

  it('returns null when no screen carries the name at all', async () => {
    serveSessions([buildSession({ sessionId: 1, screenName: 'IMAX' })], [
      { id: 22, name: 'SCREEN 1' },
    ]);

    const response = await listSessions();

    expect(response.body.data[0].screenId).toBeNull();
    expect(response.body.data[0].screenName).toBe('IMAX');
  });

  it('an ambiguous name does not poison an unambiguous one at the same cinema', async () => {
    serveSessions(
      [
        buildSession({ sessionId: 1, screenName: 'SCREEN 1' }),
        buildSession({ sessionId: 2, screenName: 'SCREEN 2' }),
      ],
      [
        { id: 22, name: 'SCREEN 1' },
        { id: 23, name: 'SCREEN 1' },
        { id: 30, name: 'SCREEN 2' },
      ]
    );

    const response = await listSessions();

    const byId = Object.fromEntries(
      response.body.data.map((session) => [session.id, session.screenId])
    );

    expect(byId[1]).toBeNull();
    expect(byId[2]).toBe(30);
  });

  it('lists the distinct seat rows available under a duplicated name, sorted', async () => {
    serveSessions([buildSession({ sessionId: 1, screenName: 'SCREEN 1' })], [
      { id: 22, name: 'SCREEN 1', seatRow: 'C' },
      { id: 23, name: 'SCREEN 1', seatRow: 'A' },
      { id: 24, name: 'SCREEN 1', seatRow: 'B' },
      { id: 25, name: 'SCREEN 2', seatRow: 'A' },
    ]);

    const response = await listSessions();

    expect(response.body.data[0].screenId).toBeNull();
    expect(response.body.data[0].seatRows).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty seatRows list for the auditorium-grain shape', async () => {
    serveSessions([buildSession({ sessionId: 1, screenName: 'SCREEN 1' })], [
      { id: 22, name: 'SCREEN 1' },
      { id: 23, name: 'SCREEN 2' },
    ]);

    const response = await listSessions();

    expect(response.body.data[0].seatRows).toEqual([]);
  });
});
