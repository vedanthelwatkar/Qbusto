'use strict';

/**
 * Request schemas for the /api/product-pricing endpoints.
 *
 * Two layers of discount validation, deliberately split:
 *
 *   here  - shape. A percentage cannot exceed 100, an amount cannot be
 *           negative, and discountType is 'P' or 'F'.
 *   model - the cross-field rule that a discount amount is meaningless without
 *           a discountType, enforced by the frozen ProductPricing beforeSave
 *           hook, which raises the same ValidationError (400).
 *
 * The hook is not duplicated here: it is the single source of that rule, and it
 * also covers writes that never pass through this schema.
 */

const Joi = require('joi');

const { id, idParam, dayOfWeek, money, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = [
  'id',
  'cinemaId',
  'productId',
  'dayOfWeek',
  'basePrice',
  'isActive',
  'createdAt',
  'updatedAt',
];

const DISCOUNT_TYPES = ['P', 'F'];

/**
 * A discount amount, capped at 100 when the type is a percentage.
 *
 * `when` resolves `discountType` as a sibling key, so the cap follows whatever
 * the same request set the type to.
 */
const discountAmount = money.allow(null).when('discountType', {
  is: 'P',
  then: Joi.number().precision(2).min(0).max(100).allow(null).messages({
    'number.max': '{{#label}} cannot exceed 100 when discountType is P',
  }),
});

const discountFields = {
  discountType: Joi.string()
    .uppercase()
    .valid(...DISCOUNT_TYPES)
    .allow(null),
  discountValue: discountAmount,
  discountOnQr: discountAmount,
  discountOnKiosk: discountAmount,
  discountOnSeatQr: discountAmount,
  discountOnCounter: discountAmount,
};

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
    cinemaId: id,
    productId: id,
    dayOfWeek,
    isActive: Joi.boolean(),
  }),
};

const getById = { params: idParam };

const create = {
  body: Joi.object({
    cinemaId: id.required(),
    productId: id.required(),
    dayOfWeek: dayOfWeek.default(0),
    basePrice: money.required(),
    ...discountFields,
    isActive: Joi.boolean().default(true),
  }),
};

const update = {
  params: idParam,
  // cinemaId, productId and dayOfWeek are absent on purpose: together they are
  // the natural key (UQ_product_pricing), so changing one is a different row,
  // not an edit of this one.
  body: Joi.object({
    basePrice: money,
    ...discountFields,
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = { list, getById, create, update, remove, SORTABLE_FIELDS, DISCOUNT_TYPES };
