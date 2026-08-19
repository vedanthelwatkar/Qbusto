'use strict';

/**
 * Request schemas for the /api/chains endpoints.
 *
 * A chain is the top of the tenant tree, so there is no parent reference to
 * validate here - the only structural rule is that names stay unique, which the
 * service enforces (the schema carries no unique index on chains.name).
 */

const Joi = require('joi');

const { idParam, optionalText, paginationQuery } = require('./common.validators');

/**
 * Whitelist rather than a free string: `sort` is interpolated into the ORDER BY
 * clause, so anything not listed here must not reach Sequelize.
 */
const SORTABLE_FIELDS = ['id', 'name', 'isActive', 'createdAt', 'updatedAt'];

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    logoImageUrl: optionalText(500),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    logoImageUrl: optionalText(500),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
