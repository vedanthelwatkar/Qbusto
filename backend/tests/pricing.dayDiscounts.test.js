'use strict';

/**
 * A discount is a property of ONE day, not of the whole week.
 *
 * THE CASE THIS FILE EXISTS FOR
 *
 * cinema 1 / product 14 (live data, before 20260906000200) had a Wednesday-
 * only flat discount that did NOT apply the other six days. A single shared
 * discount field cannot represent that without either leaking the discount
 * onto every day or losing it, so `discountForDay`/`unitDiscountPaise` take a
 * `day` argument and read only that day's columns.
 */

jest.mock('../src/config/database', () => ({ models: {}, sequelize: {}, Sequelize: {} }));

const { discountForDay, unitDiscountPaise, toPaise } = require('../src/services/pricing.service');
const { everyDayDiscount } = require('./helpers/dayDiscount');

describe('discountForDay', () => {
  it('returns null when the day has no discount type', () => {
    const pricing = everyDayDiscount({});
    expect(discountForDay(pricing, 3)).toBeNull();
  });

  /** THE CENTRAL GUARANTEE OF THIS FILE. */
  it('a Wednesday-only discount does not leak onto Thursday', () => {
    const pricing = {
      ...everyDayDiscount({}),
      wednesdayDiscountType: 'F',
      wednesdayDiscountValue: 75,
      wednesdayDiscountOnKiosk: 100,
    };

    expect(discountForDay(pricing, 3)).toMatchObject({ type: 'F', value: 75, onKiosk: 100 });
    expect(discountForDay(pricing, 4)).toBeNull(); // Thursday
    expect(discountForDay(pricing, 2)).toBeNull(); // Tuesday
    expect(discountForDay(pricing, 7)).toBeNull(); // Sunday
  });

  it('two different days can carry two different discounts at once', () => {
    const pricing = {
      ...everyDayDiscount({}),
      mondayDiscountType: 'P',
      mondayDiscountValue: 10,
      fridayDiscountType: 'F',
      fridayDiscountValue: 50,
    };

    expect(discountForDay(pricing, 1)).toMatchObject({ type: 'P', value: 10 });
    expect(discountForDay(pricing, 5)).toMatchObject({ type: 'F', value: 50 });
    expect(discountForDay(pricing, 3)).toBeNull();
  });

  it('ignores a day number outside 1-7, including inherited-key attempts', () => {
    const pricing = everyDayDiscount({ type: 'P', value: 10 });
    expect(discountForDay(pricing, 0)).toBeNull();
    expect(discountForDay(pricing, 8)).toBeNull();
    expect(discountForDay(pricing, 'constructor')).toBeNull();
    expect(discountForDay(null, 1)).toBeNull();
  });
});

describe('unitDiscountPaise with day-specific discounts', () => {
  const UNIT_PAISE = 25000; // Rs 250.00

  it('applies a day-specific percentage only on that day', () => {
    const pricing = {
      ...everyDayDiscount({}),
      wednesdayDiscountType: 'P',
      wednesdayDiscountValue: 10,
    };

    expect(unitDiscountPaise(pricing, 'qr', UNIT_PAISE, 3)).toBe(2500); // 10% on Wed
    expect(unitDiscountPaise(pricing, 'qr', UNIT_PAISE, 4)).toBe(0); // nothing on Thu
  });

  it('applies a day-specific channel override only on that day, for that channel', () => {
    const pricing = {
      ...everyDayDiscount({}),
      wednesdayDiscountType: 'F',
      wednesdayDiscountValue: 75,
      wednesdayDiscountOnKiosk: 100,
    };

    // QR/seat_qr/counter get the general Wednesday amount (75).
    expect(unitDiscountPaise(pricing, 'qr', UNIT_PAISE, 3)).toBe(7500);
    expect(unitDiscountPaise(pricing, 'seat_qr', UNIT_PAISE, 3)).toBe(7500);
    expect(unitDiscountPaise(pricing, 'counter', UNIT_PAISE, 3)).toBe(7500);
    // Kiosk gets its own Wednesday override.
    expect(unitDiscountPaise(pricing, 'kiosk', UNIT_PAISE, 3)).toBe(10000);
    // Every other day: nothing, on every channel.
    for (const source of ['qr', 'seat_qr', 'kiosk', 'counter']) {
      expect(unitDiscountPaise(pricing, source, UNIT_PAISE, 5)).toBe(0);
    }
  });

  /**
   * THE LIVE DATA THIS SCHEMA WAS BUILT FOR, reproduced exactly.
   *
   * cinema 1 / product 14 before migration: base 620, Wednesday flat 75 off,
   * 100 off kiosk on Wednesday, no discount any other day.
   */
  it('reproduces the live cinema 1 / product 14 Wednesday-only discount', () => {
    const pricing = {
      ...everyDayDiscount({}),
      wednesdayDiscountType: 'F',
      wednesdayDiscountValue: 75,
      wednesdayDiscountOnKiosk: 100,
    };
    const unitPaise = toPaise(620);

    expect((unitPaise - unitDiscountPaise(pricing, 'qr', unitPaise, 3)) / 100).toBe(545);
    expect((unitPaise - unitDiscountPaise(pricing, 'kiosk', unitPaise, 3)) / 100).toBe(520);
    expect((unitPaise - unitDiscountPaise(pricing, 'qr', unitPaise, 1)) / 100).toBe(620); // Monday: no discount
  });

  it('never lets a day-specific discount push a line below zero', () => {
    const pricing = { ...everyDayDiscount({}), sundayDiscountType: 'F', sundayDiscountValue: 9999 };

    expect(unitDiscountPaise(pricing, 'qr', UNIT_PAISE, 7)).toBe(UNIT_PAISE);
  });
});
