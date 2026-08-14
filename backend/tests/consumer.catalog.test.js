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
    Screen: { findOne: jest.fn() },
    Product: { findAll: jest.fn(), findOne: jest.fn() },
    CinemaProduct: { findAll: jest.fn() },
    ProductPricing: { findAll: jest.fn() },
    Order: { findByPk: jest.fn(), create: jest.fn() },
    OrderItem: { bulkCreate: jest.fn() },
    OrderStatus: { findOne: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    IdempotencyKey: { findOne: jest.fn(), create: jest.fn() },
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
