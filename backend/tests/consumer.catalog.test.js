'use strict';

/**
 * Consumer catalog availability.
 *
 * The catalog used to join availability_hours with `attributes: []` - present
 * in the SQL, never loaded - so `unavailableReason` was never consulted and an
 * out-of-hours product was listed, added to the cart, and only rejected at
 * checkout with "... is not available at this time of day".
 *
 * These tests pin both halves of the fix: the catalog now applies the same
 * predicate the order path applies, and the order path still applies it too,
 * because availability can change while a customer is choosing.
 *
 * The model layer is mocked, so what is asserted is the decision the service
 * makes about a given set of rows, not the SQL it emits. Boundary cases follow
 * the current implementation in pricing.service.unavailableReason exactly:
 * `start <= time && time < end`, day 0 meaning every day.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    Cinema: { findByPk: jest.fn(), findOne: jest.fn() },
    Screen: { findOne: jest.fn(), findAll: jest.fn() },
    Product: { findAll: jest.fn(), findOne: jest.fn() },
    CinemaProduct: { findAll: jest.fn() },
    ProductPricing: { findAll: jest.fn() },
    Order: { findByPk: jest.fn(), create: jest.fn(), count: jest.fn() },
    OrderItem: { bulkCreate: jest.fn() },
    OrderStatus: { findOne: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
    PaymentStatusLog: { create: jest.fn() },
    IdempotencyKey: { findOne: jest.fn(), create: jest.fn() },
    Offer: { findOne: jest.fn() },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models, sequelize } = require('../src/config/database');
const createApp = require('../src/app');
const { unavailableReason } = require('../src/services/pricing.service');

const app = createApp();

const CINEMA_ID = 3;

/**
 * A Thursday, 15:00 local. Fixed so day-of-week and time-of-day assertions do
 * not depend on when the suite runs. Thursday is ISO day 4.
 */
const NOW = new Date(2026, 7, 13, 15, 0, 0);
const ISO_THURSDAY = 4;

function buildPricing(overrides = {}) {
  return {
    basePrice: '250.00',
    discountType: null,
    discountValue: null,
    discountOnQr: null,
    discountOnSeatQr: null,
    discountOnKiosk: null,
    discountOnCounter: null,
    ...overrides,
  };
}

/** A cinema_product link, carried and active, with no time restriction. */
function buildLink(overrides = {}) {
  return {
    id: 12,
    productId: 17,
    availableFrom: null,
    availableUntil: null,
    isActive: true,
    availabilityHours: [],
    ...overrides,
  };
}

/** A product row as Product.findAll returns it, with its includes loaded. */
function buildProduct(overrides = {}) {
  const { link = {}, pricing = {}, ...rest } = overrides;
  const productId = rest.id || 17;

  return {
    id: productId,
    name: 'Cheese Nachos',
    description: 'Warm nachos',
    imageUrl: null,
    cinemaProducts: [buildLink({ productId, ...link })],
    pricings: [buildPricing(pricing)],
    ...rest,
  };
}

/** A window on the fixed Thursday, expressed as the TIME strings the driver returns. */
const hours = (startTime, endTime, dayOfWeek = ISO_THURSDAY) => [
  { id: 31, dayOfWeek, startTime, endTime },
];

function listProducts(rows) {
  models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, isActive: true });
  models.Product.findAll.mockResolvedValue(rows);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// The predicate itself, at its boundaries
// ---------------------------------------------------------------------------

