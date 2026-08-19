'use strict';

/**
 * Request id + request logging.
 *
 * Assigns every request an id (echoed back as X-Request-Id) and logs one line
 * per completed request on the 'finish' event, so the status code and duration
 * are known. The id is what ties an error response a user is looking at to the
 * log line that explains it.
 *
 * An inbound X-Request-Id is honoured so a trace started at the gateway or in a
 * frontend survives into the backend logs.
 *
 * Level is chosen by status: 5xx -> error, 4xx -> warn, everything else -> http.
 * Probes are logged at debug; a health check every few seconds would otherwise
 * bury real traffic.
 */

const { randomUUID } = require('crypto');

const logger = require('../config/logger');

const HEADER = 'X-Request-Id';
const MAX_INBOUND_LENGTH = 128;
const QUIET_PATHS = new Set(['/health', '/ready', '/version']);

function levelFor(statusCode, path) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  if (QUIET_PATHS.has(path)) return 'debug';
  return 'http';
}

function requestLogger() {
  return function requestLoggerMiddleware(req, res, next) {
    const inbound = req.get(HEADER);
    req.id = inbound && inbound.length <= MAX_INBOUND_LENGTH ? inbound : randomUUID();
    res.setHeader(HEADER, req.id);

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      logger.log(levelFor(res.statusCode, req.path), `${req.method} ${req.originalUrl}`, {
        requestId: req.id,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        ip: req.ip,
        userId: req.user ? req.user.id : undefined,
      });
    });

    next();
  };
}

module.exports = requestLogger;
