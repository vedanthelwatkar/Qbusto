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

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
