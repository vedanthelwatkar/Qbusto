'use strict';

/**
 * POS show synchronization.
 *
 * Provider-neutral by construction: this module imports only `src/pos/*`
 * (the adapter contract, the registry, the error taxonomy) and models. It
 * never branches on `provider` - that happens exactly once, inside
 * `providerRegistry.getAdapter`, per docs/pos-integration.md section 5.3.
 *
 * THE DESTINATION IS `session`, AND THERE IS ONLY ONE
 *
 * This used to write a QBusto-owned `shows` table that mirrored what the
 * client's `session` table already held. Two tables answering "what is playing
 * on this screen right now" is an ambiguity with no upside, so `shows` is gone
 * and normalized provider data lands directly in `session`:
 *
 *     POS -> adapter -> ExternalShow -> session -> QBusto APIs -> apps
 *
 * A provider-specific show table is deliberately NOT reintroduced, per
 * docs/pos-integration.md. Provider parsing stops at the adapter; from
 * `ExternalShow` onward nothing downstream speaks the provider's vocabulary.
 *
 * TWO FIELDS CANNOT BE POPULATED FROM ANY VERIFIED PROVIDER RESPONSE YET
 *
 * `session` is not shaped like the old `shows` table, and the difference is
 * not cosmetic:
 *
 *   Session_dtmFinishShow  NOT NULL. `ExternalShow` carries only a start
 *                          (`showTimeLocal`); no verified provider response
 *                          has ever supplied an end time or a runtime to
 *                          derive one from. It is NOT invented here - a
 *                          fabricated end time would silently drive the
 *                          "which show is running now" lookup in
 *                          consumer.service, which reads exactly this column.
 *                          A row with no end time is SKIPPED and logged.
 *
 *   Session_lngSessionId   int. `ExternalShow.externalSessionId` is a string,
 *                          because a POS may well use a non-numeric id. One
 *                          that will not parse as an integer cannot be stored
 *                          in this primary key at all; such a row is SKIPPED
 *                          and logged rather than hashed into a number that
 *                          would collide unpredictably.
 *
 * Both are recorded as pending in docs/pos-integration.md. They need either a
 * provider response that carries the missing value or a client decision about
 * the column - not a guess here.
 *
 * WHAT A SYNC DOES, PER INTEGRATION
 *
 *   1. Resolve the adapter for `integration.provider`.
 *   2. Ask it for every ExternalShow in today + the next day.
 *   3. On success: upsert each mappable row on the natural key
 *      `(Code, Session_lngSessionId)`. Then, ONLY IF every row returned was
 *      representable and there was at least one, close any session for this
 *      cinema, in-window, that this sync did NOT see.
 *   4. On failure: change nothing. Existing sessions stay exactly as they
 *      were, nothing is closed, the failure is logged, and the next tick can
 *      retry. A provider outage must never look like "no shows"; only a
 *      *successful* fetch may reconcile.
 *
 * The condition on step 3 is not a detail. Reconciliation closes "everything
 * the POS did not report", which is only meaningful on a COMPLETE view, and
 * `session` also holds rows the client loaded directly. A sync that skipped
 * rows, or that got an empty response, has no complete view - and today NO
 * adapter can supply an end time, so every row is skipped. Reconciling anyway
 * would close a cinema entire open schedule and empty the consumer picker,
 * on a sync reporting success. `summary.reconciled` says which happened.
 *
 * `syncAllIntegrations` isolates failures per integration: one integration
 * throwing must never stop the others from syncing.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const { getAdapter } = require('../pos/providerRegistry');
const { PosAdapterError, PosProviderNotSupportedError } = require('../pos/posErrors');
const { sqlDateTimeLiteral, toSqlDateTime } = require('../utils/sqlDate');

/** today + the next day, per docs/pos-integration.md section 6.2. */
const SYNC_WINDOW_DAYS = 2;

/**
 * `session.Session_strStatus`, as the client defines it. Only `O` is offered
 * to a customer (see consumer.service). A show the POS reports as cancelled
 * becomes `C`, not a row that vanishes - an order may already reference it.
 */
const STATUS_OPEN = 'O';
const STATUS_CLOSED = 'C';

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
 * Compute the sync window as absolute instants, from the server clock.
 * Same window for every provider; a provider needing a *local-time* window is
 * a future adapter concern, not this function's.
 */
function computeWindow(now) {
  const fromUtc = new Date(now);
  const toUtc = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { fromUtc, toUtc };
}

/**
 * The auditorium's NAME, which is what `session` stores and what
 * `consumer.service.resolveScreenId` matches an order's seat against.
 *
 * `ExternalShow` carries only the provider's screen identifier, so the name is
 * reached through the mapping the client already maintains:
 * `screen_pos_mappings` -> `screens.name`. An unmapped screen yields null; the
 * session is still written, it simply cannot be resolved to a QBusto screen
 * until someone maps it. That mirrors the old behaviour, which left
 * `shows.screen_id` null rather than dropping the show.
 */
