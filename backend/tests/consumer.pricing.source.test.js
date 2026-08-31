'use strict';

/**
 * The catalogue prices against the channel the order will be charged against.
 *
 * THE BUG THIS PINS
 *
 * `getProducts` and `getProductDetail` used to compute their displayed
 * discount against a hardcoded `ORDER_SOURCES.QR`, while `createOrder` used
 * the customer's real `source`. Any cinema whose `discount_on_seat_qr` (or
 * _kiosk, or _counter) differed from `discount_on_qr` therefore showed one
 * price on the card and charged another at checkout - silently, with no error
 * anywhere, and worse for the customer in exactly the case a cinema was most
 * likely to configure deliberately.
 *
 * These tests drive the real HTTP stack, so they cover the whole path the
 * query string actually takes: route -> controller -> deriveSource ->
 * unitDiscountPaise. The final describe covers the consequence that is easy
 * to miss - the cache key MUST carry the source, or fixing the display just
 * moves the bug into Redis.
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

const { models } = require('../src/config/database');
const createApp = require('../src/app');

const app = createApp();

const CINEMA_ID = 3;
const PRODUCT_ID = 17;

const BASE_PRICE = '250.00';

/**
 * A price row whose four channel discounts are all DIFFERENT, and none of
 * which equals the fallback `discountValue`.
 *
 * Deliberately all-distinct: if any two matched, a test asserting the right
 * column was read could pass while reading the wrong one. The fallback is
 * distinct too, so "ignored the source entirely and used discountValue" is
 * also a visible failure rather than a coincidence.
 *
 * Percentages of ₹250: qr 10% = ₹25 -> ₹225, seat_qr 20% = ₹50 -> ₹200,
 * kiosk 5% = ₹12.50 -> ₹237.50, counter 40% = ₹100 -> ₹150, fallback 50%.
 */
const DISTINCT_PRICING = {
  basePrice: BASE_PRICE,
  discountType: 'P',
  discountValue: 50,
  discountOnQr: 10,
  discountOnSeatQr: 20,
  discountOnKiosk: 5,
  discountOnCounter: 40,
};

/** What each source must be shown, given DISTINCT_PRICING. */
const EXPECTED = {
  qr: 225,
  seat_qr: 200,
  kiosk: 237.5,
  counter: 150,
};

function buildLink() {
  return {
    id: 12,
    productId: PRODUCT_ID,
    availableFrom: null,
    availableUntil: null,
    isActive: true,
    availabilityHours: [],
  };
}

function buildProduct(pricing = DISTINCT_PRICING) {
  return {
    id: PRODUCT_ID,
    categoryId: 4,
    name: 'Cheese Nachos',
    description: 'Warm nachos',
    imageUrl: null,
    weight: '150g',
    cinemaProducts: [buildLink()],
    pricings: [{ ...pricing }],
  };
}

function seed(pricing = DISTINCT_PRICING) {
  models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, isActive: true });
  models.Product.findAll.mockResolvedValue([buildProduct(pricing)]);
  models.Product.findOne.mockResolvedValue(buildProduct(pricing));
}

/**
 * A seat, sent by default on every request these tests make.
 *
 * `seat_qr` is only honoured when the request names a seat (see
 * pricing.service.deriveSource), so a suite about "the price for source X"
 * has to carry the evidence for X or it would be testing the downgrade
 * instead. The downgrade has its own describe block below, which passes
 * `null` here deliberately.
 */
const SEAT = 'A5';

function query(source, seat) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (seat) params.set('seat', seat);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const listUrl = (source, seat = SEAT) =>
  `/api/consumer/cinemas/${CINEMA_ID}/products${query(source, seat)}`;

const detailUrl = (source, seat = SEAT) =>
  `/api/consumer/cinemas/${CINEMA_ID}/products/${PRODUCT_ID}${query(source, seat)}`;

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

// ---------------------------------------------------------------------------
// One test per source, on both endpoints
// ---------------------------------------------------------------------------

describe('the listing prices against the requested source', () => {
  it.each(Object.entries(EXPECTED))('%s is priced at %p', async (source, expected) => {
    const response = await request(app).get(listUrl(source));

    expect(response.status).toBe(200);
    expect(response.body.data[0].basePrice).toBe(expected);
  });
});

