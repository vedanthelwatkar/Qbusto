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
 * A Sunday, 10:00 local. Fixed so the 06:00-to-06:00 programming-day window
 * and the "already started" cutoff do not depend on when the suite runs: at
 * 10:00 the window runs to 06:00 tomorrow, so every fixture below at 12:00 or
 * later is inside it.
 */
const NOW = new Date(2026, 7, 23, 10, 0, 0);

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
function serveSessions(rows) {
  models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, code: CINEMA_CODE, isActive: true });

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

  it('bounds the query to the remaining programming day', async () => {
    serveSessions([buildSession()]);

    await listSessions();

    // Both bounds are present, so a screening already under way and one
    // beyond the 06:00 rollover are both excluded by the database.
    const startsAt = emittedWhere().startsAt;
    const bounds = Object.getOwnPropertySymbols(startsAt).map((symbol) => String(symbol));

    expect(bounds).toEqual(expect.arrayContaining(['Symbol(gte)', 'Symbol(lt)']));
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
