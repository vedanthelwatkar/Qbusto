'use strict';

/** Request schemas for the /api/categories endpoints. */

const Joi = require('joi');

const { id, idParam, optionalText, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt'];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    chainId: id,
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    // Only an owner may place a category in another chain; for everyone else it
    // is taken from the authenticated user (see category.service).
    chainId: id,
    name: Joi.string().trim().min(1).max(200).required(),
    // NVARCHAR(MAX), so no length cap beyond a sane request-size limit.
    description: optionalText(4000),
    imageUrl: optionalText(500),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // `chainId` is absent on purpose: moving a category between chains would drag
  // its products across a tenant boundary.
  body: Joi.object({
    name: Joi.string().trim().min(1).max(200),
    description: optionalText(4000),
    imageUrl: optionalText(500),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

/**
 * The per-cinema display order.
 *
 * The body is the ORDER ITSELF - position 1 in the array becomes sequence 1 -
 * rather than a map of explicit numbers. A positional list cannot express a
 * duplicate sequence or a gap, which is the whole reason for the shape; the
 * service rejects a duplicate CATEGORY separately.
 *
 * An empty array is legal and means "no category is placed": it clears the
 * cinema's order back to alphabetical.
 */
const categoryOrderParams = Joi.object({
  cinemaId: Joi.number().integer().positive().required(),
});

const getCategoryOrder = { params: categoryOrderParams };

const setCategoryOrder = {
  params: categoryOrderParams,
  body: Joi.object({
    categoryIds: Joi.array().items(id.required()).max(500).required(),
  }),
};

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  getCategoryOrder,
  setCategoryOrder,
  SORTABLE_FIELDS,
};
