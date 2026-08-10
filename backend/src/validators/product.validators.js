'use strict';

/**
 * Request schemas for the /api/products endpoints.
 *
 * `chainId` is not accepted anywhere: a product's chain is always the chain of
 * its category, so the service derives it rather than trusting the request.
 * That removes the possibility of a product whose chain_id disagrees with its
 * category's - a mismatch the database does not prevent.
 */

const Joi = require('joi');

const { id, idParam, optionalText, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = [
  'id',
  'name',
  'categoryId',
  'isAddon',
  'isActive',
  'createdAt',
  'updatedAt',
];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    categoryId: id,
    chainId: id,
    isAddon: Joi.boolean(),
    addonParentId: id,
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    categoryId: id.required(),
    name: Joi.string().trim().min(1).max(200).required(),
    description: optionalText(4000),
    weight: optionalText(50),
    imageUrl: optionalText(500),
    taxSlabCode: optionalText(20),
    isAddon: Joi.boolean().default(false),
    // Self-reference: an add-on points at the product it attaches to.
    addonParentId: id.allow(null),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  body: Joi.object({
    // Allowed, but only to another category inside the same chain - moving a
    // product across chains is refused by the service.
    categoryId: id,
    name: Joi.string().trim().min(1).max(200),
    description: optionalText(4000),
    weight: optionalText(50),
    imageUrl: optionalText(500),
    taxSlabCode: optionalText(20),
    isAddon: Joi.boolean(),
    addonParentId: id.allow(null),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
