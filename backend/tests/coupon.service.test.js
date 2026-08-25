'use strict';

/**
 * services/coupon.service.js - the entire QBusto-side coupon system.
 *
 * This has no route of its own (it is called from consumer.service during
 * order creation and the coupon-preview endpoint), so it is exercised
 * directly rather than through supertest. What matters here is money: a bug
 * in this file either lets a coupon over-discount an order or wrongly
 * refuses a valid one, so every rule the operator can configure is checked
 * independently.
 */

jest.mock('../src/config/database', () => ({
  models: {
    Offer: { findOne: jest.fn() },
    Order: { count: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
  },
}));

const { models } = require('../src/config/database');
const { validateCoupon } = require('../src/services/coupon.service');

const CINEMA_ID = 1;
const PAID_STATUS_ID = 2;

/** An `offers` row as Sequelize would return it. */
function offer(overrides = {}) {
  return {
    id: 1,
    cinemaId: CINEMA_ID,
    code: 'SAVE10',
    status: 'active',
    discountType: 'flat',
    discAmount: 50,
    maxDiscAmount: null,
    minTxnAmount: null,
    maxTxnAmount: null,
    maxTxnLimit: null,
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  models.PaymentStatus.findOne.mockResolvedValue({ id: PAID_STATUS_ID });
  models.Order.count.mockResolvedValue(0);
});

describe('validateCoupon', () => {
  test('an empty or whitespace code is refused before any lookup', async () => {
    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: '   ', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(models.Offer.findOne).not.toHaveBeenCalled();
  });

  test('a code that does not exist for this cinema is refused', async () => {
    models.Offer.findOne.mockResolvedValue(null);

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'NOPE', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not valid/i);
  });

  test('scopes the lookup to the cinema - a code from another cinema is not found', async () => {
    models.Offer.findOne.mockResolvedValue(null);

    await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(models.Offer.findOne).toHaveBeenCalledWith({
      where: { cinemaId: CINEMA_ID, code: 'SAVE10' },
    });
  });

  test('an inactive offer is refused regardless of case', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ status: 'INACTIVE' }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/no longer active/i);
  });

  test('a coupon not yet in its validity window is refused', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    models.Offer.findOne.mockResolvedValue(offer({ validFrom: tomorrow.toISOString() }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/not active yet/i);
  });

  test('a coupon past its validity window is refused', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    models.Offer.findOne.mockResolvedValue(offer({ validUntil: yesterday.toISOString() }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/expired/i);
  });

  test('a cart below the minimum order value is refused', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ minTxnAmount: 200 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/minimum order/i);
  });

  test('a cart above the maximum order value is refused', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ maxTxnAmount: 50 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/only applies to orders up to/i);
  });

  test('a flat coupon discounts by the configured rupee amount, in paise', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ discountType: 'flat', discAmount: 50 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.discountPaise).toBe(5000);
  });

  test('an unrecognised discountType defaults to flat, not percentage - documented, not incidental', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ discountType: 'something-unexpected', discAmount: 50 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.discountPaise).toBe(5000);
  });

  test('a percentage coupon (case-insensitive) discounts by a percent of the subtotal', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ discountType: 'PERCENTAGE', discAmount: 10 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.discountPaise).toBe(1000);
  });

  test('a percentage coupon is capped by maxDiscAmount', async () => {
    models.Offer.findOne.mockResolvedValue(
      offer({ discountType: 'percentage', discAmount: 50, maxDiscAmount: 30 })
    );

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.discountPaise).toBe(3000);
  });

  test('a coupon can never discount an order below zero - capped at the subtotal itself', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ discountType: 'flat', discAmount: 500 }));

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.discountPaise).toBe(10000);
  });

  test('a redemption limit already reached refuses the coupon, counting only PAID orders', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ maxTxnLimit: 2 }));
    models.Order.count.mockResolvedValue(2);

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/redemption limit/i);
    expect(models.Order.count).toHaveBeenCalledWith({
      where: { offerId: 1, paymentStatusId: PAID_STATUS_ID },
    });
  });

  test('a redemption limit not yet reached still allows the coupon', async () => {
    models.Offer.findOne.mockResolvedValue(offer({ maxTxnLimit: 2 }));
    models.Order.count.mockResolvedValue(1);

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
  });

  test('returns the offer itself on success, so the caller can record offerId', async () => {
    const configured = offer();
    models.Offer.findOne.mockResolvedValue(configured);

    const result = await validateCoupon({ cinemaId: CINEMA_ID, code: 'SAVE10', subtotalPaise: 10000 });

    expect(result.valid).toBe(true);
    expect(result.offer).toBe(configured);
  });
});
