'use strict';

/**
 * The business day as the PRICING and AVAILABILITY paths actually apply it.
 *
 * businessDay.test.js proves the boundary arithmetic. This proves the two
 * decisions that arithmetic exists to drive, because those are what a customer
 * experiences:
 *
 *   - at 01:00 on Monday, a Sunday screening's customer pays SUNDAY's price;
 *   - at 01:00 on Monday, a Sunday availability window is still open.
 *
 * Both were wrong before: `Date.getDay()` said Monday, so a cinema charging
 * more at the weekend under-charged its entire Sunday late show, and a product
 * available "Sunday 18:00-02:00" could not be ordered after midnight.
 */

jest.mock('../src/config/database', () => ({
  models: {},
  sequelize: {},
  Sequelize: {},
}));

const {
  isoDayOfWeek,
  selectPricing,
  priceForDay,
  unavailableReason,
  DAY_PRICE_COLUMN,
} = require('../src/services/pricing.service');

// 2026-09-06 is a Sunday; 2026-09-07 a Monday.
const SUNDAY_EVENING = new Date(2026, 8, 6, 22, 0, 0);
const MONDAY_SMALL_HOURS = new Date(2026, 8, 7, 1, 0, 0);
const MONDAY_MORNING = new Date(2026, 8, 7, 9, 0, 0);

/** One row, the whole week - cheap weekdays, dearer at the weekend. */
const WEEKEND_PRICING = {
  mondayPrice: '250.00',
  tuesdayPrice: '250.00',
  wednesdayPrice: '250.00',
  thursdayPrice: '250.00',
  fridayPrice: '250.00',
  saturdayPrice: '320.00',
  sundayPrice: '320.00',
};

describe('which price applies', () => {
  it('charges Sunday on Sunday evening', () => {
    expect(priceForDay(WEEKEND_PRICING, isoDayOfWeek(SUNDAY_EVENING))).toBe('320.00');
  });

  /** THE CASE THIS WHOLE CHANGE EXISTS FOR. */
  it('still charges Sunday at 01:00 on Monday', () => {
    expect(isoDayOfWeek(MONDAY_SMALL_HOURS)).toBe(7);
    expect(priceForDay(WEEKEND_PRICING, isoDayOfWeek(MONDAY_SMALL_HOURS))).toBe('320.00');
  });

  it('charges Monday once the business day has turned over', () => {
    expect(priceForDay(WEEKEND_PRICING, isoDayOfWeek(MONDAY_MORNING))).toBe('250.00');
  });

  it('maps every ISO day to its own column', () => {
    expect(Object.values(DAY_PRICE_COLUMN)).toEqual([
      'mondayPrice',
      'tuesdayPrice',
      'wednesdayPrice',
      'thursdayPrice',
      'fridayPrice',
      'saturdayPrice',
      'sundayPrice',
    ]);
  });
});

describe('a day with no price is not sellable', () => {
  // Cinema 8 genuinely does this: product 151 is priced Friday to Sunday only.
  const WEEKEND_ONLY = {
    mondayPrice: null,
    tuesdayPrice: null,
    wednesdayPrice: null,
    thursdayPrice: null,
    fridayPrice: '100.00',
    saturdayPrice: '500.00',
    sundayPrice: '700.00',
  };

  it('offers the product on a priced day', () => {
    expect(selectPricing([WEEKEND_ONLY], 7)).toBe(WEEKEND_ONLY);
  });

  it('offers nothing on an unpriced day', () => {
    // null, not zero: the caller turns this into "has no price set at this
    // cinema", which is what stops the product being ordered.
    expect(selectPricing([WEEKEND_ONLY], 1)).toBeNull();
    expect(priceForDay(WEEKEND_ONLY, 1)).toBeNull();
  });

  it('offers nothing when there is no pricing row at all', () => {
    expect(selectPricing([], 1)).toBeNull();
    expect(priceForDay(null, 1)).toBeNull();
  });

  it('ignores a day number that is not a weekday', () => {
    // Guards the frozen-map lookup: an inherited key must never resolve.
    expect(priceForDay(WEEKEND_ONLY, 0)).toBeNull();
    expect(priceForDay(WEEKEND_ONLY, 'constructor')).toBeNull();
    expect(priceForDay(WEEKEND_ONLY, 8)).toBeNull();
  });
});

describe('which availability windows apply', () => {
  const carried = (hours) => ({ isActive: true, availabilityHours: hours });

  it('keeps a Sunday evening window open past midnight', () => {
    const product = carried([{ dayOfWeek: 7, startTime: '18:00:00', endTime: '02:00:00' }]);

    expect(unavailableReason(product, SUNDAY_EVENING)).toBeNull();
    // 01:00 Monday is still inside Sunday's window, on both counts: the day is
    // Sunday, and the window wraps.
    expect(unavailableReason(product, MONDAY_SMALL_HOURS)).toBeNull();
  });

  it('closes it once the business day turns over', () => {
    const product = carried([{ dayOfWeek: 7, startTime: '18:00:00', endTime: '02:00:00' }]);

    expect(unavailableReason(product, MONDAY_MORNING)).toBe('is not available at this time of day');
  });

  it('leaves the everyday all-day window open at every hour', () => {
    // The shape 110 live rows use. If this ever fails, the catalogue is empty.
    const product = carried([{ dayOfWeek: 0, startTime: '00:00:00', endTime: '23:59:59' }]);

    for (const instant of [SUNDAY_EVENING, MONDAY_SMALL_HOURS, MONDAY_MORNING]) {
      expect(unavailableReason(product, instant)).toBeNull();
    }
  });

  it('still reports the reasons that have nothing to do with the clock', () => {
    expect(unavailableReason({ isActive: false }, MONDAY_MORNING)).toBe(
      'is not currently carried at this cinema'
    );
  });

  it('is available all day when no window is configured', () => {
    expect(unavailableReason(carried([]), MONDAY_SMALL_HOURS)).toBeNull();
  });
});
