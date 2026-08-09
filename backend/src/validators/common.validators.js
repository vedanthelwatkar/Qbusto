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

module.exports = { id, idParam, paginationQuery };
