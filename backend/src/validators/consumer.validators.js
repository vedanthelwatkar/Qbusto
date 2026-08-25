'use strict';

/**
 * Request schemas for the public /api/consumer endpoints.
 *
 * Mirrors order.validators.js's `create` schema (the staff-facing
 * POST /api/orders) as closely as the two request shapes allow - same
 * `orderItem` shape, same `items` bound - because the underlying integrity
 * requirement is identical: an order without at least one real line has
 * nothing to fulfil and nothing to charge for.
 *
 * THIS FILE'S REASON TO EXIST
 *
 * POST /api/consumer/orders had no `validate()` middleware in front of it at
 * all - the body went straight from Express to consumerService.createOrder()
 * with only ad-hoc, partial checks inside the service. The endpoint's own
 * published OpenAPI contract already documented `items` as `required` with
 * `minItems: 1`, but nothing enforced that: an empty `items` array produced a
 * ₹0 order that consumer.service.paymentInit's zero-total short-circuit (see
 * its own header note) would then confirm and hand to the kitchen with
 * nothing in it, no payment taken, no auth required. This schema closes that
 * gap by making the actual validation match the contract that was already
 * being advertised.
 *
 * Nothing here accepts a price, a discount or a total - those are computed by
 * the service from product_pricing and the coupon it looks up, exactly as
 * before. `validate()` runs with `stripUnknown: true`, so a client sending
 * one anyway has it silently discarded before the service ever sees the body.
 */

const Joi = require('joi');

const { id, optionalText } = require('./common.validators');
const { ORDER_SOURCE_NAMES } = require('../constants');

/**
 * The quantity ceiling matches order.validators.js's `orderItem` for the same
 * reason: `orders.subtotal`/`total` are DECIMAL(10,2), and an unbounded
 * quantity on one line risks an opaque database overflow instead of a clean
 * validation message. 999 of one item is far past any real cinema order.
 */
const orderItem = Joi.object({
  productId: id.required(),
  quantity: Joi.number().integer().min(1).max(999).required(),
});

const items = Joi.array().items(orderItem).min(1).max(50).required().messages({
  'array.min': 'Add at least one item to the order',
});

const createOrder = {
  body: Joi.object({
    cinemaId: id.required(),
    screenId: id.allow(null).default(null),
    seatNumber: optionalText(20).default(null),
    source: Joi.string()
      .valid(...ORDER_SOURCE_NAMES)
      .required(),
    customerMobile: optionalText(15).default(null),
    customerEmail: Joi.string()
      .trim()
      .lowercase()
      .email({ tlds: false })
      .max(200)
      .allow(null)
      .empty('')
      .default(null),
    filmTitle: optionalText(200).default(null),
    showTime: Joi.date().iso().allow(null).default(null),
    notes: optionalText(500).default(null),
    // Validated for real against `offers` inside the service - this only
    // bounds its shape. `null`/omitted means no coupon was applied.
    couponCode: optionalText(50).default(null),
    items,
  }),
};

/**
 * Preview endpoint - creates nothing, but computes the same subtotal
 * `createOrder` would from the same `items`/`source`, so it needs the same
 * non-empty-cart guarantee to produce a meaningful number.
 */
const validateCoupon = {
  body: Joi.object({
    code: Joi.string().trim().min(1).max(50).required(),
    source: Joi.string()
      .valid(...ORDER_SOURCE_NAMES)
      .required(),
    items,
  }),
};

module.exports = { createOrder, validateCoupon };
