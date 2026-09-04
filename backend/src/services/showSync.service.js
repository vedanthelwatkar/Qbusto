'use strict';

/**
 * POS show synchronization (Phase B5).
 *
 * Provider-neutral by construction: this module imports only `src/pos/*`
 * (the adapter contract, the registry, the error taxonomy) and models. It
 * never branches on `provider` - that happens exactly once, inside
 * `providerRegistry.getAdapter`, per docs/pos-integration.md section 5.3.
 *
 * WHAT A SYNC DOES, PER INTEGRATION (section 6)
 *
 *   1. Resolve the adapter for `integration.provider`.
 *   2. Ask it for every ExternalShow in today + the next day (section 6.2).
 *   3. On success (including an empty array): upsert on the natural key
 *      `(pos_integration_id, external_session_id)`, then cancel any show for
 *      this integration, in-window, that this sync did NOT see - section 6.3.
 *   4. On failure: change nothing. Existing shows stay exactly as they were,
 *      nothing is cancelled, the failure is logged, and the next tick can
 *      retry - section 6.5. A provider outage must never look like "no
 *      shows"; only a *successful* fetch may reconcile.
 *
 * `syncAllIntegrations` isolates failures per integration (section 6.5): one
 * integration throwing must never stop the others from syncing.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const { getAdapter } = require('../pos/providerRegistry');
const { PosAdapterError, PosProviderNotSupportedError } = require('../pos/posErrors');

/** today + the next day, per docs/pos-integration.md section 6.2. */
const SYNC_WINDOW_DAYS = 2;

/**
 * Turn a provider wall-clock string (already validated by
 * normalizeExternalShow - no offset, no zone) into an instant, using the
 * cinema's IANA timezone, per docs/pos-integration.md section 9.3.
 *
 * `Intl.DateTimeFormat` with a target zone plus a UTC-anchored guess is the
 * standard offset-free way to do this without adding a dependency: format
 * a UTC-based guess in the target zone, read back the delta, and correct
 * once. Show times do not straddle a DST transition boundary at the minute
 * granularity this needs to be exact for common IANA zones.
 */
function wallClockToInstant(wallClock, timezone) {
  const [datePart, timePart] = wallClock.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = '0'] = timePart.split(':');

  const naiveUtc = Date.UTC(year, month - 1, day, Number(hour), Number(minute), Number(second));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(naiveUtc)).map((part) => [part.type, part.value])
  );

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  // asIfUtc is what `naiveUtc` LOOKS LIKE when rendered in `timezone`; the gap
  // between them is exactly that zone's offset from UTC at this instant.
  const offsetMs = asIfUtc - naiveUtc;
  return new Date(naiveUtc - offsetMs);
}

/**
 * Compute the sync window as absolute instants, from the server clock -
 * section 6.6. Same window for every provider; a provider needing a
 * *local-time* window is a future adapter concern (section 12.13), not this
 * function's.
 */
function computeWindow(now) {
  const fromUtc = new Date(now);
  const toUtc = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { fromUtc, toUtc };
}

/**
 * Resolve `externalScreenId` to a QBusto `screenId` via `screen_pos_mappings`.
 * Null/unmapped stays null - never drops the show (section 6.4/6.10).
 */
async function resolveScreenId(integrationId, externalScreenId, transaction) {
  if (externalScreenId === null) return null;

  const mapping = await models.ScreenPosMapping.findOne({
    where: { posIntegrationId: integrationId, externalScreenId },
    transaction,
  });

  return mapping ? mapping.screenId : null;
}

/**
 * Sync one POS integration.
 *
 * @param {object} integration A pos_integrations row, with its `cinema`
 *   association loaded (for `cinema.timezone`).
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<{failed: boolean, posCode?: string, inserted?: number, updated?: number, cancelled?: number}>}
 */
