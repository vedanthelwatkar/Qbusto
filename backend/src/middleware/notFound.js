'use strict';

/**
 * Catch-all for unmatched routes. Registered after all routers and before the
 * error handler.
 *
 * Implemented as plain middleware rather than app.all('*', ...) - Express 5's
 * new path matcher no longer accepts a bare '*' pattern.
 */

const { NotFoundError } = require('../utils/errors');

function notFound() {
  return function notFoundMiddleware(req, res, next) {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
  };
}

module.exports = notFound;