describe('product detail prices against the requested source', () => {
  it.each(Object.entries(EXPECTED))('%s is priced at %p', async (source, expected) => {
    const response = await request(app).get(detailUrl(source));

    expect(response.status).toBe(200);
    expect(response.body.data.basePrice).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The four sources genuinely disagree - the case the bug was invisible without
// ---------------------------------------------------------------------------

describe('sources whose prices differ', () => {
  it('returns four different prices for the four sources', async () => {
    const prices = {};

    for (const source of Object.keys(EXPECTED)) {
      const response = await request(app).get(listUrl(source));
      prices[source] = response.body.data[0].basePrice;
    }

    // The whole point: no two channels collapse onto the same number, so a
    // regression that pins one source for everyone cannot pass this.
    expect(new Set(Object.values(prices)).size).toBe(4);
    expect(prices).toEqual(EXPECTED);
  });

  it('a seat_qr customer is no longer shown the lobby price', async () => {
    const lobby = await request(app).get(listUrl('qr'));
    const seat = await request(app).get(listUrl('seat_qr'));

    // This is the exact assertion that failed before the fix: both were 225.
    expect(lobby.body.data[0].basePrice).toBe(225);
    expect(seat.body.data[0].basePrice).toBe(200);
    expect(seat.body.data[0].basePrice).not.toBe(lobby.body.data[0].basePrice);
  });

  it('shows the price the order will actually charge', async () => {
    // buildOrderLines uses unitDiscountPaise with the order's own source, so
    // agreement is asserted against that function rather than a copied
    // constant - a change to either side breaks this test.
    const { unitDiscountPaise, toPaise } = require('../src/services/pricing.service');

    for (const source of Object.keys(EXPECTED)) {
      const response = await request(app).get(listUrl(source));

      const unitPaise = toPaise(BASE_PRICE);
      const charged = (unitPaise - unitDiscountPaise(DISTINCT_PRICING, source, unitPaise)) / 100;

      expect(response.body.data[0].basePrice).toBe(charged);
    }
  });
});

// ---------------------------------------------------------------------------
// The parameter is untrusted input
// ---------------------------------------------------------------------------

describe('an unrecognised source falls back to qr, never to the fallback discount', () => {
  it.each([
    ['omitted', undefined],
    ['empty', ''],
    ['nonsense', 'not-a-source'],
    ['wrong case', 'SEAT_QR'],
    ['padded', ' counter '],
    ['prototype key', '__proto__'],
    ['prototype key', 'constructor'],
    ['inherited method', 'toString'],
  ])('%s -> %s', async (_label, source) => {
    const response = await request(app).get(listUrl(source));

    expect(response.status).toBe(200);

    // Only the two that normalise to a real source keep their own price.
    const expected =
      source === 'SEAT_QR' ? EXPECTED.seat_qr : source === ' counter ' ? EXPECTED.counter : 225;

    expect(response.body.data[0].basePrice).toBe(expected);
    // 125 is what `discountValue` (50%) would produce. Reaching it would mean
    // the source resolved to a column name no pricing row has.
    expect(response.body.data[0].basePrice).not.toBe(125);
  });
});

// ---------------------------------------------------------------------------
// Cache separation - the consequence of making the response vary by source
// ---------------------------------------------------------------------------

describe('the cache key separates the sources', () => {
  const cache = require('../src/services/cache.service');
  const consumerService = require('../src/services/consumer.service');
  const redis = require('../src/config/redis');

  /** An in-memory Redis, so key construction is observable. */
  function useFakeRedis() {
    const store = new Map();

    jest.spyOn(redis, 'isEnabled').mockReturnValue(true);
    jest.spyOn(redis, 'getRaw').mockImplementation(async (key) => store.get(key) ?? null);
    jest
      .spyOn(redis, 'get')
      .mockImplementation(async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null));
    jest.spyOn(redis, 'set').mockImplementation(async (key, value) => {
      store.set(key, JSON.stringify(value));
    });
    jest.spyOn(redis, 'increment').mockImplementation(async (key) => {
      const next = Number.parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(next));
      return next;
    });

    return store;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives each source its own entry rather than sharing one', async () => {
    const store = useFakeRedis();

    for (const source of Object.keys(EXPECTED)) {
      await consumerService.getProducts(CINEMA_ID, { limit: 20, page: 1, source, seat: SEAT });
    }

    const productKeys = [...store.keys()].filter((key) => key.includes(':products:'));

    // Four sources, four distinct keys. One key here would mean the first
    // channel to warm the cache dictates the price every other channel sees.
    expect(productKeys).toHaveLength(4);
    expect(new Set(productKeys).size).toBe(4);
  });

  it('never serves one source the price cached for another', async () => {
    useFakeRedis();

    // Warm on seat_qr first, deliberately: this is the ordering that produced
    // the wrong answer when source was absent from the key.
    const seat = await consumerService.getProducts(CINEMA_ID, {
      limit: 20,
      page: 1,
      source: 'seat_qr',
      seat: SEAT,
    });
    const qr = await consumerService.getProducts(CINEMA_ID, {
      limit: 20,
      page: 1,
      source: 'qr',
      seat: SEAT,
    });

    expect(seat.products[0].basePrice).toBe(EXPECTED.seat_qr);
    expect(qr.products[0].basePrice).toBe(EXPECTED.qr);
  });

  it('product detail separates sources too', async () => {
    const store = useFakeRedis();

    for (const source of Object.keys(EXPECTED)) {
      await consumerService.getProductDetail(CINEMA_ID, PRODUCT_ID, source, SEAT);
    }

    expect([...store.keys()].filter((key) => key.includes(':product:'))).toHaveLength(4);
  });

  it('bounds key cardinality: unrecognised sources all collapse onto qr', async () => {
    const store = useFakeRedis();

    // If the raw query value reached the key, an unauthenticated caller could
    // mint unlimited entries and exhaust Redis just by varying it.
    for (const source of ['junk-1', 'junk-2', 'junk-3', '__proto__', '', null, undefined]) {
      await consumerService.getProducts(CINEMA_ID, { limit: 20, page: 1, source, seat: SEAT });
    }

    expect([...store.keys()].filter((key) => key.includes(':products:'))).toHaveLength(1);
  });

  it('a catalogue write invalidates every source at once', async () => {
    useFakeRedis();

    const warmed = {};
    for (const source of Object.keys(EXPECTED)) {
      const result = await consumerService.getProducts(CINEMA_ID, {
        limit: 20,
        page: 1,
        source,
        seat: SEAT,
      });
      warmed[source] = result.products[0].basePrice;
    }
    expect(warmed).toEqual(EXPECTED);

    // Re-price the product: every channel's discount doubles.
    models.Product.findAll.mockResolvedValue([
      buildProduct({
        ...DISTINCT_PRICING,
        discountOnQr: 20,
        discountOnSeatQr: 40,
        discountOnKiosk: 10,
        discountOnCounter: 80,
      }),
    ]);

    // The generation bump is global, so ONE write must clear all four - not
    // just the source that happened to be written through.
    await cache.invalidateCatalogue();

    const after = {};
    for (const source of Object.keys(EXPECTED)) {
      const result = await consumerService.getProducts(CINEMA_ID, {
        limit: 20,
        page: 1,
        source,
        seat: SEAT,
      });
      after[source] = result.products[0].basePrice;
    }

    expect(after).toEqual({ qr: 200, seat_qr: 150, kiosk: 225, counter: 50 });
  });
});

// ---------------------------------------------------------------------------
// The seat rate has to be earned
// ---------------------------------------------------------------------------

/**
 * `source` is client-declared - it is a query-string value on an endpoint with
 * no authentication at all - so on its own it is a claim about a channel, not
 * a fact about one. It also selects a discount column, which makes it a claim
 * about a PRICE.
 *
 * `seat_qr` is the one source a request can substantiate from what it already
 * carries: a seat QR is by definition a QR with a seat on it. So the rule is
 * that a seat_qr claim naming no seat is served the lobby rate, on both the
 * catalogue and the order, from the same function - see
 * pricing.service.deriveSource.
 *
 * The fixture makes this visible: seat_qr is the BEST rate of the four
 * (200 vs qr's 225), so a downgrade that silently failed open would show up
 * as a cheaper price, not an equal one.
 */
describe('a seat_qr claim with no seat is priced as qr', () => {
  it('the listing serves the lobby rate when no seat is named', async () => {
    const response = await request(app).get(listUrl('seat_qr', null));

    expect(response.status).toBe(200);
    expect(response.body.data[0].basePrice).toBe(EXPECTED.qr);
    expect(response.body.data[0].basePrice).not.toBe(EXPECTED.seat_qr);
  });

  it('product detail serves the lobby rate when no seat is named', async () => {
    const response = await request(app).get(detailUrl('seat_qr', null));

    expect(response.status).toBe(200);
    expect(response.body.data.basePrice).toBe(EXPECTED.qr);
  });

  it('an empty seat is no seat', async () => {
    const response = await request(app).get(
      `/api/consumer/cinemas/${CINEMA_ID}/products?source=seat_qr&seat=`
    );

    expect(response.body.data[0].basePrice).toBe(EXPECTED.qr);
  });

  it('naming a seat restores the seat rate', async () => {
    const withSeat = await request(app).get(listUrl('seat_qr', 'B12'));
    const without = await request(app).get(listUrl('seat_qr', null));

    expect(withSeat.body.data[0].basePrice).toBe(EXPECTED.seat_qr);
    expect(without.body.data[0].basePrice).toBe(EXPECTED.qr);
  });

  it('leaves the other three sources alone - only seat_qr is seat-evidenced', async () => {
    for (const source of ['qr', 'kiosk', 'counter']) {
      const response = await request(app).get(listUrl(source, null));
      expect(response.body.data[0].basePrice).toBe(EXPECTED[source]);
    }
  });

  /**
   * The cache key has to carry the DERIVED source, not the claimed one.
   *
   * Keying on the claim would file this lobby-priced payload under `seat_qr`,
   * and the next request that DID name a seat would be handed it - a seatless
   * caller poisoning the seat channel for everyone. This is the same class of
   * bug as omitting source from the key entirely, one level deeper.
   */
  it('does not poison the seat_qr cache entry with a seatless response', async () => {
    const cache = require('../src/services/cache.service');
    const consumerService = require('../src/services/consumer.service');
    const redis = require('../src/config/redis');

    const store = new Map();
    jest.spyOn(redis, 'isEnabled').mockReturnValue(true);
    jest.spyOn(redis, 'getRaw').mockImplementation(async (key) => store.get(key) ?? null);
    jest
      .spyOn(redis, 'get')
      .mockImplementation(async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null));
    jest.spyOn(redis, 'set').mockImplementation(async (key, value) => {
      store.set(key, JSON.stringify(value));
    });
    jest.spyOn(redis, 'increment').mockImplementation(async (key) => {
      const next = Number.parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(next));
      return next;
    });

    try {
      await cache.invalidateCatalogue();

      // Seatless claim first - the ordering that would do the damage.
      const seatless = await consumerService.getProducts(CINEMA_ID, {
        limit: 20,
        page: 1,
        source: 'seat_qr',
      });
      expect(seatless.products[0].basePrice).toBe(EXPECTED.qr);

      // A genuine seat scan must still get its own rate, not the entry above.
      const seated = await consumerService.getProducts(CINEMA_ID, {
        limit: 20,
        page: 1,
        source: 'seat_qr',
        seat: SEAT,
      });
      expect(seated.products[0].basePrice).toBe(EXPECTED.seat_qr);

      // Two keys, not one: the seatless request landed on the qr entry.
      const productKeys = [...store.keys()].filter((key) => key.includes(':products:'));
      expect(productKeys).toHaveLength(2);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// The order path applies the SAME rule - which is the half that costs money
// ---------------------------------------------------------------------------

/**
 * The catalogue only displays a price; `createOrder` charges one. If the two
 * derived their source differently, fixing the display would simply move the
 * mismatch rather than close it - so this asserts the rule where it is
 * enforced for real, on the totals actually written to `orders`.
 *
 * It also asserts what is RECORDED. `orders.source` is written from the
 * derived value, not the claim, so an order that asked for the seat rate
 * without a seat is stored as the `qr` order it was charged as. Staff reading
 * that row later, or anyone reconciling revenue by channel, sees what
 * happened rather than what was asserted.
 */
describe('order creation earns the seat rate the same way', () => {
  const { sequelize } = require('../src/config/database');
  const TX = Symbol('transaction');

  function arrangeOrder() {
    sequelize.transaction.mockImplementation((callback) => callback(TX));
    models.IdempotencyKey.findOne.mockResolvedValue(null);
    models.IdempotencyKey.create.mockResolvedValue({});
    models.Cinema.findByPk.mockResolvedValue({ id: CINEMA_ID, chainId: 1, isActive: true });
    models.Product.findAll.mockResolvedValue([{ id: PRODUCT_ID, name: 'Cheese Nachos' }]);
    models.CinemaProduct.findAll.mockResolvedValue([buildLink()]);
    models.ProductPricing.findAll.mockResolvedValue([
      { productId: PRODUCT_ID, dayOfWeek: 0, ...DISTINCT_PRICING },
    ]);
    models.OrderStatus.findOne.mockResolvedValue({ id: 1 });
    models.PaymentStatus.findOne.mockResolvedValue({ id: 1 });
    models.OrderStatusLog.create.mockResolvedValue({});
    models.PaymentStatusLog.create.mockResolvedValue({});
    models.OrderItem.bulkCreate.mockResolvedValue([]);
    models.Order.create.mockImplementation(async (values) => ({ ...values, id: 900 }));
    models.Order.findByPk.mockResolvedValue({ id: 900, orderItems: [] });
  }

  async function placeOrder(body, key) {
    return request(app)
      .post('/api/consumer/orders')
      .set('Idempotency-Key', key)
      .send({
        cinemaId: CINEMA_ID,
        source: 'seat_qr',
        customerMobile: '9876543210',
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        ...body,
      });
  }

  beforeEach(() => {
    arrangeOrder();
  });

  it('charges the seat rate, and records it, when a seat is given', async () => {
    await placeOrder({ seatNumber: 'A5' }, 'source-order-with-seat');

    const written = models.Order.create.mock.calls[0][0];
    expect(written.source).toBe('seat_qr');
    expect(Number(written.total)).toBe(EXPECTED.seat_qr);
  });

  it('charges the lobby rate, and records qr, when no seat is given', async () => {
    await placeOrder({ seatNumber: null }, 'source-order-no-seat');

    const written = models.Order.create.mock.calls[0][0];
    // Recorded as what it was charged as, not as what it claimed to be.
    expect(written.source).toBe('qr');
    expect(Number(written.total)).toBe(EXPECTED.qr);
    expect(Number(written.total)).not.toBe(EXPECTED.seat_qr);
  });

  it('agrees with the catalogue in both directions', async () => {
    // The whole point of the rule living in one function: whatever the card
    // showed for a given (source, seat) is what the bill says for it.
    await placeOrder({ seatNumber: 'A5' }, 'source-agree-seat');
    const withSeat = Number(models.Order.create.mock.calls[0][0].total);

    models.Order.create.mockClear();
    await placeOrder({ seatNumber: null }, 'source-agree-noseat');
    const withoutSeat = Number(models.Order.create.mock.calls[0][0].total);

    // Back to the catalogue's own fixture: the order harness above replaced
    // Product.findAll with the lean shape createOrder reads.
    seed();

    const shownWithSeat = await request(app).get(listUrl('seat_qr', 'A5'));
    const shownWithout = await request(app).get(listUrl('seat_qr', null));

    expect(withSeat).toBe(shownWithSeat.body.data[0].basePrice);
    expect(withoutSeat).toBe(shownWithout.body.data[0].basePrice);
  });

  it('leaves kiosk and counter orders priced as claimed', async () => {
    for (const source of ['kiosk', 'counter']) {
      models.Order.create.mockClear();
      await placeOrder({ source, seatNumber: null }, `source-order-${source}`);

      const written = models.Order.create.mock.calls[0][0];
      expect(written.source).toBe(source);
      expect(Number(written.total)).toBe(EXPECTED[source]);
    }
  });
});
