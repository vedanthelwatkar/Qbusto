/**
 * Days of the week, as QBusto counts them.
 *
 * 0 is not Sunday - it means "every day". Days 1-7 run Monday to Sunday, which
 * is ISO order and not the JavaScript `Date.getDay()` order, so these labels
 * are written out rather than derived from a date.
 *
 * A DAY RUNS 6:00 AM TO 6:00 AM. "Sunday" means Sunday 6:00 am through Monday
 * 6:00 am, so a customer ordering at 1:00 am on Monday is still charged
 * Sunday's price and sees Sunday's availability. The boundary lives in the
 * backend (utils/businessDay.js); the Dashboard only has to describe it
 * honestly where a user picks a day.
 *
 * `DAY_OF_WEEK_LABELS` is still used by product AVAILABILITY, whose windows are
 * one row per day and do use 0 for "every day". Pricing no longer has a day
 * column at all - one row carries the whole week - which is what
 * `WEEKDAY_PRICE_FIELDS` describes.
 */

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: 'Every day',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const DAY_OF_WEEK_OPTIONS = Object.entries(DAY_OF_WEEK_LABELS).map(([value, label]) => ({
  value: Number(value),
  label,
}));

export function dayOfWeekLabel(day: number | undefined): string {
  if (day === undefined) return '-';

  return DAY_OF_WEEK_LABELS[day] ?? `Day ${day}`;
}

/**
 * The seven price columns on a pricing row, in the order they are shown.
 *
 * Monday first, matching ISO day numbering and the order the backend's
 * DAY_PRICE_COLUMN map uses, so the form, the table and the database all read
 * the week the same way round.
 */
export const WEEKDAY_PRICE_FIELDS = [
  { day: 1, field: 'mondayPrice', label: 'Monday', short: 'Mon' },
  { day: 2, field: 'tuesdayPrice', label: 'Tuesday', short: 'Tue' },
  { day: 3, field: 'wednesdayPrice', label: 'Wednesday', short: 'Wed' },
  { day: 4, field: 'thursdayPrice', label: 'Thursday', short: 'Thu' },
  { day: 5, field: 'fridayPrice', label: 'Friday', short: 'Fri' },
  { day: 6, field: 'saturdayPrice', label: 'Saturday', short: 'Sat' },
  { day: 7, field: 'sundayPrice', label: 'Sunday', short: 'Sun' },
] as const;

export type WeekdayPriceField = (typeof WEEKDAY_PRICE_FIELDS)[number]['field'];

/**
 * The per-day discount field names on a pricing row.
 *
 * Each day's discount is independent - `wednesdayDiscountType` governs only
 * `wednesdayDiscount*`, never Thursday's. Named to match the backend model
 * (models/productpricing.js) and validator field-for-field.
 */
export function dayDiscountFields(day: (typeof WEEKDAY_PRICE_FIELDS)[number]['field']) {
  const prefix = day.replace(/Price$/, '');

  return {
    type: `${prefix}DiscountType` as const,
    value: `${prefix}DiscountValue` as const,
    onQr: `${prefix}DiscountOnQr` as const,
    onKiosk: `${prefix}DiscountOnKiosk` as const,
    onSeatQr: `${prefix}DiscountOnSeatQr` as const,
    onCounter: `${prefix}DiscountOnCounter` as const,
  };
}
