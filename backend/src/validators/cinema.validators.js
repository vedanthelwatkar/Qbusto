'use strict';

/**
 * Request schemas for the /api/cinemas endpoints.
 *
 * `code` is normalised to upper case here rather than in the service: it appears
 * in QR ordering URLs, so it is restricted to URL-safe characters and stored in
 * one casing so that UQ_cinemas_code means what it looks like it means.
 */

const Joi = require('joi');

const { id, idParam, optionalText, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'code', 'name', 'city', 'isActive', 'createdAt', 'updatedAt'];

const code = Joi.string()
  .trim()
  .uppercase()
  .min(2)
  .max(10)
  .pattern(/^[A-Z0-9-]+$/)
  .messages({
    'string.pattern.base': "'code' may contain only letters, digits and hyphens",
  });

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    chainId: id,
    city: Joi.string().trim().max(100),
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    // Only an owner may place a cinema in another chain; for everyone else it is
    // taken from the authenticated user and any value sent here is ignored
    // (see cinema.service).
    chainId: id,
    code: code.required(),
    name: Joi.string().trim().min(2).max(100).required(),
    location: optionalText(255),
    city: optionalText(100),
    gstNumber: optionalText(50),
    fssaiNumber: optionalText(50),
    activeSince: Joi.date().iso().allow(null),
    smsEnabled: Joi.boolean().default(false),
    whatsappEnabled: Joi.boolean().default(false),
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // `chainId` is absent on purpose: moving a cinema between chains would carry
  // its screens, orders and pricing across a tenant boundary.
  body: Joi.object({
    code,
    name: Joi.string().trim().min(2).max(100),
    location: optionalText(255),
    city: optionalText(100),
    gstNumber: optionalText(50),
    fssaiNumber: optionalText(50),
    activeSince: Joi.date().iso().allow(null),
    smsEnabled: Joi.boolean(),
    whatsappEnabled: Joi.boolean(),
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS };
