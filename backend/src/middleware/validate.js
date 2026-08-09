'use strict';

/**
 * Joi request validation.
 *
 *   const schema = { body: Joi.object({ name: Joi.string().required() }) };
 *   router.post('/things', validate(schema), (req, res) => {
 *     const { name } = req.validated.body;
 *   });
 *
 * Validates any of body / query / params that a schema is supplied for,
 * collecting every failure into one 400 rather than stopping at the first.
 *
 * Sanitised values go to `req.validated.{body,query,params}` and nowhere else.
 * Handlers must read from there rather than from req.body - there is one place
 * to look, and Express 5 exposes req.query and req.params as getters that
 * cannot be reassigned anyway.
 */

const Joi = require('joi');

const { ValidationError } = require('../utils/errors');

const SOURCES = ['body', 'query', 'params'];

const JOI_OPTIONS = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
};

/**
 * @param {object} schemas Map of source -> Joi schema. Unlisted sources are
 *   left untouched.
 * @returns {import('express').RequestHandler}
 */
function validate(schemas) {
  if (!schemas || typeof schemas !== 'object') {
    throw new Error('validate() requires an object of { body, query, params } schemas');
  }

  const active = SOURCES.filter((source) => schemas[source]);

  if (active.length === 0) {
    throw new Error(
      `validate() was given no usable schema. Expected one of: ${SOURCES.join(', ')}`
    );
  }

  for (const source of active) {
    if (!Joi.isSchema(schemas[source])) {
      throw new Error(`validate(): schema for "${source}" is not a Joi schema`);
    }
  }

  return function validateMiddleware(req, res, next) {
    const details = [];
    const validated = {};

    for (const source of active) {
      const { value, error } = schemas[source].validate(req[source], JOI_OPTIONS);

      if (error) {
        for (const detail of error.details) {
          details.push({
            source,
            field: detail.path.join('.') || source,
            message: detail.message.replace(/"/g, "'"),
          });
        }
        continue;
      }

      validated[source] = value;
    }

    if (details.length > 0) {
      return next(new ValidationError('Request validation failed', details));
    }

    req.validated = { ...req.validated, ...validated };

    return next();
  };
}

module.exports = validate;
