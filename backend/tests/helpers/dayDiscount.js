'use strict';

/**
 * Test helper: spread one discount configuration onto all seven day-specific
 * columns.
 *
 * Since 20260906000200-product-pricing-day-discounts, a discount is a
 * property of ONE day, not of the whole row - `wednesdayDiscountType`, not
 * `discountType`. Most pricing tests are not testing "which day" behaviour at
 * all (that is covered separately in pricing.businessDay.test.js and
 * pricing.dayDiscounts.test.js); they are testing channel/percentage/flat
 * arithmetic, and don't care which of the seven days the server's clock
 * happens to land on when the suite runs. This fills every day identically so
 * those tests keep working regardless of the day they run on.
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CHANNELS = ['Qr', 'Kiosk', 'SeatQr', 'Counter'];

/**
 * @param {object} discount
 * @param {string|null} discount.type 'P' | 'F' | null
 * @param {number|null} [discount.value]
 * @param {number|null} [discount.onQr]
 * @param {number|null} [discount.onKiosk]
 * @param {number|null} [discount.onSeatQr]
 * @param {number|null} [discount.onCounter]
 * @returns {object} 42 fields: `{day}DiscountType`, `{day}DiscountValue`,
 *   `{day}DiscountOn{Channel}` for every day.
 */
function everyDayDiscount({ type = null, value = null, onQr = null, onKiosk = null, onSeatQr = null, onCounter = null } = {}) {
  const fields = {};

  for (const day of DAYS) {
    fields[`${day}DiscountType`] = type;
    fields[`${day}DiscountValue`] = value;
    fields[`${day}DiscountOnQr`] = onQr;
    fields[`${day}DiscountOnKiosk`] = onKiosk;
    fields[`${day}DiscountOnSeatQr`] = onSeatQr;
    fields[`${day}DiscountOnCounter`] = onCounter;
  }

  return fields;
}

/** Every day's discount fields, all null - "no discount at all". */
function noDiscount() {
  return everyDayDiscount({});
}

module.exports = { DAYS, CHANNELS, everyDayDiscount, noDiscount };
