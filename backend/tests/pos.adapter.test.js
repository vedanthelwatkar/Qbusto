'use strict';

/**
 * Phase B2 - POS adapter architecture.
 *
 * These tests exercise the abstraction, not any provider. Every adapter below
 * is a TEST DOUBLE: a provider-neutral object written to satisfy the contract,
 * returning data invented for this file. None of them models Vista or Showbiz,
 * whose API contracts are unknown (decision register §12.3) and must not be
 * guessed at.
 *
 * The doubles are registered under real `pos_integrations.provider` values only
 * because `registerAdapter` refuses unknown ones. Each test unregisters what it
 * registered; nothing is registered at module load, and the registry ships
 * empty.
 */

const {
  POS_ERROR_CODES,
  PosAdapterError,
  PosProviderUnavailableError,
  PosConfigurationError,
  PosMalformedResponseError,
  PosProviderNotSupportedError,
} = require('../src/pos/posErrors');
const {
  normalizeExternalShow,
  normalizeExternalShows,
  normalizeShowTimeLocal,
} = require('../src/pos/externalShow');
const { assertPosAdapter, assertShowWindow } = require('../src/pos/adapter');
const {
  registerAdapter,
  getAdapter,
  hasAdapter,
  registeredProviders,
  unregisterAdapter,
  isKnownProvider,
} = require('../src/pos/providerRegistry');
const { POS_PROVIDERS } = require('../src/constants');
const { AppError } = require('../src/utils/errors');

/** A well-formed raw show, in the shape an adapter hands to the normalizer. */
const rawShow = (overrides = {}) => ({
  externalSessionId: 'SESSION-1',
  externalScreenId: 'SCREEN-A',
  externalFilmId: 'FILM-9',
  filmTitle: 'A Test Double Film',
  showTimeLocal: '2026-08-13T18:30:00',
  cancelled: false,
  ...overrides,
});

/**
 * TEST DOUBLE. Returns whatever it is told to, or throws whatever it is told
 * to. Provider-neutral by construction: it has no transport, no auth and no
 * response shape of its own.
 */
const makeStubAdapter = (provider, { shows = [], error = null } = {}) => ({
  provider,
  calls: [],
  async fetchShows(integration, range) {
    this.calls.push({ integration, range });
    if (error) throw error;
    return normalizeExternalShows(shows, {
      provider,
      integrationId: integration ? integration.id : null,
    });
  },
});

const integration = { id: 1, cinemaId: 7, provider: POS_PROVIDERS.IMPACT };
const window = {
  fromUtc: new Date('2026-08-13T09:00:00.000Z'),
  toUtc: new Date('2026-08-13T15:00:00.000Z'),
};

afterEach(() => {
  for (const provider of registeredProviders()) unregisterAdapter(provider);
});

