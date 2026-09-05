'use strict';

/**
 * The 06:00 -> 06:00 business day.
 *
 * This is a CORE BUSINESS RULE, not a formatting detail: it decides which
 * day's price a customer pays, whether a product is available, and whether a
 * banner is in season. The case it exists for is the late show - a customer
 * ordering at 01:00 on Monday is sitting in a SUNDAY screening and must be
 * charged Sunday's price.
 *
 * The tests below are deliberately written around that boundary, because the
 * hours either side of it are the only ones where the old calendar-day
 * behaviour and the new one differ, and every one of them is a real trading
 * hour at a cinema.
 */

const {
  BUSINESS_DAY_START_HOUR,
  businessDate,
  businessDayStart,
  businessDayOfWeek,
  secondsIntoDay,
  timeToSeconds,
  isWithinDailyWindow,
  dailyWindowsOverlap,
} = require('../src/utils/businessDay');

// 2026-09-06 is a Sunday, so 2026-09-07 is a Monday.
const SUNDAY = 7;
const MONDAY = 1;
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute, 0);

describe('which business day an instant belongs to', () => {
  it('starts the day at 06:00', () => {
    expect(BUSINESS_DAY_START_HOUR).toBe(6);
  });

  /** THE RULE, stated as its own test. */
  it.each([
    ['Sunday 06:00 - the moment it starts', at(6, 6, 0), SUNDAY],
    ['Sunday 15:00 - the middle of it', at(6, 15, 0), SUNDAY],
    ['Sunday 23:59 - late show', at(6, 23, 59), SUNDAY],
    ['Monday 00:30 - past midnight, still Sunday', at(7, 0, 30), SUNDAY],
    ['Monday 02:00 - the case this exists for', at(7, 2, 0), SUNDAY],
    ['Monday 05:59 - the last minute of Sunday', at(7, 5, 59), SUNDAY],
    ['Monday 06:00 - Monday begins', at(7, 6, 0), MONDAY],
    ['Monday 06:01', at(7, 6, 1), MONDAY],
  ])('%s', (_label, instant, expected) => {
    expect(businessDayOfWeek(instant)).toBe(expected);
  });

  it('names the business day after the calendar date it began on', () => {
    // Monday 02:00 belongs to the business day that began on Sunday.
    expect(businessDate(at(7, 2, 0)).toDateString()).toBe(at(6, 0, 0).toDateString());
    expect(businessDate(at(7, 7, 0)).toDateString()).toBe(at(7, 0, 0).toDateString());
  });

  it('reports when the current business day began', () => {
    const start = businessDayStart(at(7, 2, 0));

    expect(start.getDate()).toBe(6);
    expect(start.getHours()).toBe(6);
    expect(start.getMinutes()).toBe(0);
  });

  it('differs from the calendar day exactly between midnight and 06:00', () => {
    /*
     * The whole behavioural change, in one assertion. Outside this window the
     * business day and the calendar day agree, which is why the rest of the
     * application could adopt it without any other visible effect.
     */
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = at(7, hour);
      const calendar = instant.getDay() === 0 ? 7 : instant.getDay();
      const differs = businessDayOfWeek(instant) !== calendar;

      expect(differs).toBe(hour < 6);
    }
  });
});

describe('reading a stored time of day', () => {
  it('keeps seconds, so 23:59:59 is not rounded to 23:59', () => {
    // 110 live availability windows end at exactly this second.
    expect(timeToSeconds('23:59:59')).toBe(86399);
    expect(timeToSeconds('23:59')).toBe(86340);
  });

  it('accepts HH:MM and HH:MM:SS', () => {
    expect(timeToSeconds('09:00')).toBe(9 * 3600);
    expect(timeToSeconds('09:00:00')).toBe(9 * 3600);
  });

  it.each([['not a time'], ['25:00:00'], ['09:60'], ['']])('rejects %s', (value) => {
    expect(Number.isNaN(timeToSeconds(value))).toBe(true);
  });

  it('rejects a non-string rather than coercing it', () => {
    expect(Number.isNaN(timeToSeconds(null))).toBe(true);
    expect(Number.isNaN(timeToSeconds(900))).toBe(true);
  });

  it('measures an instant from midnight', () => {
    expect(secondsIntoDay(at(6, 6, 0))).toBe(6 * 3600);
    expect(secondsIntoDay(at(6, 0, 0))).toBe(0);
  });
});

