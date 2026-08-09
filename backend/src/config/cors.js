'use strict';

/**
 * CORS options built from CORS_ALLOWED_ORIGINS (comma-separated) and
 * CORS_ALLOW_CREDENTIALS.
 *
 * An empty CORS_ALLOWED_ORIGINS means "same-origin / non-browser clients only":
 * requests without an Origin header (curl, server-to-server, health probes)
 * still pass, but no browser origin is granted access. That is the safe default
 * - it is deliberately not a wildcard.
 */

const env = require('./env');
const logger = require('./logger');

const { allowedOrigins, allowCredentials } = env.cors;

if (allowedOrigins.length === 0) {
  logger.warn(
    'CORS_ALLOWED_ORIGINS is empty - no browser origin will be allowed. ' +
      'Set it to a comma-separated list of origins.'
  );
}

const corsOptions = {
  origin(origin, callback) {
    // No Origin header: not a browser cross-origin request.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(null, false);
  },
  credentials: allowCredentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400,
};

module.exports = corsOptions;
