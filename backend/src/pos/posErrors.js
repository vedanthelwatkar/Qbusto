'use strict';

/**
 * Provider-neutral POS adapter error taxonomy (Phase B2).
 *
 * The sync service (Phase B5) must be able to tell four outcomes apart without
 * knowing which provider it was talking to:
 *
 *   1. the provider failed or could not be reached  -> PosProviderUnavailableError
 *   2. the integration is configured wrongly        -> PosConfigurationError
 *   3. the provider answered, but unusably          -> PosMalformedResponseError
 *   4. the provider answered with no shows          -> NOT an error; `[]`
 *
 * Outcome 4 is stated here deliberately: an empty window is the normal state
 * outside opening hours. An adapter that throws on zero shows would make B5
 * treat a quiet cinema as an outage and - worse, per §6.3 - suppress the
 * cancellation pass that a *successful* empty sync is supposed to trigger.
 *
 * Provider neutrality rules for adapters raising these:
 *
 * - Never encode an HTTP status, SOAP fault code or provider error string in
 *   the class choice. Map the provider's failure onto the taxonomy instead.
 * - Never put credentials, tokens, auth headers or raw provider payloads in
 *   `message`, per the integration reliability and logging rules. `message` is
 *   read by humans in logs and may
 *   reach an operator-facing screen.
 * - Attach the underlying error as `cause` for diagnostics only. It is not part
 *   of `details`, so the error middleware never serializes it to a client.
 *
 * These extend AppError so that if one ever escapes to a route - a manual sync
 * endpoint in B5, the Dashboard health view in B8 - the existing error
 * middleware handles it safely rather than turning it into a leaked 500.
 * `posCode` is the authoritative discriminator; the HTTP status is a safe
 * default, and mapping POS failures onto HTTP responses is B5/B8's decision,
 * not the adapter's.
 */

const { AppError } = require('../utils/errors');
const { ERROR_CODES } = require('../constants');

/** Discriminators for the four adapter failure modes. */
const POS_ERROR_CODES = Object.freeze({
  PROVIDER_UNAVAILABLE: 'POS_PROVIDER_UNAVAILABLE',
  INVALID_CONFIGURATION: 'POS_INVALID_CONFIGURATION',
  MALFORMED_RESPONSE: 'POS_MALFORMED_RESPONSE',
  PROVIDER_NOT_SUPPORTED: 'POS_PROVIDER_NOT_SUPPORTED',
});

const POS_ERROR_CODE_VALUES = Object.freeze(Object.values(POS_ERROR_CODES));

/**
 * Base class for every failure crossing the adapter boundary.
 *
 * `instanceof PosAdapterError` is how B5 will separate "the POS layer failed"
 * from a bug, without listing subclasses.
 */
class PosAdapterError extends AppError {
  /**
   * @param {string} message   Provider-neutral, safe to log. No secrets.
   * @param {object} [options]
   * @param {string} [options.posCode]    One of POS_ERROR_CODES.
   * @param {string|null} [options.provider]  pos_integrations.provider, if known.
   * @param {number|null} [options.integrationId] pos_integrations.id, if known.
   * @param {string|null} [options.operation] Adapter method, e.g. 'fetchShows'.
   * @param {Error|null} [options.cause]  Underlying error, diagnostics only.
   * @param {number} [options.statusCode] Safe HTTP default if this ever escapes.
   * @param {string} [options.code]       ERROR_CODES value for the envelope.
   */
  constructor(message, options = {}) {
    const {
      posCode = POS_ERROR_CODES.PROVIDER_UNAVAILABLE,
      provider = null,
      integrationId = null,
      operation = null,
      cause = null,
      statusCode = 503,
      code = ERROR_CODES.SERVICE_UNAVAILABLE,
    } = options;

    // `details` stays null on purpose: it is the only part of an AppError the
    // error middleware puts on the wire, and nothing below belongs to a client.
    super(message, statusCode, code, null);

    this.posCode = posCode;
    this.provider = provider;
    this.integrationId = integrationId;
    this.operation = operation;
    this.cause = cause;
  }

  /**
   * The safe shape for structured logging: identifiers and outcome only, never
   * the message of the underlying provider error, per the logging rules.
   */
  toLogContext() {
    return {
      posCode: this.posCode,
      provider: this.provider,
      integrationId: this.integrationId,
      operation: this.operation,
    };
  }
}

/**
 * The provider could not be reached, timed out, or returned a failure.
 *
 * Deliberately covers both definitive failures and ambiguous ones. An adapter
 * that cannot tell whether a request reached the provider should set
 * `ambiguous: true` so the sync service can honour the idempotency and retry
 * rules and refuse to blindly
 * retry. `fetchShows` is a read and is safe to retry; the flag exists because
 * the same taxonomy will carry write operations later.
 */
class PosProviderUnavailableError extends PosAdapterError {
  constructor(message = 'POS provider is unavailable', options = {}) {
    super(message, {
      ...options,
      posCode: POS_ERROR_CODES.PROVIDER_UNAVAILABLE,
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
    this.ambiguous = options.ambiguous === true;
  }
}

/**
 * The integration row itself is unusable: missing api_url, a credential_ref
 * that resolves to nothing, config that does not parse.
 *
 * This is operator error, not client error and not a provider outage. Retrying
 * cannot fix it, so B5 must not treat it as a transient failure. 500 rather
 * than 400: no client supplied this input.
 */
class PosConfigurationError extends PosAdapterError {
  constructor(message = 'POS integration is not configured correctly', options = {}) {
    super(message, {
      ...options,
      posCode: POS_ERROR_CODES.INVALID_CONFIGURATION,
      statusCode: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
}

/**
 * The provider answered, but the payload cannot be normalized - a missing
 * session id, an unparseable show time, a body that is not the expected shape.
 *
 * Distinct from PROVIDER_UNAVAILABLE because the connection worked: the fault
 * is in the data, and retrying the same window will usually reproduce it.
 */
class PosMalformedResponseError extends PosAdapterError {
  constructor(message = 'POS provider returned an unusable response', options = {}) {
    super(message, {
      ...options,
      posCode: POS_ERROR_CODES.MALFORMED_RESPONSE,
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
    });
  }
}

/**
 * No adapter is registered for the integration's provider.
 *
 * Raised by the registry, not by an adapter. It exists so that a provider the
 * *database* accepts but the *application* cannot talk to fails loudly instead
 * of silently syncing nothing - see src/pos/providerRegistry.js.
 */
class PosProviderNotSupportedError extends PosAdapterError {
  constructor(message = 'No POS adapter is registered for this provider', options = {}) {
    super(message, {
      ...options,
      posCode: POS_ERROR_CODES.PROVIDER_NOT_SUPPORTED,
      statusCode: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
}

module.exports = {
  POS_ERROR_CODES,
  POS_ERROR_CODE_VALUES,
  PosAdapterError,
  PosProviderUnavailableError,
  PosConfigurationError,
  PosMalformedResponseError,
  PosProviderNotSupportedError,
};
