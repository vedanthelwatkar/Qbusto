'use strict';

/** Request schemas for the /api/screens endpoints. */

const Joi = require('joi');

const { id, idParam, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'name', 'cinemaId', 'isActive', 'createdAt', 'updatedAt'];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    cinemaId: id,
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaId: id.required(),
    name: Joi.string().trim().min(1).max(50).required(),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // `cinemaId` is absent on purpose: orders reference a screen, so moving one
  // between cinemas would rewrite the history of those orders.
  body: Joi.object({
    name: Joi.string().trim().min(1).max(50),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
