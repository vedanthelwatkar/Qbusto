'use strict';

/**
 * Application error classes.
 *
 * Anything thrown from a route, service or repository should be one of these.
 * The global error handler reads `statusCode`, `code` and `details` off them to
 * build a consistent response body; anything else that reaches the handler is
 * treated as an unexpected 500 and its message is not leaked to the client.
 *
 * `isOperational` marks errors we anticipated (bad input, missing row, denied
 * access) as opposed to bugs. Only non-operational errors are logged at error
 * level with a stack trace.
 */

const { ERROR_CODES } = require('../constants');

class AppError extends Error {
  /**
   * @param {string} message      Safe to show the client.
   * @param {number} statusCode   HTTP status.
   * @param {string} code         Machine-readable code from ERROR_CODES.
   * @param {Array|object|null} details Optional field-level detail.
   */
  constructor(message, statusCode = 500, code = ERROR_CODES.INTERNAL_ERROR, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 - the request was understood but the payload is not acceptable. */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, ERROR_CODES.VALIDATION_ERROR, details);
  }
}

/** 401 - no credentials, or credentials that do not verify. */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', code = ERROR_CODES.AUTHENTICATION_ERROR) {
    super(message, 401, code);
  }
}

/** 403 - credentials verified, but this principal may not do this. */
class AuthorizationError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    code = ERROR_CODES.AUTHORIZATION_ERROR,
    details = null
  ) {
    super(message, 403, code, details);
  }
}

/** 404 - addressed resource does not exist. */
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, ERROR_CODES.NOT_FOUND);
  }
}

/** 409 - the request conflicts with current state (duplicate key, etc.). */
class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details = null) {
    super(message, 409, ERROR_CODES.CONFLICT, details);
  }
}

/** 503 - a dependency the request needs is down. */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details = null) {
    super(message, 503, ERROR_CODES.SERVICE_UNAVAILABLE, details);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError,
};
