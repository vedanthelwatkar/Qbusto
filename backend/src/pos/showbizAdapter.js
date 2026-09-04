'use strict';

/**
 * ShowBiz POS adapter (Phase B4) - transport and error mapping only.
 *
 * VERIFIED against the real TEST_SCHEDULE endpoint (2026-09):
 *   - ASP.NET ASMX SOAP service, but supports plain HTTP GET, which is what
 *     this adapter uses - matches the fetch-only convention used everywhere
 *     else in this backend (no SOAP library, no new dependency).
 *   - Operation: FnSchedule_CityTheatreMovieDate_All(CityId, TheatreId,
 *     MovieId, ShowDate). Read from `integration.config`, never hardcoded.
 *   - PartnerId/PartnerPwd exist only on ShowBiz transactional/booking
 *     operations (confirmed from the WSDL), not on this read-only schedule
 *     operation, so no credential is sent here at all.
 *   - Error shape is dual: a malformed/missing request parameter comes back
 *     as HTTP 500 with a plain-text body ("Missing parameter: CityId.");
 *     a query-level failure comes back as HTTP 200 with an XML envelope
 *     carrying ErrId/ErrorString. Both are reproducible today: ShowBiz's
 *     TEST_SCHEDULE database is currently returning ErrId=1 with a SQL
 *     Server storage error on every real query (Partners_Neon.mdf I/O
 *     failure), a provider-side outage that this adapter cannot work around.
 *
 * WHAT THIS ADAPTER DELIBERATELY DOES NOT DO YET
 *
 * A successful schedule response (ErrId=0 with real Schedules/PBSchedules
 * rows) has never been observed, because of the outage above. Guessing that
 * shape would mean inventing the ShowBiz contract rather than reading it, so
 * a successful envelope this adapter does not recognize is treated as
 * malformed rather than mapped. See docs/pos-integration.md section 2.5.
 */

const {
  PosConfigurationError,
  PosProviderUnavailableError,
  PosMalformedResponseError,
} = require('./posErrors');
const { assertShowWindow } = require('./adapter');
const { POS_PROVIDERS } = require('../constants');
const env = require('../config/env');
const logger = require('../config/logger');

const PROVIDER = POS_PROVIDERS.SHOWBIZZ;
const OPERATION = 'fetchShows';
const SCHEDULE_METHOD = 'FnSchedule_CityTheatreMovieDate_All';

/**
 * Same shape as cashfree.client.js withTimeout: bound how long we wait for
 * the provider, swallow the loser rejection so it cannot surface as an
 * unhandled rejection later, always clear the timer.
 */
function withTimeout(value, ms, label) {
  let timerId;

  const timeout = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  const settled = Promise.resolve(value);
  settled.catch(() => {});

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timerId));
}

function configError(message, integrationId) {
  return new PosConfigurationError(message, {
    provider: PROVIDER,
    integrationId: integrationId ?? null,
    operation: OPERATION,
  });
}

/**
 * Pull CityId/TheatreId out of integration.config.
 *
 * config is a free-form TEXT column on pos_integrations (JSON), so a
 * missing or unparseable value is this integration's own misconfiguration,
 * never a provider outage.
 */
function readConfig(integration) {
  const raw = integration && integration.config;
  if (raw === undefined || raw === null || raw === '') {
    throw configError(
      'ShowBiz integration is missing config (cityId/theatreId)',
      integration && integration.id
    );
  }

  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw configError('ShowBiz integration config is not valid JSON', integration && integration.id);
  }

  const { cityId, theatreId } = parsed || {};
  if (cityId === undefined || cityId === null || cityId === '') {
    throw configError('ShowBiz integration config is missing cityId', integration && integration.id);
  }
  if (theatreId === undefined || theatreId === null || theatreId === '') {
    throw configError('ShowBiz integration config is missing theatreId', integration && integration.id);
  }

  return { cityId: String(cityId), theatreId: String(theatreId) };
}

function readApiUrl(integration) {
  const apiUrl = integration && integration.apiUrl;
  if (typeof apiUrl !== 'string' || apiUrl.trim() === '') {
    throw configError('ShowBiz integration is missing apiUrl', integration && integration.id);
  }
  return apiUrl.replace(/\/+$/, '');
}