describe('pos/providerRegistry', () => {
  it('ships with no adapters registered', () => {
    expect(registeredProviders()).toEqual([]);
    for (const provider of Object.values(POS_PROVIDERS)) {
      expect(hasAdapter(provider)).toBe(false);
    }
  });

  it('resolves a registered adapter', () => {
    const stub = makeStubAdapter(POS_PROVIDERS.IMPACT);
    registerAdapter(POS_PROVIDERS.IMPACT, stub);

    expect(getAdapter(POS_PROVIDERS.IMPACT)).toBe(stub);
    expect(hasAdapter(POS_PROVIDERS.IMPACT)).toBe(true);
    expect(registeredProviders()).toEqual([POS_PROVIDERS.IMPACT]);
  });

  it('fails clearly for a database-supported provider that has no adapter', () => {
    // vista and showbizz are accepted by the CHECK constraint. That must not
    // imply their APIs are implemented - B3/B4 are blocked.
    for (const provider of [POS_PROVIDERS.VISTA, POS_PROVIDERS.SHOWBIZZ]) {
      expect(() => getAdapter(provider)).toThrow(PosProviderNotSupportedError);

      try {
        getAdapter(provider);
      } catch (err) {
        expect(err.posCode).toBe(POS_ERROR_CODES.PROVIDER_NOT_SUPPORTED);
        expect(err.provider).toBe(provider);
        expect(err.message).toBe(`No POS adapter is registered for provider "${provider}"`);
      }
    }
  });

  it('fails clearly for a provider value the database would reject', () => {
    for (const provider of ['showbiz', 'VISTA', '', null, undefined]) {
      expect(() => getAdapter(provider)).toThrow(PosProviderNotSupportedError);
    }
    expect(() => getAdapter('showbiz')).toThrow('Unknown POS provider "showbiz"');
  });

  it('keeps internal project detail out of client-facing error messages', () => {
    // errorHandler returns AppError.message to the caller verbatim, so these
    // messages are on the wire. They must not carry roadmap or source layout
    // (error-handling rules).
    const messages = [POS_PROVIDERS.VISTA, POS_PROVIDERS.SHOWBIZZ, 'showbiz', null].map(
      (provider) => {
        try {
          getAdapter(provider);
          throw new Error('expected getAdapter to throw');
        } catch (err) {
          return err.message;
        }
      }
    );
    messages.push(
      (() => {
        try {
          registerAdapter('netflix', makeStubAdapter('netflix'));
          throw new Error('expected registerAdapter to throw');
        } catch (err) {
          return err.message;
        }
      })()
    );

    for (const message of messages) {
      expect(message).not.toMatch(/phases\.md|\bB[0-9]\b|phase|blocked|credential|documentation/i);
      expect(message).not.toMatch(/backend\/|src\/|\.js\b/);
      // No enumeration of the system's providers.
      expect(message).not.toMatch(/impact|qbusto/i);
    }
  });

  it('preserves the schema spelling "showbizz"', () => {
    expect(isKnownProvider('showbizz')).toBe(true);
    expect(isKnownProvider('showbiz')).toBe(false);
    expect(POS_PROVIDERS.SHOWBIZZ).toBe('showbizz');
  });

  it('refuses to register an unknown provider', () => {
    expect(() => registerAdapter('netflix', makeStubAdapter('netflix'))).toThrow(
      PosProviderNotSupportedError
    );
    expect(registeredProviders()).toEqual([]);
  });

  it('refuses to register an adapter that does not satisfy the contract', () => {
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, {})).toThrow(PosConfigurationError);
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, { fetchShows: 'nope' })).toThrow(
      /must implement fetchShows/
    );
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, null)).toThrow(PosConfigurationError);
    expect(registeredProviders()).toEqual([]);
  });

  it('refuses a duplicate registration rather than letting require order decide', () => {
    registerAdapter(POS_PROVIDERS.IMPACT, makeStubAdapter(POS_PROVIDERS.IMPACT));
    expect(() =>
      registerAdapter(POS_PROVIDERS.IMPACT, makeStubAdapter(POS_PROVIDERS.IMPACT))
    ).toThrow(PosConfigurationError);
  });

  it('refuses an adapter registered under a provider it does not declare', () => {
    // Without this check the wrong POS client would be wired to a cinema
    // silently, surfacing as wrong show data rather than as an error.
    const impactAdapter = makeStubAdapter(POS_PROVIDERS.IMPACT);

    expect(() => registerAdapter(POS_PROVIDERS.SHOWBIZZ, impactAdapter)).toThrow(
      PosConfigurationError
    );
    expect(() => registerAdapter(POS_PROVIDERS.SHOWBIZZ, impactAdapter)).toThrow(
      /declares a different provider: "impact"/
    );

    // An adapter with no provider at all is equally a mismatch.
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, { fetchShows: async () => [] })).toThrow(
      PosConfigurationError
    );

    // ...and the matching case still registers.
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, impactAdapter)).not.toThrow();
    expect(getAdapter(POS_PROVIDERS.IMPACT)).toBe(impactAdapter);
  });

  it('leaves the registry unchanged when a registration is rejected', () => {
    const rejected = [
      ['netflix', makeStubAdapter('netflix')], // unknown provider
      [POS_PROVIDERS.IMPACT, {}], // no fetchShows
      [POS_PROVIDERS.IMPACT, null], // not an object
      [POS_PROVIDERS.IMPACT, { fetchShows: 'nope' }], // fetchShows not callable
      [POS_PROVIDERS.SHOWBIZZ, makeStubAdapter(POS_PROVIDERS.IMPACT)], // provider mismatch
    ];

    for (const [provider, adapter] of rejected) {
      expect(() => registerAdapter(provider, adapter)).toThrow();
      expect(registeredProviders()).toEqual([]);
      expect(hasAdapter(provider)).toBe(false);
    }

    // A rejected registration must not have consumed the slot either.
    const good = makeStubAdapter(POS_PROVIDERS.IMPACT);
    expect(() => registerAdapter(POS_PROVIDERS.IMPACT, good)).not.toThrow();
    expect(registeredProviders()).toEqual([POS_PROVIDERS.IMPACT]);
  });
});

