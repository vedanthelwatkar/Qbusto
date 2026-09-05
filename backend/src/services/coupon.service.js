'use strict';

/**
 * Coupon validation and discount computation - the entire replacement for
 * the earlier Cashfree-side offer integration.
 *
 * THE MODEL, NOW
 *
 * A coupon is a row in `offers` (cinema-scoped, managed from the Dashboard's
 * Offers tab). QBusto is the ONLY place a coupon is ever validated or
 * applied: a customer enters a code in the Consumer app's cart, this module
 * checks it against everything the operator configured (validity window,
 * min/max cart value, per-coupon redemption cap) and computes a discount
 * ENTIRELY from data QBusto already has - the cart subtotal QBusto itself
 * computed from product_pricing, never a client-supplied figure. The
 * resulting discount is folded into the order's own `discount`/`total`
 * BEFORE payment-init ever runs, so Cashfree sees a plain, final amount and
 * has no discount/offer concept in this flow at all.
 *
 * This is a deliberate reversion from an earlier design that tried routing
 * coupons through Cashfree's own offer system and trusting a short payment
 * as evidence of a valid redemption - abandoned because it meant a THIRD
 * PARTY, not QBusto, could ultimately decide how much a customer owed.
 *
 * DISCOUNT TYPE VOCABULARY - A DELIBERATE CHOICE, DOCUMENTED BECAUSE IT WAS
 * NOT SPECIFIED
 *
 * `offers.discount_type` is free text so operators are never blocked by a
 * fixed enum, but unlike when this field only mirrored Cashfree's own
 * vocabulary, it now DRIVES this module's arithmetic directly, so it needs a
 * defined meaning:
 *
 *   'PERCENTAGE' (case-insensitive)  discAmount is treated as a percentage of
 *                                     the subtotal, capped by maxDiscAmount
 *                                     if one is set.
 *   anything else, including 'FLAT'  discAmount is treated as a flat rupee
 *                                     amount. This is the default specifically
 *                                     so a coupon created without giving
 *                                     discountType much thought behaves as
 *                                     "flat" rather than silently computing a
 *                                     percentage of an unrelated magnitude.
 *
 * Either way, the discount is capped at the subtotal itself - a coupon can
 * never make an order's total negative.
 */

const { models } = require('../config/database');
const { toPaise, toDecimalString } = require('./pricing.service');
const { PAYMENT_STATUSES } = require('../constants');

const PERCENTAGE_TYPES = new Set(['percentage', 'percent', '%']);

/**
 * @param {object} params
 * @param {number} params.cinemaId
 * @param {string} params.code
 * @param {number} params.subtotalPaise QBusto's own computed cart subtotal,
 *   integer paise - never a client-supplied amount.
 * @returns {Promise<{valid: true, discountPaise: number, offer: object} |
 *   {valid: false, message: string}>}
 */
async function validateCoupon({ cinemaId, code, subtotalPaise }) {
  const trimmedCode = typeof code === 'string' ? code.trim() : '';
  if (!trimmedCode) {
    return { valid: false, message: 'Enter a coupon code' };
  }

  /*
   * THE ACTUAL ENFORCEMENT of cinemas.offers_enabled.
   *
   * The Consumer hiding the "Apply coupon" section is cosmetic - this is the
   * check that matters, because it runs no matter how the request was made.
   * Checked here rather than by every caller, so createOrder and the preview
   * endpoint cannot drift: there is exactly one place a coupon is ever
   * validated (see the module header), and this is that place.
   *
   * Existing `offers` rows are never touched by the flag - it only gates
   * whether this function will look at them.
   */
  const cinema = await models.Cinema.findByPk(cinemaId, { attributes: ['id', 'offersEnabled'] });

  if (!cinema || !cinema.offersEnabled) {
    return { valid: false, message: 'Coupons are not available at this cinema' };
  }

  const offer = await models.Offer.findOne({
    where: { cinemaId, code: trimmedCode },
  });

  if (!offer) {
    return { valid: false, message: 'This coupon code is not valid for this cinema' };
  }

  if (String(offer.status).toLowerCase() !== 'active') {
    return { valid: false, message: 'This coupon is no longer active' };
  }

  const now = new Date();
  if (offer.validFrom && new Date(offer.validFrom) > now) {
    return { valid: false, message: 'This coupon is not active yet' };
  }
  if (offer.validUntil && new Date(offer.validUntil) < now) {
    return { valid: false, message: 'This coupon has expired' };
  }

  if (offer.minTxnAmount != null && subtotalPaise < toPaise(offer.minTxnAmount)) {
    return {
      valid: false,
      message: `This coupon needs a minimum order of ₹${toDecimalString(toPaise(offer.minTxnAmount))}`,
    };
  }

  if (offer.maxTxnAmount != null && subtotalPaise > toPaise(offer.maxTxnAmount)) {
    return {
      valid: false,
      message: `This coupon only applies to orders up to ₹${toDecimalString(toPaise(offer.maxTxnAmount))}`,
    };
  }

  if (offer.maxTxnLimit != null) {
    // Only PAID redemptions count against the limit - an abandoned or failed
    // attempt never took the coupon's slot, matching how the rest of the
    // payment architecture treats an unpaid order as though nothing happened.
    const redemptions = await models.Order.count({
      where: { offerId: offer.id, paymentStatusId: await paidStatusId() },
    });

    if (redemptions >= offer.maxTxnLimit) {
      return { valid: false, message: 'This coupon has reached its redemption limit' };
    }
  }

  const discountPaise = computeDiscountPaise(offer, subtotalPaise);

  if (discountPaise <= 0) {
    return { valid: false, message: 'This coupon does not apply to this order' };
  }

  return { valid: true, discountPaise, offer };
}

/** Cached within one process lifetime - the 'paid' status id never changes. */
let cachedPaidStatusId = null;
async function paidStatusId() {
  if (cachedPaidStatusId !== null) return cachedPaidStatusId;

  const status = await models.PaymentStatus.findOne({
    where: { code: PAYMENT_STATUSES.PAID },
    attributes: ['id'],
  });

  if (!status) {
    throw new Error('Payment status "paid" not found in payment_statuses master table');
  }

  cachedPaidStatusId = status.id;
  return cachedPaidStatusId;
}

function computeDiscountPaise(offer, subtotalPaise) {
  const isPercentage = PERCENTAGE_TYPES.has(String(offer.discountType).toLowerCase());

  let discountPaise;
  if (isPercentage) {
    const percent = Number(offer.discAmount);
    discountPaise = Math.round((subtotalPaise * percent) / 100);
  } else {
    discountPaise = toPaise(offer.discAmount);
  }

  if (offer.maxDiscAmount != null) {
    discountPaise = Math.min(discountPaise, toPaise(offer.maxDiscAmount));
  }

  // Never let a coupon make the order free-or-negative.
  return Math.max(0, Math.min(discountPaise, subtotalPaise));
}

module.exports = { validateCoupon };
