'use strict';

/**
 * Request schemas for the /api/sessions endpoints.
 *
 * Read-only, so there is no create or update body. A session is addressed by
 * the source system's numeric session id.
 */

const Joi = require('joi');

const { id, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = [
  'sessionId',
  'startsAt',
  'endsAt',
  'filmCode',
  'filmTitle',
  'screenName',
  'status',
];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('startsAt'),
    cinemaId: id,
    filmCode: Joi.string().trim().max(20),
    // Bounds on startsAt, so the list can be narrowed to a day's programming.
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }),
};

const getById = {
  params: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
};

module.exports = { list, getById };
