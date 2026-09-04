'use strict';

/**
 * Phase B5 - POS show sync, provider-neutral.
 *
 * Drives showSync.service exclusively through a TEST DOUBLE adapter
 * registered under the 'qbusto' provider value (a real, schema-accepted
 * provider, so registerAdapter does not need a schema change for this
 * double). No ShowBiz-specific data anywhere in this file - see
 * src/pos/adapter.js's own header on why adapters are test-doubled rather
 * than faked with real-looking provider payloads.
 *
 * The database layer is mocked, matching the project's convention (see
 * tests/cinema.routes.test.js) - `npm test` opens no real connection.
 */

jest.mock('../src/config/database', () => {
  const models = {
    PosIntegration: { findAll: jest.fn() },
    Show: { findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
    ScreenPosMapping: { findOne: jest.fn() },
    Cinema: {},
  };

  return {
    models,
    sequelize: { transaction: jest.fn((cb) => cb('TX')) },
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

/** A well-formed ExternalShow, in the shape normalizeExternalShow produces. */
const externalShow = (overrides = {}) => ({
  externalSessionId: 'SESSION-1',
  externalScreenId: 'SCR-A',
  externalFilmId: 'FILM-1',
  filmTitle: 'A Stub Film',
  showTimeLocal: '2026-09-03T18:30:00',
  cancelled: false,
  ...overrides,
});

const integration = (overrides = {}) => ({
  id: 7,
  cinemaId: 55,
  provider: PROVIDER,
  apiUrl: 'http://stub.example/api',
  config: null,
  cinema: { timezone: 'Asia/Kolkata' },
  ...overrides,
});

describe('showSync.service', () => {
  let stubFetchShows;

  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockImplementation((cb) => cb('TX'));

    stubFetchShows = jest.fn();
    registerAdapter(PROVIDER, { provider: PROVIDER, fetchShows: stubFetchShows });
  });

  afterEach(() => {
    unregisterAdapter(PROVIDER);
  });

  describe('syncIntegration', () => {
    test('inserts a new show on the natural key when none exists', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);
      models.Show.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce({ screenId: 12 });
      models.Show.update.mockResolvedValueOnce([0]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: false, inserted: 1, updated: 0 }));
      expect(models.Show.create).toHaveBeenCalledTimes(1);
      const createArgs = models.Show.create.mock.calls[0][0];
      expect(createArgs.externalSessionId).toBe('SESSION-1');
      expect(createArgs.screenId).toBe(12);
      expect(createArgs.status).toBe('scheduled');
      expect(createArgs.showTime).toBeInstanceOf(Date);
    });

    test('updates an existing show on the same natural key instead of duplicating it', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ filmTitle: 'Updated Title' })]);
      const existing = { update: jest.fn().mockResolvedValueOnce() };
      models.Show.findOne.mockResolvedValueOnce(existing);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);
      models.Show.update.mockResolvedValueOnce([0]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ inserted: 0, updated: 1 }));
      expect(models.Show.create).not.toHaveBeenCalled();
      expect(existing.update).toHaveBeenCalledWith(
        expect.objectContaining({ filmTitle: 'Updated Title' }),
        expect.anything()
      );
    });

    test('an unmapped external screen resolves to a null screenId, never drops the show', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ externalScreenId: 'UNKNOWN-SCREEN' })]);
      models.Show.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);
      models.Show.update.mockResolvedValueOnce([0]);

      await showSync.syncIntegration(integration());

      expect(models.Show.create).toHaveBeenCalledWith(
        expect.objectContaining({ screenId: null }),
        expect.anything()
      );
    });

    test('converts cinema-local wall clock to an instant using the cinema timezone', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow({ showTimeLocal: '2026-09-03T18:30:00' })]);
      models.Show.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);
      models.Show.update.mockResolvedValueOnce([0]);

      await showSync.syncIntegration(integration({ cinema: { timezone: 'Asia/Kolkata' } }));

      const createArgs = models.Show.create.mock.calls[0][0];
      // 18:30 IST (+05:30) is 13:00 UTC.
      expect(createArgs.showTime.toISOString()).toBe('2026-09-03T13:00:00.000Z');
    });

    test('a successful sync (including empty) cancels shows this sync did not see', async () => {
      stubFetchShows.mockResolvedValueOnce([]);
      models.Show.update.mockResolvedValueOnce([3]);

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: false, cancelled: 3 }));
      expect(models.Show.update).toHaveBeenCalledWith(
        { status: 'cancelled' },
        expect.objectContaining({
          where: expect.objectContaining({ posIntegrationId: 7, status: 'scheduled' }),
        })
      );
    });

    test('a provider outage leaves existing shows untouched: no upsert, no cancellation', async () => {
      stubFetchShows.mockRejectedValueOnce(
        new PosProviderUnavailableError('stub outage', { provider: PROVIDER })
      );

      const result = await showSync.syncIntegration(integration());

      expect(result).toEqual(expect.objectContaining({ failed: true }));
      expect(models.Show.create).not.toHaveBeenCalled();
      expect(models.Show.update).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    test('an unsupported provider is skipped without touching the database', async () => {
      unregisterAdapter(PROVIDER);

      const result = await showSync.syncIntegration(integration());

      expect(result.failed).toBe(true);
      expect(result.posCode).toBeDefined();
      expect(models.Show.create).not.toHaveBeenCalled();

      // Re-register so afterEach's unregister does not throw on a missing key.
      registerAdapter(PROVIDER, { provider: PROVIDER, fetchShows: stubFetchShows });
    });

    test('duplicate prevention: the same natural key within one sync updates rather than creating twice', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow(), externalShow({ filmTitle: 'Same show again' })]);
      models.Show.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ update: jest.fn().mockResolvedValueOnce() });
      models.ScreenPosMapping.findOne.mockResolvedValue({ screenId: 12 });
      models.Show.update.mockResolvedValueOnce([0]);

      const result = await showSync.syncIntegration(integration());

      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(1);
    });

    test('sets last_synced_at on every upserted show', async () => {
      stubFetchShows.mockResolvedValueOnce([externalShow()]);
      models.Show.findOne.mockResolvedValueOnce(null);
      models.ScreenPosMapping.findOne.mockResolvedValueOnce(null);
      models.Show.update.mockResolvedValueOnce([0]);

      await showSync.syncIntegration(integration(), { now: new Date('2026-09-03T10:00:00.000Z') });

      expect(models.Show.create).toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncedAt: new Date('2026-09-03T10:00:00.000Z') }),
        expect.anything()
      );
    });
  });

  describe('syncAllIntegrations', () => {
    test('isolates one integration failing from the others', async () => {
      models.PosIntegration.findAll.mockResolvedValueOnce([
        integration({ id: 1 }),
        integration({ id: 2 }),
      ]);

      stubFetchShows
        .mockRejectedValueOnce(new Error('unexpected boom'))
        .mockResolvedValueOnce([]);
      models.Show.update.mockResolvedValue([0]);

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