/** ShowDate is the only format verified live: plain YYYY-MM-DD, no time component. */
function toShowDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildRequestUrl(integration, range) {
  const apiUrl = readApiUrl(integration);
  const { cityId, theatreId } = readConfig(integration);

  const params = new URLSearchParams({
    CityId: cityId,
    TheatreId: theatreId,
    MovieId: '0',
    ShowDate: toShowDate(range.fromUtc),
  });

  return `${apiUrl}/${SCHEDULE_METHOD}?${params.toString()}`;
}

/**
 * Extract ErrId/ErrorString from the ShowBiz flat XML envelope.
 *
 * Every real body captured so far is a single-level
 * Root/ErrId/ErrorString document. A regex-based reader is used deliberately
 * rather than adding an XML parsing dependency, see
 * docs/pos-integration.md section 2.5.
 *
 * Returns null when the body is not this recognizable envelope shape at all.
 */
function readErrorEnvelope(body) {
  const errIdMatch = /<ErrId>\s*(-?\d+)\s*<\/ErrId>/i.exec(body);
  if (!errIdMatch) return null;

  const errorStringMatch = /<ErrorString>([\s\S]*?)<\/ErrorString>/i.exec(body);

  return {
    errId: Number(errIdMatch[1]),
    errorString: errorStringMatch ? errorStringMatch[1].trim() : '',
  };
}

/**
 * ShowBiz adapter: transport and error mapping only. See module header for
 * what a successful, mapped response would additionally require.
 */
const showbizAdapter = {
  provider: PROVIDER,

  async fetchShows(integration, range) {
    assertShowWindow(range, { provider: PROVIDER, integrationId: integration && integration.id });

    const url = buildRequestUrl(integration, range);
    const timeoutMs = env.showbiz.timeoutMs;

    let response;
    try {
      response = await withTimeout(fetch(url, { method: 'GET' }), timeoutMs, 'ShowBiz fetchShows');
    } catch (err) {
      // Network failure and timeout are both "we cannot tell if ShowBiz
      // received the request", ambiguous, per posErrors.js.
      throw new PosProviderUnavailableError('ShowBiz schedule request failed', {
        provider: PROVIDER,
        integrationId: integration && integration.id,
        operation: OPERATION,
        cause: err,
        ambiguous: true,
      });
    }

    const body = await response.text();

    if (!response.ok) {
      // Verified shape: HTTP 500 + plain text for a malformed/missing request
      // parameter, our request was wrong, not a provider outage.
      logger.warn('ShowBiz schedule request rejected', {
        provider: PROVIDER,
        integrationId: integration && integration.id,
        status: response.status,
      });
      throw configError(
        `ShowBiz rejected the schedule request (HTTP ${response.status})`,
        integration && integration.id
      );
    }

    const envelope = readErrorEnvelope(body);
    if (!envelope) {
      throw new PosMalformedResponseError(
        'ShowBiz schedule response is not a recognizable envelope',
        {
          provider: PROVIDER,
          integrationId: integration && integration.id,
          operation: OPERATION,
        }
      );
    }

    if (envelope.errId !== 0) {
      // Verified outage shape. The real ErrorString (which in practice has
      // named an internal SQL Server file path) never goes in message, only
      // in cause, for logs.
      logger.warn('ShowBiz schedule query failed', {
        provider: PROVIDER,
        integrationId: integration && integration.id,
        errId: envelope.errId,
      });
      throw new PosProviderUnavailableError('ShowBiz reported a schedule query failure', {
        provider: PROVIDER,
        integrationId: integration && integration.id,
        operation: OPERATION,
        cause: new Error(envelope.errorString || `ErrId ${envelope.errId}`),
      });
    }

    // ErrId === 0: a genuine successful envelope. No real one has ever been
    // observed (the outage above blocks every query), so there is no known
    // Schedules/PBSchedules row shape to map yet, fail explicitly rather
    // than guess. See module header and docs/pos-integration.md section 2.5.
    throw new PosMalformedResponseError(
      'ShowBiz returned a successful envelope with no implemented row mapping yet',
      {
        provider: PROVIDER,
        integrationId: integration && integration.id,
        operation: OPERATION,
      }
    );
  },
};

module.exports = showbizAdapter;
