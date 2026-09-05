'use strict';

/**
 * The QBusto business day: 06:00 -> 06:00.
 *
 * A cinema's trading day does not end at midnight. The last show of the night
 * finishes at 01:30, the customer in seat J7 orders popcorn at 01:15, and
 * everyone involved - the customer, the counter staff, the manager reading the
 * day's numbers - considers that part of *Sunday*, not the small hours of
 * Monday. So:
 *
 *   Sunday business day  =  Sunday 06:00:00  ->  Monday 05:59:59
 *
 * A timestamp at Monday 02:00 therefore belongs to the SUNDAY business day.
 *
 * WHAT USES THIS, AND WHAT MUST NOT
 *
 * This governs SCHEDULING - the questions of the form "which day's rules apply
 * right now": which day's price, which day's availability window, whether a
 * banner is in season. It must NOT be applied to timestamps that record when
 * something actually happened: `created_at`, `updated_at`, order and payment
 * times, audit logs and status logs are instants, and an instant has no
 * business day of its own. Reporting that groups orders INTO business days is
 * the one legitimate crossover, and it should call `businessDate` explicitly
 * rather than have the boundary applied to the stored value.
 *
 * TIME ZONE
 *
 * Every function here works in PROCESS-LOCAL time, which `APP_TIMEZONE` pins
 * to IST and refuses to boot without (src/config/env.js). That is deliberate
 * and matches the rest of the codebase: the database stores IST wall clock,
 * `pricing.timeOfDay` reads local components, and a business day is a local
 * idea - 06:00 means 06:00 where the cinema is, not 06:00 UTC.
 */

/** The hour a business day begins. Changing this changes the whole platform. */
const BUSINESS_DAY_START_HOUR = 6;

/**
 * The calendar date that a timestamp's business day is named after, at
 * midnight local time.
 *
 * Monday 02:00 -> Sunday 00:00, because Monday 02:00 is still Sunday's
 * business day. Monday 07:00 -> Monday 00:00.
 *
 * Returned at midnight rather than at 06:00 because that is the form a stored
 * date-only column (`banners.start_date`, which live rows hold at 00:00:00) is
 * comparable against without further arithmetic.
 *
 * @param {Date} [instant] Defaults to now.
 * @returns {Date}
 */
function businessDate(instant = new Date()) {
  const date = new Date(instant);

  if (date.getHours() < BUSINESS_DAY_START_HOUR) {
    date.setDate(date.getDate() - 1);
  }

  date.setHours(0, 0, 0, 0);

  return date;
}

/**
 * The instant a timestamp's business day began: 06:00 on its business date.
 *
 * @param {Date} [instant] Defaults to now.
 * @returns {Date}
 */
function businessDayStart(instant = new Date()) {
  const start = businessDate(instant);
  start.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);

  return start;
}

/**
 * The ISO weekday of a timestamp's BUSINESS day: 1 = Monday ... 7 = Sunday.
 *
 * This is the function that decides which day's price and which day's
 * availability window apply, and it is the reason `Date.getDay()` must not be
 * called directly for that purpose anywhere in the codebase: at Monday 02:00
 * `getDay()` says Monday and the business day says Sunday, and the customer is
 * sitting in a Sunday-night show.
 *
 * ISO order (Monday = 1) rather than JavaScript order (Sunday = 0) because
 * that is what `product_pricing.day_of_week` and
 * `product_availability_hours.day_of_week` store.
 *
 * @param {Date} [instant] Defaults to now.
 * @returns {number} 1-7
 */
function businessDayOfWeek(instant = new Date()) {
  const day = businessDate(instant).getDay();

  return day === 0 ? 7 : day;
}

/**
 * Seconds since local midnight: 0 at 00:00:00, 86399 at 23:59:59.
 *
 * @param {Date} [instant] Defaults to now.
 * @returns {number}
 */
function secondsIntoDay(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);

  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