async function resolveScreenName(integrationId, externalScreenId, transaction) {
  if (externalScreenId === null || externalScreenId === undefined) return null;

  const mapping = await models.ScreenPosMapping.findOne({
    where: { posIntegrationId: integrationId, externalScreenId },
    include: [{ association: 'screen', attributes: ['name'] }],
    transaction,
  });

  return mapping && mapping.screen ? mapping.screen.name : null;
}

/**
 * ExternalShow -> the ten columns of a `session` row, or null when the row
 * cannot be represented. See the module header for the two reasons.
 *
 * @returns {{row: object}|{skip: string}}
 */
function toSessionRow(externalShow, { cinemaCode, screenName, timezone }) {
  const sessionId = Number(externalShow.externalSessionId);

  if (!Number.isSafeInteger(sessionId)) {
    return { skip: 'externalSessionId is not an integer, and Session_lngSessionId is int' };
  }

  if (!externalShow.showTimeEndLocal) {
    return { skip: 'no end time supplied, and Session_dtmFinishShow is NOT NULL' };
  }

  /*
   * `Number(null)` is 0 and `Number('')` is 0, and both pass isSafeInteger -
   * which would record auditorium 0 for a show whose provider named no screen
   * at all. Absent has to stay absent.
   */
  const rawScreen = externalShow.externalScreenId;
  const screenNumber =
    rawScreen === null || rawScreen === undefined || rawScreen === '' ? NaN : Number(rawScreen);

  return {
    row: {
      cinemaCode,
      sessionId,
      filmTitle: externalShow.filmTitle,
      // NOT NULL in the table. An empty string records "the provider named no
      // film code", which is different from a code we failed to read.
      filmCode: externalShow.externalFilmId || '',
      screenNumber: Number.isSafeInteger(screenNumber) ? screenNumber : null,
      screenName,
      status: externalShow.cancelled ? STATUS_CLOSED : STATUS_OPEN,
      startsAt: wallClockToInstant(externalShow.showTimeLocal, timezone),
      endsAt: wallClockToInstant(externalShow.showTimeEndLocal, timezone),
      stampedAt: new Date(),
    },
  };
}

/**
 * Write one session row with RAW SQL, not through the model.
 *
 * WHY NOT `Session.create` / `instance.update`
 *
 * `Session_dtmRealShow`, `Session_dtmFinishShow` and `Session_dtmStamp` are
 * `datetime`, the client's type, which carries no offset. Sequelize's mssql
 * dialect binds a JS Date as an offset-bearing literal, and SQL Server refuses
 * to convert that to `datetime`: the statement fails outright with "Conversion
 * failed when converting date and/or time from character string". Verified
 * against the live table, not inferred - an ORM insert of a well-formed row
 * fails every time.
 *
 * That is the same constraint `utils/sqlDate.js` already documents for
 * comparisons; it applies to writes for the same reason. The three datetimes
 * are formatted by `toSqlDateTime` and interpolated (digits and separators
 * produced from a Date - no caller input reaches the SQL); every other value is
 * a bound parameter.
 *
 * @param {object} row A row shaped by `toSessionRow`.
 * @param {{update: boolean, transaction: import('sequelize').Transaction}} options
 */
async function writeSessionRow(row, { update, transaction }) {
  const replacements = {
    cinemaCode: row.cinemaCode,
    sessionId: row.sessionId,
    filmTitle: row.filmTitle,
    filmCode: row.filmCode,
    screenNumber: row.screenNumber,
    screenName: row.screenName,
    status: row.status,
  };

  const startsAt = `'${toSqlDateTime(row.startsAt)}'`;
  const endsAt = `'${toSqlDateTime(row.endsAt)}'`;
  const stampedAt = `'${toSqlDateTime(row.stampedAt)}'`;

  const sql = update
    ? `UPDATE [dbo].[session]
          SET [Film_strName] = :filmTitle,
              [Film_strCode] = :filmCode,
              [Screen_bytNum] = :screenNumber,
              [Screen_strName] = :screenName,
              [Session_strStatus] = :status,
              [Session_dtmRealShow] = ${startsAt},
              [Session_dtmFinishShow] = ${endsAt},
              [Session_dtmStamp] = ${stampedAt}
        WHERE [Code] = :cinemaCode AND [Session_lngSessionId] = :sessionId`
    : `INSERT INTO [dbo].[session]
         ([Code], [Session_lngSessionId], [Film_strName], [Film_strCode],
          [Screen_bytNum], [Screen_strName], [Session_strStatus],
          [Session_dtmRealShow], [Session_dtmFinishShow], [Session_dtmStamp])
       VALUES
         (:cinemaCode, :sessionId, :filmTitle, :filmCode,
          :screenNumber, :screenName, :status,
          ${startsAt}, ${endsAt}, ${stampedAt})`;

  await sequelize.query(sql, { replacements, transaction });
}

