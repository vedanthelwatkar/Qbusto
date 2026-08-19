'use strict';

/**
 * CORS options built from CORS_ALLOWED_ORIGINS (comma-separated) and
 * CORS_ALLOW_CREDENTIALS.
 *
 * An empty CORS_ALLOWED_ORIGINS means "same-origin / non-browser clients only":
 * requests without an Origin header (curl, server-to-server, health probes)
 * still pass, but no browser origin is granted access. That is the safe default
 * - it is deliberately not a wildcard.
 *
 * A single "*" entry allows every browser origin. It is a development
 * convenience and must not reach production - see the warning below.
 */

const env = require('./env');
const logger = require('./logger');

const { allowedOrigins, allowCredentials } = env.cors;

/** "*" is matched here rather than compared as a literal origin string. */
const allowAllOrigins = allowedOrigins.includes('*');

if (allowedOrigins.length === 0) {
  logger.warn(
    'CORS_ALLOWED_ORIGINS is empty - no browser origin will be allowed. ' +
      'Set it to a comma-separated list of origins.'
  );
} else if (allowAllOrigins) {
  const message =
    'CORS_ALLOWED_ORIGINS is "*" - EVERY browser origin is allowed' +
    (allowCredentials ? ', with credentials' : '') +
    '. Development convenience only; set an explicit origin list before deploying.';

  // Loud in production, because combined with credentials this lets any site a
  // logged-in user visits call the API with their session.
  if (env.isProduction) logger.error(message);
  else logger.warn(message);
} else {
  logger.info('CORS allowed origins', { origins: allowedOrigins });
}

const corsOptions = {
  origin(origin, callback) {
    // No Origin header: not a browser cross-origin request.
    if (!origin) return callback(null, true);

    // Reflect the caller's origin instead of returning a literal '*'. A literal
    // wildcard is rejected by browsers whenever credentials are enabled, so
    // reflecting is the only form of "allow all" that works in both modes.
    if (allowAllOrigins) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(null, false);
  },
  credentials: allowCredentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Idempotency-Key is required by POST /api/consumer/orders, so it must be
  // permitted at preflight or the consumer app can never create an order.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400,
};

module.exports = corsOptions;
