/**
 * The `dayOfWeek` column on a price row, and on an availability window.
 *
 * 0 is not Sunday - it means "every day", and is the default the backend
 * applies when a price is created without one. Days 1-7 run Monday to Sunday,
 * which is ISO order and not the JavaScript `Date.getDay()` order, so these
 * labels are written out rather than derived from a date.
 *
 * Shared by the pricing table, form and drawer, and by the product availability
 * drawer and form. product_pricing and product_availability_hours use the same
 * convention, including the "every day" meaning of 0, so both name the eight
 * values the same way rather than each having its own list.
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
