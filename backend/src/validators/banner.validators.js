'use strict';

/**
 * Request schemas for the /api/banners endpoints.
 *
 * One row carries one image (banners.image_url is NOT NULL and singular), so a
 * cinema shows several banners by holding several rows, ordered by `sequence`.
 */

const Joi = require('joi');

const { id, idParam, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = [
  'id',
  'cinemaId',
  'sequence',
  'type',
  'startDate',
  'isActive',
  'createdAt',
];

/** banners.type - CK_banners_type. 'H' = Header, 'I' = Inner. */
const BANNER_TYPES = ['H', 'I'];

/**
 * endDate must not fall before startDate.
 *
 * Equal dates are allowed: a banner that runs for a single instant is odd but
 * not contradictory, and the schema leaves both columns nullable so a banner
 * with no window at all is normal.
 */
const endDate = Joi.date()
  .iso()
  .allow(null)
  .custom((value, helpers) => {
    const { startDate } = helpers.state.ancestors[0];
    if (!startDate || !value) return value;

    return new Date(value) < new Date(startDate) ? helpers.error('any.invalid') : value;
  })
  .messages({ 'any.invalid': "'endDate' cannot be earlier than 'startDate'" });

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('sequence'),
    cinemaId: id,
    type: Joi.string()
      .uppercase()
      .valid(...BANNER_TYPES),
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaId: id.required(),
    imageUrl: Joi.string().trim().max(500).required(),
    type: Joi.string()
      .uppercase()
      .valid(...BANNER_TYPES)
      .default('H'),
    sequence: Joi.number().integer().min(0).default(0),
    startDate: Joi.date().iso().allow(null),
    endDate,
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // `cinemaId` is absent on purpose: a banner belongs to the cinema it was
  // created for, and moving one would sidestep that cinema's sequence rule.
  body: Joi.object({
    imageUrl: Joi.string().trim().max(500),
    type: Joi.string()
      .uppercase()
      .valid(...BANNER_TYPES),
    sequence: Joi.number().integer().min(0),
    startDate: Joi.date().iso().allow(null),
    endDate,
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS, BANNER_TYPES };