/**
 * Sync one POS integration.
 *
 * @param {object} integration A pos_integrations row, with its `cinema`
 *   association loaded (for `cinema.code` and `cinema.timezone`).
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<{failed: boolean, posCode?: string, inserted?: number,
 *   updated?: number, closed?: number, skipped?: number, reconciled?: boolean}>}
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
      // A provider failure changes nothing: existing sessions stay untouched,
      // nothing is closed, retried on the next tick. See module header.
      logger.error('POS sync failed, leaving existing sessions untouched', err.toLogContext());
      return { failed: true, posCode: err.posCode };
    }
    throw err;
  }

  const cinema = integration.cinema;

  if (!cinema || !cinema.code) {
    logger.error('POS sync skipped: integration has no cinema code to write sessions against', {
      ...logContext,
    });
    return { failed: true, posCode: null };
  }

  const timezone = cinema.timezone || 'Asia/Kolkata';

  const summary = {
    failed: false,
    inserted: 0,
    updated: 0,
    closed: 0,
    skipped: 0,
    reconciled: false,
  };

  await sequelize.transaction(async (transaction) => {
    const seenSessionIds = [];

    for (const externalShow of externalShows) {
      const screenName = await resolveScreenName(
        integration.id,
        externalShow.externalScreenId,
        transaction
      );

      const mapped = toSessionRow(externalShow, {
        cinemaCode: cinema.code,
        screenName,
        timezone,
      });

      if (mapped.skip) {
        // Logged rather than thrown: one unmappable row must not abandon a
        // whole schedule. The reason is explicit so it is obvious which of the
        // two pending fields is missing.
        logger.warn('POS sync skipped a show it cannot represent as a session', {
          ...logContext,
          externalSessionId: externalShow.externalSessionId,
          reason: mapped.skip,
        });
        summary.skipped += 1;
        continue;
      }

      seenSessionIds.push(mapped.row.sessionId);

      const existing = await models.Session.findOne({
        where: { cinemaCode: cinema.code, sessionId: mapped.row.sessionId },
        attributes: ['sessionId'],
        transaction,
      });

      if (existing) {
        await writeSessionRow(mapped.row, { update: true, transaction });
        summary.updated += 1;
      } else {
        await writeSessionRow(mapped.row, { update: false, transaction });
        summary.inserted += 1;
      }
    }

    /*
     * Reconciliation: a session for this cinema, in-window, that a SUCCESSFUL
     * sync did not see is closed rather than deleted - an order may already
     * reference it, and `C` is the client's own vocabulary for "no longer
     * selling".
     *
     * Only reached after a successful fetch; an outage returns above.
     *
     * SCOPE NOTE. `session` now holds both POS-synced and client-loaded rows,
     * and nothing on the row records which wrote it. This therefore closes any
     * open in-window session the POS did not report, including one the client
     * loaded directly. That is the correct behaviour when the POS is
     * authoritative for the cinema's schedule, which is the premise of running
     * a sync at all - but it is the one place the merge of `shows` into
     * `session` changed a blast radius, so it is called out here rather than
     * left to be discovered. See docs/pos-integration.md.
     */
    if (summary.skipped > 0 || seenSessionIds.length === 0) {
      /*
       * REFUSE TO RECONCILE ON AN INCOMPLETE VIEW.
       *
       * Closing "everything the POS did not report" is only safe when we
       * actually represented everything the POS reported. Two cases break that
       * premise, and both are live today:
       *
       *   - A row was skipped. No shipped adapter supplies an end time yet, so
       *     TODAY EVERY ROW IS SKIPPED. Reconciling would read as "the POS
       *     reported nothing" and close the cinema's whole open schedule -
       *     including the rows the client loaded directly, which this table now
       *     also holds - emptying the consumer's picker on a sync that reported
       *     success.
       *   - The provider returned nothing at all. Indistinguishable here from a
       *     provider that answered 200 with an empty body, and the cost of
       *     being wrong is the same wipe.
       *
       * So nothing is closed and the reason is logged. A stale session is a far
       * smaller fault than a schedule erased by a bookkeeping step.
       */
      logger.warn('POS sync did not reconcile: incomplete view of the schedule', {
        ...logContext,
        represented: seenSessionIds.length,
        skipped: summary.skipped,
      });
      summary.closed = 0;
      summary.reconciled = false;
      return;
    }

    const [closedCount] = await models.Session.update(
      { status: STATUS_CLOSED },
      {
        where: {
          cinemaCode: cinema.code,
          status: STATUS_OPEN,
          startsAt: {
            [Op.between]: [sqlDateTimeLiteral(range.fromUtc), sqlDateTimeLiteral(range.toUtc)],
          },
          sessionId: { [Op.notIn]: seenSessionIds },
        },
        transaction,
      }
    );
    summary.closed = closedCount;
    summary.reconciled = true;
  });

  logger.info('POS sync complete', { ...logContext, ...summary });
  return summary;
}

/**
 * Sync every active POS integration. One integration's failure is isolated
 * and never stops another's sync.
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