describe('unavailableReason boundaries (current implementation)', () => {
  it('treats the window as start-inclusive and end-exclusive', () => {
    // 15:00:00 exactly - the opening edge is inside the window.
    expect(
      unavailableReason(buildLink({ availabilityHours: hours('15:00:00', '18:00:00') }), NOW)
    ).toBeNull();

    // 15:00:00 exactly - the closing edge is outside it.
    expect(
      unavailableReason(buildLink({ availabilityHours: hours('09:00:00', '15:00:00') }), NOW)
    ).toBe('is not available at this time of day');

    // One second before close is still inside.
    expect(
      unavailableReason(buildLink({ availabilityHours: hours('09:00:00', '15:00:01') }), NOW)
    ).toBeNull();
  });

  it('treats day 0 as every day and ignores other days', () => {
    expect(
      unavailableReason(buildLink({ availabilityHours: hours('14:00:00', '16:00:00', 0) }), NOW)
    ).toBeNull();

    // Friday's window does not open a Thursday.
    expect(
      unavailableReason(buildLink({ availabilityHours: hours('14:00:00', '16:00:00', 5) }), NOW)
    ).toBe('is not available at this time of day');
  });

  it('treats no windows at all as always available', () => {
    expect(unavailableReason(buildLink({ availabilityHours: [] }), NOW)).toBeNull();
  });

  it('reports the date window and the carried flag separately', () => {
    expect(unavailableReason(buildLink({ isActive: false }), NOW)).toBe(
      'is not currently carried at this cinema'
    );
    expect(unavailableReason(buildLink({ availableFrom: new Date(2030, 0, 1) }), NOW)).toBe(
      'is not available at this cinema yet'
    );
    expect(unavailableReason(buildLink({ availableUntil: new Date(2020, 0, 1) }), NOW)).toBe(
      'is no longer available at this cinema'
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/consumer/cinemas/:cinemaId/products
// ---------------------------------------------------------------------------

describe('GET /api/consumer/cinemas/:cinemaId/products', () => {
  it('omits a product that is outside its availability window right now', async () => {
    listProducts([
      buildProduct({
        id: 85,
        name: 'Cheese Nachos',
        link: { availabilityHours: hours('09:00:00', '12:00:00') },
      }),
      buildProduct({
        id: 86,
        name: 'Popcorn',
        link: { availabilityHours: hours('14:00:00', '20:00:00') },
      }),
    ]);

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((p) => p.name)).toEqual(['Popcorn']);
    expect(response.body.data.find((p) => p.id === 85)).toBeUndefined();
  });

  it('loads the columns the availability check needs', async () => {
    // Guards the root cause directly: these were joined with attributes: [], so
    // the rows arrived empty and the check silently passed everything.
    listProducts([buildProduct()]);

    await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    const { include } = models.Product.findAll.mock.calls[0][0];
    const link = include.find((entry) => entry.association === 'cinemaProducts');
    const windows = link.include.find((entry) => entry.association === 'availabilityHours');

    expect(link.attributes).toEqual(
      expect.arrayContaining(['availableFrom', 'availableUntil', 'isActive'])
    );
    expect(windows.attributes).toEqual(
      expect.arrayContaining(['dayOfWeek', 'startTime', 'endTime'])
    );
  });

  it('counts only orderable products in the pagination total', async () => {
    listProducts([
      buildProduct({
        id: 85,
        name: 'Aaa Nachos',
        link: { availabilityHours: hours('09:00:00', '12:00:00') },
      }),
      buildProduct({ id: 86, name: 'Bbb Popcorn' }),
      buildProduct({ id: 87, name: 'Ccc Cola' }),
    ]);

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    // Not 3: a total that counted the unavailable product would make the
    // customer page towards items that are never shown.
    expect(response.body.meta.pagination.total).toBe(2);
    expect(response.body.data).toHaveLength(2);
  });

  it('paginates the filtered list, not the database page', async () => {
    listProducts([
      buildProduct({
        id: 85,
        name: 'Aaa Nachos',
        link: { availabilityHours: hours('09:00:00', '12:00:00') },
      }),
      buildProduct({ id: 86, name: 'Bbb Popcorn' }),
      buildProduct({ id: 87, name: 'Ccc Cola' }),
    ]);

    const first = await request(app).get(
      `/api/consumer/cinemas/${CINEMA_ID}/products?limit=1&page=1`
    );
    const second = await request(app).get(
      `/api/consumer/cinemas/${CINEMA_ID}/products?limit=1&page=2`
    );

    // Page 1 is not empty, which is what slicing the database page would give.
    expect(first.body.data.map((p) => p.name)).toEqual(['Bbb Popcorn']);
    expect(second.body.data.map((p) => p.name)).toEqual(['Ccc Cola']);
  });

  it('does not surface an unavailable product through search', async () => {
    // Search narrows the SQL; the availability filter runs after it, on the
    // same path, so a match that is closed right now stays hidden.
    listProducts([
      buildProduct({
        id: 85,
        name: 'Cheese Nachos',
        link: { availabilityHours: hours('09:00:00', '12:00:00') },
      }),
    ]);

    const response = await request(app).get(
      `/api/consumer/cinemas/${CINEMA_ID}/products?search=Nachos`
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.pagination.total).toBe(0);
  });

  it('keeps a product whose window is open', async () => {
    listProducts([buildProduct({ link: { availabilityHours: hours('14:00:00', '16:00:00') } })]);

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].basePrice).toBe(250);
  });

  it('omits a product whose cinema availability window has passed', async () => {
    listProducts([
      buildProduct({ link: { availableUntil: new Date(2020, 0, 1) } }),
      buildProduct({ id: 86, name: 'Popcorn' }),
    ]);

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    expect(response.body.data.map((p) => p.name)).toEqual(['Popcorn']);
  });
});

// ---------------------------------------------------------------------------
// GET /api/consumer/cinemas/:cinemaId/products/:id
// ---------------------------------------------------------------------------

describe('GET /api/consumer/cinemas/:cinemaId/products/:id', () => {
  it('does not serve an unavailable product by direct id', async () => {
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, isActive: true });
    models.Product.findOne.mockResolvedValue(
      buildProduct({ id: 85, link: { availabilityHours: hours('09:00:00', '12:00:00') } })
    );

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products/85`);

    // 404 rather than a body the cart could still use.
    expect(response.status).toBe(404);
  });

  it('serves an available product', async () => {
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, isActive: true });
    models.Product.findOne.mockResolvedValue(
      buildProduct({ id: 86, link: { availabilityHours: hours('14:00:00', '16:00:00') } })
    );

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products/86`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(86);
  });
});