describe('pos adapter contract', () => {
  it('is consumable without branching on the provider', async () => {
    // One consumer, no knowledge of who is on the other side. This is the shape
    // the B5 sync service will use.
    const syncOneIntegration = async (posIntegration, range) => {
      const adapter = getAdapter(posIntegration.provider);
      return adapter.fetchShows(posIntegration, range);
    };

    registerAdapter(
      POS_PROVIDERS.IMPACT,
      makeStubAdapter(POS_PROVIDERS.IMPACT, {
        shows: [rawShow({ externalSessionId: 'IMPACT-1' })],
      })
    );
    registerAdapter(
      POS_PROVIDERS.QBUSTO,
      makeStubAdapter(POS_PROVIDERS.QBUSTO, {
        shows: [rawShow({ externalSessionId: 'QBUSTO-1' })],
      })
    );

    const first = await syncOneIntegration(
      { ...integration, provider: POS_PROVIDERS.IMPACT },
      window
    );
    const second = await syncOneIntegration(
      { ...integration, provider: POS_PROVIDERS.QBUSTO },
      window
    );

    expect(first[0].externalSessionId).toBe('IMPACT-1');
    expect(second[0].externalSessionId).toBe('QBUSTO-1');
    // Same call site, same result shape, no provider-specific handling.
    expect(Object.keys(first[0])).toEqual(Object.keys(second[0]));
  });

  it('accepts any object exposing fetchShows', () => {
    expect(() => assertPosAdapter({ fetchShows: () => [] })).not.toThrow();

    class ClassAdapter {
      async fetchShows() {
        return [];
      }
    }
    expect(() => assertPosAdapter(new ClassAdapter())).not.toThrow();
  });

  it('validates the show window identically for every provider', () => {
    expect(() => assertShowWindow(window)).not.toThrow();
    expect(() => assertShowWindow({ fromUtc: window.toUtc, toUtc: window.fromUtc })).toThrow(
      /must not be after/
    );
    expect(() => assertShowWindow({ fromUtc: '2026-08-13', toUtc: window.toUtc })).toThrow(
      PosConfigurationError
    );
    expect(() => assertShowWindow({ fromUtc: new Date('nope'), toUtc: window.toUtc })).toThrow(
      PosConfigurationError
    );
    expect(() => assertShowWindow(null)).toThrow(PosConfigurationError);
  });

  it('passes the integration and window through untouched', async () => {
    const stub = makeStubAdapter(POS_PROVIDERS.IMPACT);
    registerAdapter(POS_PROVIDERS.IMPACT, stub);

    await getAdapter(POS_PROVIDERS.IMPACT).fetchShows(integration, window);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].integration).toBe(integration);
    expect(stub.calls[0].range).toBe(window);
  });
});

