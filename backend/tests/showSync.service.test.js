'use strict';

/**
 * POS show sync, provider-neutral, writing into `session`.
 *
 * Drives showSync.service exclusively through a TEST DOUBLE adapter
 * registered under the 'qbusto' provider value (a real, schema-accepted
 * provider, so registerAdapter does not need a schema change for this
 * double). No ShowBiz-specific data anywhere in this file - see
 * src/pos/adapter.js's own header on why adapters are test-doubled rather
 * than faked with real-looking provider payloads.
 *
 * WHAT CHANGED WHEN `shows` WAS REMOVED
 *
 * The destination is `session`, the platform's single show table. Two of its
 * columns cannot be filled from a provider response that carries only a start
 * time and a string id, and the tests below pin the SKIP behaviour for both -
 * a row that cannot be represented is logged and passed over, never stored
 * with an invented end time or a hashed key. See the service's header.
 *
 * The database layer is mocked, matching the project's convention (see
 * tests/cinema.routes.test.js) - `npm test` opens no real connection.
 */

jest.mock('../src/config/database', () => {
  const models = {
    PosIntegration: { findAll: jest.fn() },
    Session: { findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
    ScreenPosMapping: { findOne: jest.fn() },
    Cinema: {},
  };

  return {
    models,
    sequelize: { transaction: jest.fn((cb) => cb('TX')), query: jest.fn() },
  };
});

const { models, sequelize } = require('../src/config/database');
const { registerAdapter, unregisterAdapter } = require('../src/pos/providerRegistry');
const { POS_PROVIDERS } = require('../src/constants');
const { PosProviderUnavailableError } = require('../src/pos/posErrors');

// Required once, at the same module-cache level as the `models` and
// `providerRegistry` requires above - a per-test jest.resetModules() would
// give showSync.service a *different* instance of ../config/database and
// ../pos/providerRegistry than the ones this file registers stubs against
// and asserts on, so registration and mock calls would silently miss each
// other (the same class of bug already hit and fixed in
// pos.showbizAdapter.test.js's timeout case).
const showSync = require('../src/services/showSync.service');

const PROVIDER = POS_PROVIDERS.QBUSTO;

/**
 * The values bound by the Nth session write.
 *
 * Sessions are written with RAW SQL, not through the model: the client's
 * `datetime` columns reject the offset-bearing literal Sequelize binds a JS
 * Date as, which fails the statement outright (verified against the live
 * table). So these tests assert on the bound parameters and on whether the
 * statement was an INSERT or an UPDATE, which is what actually reaches SQL
 * Server.
 */
function writeCall(index = 0) {
  const call = sequelize.query.mock.calls[index];
  if (!call) return null;

  return {
    sql: call[0],
    isInsert: /INSERT INTO/i.test(call[0]),
    isUpdate: /^\s*UPDATE/i.test(call[0]),
    values: call[1].replacements,
  };
}

/** Every datetime literal embedded in a write, in order. */
function datetimeLiterals(index = 0) {
  const call = sequelize.query.mock.calls[index];
  return call ? (call[0].match(/'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}'/g) ?? []) : [];
}

/**
 * A well-formed ExternalShow, in the shape normalizeExternalShow produces.
 *
 * Numeric `externalSessionId` and a present `showTimeEndLocal`, because those
 * are exactly the two conditions a row must meet to become a session row. The
 * tests that exercise the failure of each override one of them.
 */
const externalShow = (overrides = {}) => ({
  externalSessionId: '4242',
  externalScreenId: '3',
  externalFilmId: 'FILM-1',
  filmTitle: 'A Stub Film',
  showTimeLocal: '2026-09-03T18:30:00',
  showTimeEndLocal: '2026-09-03T21:00:00',
  cancelled: false,
  ...overrides,
});

const integration = (overrides = {}) => ({
  id: 7,
  cinemaId: 55,
  provider: PROVIDER,
  apiUrl: 'http://stub.example/api',
  config: null,
  cinema: { code: 'NOIDA', timezone: 'Asia/Kolkata' },
  ...overrides,
});

describe('showSync.service', () => {
  let stubFetchShows;

  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockImplementation((cb) => cb('TX'));
    sequelize.query.mockResolvedValue([[], {}]);
    // Reconciliation runs on any sync that represented every row it was given.
    models.Session.update.mockResolvedValue([0]);

    stubFetchShows = jest.fn();
    registerAdapter(PROVIDER, { provider: PROVIDER, fetchShows: stubFetchShows });
  });

  afterEach(() => {
    unregisterAdapter(PROVIDER);
  });

  describe('syncIntegration', () => {
    test('inserts a new session on the natural key when none exists', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce({ screen: { name: 'Screen 3' } });

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: false, inserted: 1, updated: 0 }));

      const write = writeCall();
      expect(write.isInsert).toBe(true);
      expect(write.values.cinemaCode).toBe('NOIDA');
      // The provider's string id becomes the integer half of the primary key.
      expect(write.values.sessionId).toBe(4242);
      expect(write.values.filmTitle).toBe('A Stub Film');
      expect(write.values.filmCode).toBe('FILM-1');
      expect(write.values.screenName).toBe('Screen 3');
      expect(write.values.screenNumber).toBe(3);
      expect(write.values.status).toBe('O');

      // Never through the model - binding a JS Date into these columns fails
      // the statement outright against SQL Server.
      expect(models.Session.create).not.toHaveBeenCalled();
    });

    test('binds the three datetimes as offset-less literals, never as JS Dates', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      await showSync.syncIntegration(integration());

      const write = writeCall();

      // start, end and stamp - all three inline, none bound.
      expect(datetimeLiterals()).toHaveLength(3);
      expect(Object.values(write.values).every((value) => !(value instanceof Date))).toBe(true);
      // No offset anywhere: `datetime` rejects one outright.
      expect(write.sql).not.toMatch(/[+-]\d{2}:\d{2}'/);
    });

    test('updates an existing session on the same natural key instead of duplicating it', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ filmTitle: 'Updated Title' })]);
      const existing = { update: jest.fn().mockResolvedValueOnce() };
      models.Session.findOne.mockResolvedValueOnce(existing);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ inserted: 0, updated: 1 }));
      expect(sequelize.query).toHaveBeenCalledTimes(1);

      const write = writeCall();
      expect(write.isUpdate).toBe(true);
      expect(write.isInsert).toBe(false);
      expect(write.values.filmTitle).toBe('Updated Title');
      // Addressed by the natural key, so an update cannot become a duplicate.
      expect(write.values.cinemaCode).toBe('NOIDA');
      expect(write.values.sessionId).toBe(4242);
      expect(existing.update).not.toHaveBeenCalled();
    });

    test('an unmapped external screen resolves to a null screenName, never drops the show', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ externalScreenId: '99' })]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      await showSync.syncIntegration(integration());

      expect(writeCall().values).toEqual(
        expect.objectContaining({ screenName: null, screenNumber: 99 })
      );
    });

    test('a show with no external screen stores NULL, not auditorium zero', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ externalScreenId: null })]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      await showSync.syncIntegration(integration());

      // Number(null) is 0 and passes isSafeInteger. Absent must stay absent.
      expect(writeCall().values.screenNumber).toBeNull();
    });

    test('a cancelled show becomes a CLOSED session rather than disappearing', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ cancelled: true })]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      await showSync.syncIntegration(integration());

      expect(writeCall().values.status).toBe('C');
    });

    test('converts cinema-local wall clock to an instant using the cinema timezone', async () => {
      stubFetchShows.mockResolvedValueOnce([
        externalShow({ showTimeLocal: '2026-09-03T18:30:00', showTimeEndLocal: '2026-09-03T21:00:00' }),
      ]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);

      await showSync.syncIntegration(
        integration({ cinema: { code: 'NOIDA', timezone: 'Asia/Kolkata' } })
      );

      /*
       * The literals are rendered in PROCESS-LOCAL time, which APP_TIMEZONE
       * pins to IST - the same convention `utils/sqlDate.js` uses for reads.
       * 18:30 and 21:00 local go in as exactly that, which is what the
       * client's offset-less `datetime` column means.
       */
      expect(datetimeLiterals().slice(0, 2)).toEqual([
        "'2026-09-03 18:30:00.000'",
        "'2026-09-03 21:00:00.000'",
      ]);
    });

    /*
     * The two pending fields. Neither can be filled from a verified provider
     * response, and neither is invented - see the service header.
     */
    test('a show with no end time is skipped, not stored with an invented one', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ showTimeEndLocal: null })]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: false, skipped: 1, inserted: 0 }));
      expect(sequelize.query).not.toHaveBeenCalled();
    });

    test('a non-numeric provider session id is skipped, not hashed into the primary key', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ externalSessionId: 'SESSION-1' })]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: false, skipped: 1, inserted: 0 }));
      expect(sequelize.query).not.toHaveBeenCalled();
    });

    test('a sync that represented every row closes the ones it did not see', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);
      models.Session.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);
      models.Session.update.mockResolvedValue([3]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(
        expect.objectContaining({ failed: false, closed: 3, reconciled: true })
      );
      expect(models.Session.update).toHaveBeenCalledWith(
        { status: 'C' },
        expect.objectContaining({
          where: expect.objectContaining({ cinemaCode: 'NOIDA', status: 'O' }),
        })
      );
    });

    /*
     * THE MOST IMPORTANT TESTS IN THIS FILE.
     *
     * Reconciliation closes "everything the POS did not report". That is only
     * safe on a complete view. `session` now also holds rows the client loaded
     * directly, so reconciling on an incomplete view would close a cinema's
     * whole open schedule and empty the consumer's picker - on a sync that
     * reported success.
     */
    test('a sync that skipped a row closes NOTHING', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ showTimeEndLocal: null })]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(
        expect.objectContaining({ failed: false, skipped: 1, closed: 0, reconciled: false })
      );
      expect(models.Session.update).not.toHaveBeenCalled();
    });

    test('a sync that skipped SOME rows still closes nothing', async () => {
      stubFetchShows.mockResolvedValueOnce([
        externalShow(),
        externalShow({ externalSessionId: '4243', showTimeEndLocal: null }),
      ]);
      models.Session.findOne.mockResolvedValue(null);
      models.ScreenPosMapping.findOne.mockResolvedValue(null);

      const result = await showSync.syncIntegration(integration());

      // The representable row is still written. Only the closure is withheld.
      expect(result).toEqual(
        expect.objectContaining({ inserted: 1, skipped: 1, closed: 0, reconciled: false })
      );
      expect(models.Session.update).not.toHaveBeenCalled();
    });

    test('an empty provider response closes NOTHING', async () => {
      stubFetchShows.mockResolvedValueOnce([]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(
        expect.objectContaining({ failed: false, closed: 0, reconciled: false })
      );
      expect(models.Session.update).not.toHaveBeenCalled();
    });

    test('a provider outage leaves existing sessions untouched: no upsert, no closure', async () => {
      stubFetchShows.mockRejectedValueOnce(
        new PosProviderUnavailableError('stub outage', { provider: PROVIDER })
      );

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: true }));
      expect(models.Session.create).not.toHaveBeenCalled();
      expect(models.Session.update).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    test('an unsupported provider is skipped without touching the database', async () => {
      unregisterAdapter(PROVIDER);

      const result = await showSync.syncIntegration(integration());

      expect(result.failed).toBe(true);
      expect(result.posCode).toBeDefined();
      expect(sequelize.query).not.toHaveBeenCalled();

      // Re-register so afterEach's unregister does not throw on a missing key.
      registerAdapter(PROVIDER, { provider: PROVIDER, fetchShows: stubFetchShows });
    });

    test('an integration whose cinema has no code cannot write sessions, and says so', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);

      const result = await showSync.syncIntegration(integration({ cinema: { timezone: 'UTC' } }));

      expect(result).toEqual(expect.objectContaining({ failed: true }));
      expect(sequelize.query).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    test('duplicate prevention: the same natural key within one sync updates rather than creating twice', async () => {
      stubFetchShows.mockResolvedValueOnce([
        externalShow(),
        externalShow({ filmTitle: 'Same show again' }),
      ]);
      models.Session.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ update: jest.fn().mockResolvedValueOnce() });
      models.ScreenPosMapping.findOne.mockResolvedValue({ screen: { name: 'Screen 3' } });

      const result = await showSync.syncIntegration(integration());

      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(1);
    });
  });

  describe('syncAllIntegrations', () => {
    test('isolates one integration failing from the others', async () => {
      models.PosIntegration.findAll.mockResolvedValueOnce([
        integration({ id: 1 }),
        integration({ id: 2 }),
      ]);

      stubFetchShows.mockRejectedValueOnce(new Error('unexpected boom')).mockResolvedValueOnce([]);
      models.Session.update.mockResolvedValue([0]);

      const results = await showSync.syncAllIntegrations();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(expect.objectContaining({ integrationId: 1, failed: true }));
      expect(results[1]).toEqual(expect.objectContaining({ integrationId: 2, failed: false }));
    });

    test('only queries active integrations', async () => {
      models.PosIntegration.findAll.mockResolvedValueOnce([]);

      await showSync.syncAllIntegrations();

      expect(models.PosIntegration.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } })
      );
    });
  });
});