// ---------------------------------------------------------------------------
// POST /api/consumer/orders - the check that must survive the catalog filter
// ---------------------------------------------------------------------------

describe('POST /api/consumer/orders availability re-check', () => {
  const TX = Symbol('transaction');

  function orderPayload() {
    return {
      cinemaId: CINEMA_ID,
      seatNumber: 'A5',
      source: 'qr',
      customerMobile: '9876543210',
      items: [{ productId: 85, quantity: 1 }],
    };
  }

  /** Everything createOrder touches before it reaches the availability check. */
  function arrangeOrder(link) {
    sequelize.transaction.mockImplementation((callback) => callback(TX));
    models.IdempotencyKey.findOne.mockResolvedValue(null);
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, chainId: 1, isActive: true });
    models.Product.findAll.mockResolvedValue([{ id: 85, name: 'Cheese Nachos' }]);
    models.CinemaProduct.findAll.mockResolvedValue([link]);
    models.ProductPricing.findAll.mockResolvedValue([
      { productId: 85, dayOfWeek: 0, ...buildPricing() },
    ]);
  }

  it('still rejects a product that closed after the catalog was loaded', async () => {
    // The catalog was fetched while the window was open; by checkout it is not.
    arrangeOrder(buildLink({ productId: 85, availabilityHours: hours('09:00:00', '12:00:00') }));

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-closed-since-load')
      .send(orderPayload());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toBe('Cheese Nachos is not available at this time of day');
    // No order was written.
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects a product whose link was deactivated after the catalog was loaded', async () => {
    arrangeOrder(buildLink({ productId: 85, isActive: false }));

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-deactivated-since-load')
      .send(orderPayload());

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/not currently carried at this cinema/);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('loads the availability columns on the order path too', async () => {
    arrangeOrder(buildLink({ productId: 85, availabilityHours: hours('09:00:00', '12:00:00') }));

    await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-columns')
      .send(orderPayload());

    const call = models.CinemaProduct.findAll.mock.calls[0][0];
    expect(call.attributes).toEqual(
      expect.arrayContaining(['availableFrom', 'availableUntil', 'isActive'])
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/consumer/orders - empty cart, and the zero-total/discount-cap
// fixes that depend on `items` genuinely never being empty by the time
// pricing math runs.
//
// An empty `items` array used to sail straight through: buildOrderLines()
// never required a non-empty array, so an order with no lines got a ₹0
// subtotal - which paymentInit's zero-total short-circuit (added so a coupon
// covering an order in full can settle without a Cashfree call at all) then
// confirmed as PAID with nothing in it, no auth, no payment, repeatably. The
// fix is the `consumer.validators.js` schema wired into this route.
// ---------------------------------------------------------------------------

describe('POST /api/consumer/orders - non-empty cart is enforced server-side', () => {
  const TX = Symbol('transaction');

  /** Everything createOrder needs to reach a real 201, once items exist. */
  function arrangeSuccessfulCreate({ discAmount, discountType = 'flat' } = {}) {
    sequelize.transaction.mockImplementation((callback) => callback(TX));
    models.IdempotencyKey.findOne.mockResolvedValue(null);
    models.IdempotencyKey.create.mockResolvedValue({});
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, chainId: 1, isActive: true });
    models.Product.findAll.mockResolvedValue([{ id: 85, name: 'Cheese Nachos' }]);
    models.CinemaProduct.findAll.mockResolvedValue([buildLink({ productId: 85 })]);
    models.ProductPricing.findAll.mockResolvedValue([
      { productId: 85, dayOfWeek: 0, ...buildPricing() },
    ]);
    models.OrderStatus.findOne.mockResolvedValue({ id: 21 });
    models.PaymentStatus.findOne.mockResolvedValue({ id: 1 });
    models.OrderStatusLog.create.mockResolvedValue({});
    models.PaymentStatusLog.create.mockResolvedValue({});
    models.Order.create.mockResolvedValue({ id: 999 });
    models.Order.count.mockResolvedValue(0);
    models.OrderItem.bulkCreate.mockResolvedValue([]);

    if (discAmount !== undefined) {
      models.Offer.findOne.mockResolvedValue({
        id: 1,
        cinemaId: CINEMA_ID,
        code: 'SAVE',
        status: 'active',
        discountType,
        discAmount,
        maxDiscAmount: null,
        minTxnAmount: null,
        maxTxnAmount: null,
        maxTxnLimit: null,
        validFrom: null,
        validUntil: null,
      });
    }
  }

  it('rejects an empty items array with a clean 400, before touching the database', async () => {
    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-empty-cart')
      .send({
        cinemaId: CINEMA_ID,
        source: 'qr',
        customerMobile: '9876543210',
        items: [],
      });

    expect(response.status).toBe(400);
    expect(models.Cinema.findByPk).not.toHaveBeenCalled();
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects a request with no items field at all', async () => {
    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-missing-items')
      .send({ cinemaId: CINEMA_ID, source: 'qr', customerMobile: '9876543210' });

    expect(response.status).toBe(400);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('a real cart fully covered by a valid coupon still creates successfully at total 0', async () => {
    // Rs 250 item, a flat Rs 250 coupon - legitimately zero, not empty.
    arrangeSuccessfulCreate({ discAmount: 250, discountType: 'flat' });

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-fully-covered')
      .send({
        cinemaId: CINEMA_ID,
        source: 'qr',
        customerMobile: '9876543210',
        couponCode: 'SAVE',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.couponDiscount).toBe(250);
    expect(models.Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ total: '0.00', offerId: 1 }),
      expect.anything()
    );
  });

  it('a 100%-off product discount plus a coupon on top is capped at the subtotal, never negative', async () => {
    // Same Rs 250 item, but with an additional 100% source-based promo on it,
    // AND a flat Rs 250 coupon - two independently-capped discounts that would
    // sum to twice the subtotal without the cap in createOrder.
    sequelize.transaction.mockImplementation((callback) => callback(TX));
    models.IdempotencyKey.findOne.mockResolvedValue(null);
    models.IdempotencyKey.create.mockResolvedValue({});
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, chainId: 1, isActive: true });
    models.Product.findAll.mockResolvedValue([{ id: 85, name: 'Cheese Nachos' }]);
    models.CinemaProduct.findAll.mockResolvedValue([buildLink({ productId: 85 })]);
    models.ProductPricing.findAll.mockResolvedValue([
      {
        productId: 85,
        dayOfWeek: 0,
        ...buildPricing({ discountType: 'P', discountOnQr: 100 }),
      },
    ]);
    models.OrderStatus.findOne.mockResolvedValue({ id: 21 });
    models.PaymentStatus.findOne.mockResolvedValue({ id: 1 });
    models.OrderStatusLog.create.mockResolvedValue({});
    models.PaymentStatusLog.create.mockResolvedValue({});
    models.Order.create.mockResolvedValue({ id: 999 });
    models.Order.count.mockResolvedValue(0);
    models.OrderItem.bulkCreate.mockResolvedValue([]);
    models.Offer.findOne.mockResolvedValue({
      id: 1,
      cinemaId: CINEMA_ID,
      code: 'SAVE',
      status: 'active',
      discountType: 'flat',
      discAmount: 250,
      maxDiscAmount: null,
      minTxnAmount: null,
      maxTxnAmount: null,
      maxTxnLimit: null,
      validFrom: null,
      validUntil: null,
    });

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-double-discount')
      .send({
        cinemaId: CINEMA_ID,
        source: 'qr',
        customerMobile: '9876543210',
        couponCode: 'SAVE',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(201);
    // Never negative - clamped at the subtotal, not the raw sum of both discounts.
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.discount).toBe(250);
    expect(models.Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ total: '0.00', discount: '250.00' }),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// TIME columns as the driver actually hands them back
// ---------------------------------------------------------------------------

/**
 * Regression: a TIME column arrives as a Date, not a string.
 *
 * Every case above passes availability hours as 'HH:MM:SS' strings, which
 * `formatStoredTime` returns untouched - so none of them exercise the branch
 * that reads the Date's components, and a bug there went unnoticed.
 *
 * tedious materialises a SQL TIME as a Date pinned to 1970-01-01. WHICH
 * components carry the stored digits depends on the connection's `useUTC`,
 * and QBusto sets `useUTC: false` (config/config.js - the IST storage pair),
 * so the digits land in LOCAL components. Reading them with getUTC* shifted
 * every window by the IST offset: a 00:00-23:00 window became 18:30-17:30 and
 * excluded almost the whole day.
 *
 * The effect was invisible for a cinema whose products carry no availability
 * hours, because `unavailableReason` short-circuits on an empty list - which
 * is exactly why one cinema showed an empty catalogue while others looked
 * fine.
 */

/** A TIME value as the driver builds it under `useUTC: false`: local components. */
const driverTime = (h, m = 0, s = 0) => new Date(1970, 0, 1, h, m, s);

const driverHours = (start, end, dayOfWeek = ISO_THURSDAY) => [
  { id: 31, dayOfWeek, startTime: start, endTime: end },
];

describe('availability hours arriving as Date objects (driver shape)', () => {
  it('accepts an all-day window that spans the current time', () => {
    // The real-world shape: 00:00:00 -> 23:00:00, every day. Read with UTC
    // accessors this became 18:30 -> 17:30 and rejected 15:00.
    expect(
      unavailableReason(
        buildLink({ availabilityHours: driverHours(driverTime(0), driverTime(23), 0) }),
        NOW
      )
    ).toBeNull();
  });

  it('agrees with the string form for the same window', () => {
    const asDates = unavailableReason(
      buildLink({ availabilityHours: driverHours(driverTime(9), driverTime(18)) }),
      NOW
    );
    const asStrings = unavailableReason(
      buildLink({ availabilityHours: hours('09:00:00', '18:00:00') }),
      NOW
    );

    expect(asDates).toBe(asStrings);
    expect(asDates).toBeNull();
  });

  it('still rejects a window that genuinely excludes the current time', () => {
    // Guards against "fixed" by making everything available.
    expect(
      unavailableReason(
        buildLink({ availabilityHours: driverHours(driverTime(9), driverTime(12)) }),
        NOW
      )
    ).toBe('is not available at this time of day');
  });

  it('lists a product whose Date-shaped window is open right now', async () => {
    listProducts([
      buildProduct({
        link: { availabilityHours: driverHours(driverTime(0), driverTime(23), 0) },
      }),
    ]);

    const response = await request(app).get(`/api/consumer/cinemas/${CINEMA_ID}/products`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// screen_id is resolved server-side from screenName + seatRow, or refused
// ---------------------------------------------------------------------------

/**
 * `orders.screen_id` means "which auditorium", and the seat is carried
 * separately by `orders.seat_number`. The client never supplies `screen_id`
 * directly any more - only `screenName` (the session's own, always present
 * once a show is picked) and `seatRow` (required only when the cinema's
 * screen data is one row per seat row - see resolveScreenId).
 *
 * A QR's own screenId is never used as a fallback: it is fixed at print time
 * and, for exactly the cinemas whose screen data is one row per seat row, is
 * itself a seat-row record rather than the auditorium - substituting it
 * produced live orders reading `screen_id -> "Screen 1, row A"` against
 * `seat_number = "B5"`.
 */
describe('order creation with server-resolved screen id', () => {
  function arrangeCreatableOrder() {
    // A local transaction token: TX belongs to the describe block above.
    sequelize.transaction.mockImplementation((callback) => callback('TX-CREATE'));
    models.IdempotencyKey.findOne.mockResolvedValue(null);
    models.IdempotencyKey.create.mockResolvedValue({ id: 1 });
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, chainId: 1, isActive: true });
    models.Product.findAll.mockResolvedValue([{ id: 85, name: 'Cheese Nachos' }]);
    models.CinemaProduct.findAll.mockResolvedValue([buildLink({ productId: 85 })]);
    models.ProductPricing.findAll.mockResolvedValue([
      { productId: 85, dayOfWeek: 0, ...buildPricing() },
    ]);
    models.OrderStatus.findOne.mockResolvedValue({ id: 1 });
    models.PaymentStatus.findOne.mockResolvedValue({ id: 1 });
    models.Order.create.mockResolvedValue({
      id: 900,
      subtotal: '250.00',
      discount: '0.00',
      total: '250.00',
      createdAt: new Date(),
      items: [],
    });
    models.OrderItem.bulkCreate.mockResolvedValue([]);
    models.OrderStatusLog.create.mockResolvedValue({});
    models.PaymentStatusLog.create.mockResolvedValue({});
  }

  it('persists screen_id as NULL when no screenName was sent (no show picked)', async () => {
    arrangeCreatableOrder();

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-null-screen')
      .send({
        cinemaId: CINEMA_ID,
        seatNumber: 'B5',
        source: 'qr',
        customerMobile: '9876543210',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(201);

    const [values] = models.Order.create.mock.calls[0];
    expect(values.screenId).toBeNull();
    // The seat is unaffected - it travels on its own column.
    expect(values.seatNumber).toBe('B5');

    // No screenName means nothing to look up.
    expect(models.Screen.findAll).not.toHaveBeenCalled();
  });

  it('resolves screen_id by name alone for an auditorium-grain screen', async () => {
    arrangeCreatableOrder();
    models.Screen.findAll.mockResolvedValue([
      { id: 7, name: 'SCREEN 1', seatRow: null },
      { id: 8, name: 'SCREEN 2', seatRow: null },
    ]);

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-resolved-screen')
      .send({
        cinemaId: CINEMA_ID,
        screenName: 'SCREEN 1',
        seatNumber: 'B5',
        source: 'qr',
        customerMobile: '9876543210',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(201);
    expect(models.Order.create.mock.calls[0][0].screenId).toBe(7);
  });

  it('resolves screen_id from name + seatRow for a seat-row-grain screen', async () => {
    arrangeCreatableOrder();
    models.Screen.findAll.mockResolvedValue([
      { id: 22, name: 'SCREEN 1', seatRow: 'A' },
      { id: 23, name: 'SCREEN 1', seatRow: 'B' },
    ]);

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-resolved-row')
      .send({
        cinemaId: CINEMA_ID,
        screenName: 'SCREEN 1',
        seatRow: 'B',
        seatNumber: 'B5',
        source: 'qr',
        customerMobile: '9876543210',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(201);
    expect(models.Order.create.mock.calls[0][0].screenId).toBe(23);
  });

  it('rejects the order when a seat-row-grain screen has no matching row', async () => {
    arrangeCreatableOrder();
    models.Screen.findAll.mockResolvedValue([
      { id: 22, name: 'SCREEN 1', seatRow: 'A' },
      { id: 23, name: 'SCREEN 1', seatRow: 'B' },
    ]);

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-unmatched-row')
      .send({
        cinemaId: CINEMA_ID,
        screenName: 'SCREEN 1',
        seatRow: 'Z',
        seatNumber: 'Z5',
        source: 'qr',
        customerMobile: '9876543210',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('seatRow');
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects the order when screenName is unknown at the cinema', async () => {
    arrangeCreatableOrder();
    models.Screen.findAll.mockResolvedValue([{ id: 7, name: 'SCREEN 1', seatRow: null }]);

    const response = await request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', 'key-unknown-screen')
      .send({
        cinemaId: CINEMA_ID,
        screenName: 'IMAX',
        seatNumber: 'B5',
        source: 'qr',
        customerMobile: '9876543210',
        items: [{ productId: 85, quantity: 1 }],
      });

    expect(response.status).toBe(400);
    expect(models.Order.create).not.toHaveBeenCalled();
  });
});
