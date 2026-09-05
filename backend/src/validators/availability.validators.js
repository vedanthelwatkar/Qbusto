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
 * `endTime` must not EQUAL `startTime` - a window needs positive width, or it
 * matches no instant at all (see isWithinDailyWindow's zero-width rule).
 *
 * `endTime` earlier than `startTime` is explicitly ALLOWED: that is an
 * overnight window (22:00 -> 02:00), which the frozen model, the migration,
 * and utils/businessDay.isWithinDailyWindow / dailyWindowsOverlap all already
 * treat as first-class - a window that runs past midnight, not an error. This
 * validator used to reject it (`endTime <= startTime`), which was the actual
 * bug: nothing downstream ever needed that restriction, and it made the
 * client's own 22:00-02:00-shaped data impossible to enter through the API,
 * forcing the two-row midnight-split workaround this task's live-data fix
 * cleans up (see the header on 20260906000300-fix-overnight-availability.js).
 *
 * Compared as normalised `HH:MM:SS` strings. The sibling is normalised again
 * here because key order during validation is not something to rely on -
 * `startTime` may still be in its raw `HH:MM` form when this runs.
 */
const normalise = (value) =>
  typeof value === 'string' && value.length === 5 ? `${value}:00` : value;

const timeRange = {
  startTime: timeOfDay.required(),
  endTime: timeOfDay
    .required()
    .custom((value, helpers) => {
      const startTime = normalise(helpers.state.ancestors[0].startTime);

      return startTime && value === startTime ? helpers.error('any.invalid') : value;
    })
    .messages({
      'any.invalid':
        "'endTime' must not equal 'startTime' - a window needs positive width. " +
        "To span midnight, set 'endTime' earlier than 'startTime' (e.g. 22:00 -> 02:00).",
    }),
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