describe('pos/externalShow', () => {
  it('accepts the normalized shape and returns exactly the contract fields', () => {
    const show = normalizeExternalShow(rawShow());

    expect(show).toEqual({
      externalSessionId: 'SESSION-1',
      externalScreenId: 'SCREEN-A',
      externalFilmId: 'FILM-9',
      filmTitle: 'A Test Double Film',
      showTimeLocal: '2026-08-13T18:30:00',
      cancelled: false,
    });
  });

  it('treats screen and film ids as optional, so an unmapped show survives', () => {
    const show = normalizeExternalShow(
      rawShow({ externalScreenId: null, externalFilmId: undefined })
    );

    expect(show.externalScreenId).toBeNull();
    expect(show.externalFilmId).toBeNull();
    // No silent data loss: the show itself is still here.
    expect(show.externalSessionId).toBe('SESSION-1');
  });

  it('defaults cancelled to false and rejects a non-boolean', () => {
    expect(normalizeExternalShow(rawShow({ cancelled: undefined })).cancelled).toBe(false);
    expect(normalizeExternalShow(rawShow({ cancelled: true })).cancelled).toBe(true);
    expect(() => normalizeExternalShow(rawShow({ cancelled: 'yes' }))).toThrow(
      PosMalformedResponseError
    );
  });

  it('rejects a missing natural key or title', () => {
    expect(() => normalizeExternalShow(rawShow({ externalSessionId: '' }))).toThrow(
      /externalSessionId must not be empty/
    );
    expect(() => normalizeExternalShow(rawShow({ externalSessionId: undefined }))).toThrow(
      PosMalformedResponseError
    );
    expect(() => normalizeExternalShow(rawShow({ filmTitle: '   ' }))).toThrow(
      /filmTitle must not be empty/
    );
  });

  it('rejects values wider than the shows columns instead of truncating', () => {
    expect(() => normalizeExternalShow(rawShow({ externalSessionId: 'x'.repeat(101) }))).toThrow(
      /exceeds 100 characters/
    );
    expect(() => normalizeExternalShow(rawShow({ filmTitle: 'x'.repeat(201) }))).toThrow(
      /exceeds 200 characters/
    );
    expect(() => normalizeExternalShow(rawShow({ externalScreenId: 'x'.repeat(51) }))).toThrow(
      /exceeds 50 characters/
    );
  });

  describe('does not perform timezone conversion', () => {
    it('returns the provider wall clock byte-for-byte', () => {
      // 18:30 local stays 18:30. Nothing here knows the cinema's zone, and
      // that is the point: conversion happens once, in B5.
      expect(normalizeShowTimeLocal('2026-08-13T18:30:00')).toBe('2026-08-13T18:30:00');
      expect(normalizeShowTimeLocal('2026-08-13 18:30')).toBe('2026-08-13T18:30:00');
      expect(normalizeShowTimeLocal('  2026-01-01T00:00:00  ')).toBe('2026-01-01T00:00:00');
    });

    it('returns the same wall clock under two different process timezones', () => {
      // A regression guard, not a proof. The normalizer parses and reformats a
      // string and never calls a local-time API - even daysInMonth uses
      // Date.UTC - so it has no way to observe the process timezone today. This
      // test exists to fail if a future change introduces local-time parsing.
      const original = process.env.TZ;
      try {
        process.env.TZ = 'America/New_York';
        const west = normalizeExternalShow(rawShow()).showTimeLocal;
        process.env.TZ = 'Asia/Kolkata';
        const east = normalizeExternalShow(rawShow()).showTimeLocal;

        expect(west).toBe('2026-08-13T18:30:00');
        expect(east).toBe(west);
      } finally {
        // TZ is commonly unset. Assigning `undefined` to a process.env property
        // stores the string "undefined", which is an invalid zone and would
        // leak into every later test in this worker.
        if (original === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = original;
        }
      }
    });

    it('left the process timezone restored, not set to the string "undefined"', () => {
      // Guards the restore in the test above. Declared after it so it observes
      // the environment that test left behind.
      expect(process.env.TZ).not.toBe('undefined');
    });

    it('rejects a value carrying a UTC offset', () => {
      for (const value of [
        '2026-08-13T18:30:00Z',
        '2026-08-13T18:30:00+05:30',
        '2026-08-13T13:00:00-0400',
      ]) {
        expect(() => normalizeShowTimeLocal(value)).toThrow(PosMalformedResponseError);
        expect(() => normalizeShowTimeLocal(value)).toThrow(/without a UTC offset/);
      }
    });

    it('rejects a Date, which is an instant and so implies a conversion already happened', () => {
      expect(() => normalizeShowTimeLocal(new Date('2026-08-13T18:30:00Z'))).toThrow(
        /must be a wall-clock string, not a Date/
      );
      expect(() => normalizeExternalShow(rawShow({ showTimeLocal: new Date() }))).toThrow(
        PosMalformedResponseError
      );
    });

    it('rejects an unparseable or impossible show time', () => {
      for (const value of ['13/08/2026 18:30', '2026-08-13', 'tomorrow', 1755102600000, null]) {
        expect(() => normalizeShowTimeLocal(value)).toThrow(PosMalformedResponseError);
      }
      expect(() => normalizeShowTimeLocal('2026-02-30T10:00:00')).toThrow(/not a real date/);
      expect(() => normalizeShowTimeLocal('2026-08-13T25:00:00')).toThrow(/not a real date/);
    });
  });

  it('represents zero shows as a successful empty result, not an error', async () => {
    expect(normalizeExternalShows([])).toEqual([]);

    const stub = makeStubAdapter(POS_PROVIDERS.IMPACT, { shows: [] });
    registerAdapter(POS_PROVIDERS.IMPACT, stub);

    // A quiet window resolves. It does not reject - §6.3 depends on the
    // difference, because only a successful sync may cancel absent shows.
    await expect(getAdapter(POS_PROVIDERS.IMPACT).fetchShows(integration, window)).resolves.toEqual(
      []
    );
  });

  it('rejects a non-array result set', () => {
    expect(() => normalizeExternalShows(null)).toThrow(/must resolve to an array/);
    expect(() => normalizeExternalShows({ shows: [] })).toThrow(PosMalformedResponseError);
  });
});