describe('is now inside a daily window', () => {
  const inside = (now, start, end) =>
    isWithinDailyWindow(timeToSeconds(now), timeToSeconds(start), timeToSeconds(end));

  /**
   * THE REGRESSION THIS FILE MOST NEEDS TO CATCH.
   *
   * 110 of the 147 live availability windows are exactly 00:00:00-23:59:59.
   * Mapping both endpoints onto the 06:00 axis - the obvious way to "apply the
   * business day" - turns that into 18:00:00 -> 17:59:59, an end before its
   * start, and every one of those products goes dark from 06:00 every day.
   */
  it('keeps the everyday 00:00:00-23:59:59 window open all day', () => {
    for (const hour of ['00:00:00', '05:59:59', '06:00:00', '12:00:00', '23:00:00', '23:59:58']) {
      expect(inside(hour, '00:00:00', '23:59:59')).toBe(true);
    }
  });

  it('handles an ordinary daytime window', () => {
    expect(inside('09:00:00', '09:00:00', '17:00:00')).toBe(true);
    expect(inside('16:59:59', '09:00:00', '17:00:00')).toBe(true);
    expect(inside('08:59:59', '09:00:00', '17:00:00')).toBe(false);
    // End is exclusive, so adjacent windows do not both match.
    expect(inside('17:00:00', '09:00:00', '17:00:00')).toBe(false);
  });

  /** What the business day buys: an evening that runs past midnight. */
  it('handles a window running past midnight', () => {
    expect(inside('22:00:00', '22:00:00', '02:00:00')).toBe(true);
    expect(inside('23:30:00', '22:00:00', '02:00:00')).toBe(true);
    expect(inside('00:30:00', '22:00:00', '02:00:00')).toBe(true);
    expect(inside('01:59:59', '22:00:00', '02:00:00')).toBe(true);
    expect(inside('02:00:00', '22:00:00', '02:00:00')).toBe(false);
    expect(inside('12:00:00', '22:00:00', '02:00:00')).toBe(false);
  });

  it('treats a zero-width window as closed, never as open all day', () => {
    // A mistyped row must not become permanently open.
    expect(inside('12:00:00', '14:00:00', '14:00:00')).toBe(false);
  });

  it('is closed rather than open when a time cannot be read', () => {
    expect(isWithinDailyWindow(NaN, 0, 100)).toBe(false);
    expect(inside('12:00:00', 'rubbish', '17:00:00')).toBe(false);
  });
});

describe('do two windows overlap', () => {
  const clash = (aStart, aEnd, bStart, bEnd) =>
    dailyWindowsOverlap(
      timeToSeconds(aStart),
      timeToSeconds(aEnd),
      timeToSeconds(bStart),
      timeToSeconds(bEnd)
    );

  it('detects an ordinary overlap, in both orders', () => {
    expect(clash('09:00:00', '17:00:00', '12:00:00', '20:00:00')).toBe(true);
    expect(clash('12:00:00', '20:00:00', '09:00:00', '17:00:00')).toBe(true);
  });

  it('does not treat touching windows as overlapping', () => {
    expect(clash('10:00:00', '14:00:00', '14:00:00', '18:00:00')).toBe(false);
  });

  it('detects an overlap with a window that runs past midnight', () => {
    // The case plain SQL string comparison silently missed: `start < end` is
    // false for 22:00-02:00, so neither of these clashed and both saved.
    expect(clash('01:00:00', '03:00:00', '22:00:00', '02:00:00')).toBe(true);
    expect(clash('23:00:00', '23:30:00', '22:00:00', '02:00:00')).toBe(true);
  });

  it('leaves genuinely separate late-night windows alone', () => {
    expect(clash('02:00:00', '05:00:00', '22:00:00', '02:00:00')).toBe(false);
  });

  it('never reports an overlap for a zero-width window', () => {
    expect(clash('12:00:00', '12:00:00', '09:00:00', '17:00:00')).toBe(false);
  });
});
