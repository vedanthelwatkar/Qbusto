'use strict';

/**
 * Request schemas for the /api/cinema-products endpoints.
 *
 * A cinema_product says "this product is carried at this cinema". It is the
 * parent of product_availability_hours, so a window is always scoped to one
 * product at one cinema rather than to the product everywhere.
 *
 * The date-range rule - `availableUntil` must be after `availableFrom` - is not
 * expressed here. On a partial update only one of the two may be present, and
 * checking one new value against the other stored one needs the row loaded, so
 * the rule lives in the service where the effective range is known. See
 * services/cinemaproduct.service.
 */

const Joi = require('joi');

const { id, idParam, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = [
  'id',
  'cinemaId',
  'productId',
  'sequence',
  'isActive',
  'createdAt',
  'updatedAt',
];

/**
 * Display order within a cinema. Not unique - unlike banners, the legacy system
 * left DAE_ItemCinemaPrice.Sequence unconstrained and duplicates are ordinary.
 */
const sequence = Joi.number().integer().min(0);

/** Date-range availability, e.g. a festival offer. Null clears the bound. */
const availableFrom = Joi.date().iso().allow(null);
const availableUntil = Joi.date().iso().allow(null);

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('sequence'),
    cinemaId: id,
    productId: id,
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaId: id.required(),
    productId: id.required(),
    sequence: sequence.default(0),
    availableFrom: availableFrom.default(null),
    availableUntil: availableUntil.default(null),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // cinemaId and productId are absent on purpose: together they are the natural
  // key (UQ_cinema_products), so changing one identifies a different link rather
  // than editing this one. Availability hours hang off this row's id, and
  // repointing it would silently move them to another cinema.
  body: Joi.object({
    sequence,
    availableFrom,
    availableUntil,
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
