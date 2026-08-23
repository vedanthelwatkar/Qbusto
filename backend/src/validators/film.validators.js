'use strict';

/**
 * Request schemas for the /api/films endpoints.
 *
 * Read-only, so there is no create or update body. A film is addressed by the
 * source system's `code`, a varchar, not by an integer id of ours.
 */

const Joi = require('joi');

const { paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['code', 'title', 'certification', 'durationMinutes', 'openingDate'];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('title'),
    // Exact match on the provider's raw flag - not interpreted as a boolean.
    // See film.service.js for why: the client's data contains no 'Y' value,
    // so there is no basis for treating one value as "showing" and the rest
    // as not.
    nowShowingFlag: Joi.string().trim().max(1),
  }),
};

const getByCode = {
  params: Joi.object({
    code: Joi.string().trim().max(20).required(),
  }),
};

module.exports = { list, getByCode };
