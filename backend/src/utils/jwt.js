'use strict';

/**
 * JWT signing and verification.
 *
 * Token payloads carry identity only - never permissions. Permissions are read
 * from the database on every request (see middleware/authenticate.js) so that
 * revoking access takes effect immediately rather than at token expiry.
 */

const jwt = require('jsonwebtoken');

const env = require('../config/env');
const { AuthenticationError } = require('./errors');
const { ERROR_CODES } = require('../constants');

const SIGN_OPTIONS = {
  algorithm: 'HS256',
  expiresIn: env.jwt.expiresIn,
  issuer: env.jwt.issuer,
};

/** Must mirror SIGN_OPTIONS. */
const VERIFY_OPTIONS = {
  algorithms: ['HS256'],
  issuer: env.jwt.issuer,
};

/**
 * Sign an access token.
 *
 * @param {object} payload     Claims to embed. Must identify the user.
 * @param {number} payload.sub User id.
 * @param {object} [overrides] Extra jsonwebtoken sign options.
 * @returns {string}
 */
function generateAccessToken(payload, overrides = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('generateAccessToken requires a payload object');
  }
  if (payload.sub === undefined || payload.sub === null) {
    throw new TypeError('generateAccessToken requires payload.sub (the user id)');
  }

  // jsonwebtoken rejects `sub` inside the payload when also passed as an
  // option, so keep it in the payload and only merge non-conflicting options.
  return jwt.sign({ ...payload, sub: String(payload.sub) }, env.jwt.secret, {
    ...SIGN_OPTIONS,
    ...overrides,
  });
}

/**
 * Verify an access token and return its decoded payload.
 *
 * @param {string} token
 * @returns {object} Decoded payload.
 * @throws {AuthenticationError} When the token is missing, malformed, expired
 *   or fails signature/issuer checks.
 */
function verifyAccessToken(token) {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('No authentication token provided');
  }

  try {
    return jwt.verify(token, env.jwt.secret, VERIFY_OPTIONS);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Authentication token has expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    // NotBeforeError, JsonWebTokenError (bad signature, wrong issuer, malformed)
    // all collapse to the same client-facing message: revealing which check
    // failed only helps an attacker.
    throw new AuthenticationError('Invalid authentication token');
  }
}

/**
 * Pull the bearer token out of an Authorization header.
 *
 * @param {string} [headerValue]
 * @returns {string|null} The token, or null when the header is absent or not a
 *   well-formed `Bearer <token>`.
 */
function extractBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;

  const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
  if (rest.length > 0) return null;
  if (!token || scheme.toLowerCase() !== 'bearer') return null;

  return token;
}

module.exports = { generateAccessToken, verifyAccessToken, extractBearerToken, VERIFY_OPTIONS };
