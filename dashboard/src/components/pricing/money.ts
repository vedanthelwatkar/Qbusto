/**
 * Rendering the decimal columns on a price row.
 *
 * The spec types every one of them as a string - "Decimal columns are returned
 * as strings to preserve exact scale" - but they do not arrive that way. The
 * SQL Server driver hands Sequelize a JS number and the service passes it
 * through untouched, so a price stored as 250.00 reaches the browser as the
 * number 250, on create, on read and on update alike.
 *
 * Both shapes are accepted here rather than trusting either, because the
 * generated type and the running server disagree and only one of them can be
 * checked at compile time. Money is then always shown to two places: "250"
 * reads as an approximation of a price, where "250.00" reads as the price.
 */

import type { ProductPricingDiscountType } from '@/api/generated/cinemaOrderingAPI.schemas';

/** The declared type is `string`; the wire carries a number. Neither is assumed. */
type Decimal = string | number | null | undefined;

export function formatMoney(value: Decimal): string {
  if (value === null || value === undefined || value === '') return '-';

  const numeric = Number(value);

  // A value that will not parse is shown as it arrived rather than as NaN -
  // being wrong about the format should not hide what the server actually sent.
  return Number.isNaN(numeric) ? String(value) : numeric.toFixed(2);
}

/**
 * A discount reads differently depending on its type: a flat amount is money
 * and gets the two places, a percentage does not - "10%" is a rate, and
 * "10.00%" only looks like more precision than anyone entered.
 */
export function formatDiscount(value: Decimal, type: ProductPricingDiscountType): string {
  if (value === null || value === undefined || value === '' || !type) return '-';

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);

  return type === 'P' ? `${numeric}%` : formatMoney(numeric);
}
