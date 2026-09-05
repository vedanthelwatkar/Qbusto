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
  specialInstructions: optionalText(500).default(null),
});

const items = Joi.array().items(orderItem).min(1).max(50).required().messages({
  'array.min': 'Add at least one item to the order',
});

/**
 * GET /api/consumer/cinemas/{cinemaId}/sessions
 *
 * `screenId` is the QR's screen, and it is the ONLY input the client gets to
 * contribute to which show is current. There is deliberately no `now`
 * parameter: the current time is read from the server clock inside
 * consumer.service.findCurrentSession, so a device with a wrong - or edited -
 * clock cannot steer the selection.
 */
const listSessions = {
  query: Joi.object({
    screenId: id.optional().allow(null).default(null),
  }),
};

const createOrder = {
  body: Joi.object({
    cinemaId: id.required(),
    // The auditorium is never taken from the client as an id - only resolved
    // server-side from the show's screen name plus the row below (see
    // consumer.service.resolveScreenId). screenName is always present once a
    // show has been picked.
    screenName: optionalText(50).default(null),
    seatRow: optionalText(2).default(null),
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
    /*
     * The screening the customer picked, from GET .../sessions.
     *
     * When present the service reads the film title, the show time and the
     * auditorium's name off the `session` row itself and ignores any
     * client-supplied filmTitle/showTime - see consumer.service.createOrder.
     * It is the provider's session id, unique within the cinema, not a global
     * surrogate key.
     */
    sessionId: Joi.number().integer().positive().optional().allow(null).default(null),
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
    // Evidence for a `seat_qr` claim, matching createOrder's own field so the
    // preview derives the same source the order will (see
    // pricing.service.deriveSource). Optional: every other source needs none,
    // and a seat_qr preview without one simply previews the lobby rate - which
    // is exactly what the order would then charge.
    seatNumber: optionalText(20).default(null),
    items,
  }),
};

module.exports = { listSessions, createOrder, validateCoupon };