/**
 * The same measure for a stored 'HH:MM' / 'HH:MM:SS' time-of-day string.
 *
 * Seconds are kept rather than rounded away: the everyday window 110 live rows
 * use ends at 23:59:59, and losing that second would close every one of them
 * for the last minute of every day.
 *
 * @param {string} time 'HH:MM' or 'HH:MM:SS'
 * @returns {number} 0-86399, or NaN if unparseable
 */
function timeToSeconds(time) {
  if (typeof time !== 'string') return NaN;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);

  if (hours > 23 || minutes > 59 || seconds > 59) return NaN;

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Is `now` inside a daily window that may run past midnight?
 *
 * THE 06:00 BOUNDARY DELIBERATELY DOES NOT APPEAR HERE.
 *
 * It cancels: measuring both `now` and `start` from 06:00 subtracts the same
 * constant from each, and this compares their difference. What the business
 * day actually decides is WHICH day's windows are offered - that is
 * `businessDayOfWeek`, applied by the caller - and once a window belongs to
 * the right business day, the only thing left is how far into it we are.
 *
 * Mapping both endpoints onto the 06:00 axis instead is a trap worth naming:
 * the everyday window 00:00:00-23:59:59 becomes 18:00:00 -> 17:59:59, whose
 * end precedes its start, and 110 live rows would have gone dark from 06:00
 * every day.
 *
 * The window is [start, end): two adjacent windows (10:00-14:00, 14:00-18:00)
 * do not overlap. `end` before `start` means the window runs past midnight
 * (22:00 -> 02:00), which under a 06:00 business day is an ordinary evening
 * rather than something exotic. `end` EQUAL to `start` is an empty window, not
 * a 24-hour one - nothing live does this, and reading a mistyped row as
 * permanently open is the worse failure.
 *
 * @param {number} now Seconds since midnight.
 * @param {number} start Seconds since midnight.
 * @param {number} end Seconds since midnight.
 * @returns {boolean}
 */
function isWithinDailyWindow(now, start, end) {
  if (Number.isNaN(now) || Number.isNaN(start) || Number.isNaN(end)) return false;

  const SECONDS_PER_DAY = 24 * 3600;
  const width = (end - start + SECONDS_PER_DAY) % SECONDS_PER_DAY;

  if (width === 0) return false;

  return (now - start + SECONDS_PER_DAY) % SECONDS_PER_DAY < width;
}

/**
 * Do two daily windows cover any of the same time?
 *
 * Both may run past midnight, so this is an overlap test on a 24-hour circle
 * rather than on a line: each window is reduced to (start, width), and they
 * overlap when either start falls inside the other's width. Touching windows
 * (10:00-14:00 and 14:00-18:00) do not overlap, matching the half-open
 * [start, end) rule `isWithinDailyWindow` applies.
 *
 * A zero-width window overlaps nothing, consistent with it matching no instant.
 *
 * @param {number} startA Seconds since midnight.
 * @param {number} endA Seconds since midnight.
 * @param {number} startB Seconds since midnight.
 * @param {number} endB Seconds since midnight.
 * @returns {boolean}
 */
function dailyWindowsOverlap(startA, endA, startB, endB) {
  if ([startA, endA, startB, endB].some(Number.isNaN)) return false;

  const SECONDS_PER_DAY = 24 * 3600;
  const widthA = (endA - startA + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const widthB = (endB - startB + SECONDS_PER_DAY) % SECONDS_PER_DAY;

  if (widthA === 0 || widthB === 0) return false;

  return (
    (startB - startA + SECONDS_PER_DAY) % SECONDS_PER_DAY < widthA ||
    (startA - startB + SECONDS_PER_DAY) % SECONDS_PER_DAY < widthB
  );
}

module.exports = {
  BUSINESS_DAY_START_HOUR,
  businessDate,
  businessDayStart,
  businessDayOfWeek,
  secondsIntoDay,
  timeToSeconds,
  isWithinDailyWindow,
  dailyWindowsOverlap,
};