describe('pos/posErrors', () => {
  const cases = [
    [PosProviderUnavailableError, POS_ERROR_CODES.PROVIDER_UNAVAILABLE, 503],
    [PosConfigurationError, POS_ERROR_CODES.INVALID_CONFIGURATION, 500],
    [PosMalformedResponseError, POS_ERROR_CODES.MALFORMED_RESPONSE, 503],
    [PosProviderNotSupportedError, POS_ERROR_CODES.PROVIDER_NOT_SUPPORTED, 500],
  ];

  it.each(cases)('%p carries a stable posCode and a safe HTTP default', (Err, posCode, status) => {
    const err = new Err('something went wrong', {
      provider: POS_PROVIDERS.IMPACT,
      integrationId: 1,
      operation: 'fetchShows',
    });

    expect(err).toBeInstanceOf(PosAdapterError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.posCode).toBe(posCode);
    expect(err.statusCode).toBe(status);
    expect(err.isOperational).toBe(true);
    // Nothing from the provider reaches the client envelope.
    expect(err.details).toBeNull();
  });

  it('lets the sync layer tell the failure modes apart without knowing the provider', () => {
    const failures = [
      new PosProviderUnavailableError('POS did not respond'),
      new PosConfigurationError('credential_ref does not resolve'),
      new PosMalformedResponseError('session id missing'),
    ];

    const classify = (err) => (err instanceof PosAdapterError ? err.posCode : 'UNEXPECTED');

    expect(failures.map(classify)).toEqual([
      POS_ERROR_CODES.PROVIDER_UNAVAILABLE,
      POS_ERROR_CODES.INVALID_CONFIGURATION,
      POS_ERROR_CODES.MALFORMED_RESPONSE,
    ]);
    expect(classify(new Error('a bug'))).toBe('UNEXPECTED');
  });

  it('stays provider-neutral: the taxonomy encodes no provider or HTTP semantics', () => {
    // No class, code or default message mentions a provider or a transport.
    const text = [
      ...Object.values(POS_ERROR_CODES),
      ...cases.map(([Err]) => new Err().message),
      ...cases.map(([Err]) => Err.name),
    ].join(' ');

    expect(text).not.toMatch(/vista|showbiz|impact|soap|rest|http|graphql/i);
  });

  it('marks an ambiguous provider outcome so B5 will not blindly retry', () => {
    expect(new PosProviderUnavailableError('timed out').ambiguous).toBe(false);
    expect(new PosProviderUnavailableError('timed out', { ambiguous: true }).ambiguous).toBe(true);
  });

  it('keeps the underlying cause out of the client envelope but available for diagnostics', () => {
    const cause = new Error('ECONNREFUSED 10.0.0.5:1433');
    const err = new PosProviderUnavailableError('POS provider is unavailable', {
      provider: POS_PROVIDERS.IMPACT,
      integrationId: 4,
      operation: 'fetchShows',
      cause,
    });

    expect(err.cause).toBe(cause);
    expect(err.details).toBeNull();
    expect(err.message).not.toContain('ECONNREFUSED');
    // The log context is identifiers only - no cause, no message, no secrets.
    expect(err.toLogContext()).toEqual({
      posCode: POS_ERROR_CODES.PROVIDER_UNAVAILABLE,
      provider: POS_PROVIDERS.IMPACT,
      integrationId: 4,
      operation: 'fetchShows',
    });
  });

  it('surfaces an adapter failure through the registry unchanged', async () => {
    const failure = new PosProviderUnavailableError('POS did not respond', {
      provider: POS_PROVIDERS.IMPACT,
    });
    registerAdapter(
      POS_PROVIDERS.IMPACT,
      makeStubAdapter(POS_PROVIDERS.IMPACT, { error: failure })
    );

    await expect(getAdapter(POS_PROVIDERS.IMPACT).fetchShows(integration, window)).rejects.toBe(
      failure
    );
  });
});
