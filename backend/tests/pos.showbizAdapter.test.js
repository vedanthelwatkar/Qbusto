'use strict';

/**
 * Phase B4 - ShowBiz adapter transport and error mapping.
 *
 * Every fixture below is SANITIZED: no real partner password, and no
 * successful ShowBiz schedule payload. A successful payload has never been
 * observed (the provider's TEST_SCHEDULE database is in a reproducible
 * outage - see docs/pos-integration.md section 2.5), and inventing one would
 * mean guessing the provider's contract rather than reading it. These tests
 * cover only the response shapes that have actually been observed live:
 * the HTTP 200 + ErrId!=0 outage envelope, the HTTP 500 plain-text
 * missing-parameter shape, and the transport/parse failure modes every
 * adapter must handle regardless of provider.
 */

const {
  PosConfigurationError,
  PosProviderUnavailableError,
  PosMalformedResponseError,
} = require('../src/pos/posErrors');
const { POS_PROVIDERS } = require('../src/constants');

// Set before the first require of src/config/env so it is present when that
// module validates at load time - it is never read for the read-only
// schedule operation this adapter calls, but a real deployment always has
// one set, and this is here to prove it can never leak if it were.
const FAKE_PARTNER_PASSWORD = 'sanitized-test-password-should-never-leak';
process.env.SHOWBIZ_PARTNER_PASSWORD = FAKE_PARTNER_PASSWORD;

const showbizAdapter = require('../src/pos/showbizAdapter');

describe('showbizAdapter.fetchShows', () => {
  const range = {
    fromUtc: new Date('2026-09-03T00:00:00.000Z'),
    toUtc: new Date('2026-09-04T00:00:00.000Z'),
  };

  const integration = (overrides = {}) => ({
    id: 42,
    provider: POS_PROVIDERS.SHOWBIZZ,
    apiUrl: 'http://160.30.216.249/TEST_SCHEDULE',
    config: JSON.stringify({ cityId: 83, theatreId: 2 }),
    ...overrides,
  });

  beforeEach(() => {
    jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    global.fetch.mockRestore();
  });

  function mockFetchOnce({ ok, status, body }) {
    global.fetch.mockResolvedValueOnce({
      ok,
      status,
      text: async () => body,
    });
  }

  test('HTTP 200 + ErrId=1 (verified live outage shape) maps to PosProviderUnavailableError', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body:
        '<Root><ErrId>1</ErrId><ErrorString>The operating system returned error 21' +
        '(The device is not ready.) to SQL Server during a read at offset 000000000000 ' +
        "in file 'Partners_Neon.mdf'.</ErrorString></Root>",
    });

    await expect(showbizAdapter.fetchShows(integration(), range)).rejects.toThrow(
      PosProviderUnavailableError
    );
  });

  test('HTTP 500 plain-text missing-parameter body maps to PosConfigurationError', async () => {
    mockFetchOnce({ ok: false, status: 500, body: 'Missing parameter: CityId.' });

    await expect(showbizAdapter.fetchShows(integration(), range)).rejects.toThrow(
      PosConfigurationError
    );
  });

  test('non-200 status with an arbitrary body normalizes without leaking the body', async () => {
    mockFetchOnce({ ok: false, status: 503, body: '<html>Service Unavailable</html>' });

    let caught;
    try {
      await showbizAdapter.fetchShows(integration(), range);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PosConfigurationError);
    expect(caught.message).not.toContain('<html>');
    expect(JSON.stringify(caught)).not.toContain('<html>');
  });

  test('network failure maps to PosProviderUnavailableError(ambiguous)', async () => {
    global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    let caught;
    try {
      await showbizAdapter.fetchShows(integration(), range);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PosProviderUnavailableError);
    expect(caught.ambiguous).toBe(true);
  });

  test('timeout maps to PosProviderUnavailableError(ambiguous)', async () => {
    // Force a short timeout for this one test rather than waiting out the real
    // default. jest.isolateModules re-requires the adapter (and its posErrors
    // dependency together, in the same isolated registry) so the thrown
    // error's class still matches what this same require would produce.
    let caught;
    await jest.isolateModulesAsync(async () => {
      process.env.SHOWBIZ_TIMEOUT_MS = '10';
      global.fetch.mockImplementationOnce(() => new Promise(() => {}));
      // eslint-disable-next-line global-require
      const isolatedPosErrors = require('../src/pos/posErrors');
      // eslint-disable-next-line global-require
      const adapterWithShortTimeout = require('../src/pos/showbizAdapter');

      try {
        await adapterWithShortTimeout.fetchShows(integration(), range);
      } catch (err) {
        caught = err;
      }

      delete process.env.SHOWBIZ_TIMEOUT_MS;

      expect(caught).toBeInstanceOf(isolatedPosErrors.PosProviderUnavailableError);
    });

    expect(caught.ambiguous).toBe(true);
  }, 15000);

  test('malformed / unrecognizable XML body maps to PosMalformedResponseError', async () => {
    mockFetchOnce({ ok: true, status: 200, body: 'not xml at all, just noise' });

    await expect(showbizAdapter.fetchShows(integration(), range)).rejects.toThrow(
      PosMalformedResponseError
    );
  });

  test('a successful envelope (ErrId=0) with no implemented row mapping fails explicitly rather than guessing', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: '<Root><ErrId>0</ErrId><ErrorString></ErrorString></Root>',
    });

    await expect(showbizAdapter.fetchShows(integration(), range)).rejects.toThrow(
      PosMalformedResponseError
    );
  });

  test('missing config (cityId/theatreId) fails as configuration error, not a provider call', async () => {
    await expect(
      showbizAdapter.fetchShows(integration({ config: null }), range)
    ).rejects.toThrow(PosConfigurationError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the partner password never appears in a thrown error, in any form', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: '<Root><ErrId>1</ErrId><ErrorString>storage error</ErrorString></Root>',
    });

    let caught;
    try {
      await showbizAdapter.fetchShows(integration(), range);
    } catch (err) {
      caught = err;
    }

    const serialized = JSON.stringify({
      message: caught.message,
      posCode: caught.posCode,
      provider: caught.provider,
      integrationId: caught.integrationId,
      operation: caught.operation,
      details: caught.details,
      logContext: caught.toLogContext(),
    });

    expect(serialized).not.toContain(FAKE_PARTNER_PASSWORD);
    // Also confirm the request URL itself never carried the credential.
    const [calledUrl] = global.fetch.mock.calls[0];
    expect(calledUrl).not.toContain(FAKE_PARTNER_PASSWORD);
  });
});
