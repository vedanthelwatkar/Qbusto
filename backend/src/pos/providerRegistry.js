'use strict';

/**
 * POS provider registry (Phase B2).
 *
 * A `Map` from `pos_integrations.provider` to a PosAdapter. That is all it is -
 * docs/pos-integration.md §5 explicitly chose a registry over a factory or a
 * base-class hierarchy, and the architecture rules forbid adding layers
 * without a demonstrated need. Provider selection is one lookup:
 *
 *   const adapter = getAdapter(integration.provider);
 *   const shows = await adapter.fetchShows(integration, range);
 *
 * This is the only place in the backend that reads the provider value. Adding
 * Vista or Showbiz later must not require an edit anywhere above this line.
 *
 * DATABASE SUPPORT IS NOT APPLICATION SUPPORT
 *
 * `pos_integrations.provider` accepts four values today (vista, showbizz,
 * impact, qbusto - note the double-z, which is what the frozen CHECK constraint
 * contains). None of them has an adapter. A provider being storable says the
 * schema will hold the row; it says nothing about whether the application can
 * talk to that POS.
 *
 * So the registry starts empty and `getAdapter` throws
 * PosProviderNotSupportedError for every provider until B3/B4 register one.
 * Failing loudly is the point: an integration row that quietly synced nothing
 * would look, from the Dashboard and the Consumer dropdown, exactly like a
 * cinema with no shows scheduled.
 *
 * The two failure cases are distinguished, because they need different fixes:
 *
 *   unknown provider value      -> bad data, or a schema change not mirrored
 *                                  into src/constants.js
 *   known value, no adapter     -> the phase implementing it is not done yet
 */

const { POS_PROVIDER_NAMES } = require('../constants');
const { PosProviderNotSupportedError, PosConfigurationError } = require('./posErrors');
const { assertPosAdapter } = require('./adapter');

/**
 * @typedef {import('./adapter').PosAdapter} PosAdapter
 */

/** provider -> PosAdapter. Empty in B2; B3/B4 populate it at module load. */
const adapters = new Map();

/**
 * Is this a provider the database would accept?
 *
 * @param {unknown} provider
 * @returns {boolean}
 */
function isKnownProvider(provider) {
  return typeof provider === 'string' && POS_PROVIDER_NAMES.includes(provider);
}

/**
 * Register an adapter for a provider.
 *
 * Rejects unknown providers and malformed adapters at wiring time. Rejects a
 * duplicate registration too: two modules claiming the same provider is a
 * mistake, and silently keeping the last one loaded would make behaviour depend
 * on require order.
 *
 * @param {string} provider A pos_integrations.provider value.
 * @param {PosAdapter} adapter
 * @returns {PosAdapter} The registered adapter.
 * @throws {PosProviderNotSupportedError|PosConfigurationError}
 */
function registerAdapter(provider, adapter) {
  // The accepted values are POS_PROVIDER_NAMES in src/constants.js, mirroring
  // CK_pos_integrations_provider. They are deliberately not listed in the
  // message: AppError.message is returned to the client verbatim by
  // errorHandler, and an enumeration of the system's providers is not something
  // to put on the wire, per the error-handling rules.
  if (!isKnownProvider(provider)) {
    throw new PosProviderNotSupportedError(
      `Cannot register an adapter for unknown POS provider "${provider}"`,
      { provider: typeof provider === 'string' ? provider : null }
    );
  }

  if (adapters.has(provider)) {
    throw new PosConfigurationError(
      `A POS adapter is already registered for provider "${provider}"`,
      { provider }
    );
  }

  assertPosAdapter(adapter, provider);
  adapters.set(provider, adapter);
  return adapter;
}

/**
 * Resolve the adapter for a provider.
 *
 * @param {string} provider Normally `integration.provider`.
 * @returns {PosAdapter}
 * @throws {PosProviderNotSupportedError} Always, until an adapter is registered.
 */
function getAdapter(provider) {
  const adapter = adapters.get(provider);
  if (adapter) return adapter;

  // Both messages are client-facing: errorHandler returns AppError.message
  // verbatim. They state the fact and nothing else - no roadmap, no phase
  // numbers, no source paths, no provider enumeration. Which phase implements a
  // given provider is recorded in backend/phases.md and in this module's header
  // comment, which is where a developer looks; it is not something to send to a
  // caller, per the error-handling rules.
  if (isKnownProvider(provider)) {
    throw new PosProviderNotSupportedError(
      `No POS adapter is registered for provider "${provider}"`,
      { provider }
    );
  }

  throw new PosProviderNotSupportedError(`Unknown POS provider "${provider}"`, {
    provider: typeof provider === 'string' ? provider : null,
  });
}

/**
 * Whether a provider can currently be synchronized.
 *
 * For callers that need to skip or report an unsupported integration rather
 * than fail - the Dashboard health view (B8), or a B5 sync run iterating every
 * active integration.
 *
 * @param {string} provider
 * @returns {boolean}
 */
function hasAdapter(provider) {
  return adapters.has(provider);
}

/**
 * Providers with a registered adapter, in registration order.
 *
 * @returns {string[]}
 */
function registeredProviders() {
  return [...adapters.keys()];
}

/**
 * Remove a registration.
 *
 * Production code never calls this - an adapter registered at load time stays
 * for the life of the process. It exists so tests can register a test double
 * and clean up after themselves, since the Map is module-level state shared
 * across a test file.
 *
 * @param {string} provider
 * @returns {boolean} True if an adapter was removed.
 */
function unregisterAdapter(provider) {
  return adapters.delete(provider);
}

module.exports = {
  isKnownProvider,
  registerAdapter,
  getAdapter,
  hasAdapter,
  registeredProviders,
  unregisterAdapter,
};
