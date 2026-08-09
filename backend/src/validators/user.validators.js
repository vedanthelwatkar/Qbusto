'use strict';

/**
 * Request schemas for the /api/users endpoints.
 *
 * `role` and `moduleName` are restricted to the values in src/constants, which
 * mirror the CHECK constraints on users.role and user_permissions.module_name -
 * a bad value is rejected as a 400 here rather than surfacing as a database
 * error later.
 */

const Joi = require('joi');

const { id, idParam, password, optionalText, paginationQuery } = require('./common.validators');
const { MODULE_NAMES, ROLE_NAMES } = require('../constants');

/**
 * Whitelist rather than a free string: `sort` is interpolated into the ORDER BY
 * clause, so anything not listed here must not reach Sequelize.
 */
const SORTABLE_FIELDS = [
  'id',
  'username',
  'role',
  'firstName',
  'lastName',
  'isActive',
  'createdAt',
  'updatedAt',
];

/**
 * One row of user_permissions. Absent flags default to false, so a client can
 * send `{ moduleName: 'Orders', canRead: true }` and get read-only access.
 */
const permissionEntry = Joi.object({
  moduleName: Joi.string()
    .valid(...MODULE_NAMES)
    .required(),
  canRead: Joi.boolean().default(false),
  canEdit: Joi.boolean().default(false),
  canDelete: Joi.boolean().default(false),
});

/**
 * The complete permission set for a user. `unique` enforces the same rule as
 * the UQ_user_permissions index: one row per module.
 */
const permissions = Joi.array()
  .items(permissionEntry)
  .max(MODULE_NAMES.length)
  .unique('moduleName')
  .messages({ 'array.unique': 'Each module may appear only once in permissions' });

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    role: Joi.string().valid(...ROLE_NAMES),
    isActive: Joi.boolean(),
    cinemaId: id,
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    // Only an owner may set this; for everyone else it is taken from the
    // authenticated user and any value sent here is ignored (see user.service).
    chainId: id,
    cinemaId: id.allow(null),
    role: Joi.string()
      .valid(...ROLE_NAMES)
      .required(),
    username: Joi.string().trim().min(3).max(50).required(),
    password: password.required(),
    firstName: optionalText(50),
    lastName: optionalText(50),
    mobile: optionalText(15),
    isActive: Joi.boolean().default(true),
    permissions: permissions.default([]),
  }),
};

const update = {
  params: idParam,
  // `chainId` is absent on purpose: moving a user between chains would carry
  // their permissions across a tenant boundary. `password` is absent because
  // POST /api/auth/change-password is the only supported way to set one.
  body: Joi.object({
    cinemaId: id.allow(null),
    role: Joi.string().valid(...ROLE_NAMES),
    username: Joi.string().trim().min(3).max(50),
    firstName: optionalText(50),
    lastName: optionalText(50),
    mobile: optionalText(15),
    isActive: Joi.boolean(),
    // Omit to leave permissions untouched; send an array to replace them all.
    permissions,
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