async function syncIntegration(integration, { now = new Date() } = {}) {
  const logContext = { integrationId: integration.id, provider: integration.provider };

  let adapter;
  try {
    adapter = getAdapter(integration.provider);
  } catch (err) {
    if (err instanceof PosProviderNotSupportedError) {
      logger.warn('Skipping POS sync: no adapter registered', {
        ...logContext,
        posCode: err.posCode,
      });
      return { failed: true, posCode: err.posCode };
    }
    throw err;
  }

  const range = computeWindow(now);

  let externalShows;
  try {
    externalShows = await adapter.fetchShows(integration, range);
  } catch (err) {
    if (err instanceof PosAdapterError) {
      // A provider failure changes nothing: existing shows stay untouched,
      // nothing is cancelled, retried on the next tick. See module header.
      logger.error('POS sync failed, leaving existing shows untouched', err.toLogContext());
      return { failed: true, posCode: err.posCode };
    }
    throw err;
  }

  const timezone = (integration.cinema && integration.cinema.timezone) || 'Asia/Kolkata';

  const summary = { failed: false, inserted: 0, updated: 0, cancelled: 0 };

  await sequelize.transaction(async (transaction) => {
    const seenSessionIds = [];

    for (const externalShow of externalShows) {
      seenSessionIds.push(externalShow.externalSessionId);

      const screenId = await resolveScreenId(
        integration.id,
        externalShow.externalScreenId,
        transaction
      );
      const showTime = wallClockToInstant(externalShow.showTimeLocal, timezone);
      const status = externalShow.cancelled ? 'cancelled' : 'scheduled';

      const existing = await models.Show.findOne({
        where: {
          posIntegrationId: integration.id,
          externalSessionId: externalShow.externalSessionId,
        },
        transaction,
      });

      if (existing) {
        await existing.update(
          {
            cinemaId: integration.cinemaId,
            screenId,
            externalScreenId: externalShow.externalScreenId,
            externalFilmId: externalShow.externalFilmId,
            filmTitle: externalShow.filmTitle,
            showTime,
            status,
            lastSyncedAt: now,
          },
          { transaction }
        );
        summary.updated += 1;
      } else {
        await models.Show.create(
          {
            cinemaId: integration.cinemaId,
            screenId,
            posIntegrationId: integration.id,
            externalSessionId: externalShow.externalSessionId,
            externalScreenId: externalShow.externalScreenId,
            externalFilmId: externalShow.externalFilmId,
            filmTitle: externalShow.filmTitle,
            showTime,
            status,
            lastSyncedAt: now,
          },
          { transaction }
        );
        summary.inserted += 1;
      }
    }

    // Reconciliation (section 6.3): any show for this integration, in-window,
    // not seen in THIS successful sync is cancelled. Only reached after a
    // successful fetch - an outage returns above before this line runs.
    const [cancelledCount] = await models.Show.update(
      { status: 'cancelled' },
      {
        where: {
          posIntegrationId: integration.id,
          status: 'scheduled',
          showTime: { [Op.between]: [range.fromUtc, range.toUtc] },
          externalSessionId: { [Op.notIn]: seenSessionIds.length ? seenSessionIds : [''] },
        },
        transaction,
      }
    );
    summary.cancelled = cancelledCount;
  });

  logger.info('POS sync complete', { ...logContext, ...summary });
  return summary;
}

/**
 * Sync every active POS integration. One integration's failure is isolated
 * and never stops another's sync - section 6.5.
 *
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<Array<{integrationId: number, provider: string, failed: boolean}>>}
 */
async function syncAllIntegrations({ now = new Date() } = {}) {
  const integrations = await models.PosIntegration.findAll({
    where: { isActive: true },
    include: [{ model: models.Cinema, as: 'cinema' }],
  });

  const results = [];

  for (const integration of integrations) {
    try {
      const result = await syncIntegration(integration, { now });
      results.push({ integrationId: integration.id, provider: integration.provider, ...result });
    } catch (err) {
      logger.error('Unexpected error during POS sync, continuing with remaining integrations', {
        integrationId: integration.id,
        provider: integration.provider,
        error: err.message,
      });
      results.push({
        integrationId: integration.id,
        provider: integration.provider,
        failed: true,
        posCode: null,
      });
    }
  }

  return results;
}

module.exports = {
  syncIntegration,
  syncAllIntegrations,
};
