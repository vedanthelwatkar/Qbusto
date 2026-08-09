'use strict';

/**
 * Reusable Joi building blocks.
 *
 * Phase 2 resource validators should compose these rather than redefining an id
 * or a pagination block per module.
 */

const Joi = require('joi');

const { PAGINATION } = require('../constants');

/** A positive integer primary key. */
const id = Joi.number().integer().positive();

/**
 * A plaintext password on its way to the User model's hashing hook.
 * Capped at 72 because bcrypt silently ignores anything past 72 bytes - a
 * longer password would give a false sense of strength.
 */
const password = Joi.string().min(8).max(72);

/**
 * An optional free-text field stored as a nullable varchar.
 *
 * Both `''` and `null` clear the field, and both arrive at the model as `null` -
 * one column should not hold two different spellings of "empty", or a later
 * `WHERE city IS NULL` silently misses the rows that were cleared with `''`.
 * Whitespace-only input counts as empty, since it trims to nothing.
 *
 * Written as an explicit coercion rather than the more obvious
 * `.allow(null, '')` or `.empty('').default(null)`, because neither does the
 * right thing here: values listed in `allow()` skip every later rule, so a
 * `custom()` mapping would never see `''`; and `default(null)` fires for absent
 * keys too, which on a partial update would blank every field the request did
 * not mention. Omitted keys must stay omitted - only a key that is actually
 * present may clear its column.
 *
 * `messages()` restores the two native string errors that `Joi.any()` does not
 * define, worded exactly as Joi words them, so error responses are unchanged.
 */
const optionalText = (max) =>
  Joi.any()
    .custom((value, helpers) => {
      if (value === null) return null;
      if (typeof value !== 'string') return helpers.error('string.base');

      const trimmed = value.trim();
      if (trimmed === '') return null;
      if (trimmed.length > max) return helpers.error('string.max', { limit: max });

      return trimmed;
    })
    .messages({
      'string.base': '{{#label}} must be a string',
      'string.max': '{{#label}} length must be less than or equal to {{#limit}} characters long',
    });

/** `{ id }` route params, e.g. GET /products/:id */
const idParam = Joi.object({
  id: id.required(),
});

/**
 * Standard list query: ?page=1&limit=20&sort=createdAt&order=desc&search=foo
 * `limit` is capped at PAGINATION.MAX_LIMIT so a client cannot ask for the
 * whole table.
 */
const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  sort: Joi.string().max(50),
  order: Joi.string().lowercase().valid('asc', 'desc').default('asc'),
  search: Joi.string().trim().max(200).allow(''),
});

module.exports = { id, idParam, password, optionalText, paginationQuery };
