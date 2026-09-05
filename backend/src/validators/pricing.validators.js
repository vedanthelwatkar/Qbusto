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

const { id, idParam, money, paginationQuery } = require('./common.validators');

/** See chain.validators for why this is a whitelist. */
const SORTABLE_FIELDS = ['id', 'cinemaId', 'productId', 'isActive', 'createdAt', 'updatedAt'];

/**
 * The seven day prices.
 *
 * NULL IS ALLOWED AND MEANS SOMETHING: "not sold on that day". It is not the
 * same as omitting the key on an update, which leaves that day as it was, and
 * it is not zero, which would mean the product is free. The Dashboard's weekly
 * editor sends an explicit null for a day the user cleared.
 */
const dayPriceFields = {
  mondayPrice: money.allow(null),
  tuesdayPrice: money.allow(null),
  wednesdayPrice: money.allow(null),
  thursdayPrice: money.allow(null),
  fridayPrice: money.allow(null),
  saturdayPrice: money.allow(null),
  sundayPrice: money.allow(null),
};

const DAY_PRICE_KEYS = Object.keys(dayPriceFields);

const DISCOUNT_TYPES = ['P', 'F'];

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CHANNEL_SUFFIXES = ['Qr', 'Kiosk', 'SeatQr', 'Counter'];

/**
 * A discount amount, capped at 100 when ITS OWN day's type is a percentage.
 *
 * `when` resolves `typeField` as a sibling key within the same day's group of
 * fields - e.g. `wednesdayDiscountValue` depends on `wednesdayDiscountType`,
 * never on Monday's. That is what keeps a percentage cap, and every other
 * per-day rule, from crossing between days.
 */
function discountAmountFor(typeField) {
  return money.allow(null).when(typeField, {
    is: 'P',
    then: Joi.number()
      .precision(2)
      .min(0)
      .max(100)
      .allow(null)
      .messages({
        'number.max': `{{#label}} cannot exceed 100 when ${typeField} is P`,
      }),
  });
}

/**
 * Every day's discount fields, independently of every other day.
 *
 * Mechanical repetition of the same six fields the old shared discount used -
 * type, value, four channel overrides - once per weekday, so that (say) a
 * Wednesday discount can exist without applying to Thursday. Checked against
 * the beforeSave hook in models/productpricing.js, which enforces the same
 * per-day "amount needs that day's type" rule at the model layer for writes
 * that do not pass through this schema.
 */
const discountFields = {};
for (const day of DAYS) {
  const typeField = `${day}DiscountType`;
  const valueField = `${day}DiscountValue`;

  discountFields[typeField] = Joi.string()
    .uppercase()
    .valid(...DISCOUNT_TYPES)
    .allow(null);
  discountFields[valueField] = discountAmountFor(typeField);

  for (const channel of CHANNEL_SUFFIXES) {
    discountFields[`${day}DiscountOn${channel}`] = discountAmountFor(typeField);
  }
}

const list = {
  query: paginationQuery.keys({
    sort: Joi.string()
      .valid(...SORTABLE_FIELDS)
      .default('createdAt'),
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
    ...dayPriceFields,
    ...discountFields,
    isActive: Joi.boolean().default(true),
  })
    /*
     * At least one day must carry a price. A row with all seven NULL prices
     * makes the product unsellable every day of the week, which nobody means
     * to create and which reads as a saved configuration in the Dashboard.
     */
    .or(...DAY_PRICE_KEYS)
    .messages({ 'object.missing': 'Provide a price for at least one day of the week' }),
};

const update = {
  params: idParam,
  // cinemaId and productId are absent on purpose: together they are the
  // natural key (UQ_product_pricing_cinema_product), so changing one is a
  // different row, not an edit of this one.
  body: Joi.object({
    ...dayPriceFields,
    ...discountFields,
    isActive: Joi.boolean(),
  })
    .min(1)
    .messages({ 'object.min': 'Provide at least one field to update' }),
};

const remove = { params: idParam };

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  SORTABLE_FIELDS,
  DISCOUNT_TYPES,
  DAY_PRICE_KEYS,
};
