'use strict';

/**
 * The POS adapter contract (Phase B2).
 *
 * A POS adapter is a plain object with a `provider` string and a `fetchShows`
 * method. That is the whole contract - there is no base class to extend and no
 * factory to call - see docs/pos-integration.md §5. A provider
 * implementation is a module that builds such an object and registers it.
 *
 *   fetchShows(integration, range) -> Promise<ExternalShow[]>
 *
 * Everything provider-specific - transport, authentication, retries, pagination,
 * response quirks, error mapping - lives inside `fetchShows`. Nothing above the
 * adapter may branch on `provider`; the sync service resolves an adapter from
 * the registry and calls it, and that is the only place the provider value is
 * read.
 *
 * WHAT AN ADAPTER MUST DO
 *
 * - Return `ExternalShow[]`, normalized through `normalizeExternalShows`.
 * - Return `[]` when the provider succeeds with no shows in the window. Zero
 *   shows is a successful result, never an error - §6.3 depends on the
 *   difference, because only a *successful* empty sync may cancel shows.
 * - Throw a provider-neutral error from `posErrors.js` on any failure.
 * - Leave the show time in the provider's cinema-local wall clock.
 *
 * WHAT AN ADAPTER MUST NOT DO
 *
 * - Convert timezones. `showTimeLocal` is wall clock; the Phase B5 sync service
 *   converts it once, centrally, per the timezone rule in the development
 *   guide. `normalizeShowTimeLocal`
 *   rejects any value carrying an offset, so a converting adapter fails.
 * - Touch the database. An adapter reads the POS and returns data; mapping,
 *   upserting and reconciliation are B5's job.
 * - Leak provider error text, credentials or raw payloads into error messages
 *   or logs, per the integration reliability and logging rules.
 * - Cancel, retry-forever or otherwise make policy decisions. It reports the
 *   outcome; B5 decides what to do about it.
 *
 * No adapter exists yet. Vista (B3) and Showbiz (B4) are blocked on provider
 * documentation and credentials - decision register §12.3.
 */

const { PosConfigurationError } = require('./posErrors');

/**
 * @typedef {import('./externalShow').ExternalShow} ExternalShow
 */

/**
 * The synchronization window, as UTC instants.
 *
 * The window is computed from the server clock by the caller (§6.6) and is the
 * same for every provider, which is why it is expressed in UTC rather than in
 * any cinema's local time.
 *
 * An adapter whose provider requires a *local-time* window must be given that
 * window by the sync service rather than deriving it - deriving it would put
 * timezone logic back inside the adapter. How B5 supplies it is open item
 * §12.13 and is deliberately not decided here.
 *
 * @typedef {object} ShowWindow
 * @property {Date} fromUtc Inclusive start.
 * @property {Date} toUtc Inclusive end.
 */

/**
 * @typedef {object} PosAdapter
 * @property {string} provider A pos_integrations.provider value. Verified
 *   against the registration key by `assertPosAdapter`.
 * @property {(integration: object, range: ShowWindow) => Promise<ExternalShow[]>} fetchShows
 */

/** Methods every adapter must implement. One entry today; the list is the contract. */
const REQUIRED_METHODS = Object.freeze(['fetchShows']);

/**
 * Assert that an object satisfies the adapter contract.
 *
 * Called by the registry at registration time so a malformed adapter fails when
 * the process wires itself up, not on the first sync tick at 3am.
 *
 * When an expected `provider` is supplied, the adapter's own `provider` must
 * match it. Without that check the `provider` field would be documentation
 * rather than contract, and registering an adapter under the wrong key would
 * succeed silently - routing one chain's cinemas to another POS's client, which
 * surfaces as wrong show data rather than as an error. This is precisely the
 * mistake the registry exists to prevent.
 *
 * @param {unknown} adapter
 * @param {string} [provider] Expected provider. Omit to check shape only.
 * @throws {PosConfigurationError}
 */
function assertPosAdapter(adapter, provider = null) {
  const label = provider ? `POS adapter for "${provider}"` : 'POS adapter';

  if (adapter === null || typeof adapter !== 'object') {
    throw new PosConfigurationError(`${label} must be an object`, { provider });
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new PosConfigurationError(`${label} must implement ${method}()`, { provider });
    }
  }

  // Checked after the shape, so an adapter missing fetchShows still reports the
  // more fundamental problem first.
  if (provider !== null && adapter.provider !== provider) {
    throw new PosConfigurationError(
      `${label} declares a different provider: "${adapter.provider}"`,
      { provider }
    );
  }
}

/**
 * Validate a show window before handing it to an adapter.
 *
 * Exists so every provider rejects a nonsensical window identically instead of
 * each one inventing its own guard - or worse, passing it through and asking
 * the POS for a backwards range.
 *
 * @param {unknown} range
 * @param {object} [context] { provider, integrationId } for the error.
 * @throws {PosConfigurationError}
 */
function assertShowWindow(range, context = {}) {
  const invalid = (message) =>
    new PosConfigurationError(message, { ...context, operation: 'fetchShows' });

  if (range === null || typeof range !== 'object') {
    throw invalid('Show window must be an object with fromUtc and toUtc');
  }

  for (const field of ['fromUtc', 'toUtc']) {
    const value = range[field];
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw invalid(`Show window ${field} must be a valid Date`);
    }
  }

  if (range.fromUtc.getTime() > range.toUtc.getTime()) {
    throw invalid('Show window fromUtc must not be after toUtc');
  }
}

module.exports = {
  REQUIRED_METHODS,
  assertPosAdapter,
  assertShowWindow,
};
