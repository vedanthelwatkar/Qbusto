'use strict';

/**
 * Shared pricing, availability, and money utility functions.
 *
 * Extracted from order.service.js so both staff and consumer order flows
 * use the exact same calculations for money, pricing, and availability.
 * Single source of truth for financial logic.
 */

const { ORDER_SOURCES } = require('../constants');

const EVERY_DAY = 0;

const SOURCE_DISCOUNT_COLUMN = Object.freeze({
  [ORDER_SOURCES.QR]: 'discountOnQr',
  [ORDER_SOURCES.SEAT_QR]: 'discountOnSeatQr',
  [ORDER_SOURCES.KIOSK]: 'discountOnKiosk',
  [ORDER_SOURCES.COUNTER]: 'discountOnCounter',
});

/** '250.00' | 250 -> 25000. */
function toPaise(value) {
  return Math.round(Number(value) * 100);
}

/** 25000 -> '250.00', the exact string a DECIMAL(10,2) column wants. */
function toDecimalString(paise) {
  return (paise / 100).toFixed(2);
}

/** The ISO day number for a date: 1 = Monday ... 7 = Sunday. */
function isoDayOfWeek(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** A Date as the 'HH:MM:SS' string a TIME column is compared against. */
function timeOfDay(date) {
  const pad = (part) => String(part).padStart(2, '0');
  return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
}

/** Render whatever the driver hands back for a TIME column as 'HH:MM:SS'. */
function formatStoredTime(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;

  const pad = (part) => String(part).padStart(2, '0');
  return [pad(value.getUTCHours()), pad(value.getUTCMinutes()), pad(value.getUTCSeconds())].join(
    ':'
  );
}

/**
 * Whether a cinema product is orderable at `now`.
 * @returns {string|null} A reason it is unavailable, or null when it is.
 */
function unavailableReason(cinemaProduct, now) {
  if (!cinemaProduct.isActive) {
    return 'is not currently carried at this cinema';
  }

  if (cinemaProduct.availableFrom && now < new Date(cinemaProduct.availableFrom)) {
    return 'is not available at this cinema yet';
  }

  if (cinemaProduct.availableUntil && now > new Date(cinemaProduct.availableUntil)) {
    return 'is no longer available at this cinema';
  }

  const hours = cinemaProduct.availabilityHours || [];

  if (hours.length === 0) return null;

  const day = isoDayOfWeek(now);
  const time = timeOfDay(now);

  const open = hours.some((hour) => {
    if (hour.dayOfWeek !== EVERY_DAY && hour.dayOfWeek !== day) return false;

    const start = formatStoredTime(hour.startTime);
    const end = formatStoredTime(hour.endTime);

    return start <= time && time < end;
  });

  return open ? null : 'is not available at this time of day';
}

/**
 * The price row that applies to a product at a cinema on a given day.
 * Day-specific row wins over the every-day row.
 */
function selectPricing(pricings, day) {
  return (
    pricings.find((pricing) => pricing.dayOfWeek === day) ||
    pricings.find((pricing) => pricing.dayOfWeek === EVERY_DAY) ||
    null
  );
}

/**
 * The per-unit discount in paise for one price row on one channel.
 * Clamped to the unit price to prevent negative totals.
 */
function unitDiscountPaise(pricing, source, unitPricePaise) {
  if (!pricing.discountType) return 0;

  const column = source ? SOURCE_DISCOUNT_COLUMN[source] : undefined;
  const channelValue = column ? pricing[column] : null;
  const raw =
    channelValue !== null && channelValue !== undefined ? channelValue : pricing.discountValue;

  if (raw === null || raw === undefined) return 0;

  const discount =
    pricing.discountType === 'P' ? Math.round((unitPricePaise * Number(raw)) / 100) : toPaise(raw);

  return Math.min(Math.max(discount, 0), unitPricePaise);
}

module.exports = {
  toPaise,
  toDecimalString,
  isoDayOfWeek,
  timeOfDay,
  formatStoredTime,
  unavailableReason,
  selectPricing,
  unitDiscountPaise,
  EVERY_DAY,
  SOURCE_DISCOUNT_COLUMN,
};
