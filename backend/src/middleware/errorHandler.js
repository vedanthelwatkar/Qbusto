'use strict';

/**
 * Global error handler. Must be registered last.
 *
 * Translates everything that reaches it into the standard error envelope:
 *   - AppError subclasses are trusted and passed through as-is.
 *   - Joi, Sequelize, jsonwebtoken and body-parser errors are recognised and
 *     mapped to sensible statuses.
 *   - Anything else is a bug: logged with a stack trace, and reported to the
 *     client as a generic 500 so internals are not leaked.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route handlers do not need a try/catch or an asyncHandler wrapper.
 */

const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { BaseError: SequelizeBaseError } = require('sequelize');

const env = require('../config/env');
const logger = require('../config/logger');
const {
  AppError,
  ValidationError,
  ConflictError,
  ServiceUnavailableError,
  AuthenticationError,
} = require('../utils/errors');
const { error: errorResponse } = require('../utils/response');
const { ERROR_CODES } = require('../constants');

/** Map a non-AppError into one, or return null if it is not recognised. */
function normalise(err) {
  // ---- Joi, when a schema is validated outside validate() middleware -------
  if (Joi.isError(err)) {
    return new ValidationError(
      'Request validation failed',
      err.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, "'"),
      }))
    );
  }

  // ---- jsonwebtoken, if a token is verified outside utils/jwt -------------
  if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
    return err instanceof jwt.TokenExpiredError
      ? new AuthenticationError('Authentication token has expired', ERROR_CODES.TOKEN_EXPIRED)
      : new AuthenticationError('Invalid authentication token');
  }

  // ---- Sequelize -----------------------------------------------------------
  if (err instanceof SequelizeBaseError) {
    switch (err.name) {
      case 'SequelizeUniqueConstraintError':
        return new ConflictError(
          'A record with these values already exists',
          (err.errors || []).map((item) => ({ field: item.path, message: item.message }))
        );

      case 'SequelizeValidationError':
        return new ValidationError(
          'Request validation failed',
          (err.errors || []).map((item) => ({ field: item.path, message: item.message }))
        );

      case 'SequelizeForeignKeyConstraintError':
        return new ConflictError('A referenced record is missing or still in use');

      case 'SequelizeConnectionError':
      case 'SequelizeConnectionRefusedError':
      case 'SequelizeHostNotFoundError':
      case 'SequelizeHostNotReachableError':
      case 'SequelizeConnectionTimedOutError':
        return new ServiceUnavailableError('Database is unavailable');

      default:
        return null; // Unexpected DB error - treat as a bug.
    }
  }

  // ---- body-parser: malformed JSON ----------------------------------------
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return new ValidationError('Request body is not valid JSON');
  }

  return null;
}

// `next` is unused but required: Express identifies error handlers by arity.
function errorHandler(err, req, res, next) {
  const appError = err instanceof AppError ? err : normalise(err);

  if (appError) {
    // Expected outcome. Log at warn so it is visible without being alarming.
    logger.warn(`${appError.code}: ${appError.message}`, {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: appError.statusCode,
      userId: req.user ? req.user.id : undefined,
    });

    return errorResponse(res, {
      message: appError.message,
      statusCode: appError.statusCode,
      code: appError.code,
      details: appError.details,
    });
  }

  // Unrecognised: a bug, a broken dependency, or an unmapped library error.
  logger.error(err.message || 'Unhandled error', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    name: err.name,
    stack: err.stack,
    userId: req.user ? req.user.id : undefined,
  });

  return errorResponse(res, {
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: env.isProduction ? 'An unexpected error occurred' : err.message || 'Unhandled error',
    details: env.isProduction ? null : { name: err.name, stack: err.stack },
  });
}

module.exports = errorHandler;
