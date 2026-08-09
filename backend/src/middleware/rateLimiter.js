'use strict';

/**
 * Rate limiting for the API surface.
 *
 * Disabled under NODE_ENV=test so the suite is not throttled. Phase 2 should
 * add a tighter limiter for credential endpoints (login, password reset)
 * alongside the routes that need it.
 */

const rateLimit = require('express-rate-limit');

const env = require('../config/env');
const logger = require('../config/logger');
const { error: errorResponse } = require('../utils/response');
const { ERROR_CODES } = require('../constants');

const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,

  // Probes must never be throttled - a limiter that blocks the readiness check
  // turns a traffic spike into a failed deployment.
  skip: (req) => env.isTest || ['/health', '/ready', '/version'].includes(req.path),

  handler(req, res) {
    logger.warn('Rate limit exceeded', { requestId: req.id, ip: req.ip, path: req.originalUrl });

    return errorResponse(res, {
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests, please try again later',
    });
  },
});

module.exports = apiLimiter;
