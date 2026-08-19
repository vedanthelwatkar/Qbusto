'use strict';

/**
 * Request schemas for the /api/product-availability-hours endpoints.
 *
 * The parent is `cinemaProductId`, not `productId`: the schema hangs
 * availability off cinema_products, so a window applies to one product *at one
 * cinema* rather than to the product everywhere.
 */

const Joi = require('joi');

const { id, idParam, dayOfWeek, timeOfDay, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'cinemaProductId', 'dayOfWeek', 'startTime', 'endTime', 'createdAt'];

/**
 * startTime must be strictly before endTime.
 *
 * Compared as normalised `HH:MM:SS` strings, where lexicographic order is
 * chronological order. The sibling is normalised again here because key order
 * during validation is not something to rely on - `startTime` may still be in
 * its raw `HH:MM` form when this runs.
 *
 * Note this rules out an overnight window such as 22:00 -> 02:00, which the
 * frozen model and migration both comment as deliberately permitted. See
 * services/availability.service for the consequence.
 */
const normalise = (value) =>
  typeof value === 'string' && value.length === 5 ? `${value}:00` : value;

const timeRange = {
  startTime: timeOfDay.required(),
  endTime: timeOfDay
    .required()
    .custom((value, helpers) => {
      const startTime = normalise(helpers.state.ancestors[0].startTime);

      return startTime && value <= startTime ? helpers.error('any.invalid') : value;
    })
    .messages({ 'any.invalid': "'endTime' must be later than 'startTime'" }),
};

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('id'),
    cinemaProductId: id,
    dayOfWeek,
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaProductId: id.required(),
    dayOfWeek: dayOfWeek.required(),
    ...timeRange,
  }),
};

const update = {
  params: idParam,
  // `cinemaProductId` is absent on purpose: a window belongs to the cinema
  // product it was created for.
  //
  // Both times are required together even though this is a PUT of one row:
  // validating one new time against the other stored one would need the row
  // loaded, and a half-specified range has no meaning.
  body: Joi.object({
    dayOfWeek: dayOfWeek.required(),
    ...timeRange,
  }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
