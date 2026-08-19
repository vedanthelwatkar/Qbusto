'use strict';

/**
 * The normalized show shape every POS adapter returns (Phase B2).
 *
 * `ExternalShow` is the entire vocabulary the layers above the adapter get to
 * speak. It carries only what synchronizing the `shows` table needs, and every
 * field maps to a column that already exists:
 *
 *   externalSessionId -> shows.external_session_id  (half the natural key)
 *   externalScreenId  -> shows.external_screen_id   (resolved via screen_pos_mappings)
 *   externalFilmId    -> shows.external_film_id
 *   filmTitle         -> shows.film_title
 *   showTimeLocal     -> shows.show_time            (after B5 converts it)
 *   cancelled         -> shows.status               ('scheduled' | 'cancelled')
 *
 * Nothing else is here. Seat maps, pricing, ratings, runtime and booking counts
 * are all things a POS could return and none of them have a column, so
 * accepting them would create a field with no meaning downstream.
 *
 * `cancelled` is not speculative: docs/pos-integration.md §6.3 requires a
 * POS-cancelled show to become `status = 'cancelled'` rather than vanish, and
 * that state cannot be derived from absence alone.
 *
 * TIMEZONE - the rule this module enforces
 * ----------------------------------------
 * `showTimeLocal` is the provider's cinema-local wall clock, exactly as the POS
 * expressed it, with no offset attached and no conversion applied. Conversion
 * to a UTC instant happens once, centrally, in the Phase B5 sync service, so
 * two providers cannot drift apart, per the adapter-boundary rule.
 *
 * `normalizeExternalShow` enforces this rather than merely documenting it: a
 * value carrying a `Z` or a `+05:30`, or a JavaScript `Date` (which is an
 * instant, so a conversion already happened), is rejected as malformed. An
 * adapter cannot quietly convert and still pass.
 */

const { PosMalformedResponseError } = require('./posErrors');

/**
 * @typedef {object} ExternalShow
 * @property {string} externalSessionId Stable provider session id. Required.
 * @property {string|null} externalScreenId Provider screen id, unmapped.
 * @property {string|null} externalFilmId Provider film id, unmapped.
 * @property {string} filmTitle Display title. Required.
 * @property {string} showTimeLocal Cinema-local wall clock, 'YYYY-MM-DDTHH:mm:ss'.
 * @property {boolean} cancelled True when the POS reports the show cancelled.
 */

/** Column widths from the `shows` table. Truncating silently would corrupt the natural key. */
const MAX_LENGTHS = Object.freeze({
  externalSessionId: 100,
  externalScreenId: 50,
  externalFilmId: 50,
  filmTitle: 200,
});

/** Wall clock only: no zone designator, no offset, no fractional seconds. */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Anything that pins a value to an absolute instant, i.e. evidence of conversion. */
const HAS_OFFSET = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

function malformed(message, context) {
  return new PosMalformedResponseError(message, { ...context, operation: 'fetchShows' });
}

/** Days in a month, so 2026-02-30 is rejected rather than silently rolling over. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function requiredString(value, field, context) {
  if (typeof value !== 'string') {
    throw malformed(`ExternalShow.${field} must be a string`, context);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw malformed(`ExternalShow.${field} must not be empty`, context);
  }
  if (trimmed.length > MAX_LENGTHS[field]) {
    throw malformed(`ExternalShow.${field} exceeds ${MAX_LENGTHS[field]} characters`, context);
  }
  return trimmed;
}

function optionalString(value, field, context) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw malformed(`ExternalShow.${field} must be a string or null`, context);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_LENGTHS[field]) {
    throw malformed(`ExternalShow.${field} exceeds ${MAX_LENGTHS[field]} characters`, context);
  }
  return trimmed;
}

/**
 * Validate a provider wall-clock show time and canonicalize it.
 *
 * @param {unknown} value Raw value from the adapter.
 * @param {object} [context] provider / integrationId, for the error.
 * @returns {string} 'YYYY-MM-DDTHH:mm:ss'
 * @throws {PosMalformedResponseError}
 */
function normalizeShowTimeLocal(value, context = {}) {
  if (value instanceof Date) {
    throw malformed(
      'ExternalShow.showTimeLocal must be a wall-clock string, not a Date. A Date is an ' +
        'absolute instant, so the adapter has already applied a timezone conversion. ' +
        'Conversion belongs to the Phase B5 sync service.',
      context
    );
  }
  if (typeof value !== 'string') {
    throw malformed('ExternalShow.showTimeLocal must be a string', context);
  }

  const raw = value.trim();
  if (HAS_OFFSET.test(raw)) {
    throw malformed(
      `ExternalShow.showTimeLocal must be provider wall clock without a UTC offset, got "${raw}". ` +
        'Adapters return the cinema-local time as the POS expressed it; the Phase B5 sync ' +
        'service converts it to a UTC instant.',
      context
    );
  }

  const match = WALL_CLOCK.exec(raw);
  if (!match) {
    throw malformed(
      `ExternalShow.showTimeLocal must match YYYY-MM-DDTHH:mm[:ss], got "${raw}"`,
      context
    );
  }

  const [, year, month, day, hour, minute, second = '00'] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  const valid =
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    dayNumber >= 1 &&
    dayNumber <= daysInMonth(Number(year), monthNumber) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59;

  if (!valid) {
    throw malformed(`ExternalShow.showTimeLocal is not a real date/time: "${raw}"`, context);
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Normalize one raw adapter result into an ExternalShow.
 *
 * Adapters call this as their last step so that every provider is held to the
 * same contract, and so a provider-shaped mistake surfaces as a
 * PosMalformedResponseError at the boundary instead of a constraint violation
 * during the B5 upsert.
 *
 * @param {unknown} raw
 * @param {object} [context] { provider, integrationId } for error diagnostics.
 * @returns {ExternalShow}
 * @throws {PosMalformedResponseError}
 */
function normalizeExternalShow(raw, context = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw malformed('ExternalShow must be an object', context);
  }

  if (raw.cancelled !== undefined && typeof raw.cancelled !== 'boolean') {
    throw malformed('ExternalShow.cancelled must be a boolean when present', context);
  }

  return {
    externalSessionId: requiredString(raw.externalSessionId, 'externalSessionId', context),
    externalScreenId: optionalString(raw.externalScreenId, 'externalScreenId', context),
    externalFilmId: optionalString(raw.externalFilmId, 'externalFilmId', context),
    filmTitle: requiredString(raw.filmTitle, 'filmTitle', context),
    showTimeLocal: normalizeShowTimeLocal(raw.showTimeLocal, context),
    cancelled: raw.cancelled === true,
  };
}

/**
 * Normalize a whole adapter result set.
 *
 * An empty array in is an empty array out. Zero shows is a successful sync of a
 * quiet window, never a failure - see the note in posErrors.js.
 *
 * @param {unknown} rawList
 * @param {object} [context]
 * @returns {ExternalShow[]}
 * @throws {PosMalformedResponseError}
 */
function normalizeExternalShows(rawList, context = {}) {
  if (!Array.isArray(rawList)) {
    throw malformed('fetchShows must resolve to an array of shows', context);
  }
  return rawList.map((raw) => normalizeExternalShow(raw, context));
}

module.exports = {
  MAX_LENGTHS,
  normalizeShowTimeLocal,
  normalizeExternalShow,
  normalizeExternalShows,
};
