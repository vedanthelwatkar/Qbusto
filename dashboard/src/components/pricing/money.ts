/**
 * Rendering the decimal columns on a price row.
 *
 * These are DECIMAL(10,2) in SQL Server, but they do not arrive as strings.
 * The driver hands Sequelize a JS number and the service passes it through
 * untouched, so a price stored as 250.00 reaches the browser as the number
 * 250, on create, on read and on update alike. The OpenAPI schema says so, so
 * the generated type is `number` and nothing here has to guess.
 *
 * Money is then always shown to two places: "250" reads as an approximation of
 * a price, where "250.00" reads as the price.
 */

import type { ProductPricingDiscountType } from '@/api/generated/cinemaOrderingAPI.schemas';

/** What the generated ProductPricing type gives for any of its money columns. */
type Decimal = number | null | undefined;

export function formatMoney(value: Decimal): string {
  if (value === null || value === undefined) return '-';

  // Guards a value that arrived outside the type - a hand-built object in a
  // test, or a contract that drifts again. Showing what came through beats
  // rendering NaN.
  return Number.isFinite(value) ? value.toFixed(2) : String(value);
}

/**
 * A discount reads differently depending on its type: a flat amount is money
 * and gets the two places, a percentage does not - "10%" is a rate, and
 * "10.00%" only looks like more precision than anyone entered.
 */
export function formatDiscount(value: Decimal, type: ProductPricingDiscountType): string {
  if (value === null || value === undefined || !type) return '-';
  if (!Number.isFinite(value)) return String(value);

  return type === 'P' ? `${value}%` : formatMoney(value);
}
