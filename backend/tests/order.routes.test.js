'use strict';

/**
 * End-to-end tests for /api/orders, /api/order-statuses and
 * /api/payment-statuses.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * permission checks, tenant scoping, server-side pricing, availability, the
 * transition graph, audit logging and transaction boundaries - rather than the
 * SQL it emits.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Cinema: { findOne: jest.fn() },
    Screen: { findOne: jest.fn() },
    Product: { findAll: jest.fn() },
    CinemaProduct: { findAll: jest.fn() },
    ProductPricing: { findAll: jest.fn() },
    // `update` is the static, not the instance method: status transitions are
    // compare-and-set writes issued as Order.update({...}, { where: { id, statusId } }),
    // so that a concurrent writer makes them match zero rows.
    Order: {
      findOne: jest.fn(),
      findAndCountAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    OrderItem: { bulkCreate: jest.fn() },
    OrderStatus: { findOne: jest.fn(), findAll: jest.fn() },
    PaymentStatus: { findOne: jest.fn(), findAll: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
    PaymentStatusLog: { create: jest.fn() },
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
const { generateAccessToken } = require('../src/utils/jwt');

const app = createApp();

const FULL = [{ moduleName: 'Orders', canRead: true, canEdit: true, canDelete: true }];
const READ_ONLY = [{ moduleName: 'Orders', canRead: true, canEdit: false, canDelete: false }];

/** Stable ids for the seeded master rows, so a test can assert what was written. */
const ORDER_STATUS_IDS = {
  initiated: 1,
  confirmed: 2,
  preparing: 3,
  ready: 4,
  delivered: 5,
  rejected: 6,
};

const PAYMENT_STATUS_IDS = { pending: 1, paid: 2, failed: 3, refunded: 4 };

/** The transaction handle the service threads through every call. */
const TX = Symbol('transaction');

let rolledBack = false;

function buildActor(overrides = {}) {
  return {
    id: 7,
    chainId: 1,
    cinemaId: null,
    role: 'cinema_admin',
    username: 'alice',
    isActive: true,
    permissions: FULL,
    ...overrides,
  };
}

/** An owner bypasses the permission table entirely, so they need no grants. */
function buildOwner(overrides = {}) {
  return buildActor({ role: 'owner', permissions: [], ...overrides });
}

function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

function cinemaInclude(mockCall) {
  return mockCall.include.find((entry) => entry.association === 'cinema');
}

function buildOrder(overrides = {}) {
  return {
    id: 30,
    cinemaId: 3,
    screenId: 8,
    seatNumber: 'H12',
    statusId: ORDER_STATUS_IDS.initiated,
    paymentStatusId: PAYMENT_STATUS_IDS.pending,
    source: 'seat_qr',
    customerMobile: '9876543210',
    customerEmail: null,
    filmTitle: 'Dune: Part Two',
    showTime: null,
    // Numbers, not strings: the SQL Server driver returns DECIMAL as a JS
    // number, so this is the shape a loaded order actually has. The write path
    // is the other way round - the service writes exact decimal strings.
    subtotal: 500,
    discount: 50,
    total: 450,
    smsStatus: null,
    whatsappStatus: null,
    razorpayOrderId: null,
    razorpayPaymentId: null,
    notes: null,
    deliveredAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    status: { id: ORDER_STATUS_IDS.initiated, code: 'initiated' },
    paymentStatus: { id: PAYMENT_STATUS_IDS.pending, code: 'pending' },
    items: [],
    update: jest.fn(function update(values) {
      Object.assign(this, values);
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** A cinema_product that is carried, active and under no time restriction. */
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

function buildPricing(overrides = {}) {
  return {
    id: 22,
    cinemaId: 3,
    productId: 17,
    dayOfWeek: 0,
    basePrice: 250,
    discountType: null,
    discountValue: null,
    discountOnQr: null,
    discountOnKiosk: null,
    discountOnSeatQr: null,
    discountOnCounter: null,
    ...overrides,
  };
}

/**
 * Wire up a create that succeeds: one active cinema, one screen, one product
 * carried at that cinema with a price.
 */
function creatableOrder({ pricing = buildPricing(), link = buildLink() } = {}) {
  models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: true });
  models.Screen.findOne.mockResolvedValue({ id: 8, isActive: true });
  models.Product.findAll.mockResolvedValue([{ id: 17, name: 'Salted Popcorn', isActive: true }]);
  models.CinemaProduct.findAll.mockResolvedValue([link]);
  models.ProductPricing.findAll.mockResolvedValue([pricing]);
  models.Order.create.mockImplementation((values) => Promise.resolve({ id: 30, ...values }));
  models.OrderItem.bulkCreate.mockResolvedValue([]);
  models.OrderStatusLog.create.mockResolvedValue({});
  models.PaymentStatusLog.create.mockResolvedValue({});
  // createOrder re-reads the order through getOrder once the transaction commits.
  models.Order.findOne.mockResolvedValue(buildOrder());
}

const VALID_ORDER = { cinemaId: 3, items: [{ productId: 17, quantity: 2 }] };

beforeEach(() => {
  rolledBack = false;

  // The default for a transition that wins its compare-and-set: one row
  // matched. Tests that simulate losing the race override this with [0].
  models.Order.update.mockResolvedValue([1]);

  sequelize.transaction.mockImplementation(async (callback) => {
    try {
      return await callback(TX);
    } catch (err) {
      rolledBack = true;
      throw err;
    }
  });

  models.OrderStatus.findOne.mockImplementation(({ where }) =>
    Promise.resolve(ORDER_STATUS_IDS[where.code] ? { id: ORDER_STATUS_IDS[where.code] } : null)
  );
  models.PaymentStatus.findOne.mockImplementation(({ where }) =>
    Promise.resolve(PAYMENT_STATUS_IDS[where.code] ? { id: PAYMENT_STATUS_IDS[where.code] } : null)
  );
});

describe('GET /api/orders', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/orders');

    expect(response.status).toBe(401);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Orders read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/orders').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user holding only the Products permission', async () => {
    const token = authenticateAs(
      buildActor({
        permissions: [{ moduleName: 'Products', canRead: true, canEdit: true, canDelete: true }],
      })
    );

    const response = await request(app).get('/api/orders').set('Authorization', token);

    expect(response.status).toBe(403);
  });

  it('returns a page of orders with pagination meta', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.Order.findAndCountAll.mockResolvedValue({ rows: [buildOrder()], count: 1 });

    const response = await request(app).get('/api/orders').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 30, cinemaId: 3, total: 450 });
    expect(response.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('flattens both statuses to their codes', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [buildOrder()], count: 1 });

    const response = await request(app).get('/api/orders').set('Authorization', token);

    expect(response.body.data[0].status).toBe('initiated');
    expect(response.body.data[0].paymentStatus).toBe('pending');
  });

  it('defaults to newest first', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders').set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].order).toEqual([['createdAt', 'DESC']]);
  });

  it('counts orders rather than joined item rows', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders').set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].distinct).toBe(true);
  });

  it('resolves a status code filter to its id', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app)
      .get('/api/orders?status=preparing&paymentStatus=paid')
      .set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].where).toMatchObject({
      statusId: ORDER_STATUS_IDS.preparing,
      paymentStatusId: PAYMENT_STATUS_IDS.paid,
    });
  });

  it('rejects a status that is not a seeded code', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/orders?status=shipped')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('rejects a numeric status id in place of a code', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/orders?status=3').set('Authorization', token);

    expect(response.status).toBe(400);
  });

  it('filters by cinema, screen and source', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app)
      .get('/api/orders?cinemaId=3&screenId=8&source=kiosk')
      .set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].where).toMatchObject({
      cinemaId: 3,
      screenId: 8,
      source: 'kiosk',
    });
  });

  it('bounds the created_at window on both sides', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app)
      .get('/api/orders?createdFrom=2026-01-01T00:00:00Z&createdTo=2026-02-01T00:00:00Z')
      .set('Authorization', token);

    const { createdAt } = models.Order.findAndCountAll.mock.calls[0][0].where;
    expect(Object.getOwnPropertySymbols(createdAt)).toHaveLength(2);
  });

  it('rejects a createdTo that is not after createdFrom', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/orders?createdFrom=2026-02-01T00:00:00Z&createdTo=2026-01-01T00:00:00Z')
      .set('Authorization', token);

    expect(response.status).toBe(400);
  });

  it('scopes a non-owner through the cinema join', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders').set('Authorization', token);

    expect(cinemaInclude(models.Order.findAndCountAll.mock.calls[0][0])).toMatchObject({
      required: true,
      where: { chainId: 4 },
    });
  });

  it('keeps the tenant join when filtering by a cinema in another chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders?cinemaId=99').set('Authorization', token);

    const call = models.Order.findAndCountAll.mock.calls[0][0];
    expect(call.where.cinemaId).toBe(99);
    expect(cinemaInclude(call).where).toEqual({ chainId: 4 });
  });

  it('leaves an owner unscoped', async () => {
    const token = authenticateAs(buildOwner());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders').set('Authorization', token);

    expect(cinemaInclude(models.Order.findAndCountAll.mock.calls[0][0]).where).toBeUndefined();
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/orders?sort=total;drop')
      .set('Authorization', token);

    expect(response.status).toBe(400);
  });

  it('loads items with the page rather than per order', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app).get('/api/orders').set('Authorization', token);

    const { include } = models.Order.findAndCountAll.mock.calls[0][0];
    expect(include.some((entry) => entry.association === 'items')).toBe(true);
  });
});

describe('GET /api/orders/:id', () => {
  it('returns the order with its items and both audit trails', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findOne.mockResolvedValue(
      buildOrder({
        items: [
          {
            id: 54,
            orderId: 30,
            productId: 17,
            productName: 'Salted Popcorn',
            posItemId: null,
            quantity: 2,
            unitPrice: 250,
            discount: 50,
            total: 450,
          },
        ],
        statusLogs: [
          {
            id: 71,
            orderId: 30,
            previousStatusId: null,
            newStatusId: ORDER_STATUS_IDS.initiated,
            previousStatus: null,
            newStatus: { id: ORDER_STATUS_IDS.initiated, code: 'initiated' },
            changedByUserId: 7,
            reason: 'Order created',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        paymentStatusLogs: [],
      })
    );

    const response = await request(app).get('/api/orders/30').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({
      productName: 'Salted Popcorn',
      quantity: 2,
      unitPrice: 250,
    });
    expect(response.body.data.statusLogs[0]).toMatchObject({
      previousStatus: null,
      newStatus: 'initiated',
      changedByUserId: 7,
    });
  });

  it('reports an order in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/orders/99').set('Authorization', token);

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.Order.findOne.mock.calls[0][0]).where).toEqual({ chainId: 4 });
  });
});

describe('POST /api/orders', () => {
  it('denies a user with only read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(403);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects an order with no items', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ cinemaId: 3, items: [] });

    expect(response.status).toBe(400);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects a quantity of zero', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ cinemaId: 3, items: [{ productId: 17, quantity: 0 }] });

    expect(response.status).toBe(400);
  });

  it('rejects a fractional quantity', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ cinemaId: 3, items: [{ productId: 17, quantity: 1.5 }] });

    expect(response.status).toBe(400);
  });

  it('rejects the same product listed twice', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({
        cinemaId: 3,
        items: [
          { productId: 17, quantity: 1 },
          { productId: 17, quantity: 2 },
        ],
      });

    expect(response.status).toBe(400);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('creates the order, prices it server-side and returns 201', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(201);
    expect(models.Order.create.mock.calls[0][0]).toMatchObject({
      cinemaId: 3,
      subtotal: '500.00',
      discount: '0.00',
      total: '500.00',
    });
  });

  it('ignores a price sent by the client', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({
        cinemaId: 3,
        subtotal: '1.00',
        total: '1.00',
        discount: '999.00',
        items: [{ productId: 17, quantity: 2, unitPrice: '0.01' }],
      });

    const created = models.Order.create.mock.calls[0][0];
    expect(created.total).toBe('500.00');
    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0].unitPrice).toBe('250.00');
  });

  it('writes an immutable snapshot of the product name and price', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0]).toMatchObject({
      orderId: 30,
      productId: 17,
      productName: 'Salted Popcorn',
      quantity: 2,
      unitPrice: '250.00',
      total: '500.00',
    });
  });

  it('applies a percentage discount per unit', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      pricing: buildPricing({ discountType: 'P', discountValue: 10 }),
    });

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    // 10% of 250.00 is 25.00 per unit, so 50.00 across two.
    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0]).toMatchObject({
      discount: '50.00',
      total: '450.00',
    });
    expect(models.Order.create.mock.calls[0][0]).toMatchObject({
      subtotal: '500.00',
      discount: '50.00',
      total: '450.00',
    });
  });

  it('applies a flat discount per unit', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      pricing: buildPricing({ discountType: 'F', discountValue: 30 }),
    });

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0]).toMatchObject({
      discount: '60.00',
      total: '440.00',
    });
  });

  it('prefers the channel discount matching the order source', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      pricing: buildPricing({
        discountType: 'P',
        discountValue: 10,
        discountOnKiosk: 20,
      }),
    });

    await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ ...VALID_ORDER, source: 'kiosk' });

    // 20% rather than the row's general 10%.
    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0].discount).toBe('100.00');
  });

  it('falls back to the general discount when the channel column is null', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      pricing: buildPricing({ discountType: 'P', discountValue: 10 }),
    });

    await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ ...VALID_ORDER, source: 'kiosk' });

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0].discount).toBe('50.00');
  });

  it('ignores a discount amount left behind with no discount type', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({ pricing: buildPricing({ discountType: null, discountValue: 10 }) });

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0].discount).toBe('0.00');
  });

  it('never lets a discount drive a line total below zero', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({ pricing: buildPricing({ discountType: 'F', discountValue: 9999 }) });

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0]).toMatchObject({
      discount: '500.00',
      total: '0.00',
    });
  });

  it('prices correctly when the driver hands decimals back as strings', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      // Sequelize can be configured to return DECIMAL as a string, and some
      // drivers do it by default. Pricing must not silently change shape with
      // it, so the arithmetic is proven against both forms.
      pricing: buildPricing({ basePrice: '250.00', discountType: 'P', discountValue: '10.00' }),
    });

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0]).toMatchObject({
      unitPrice: '250.00',
      discount: '50.00',
      total: '450.00',
    });
  });

  it('prefers a day-specific price over the every-day price', async () => {
    const token = authenticateAs(buildActor());
    const today = new Date().getDay() === 0 ? 7 : new Date().getDay();

    creatableOrder();
    models.ProductPricing.findAll.mockResolvedValue([
      buildPricing({ dayOfWeek: 0, basePrice: 250 }),
      buildPricing({ id: 23, dayOfWeek: today, basePrice: 300 }),
    ]);

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderItem.bulkCreate.mock.calls[0][0][0].unitPrice).toBe('300.00');
  });

  it('starts the order at initiated and pending', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.Order.create.mock.calls[0][0]).toMatchObject({
      statusId: ORDER_STATUS_IDS.initiated,
      paymentStatusId: PAYMENT_STATUS_IDS.pending,
    });
  });

  it('opens both audit trails with a null previous status', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.OrderStatusLog.create.mock.calls[0][0]).toMatchObject({
      orderId: 30,
      previousStatusId: null,
      newStatusId: ORDER_STATUS_IDS.initiated,
      changedByUserId: 7,
    });
    expect(models.PaymentStatusLog.create.mock.calls[0][0]).toMatchObject({
      previousStatusId: null,
      newStatusId: PAYMENT_STATUS_IDS.pending,
    });
  });

  it('writes the order, its items and both logs in one transaction', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(models.Order.create.mock.calls[0][1]).toEqual({ transaction: TX });
    expect(models.OrderItem.bulkCreate.mock.calls[0][1]).toEqual({ transaction: TX });
    expect(models.OrderStatusLog.create.mock.calls[0][1]).toEqual({ transaction: TX });
    expect(models.PaymentStatusLog.create.mock.calls[0][1]).toEqual({ transaction: TX });
  });

  it('rolls the whole order back when writing the items fails', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.OrderItem.bulkCreate.mockRejectedValue(new Error('insert failed'));

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    // The failure propagated out of the transaction rather than being swallowed
    // and reported as a created order.
    expect(response.body.success).toBe(false);
  });

  it('reports a cinema in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Cinema.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(404);
    expect(models.Cinema.findOne.mock.calls[0][0].where).toMatchObject({ id: 3, chainId: 4 });
  });

  it('refuses an order at a deactivated cinema', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.Cinema.findOne.mockResolvedValue({ id: 3, chainId: 1, isActive: false });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
  });

  it('reports a screen from another cinema as 404', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.Screen.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send({ ...VALID_ORDER, screenId: 99 });

    expect(response.status).toBe(404);
    expect(models.Screen.findOne.mock.calls[0][0].where).toMatchObject({
      id: 99,
      cinemaId: 3,
    });
  });

  it('reports a product outside the chain as 404', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.Product.findAll.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(404);
  });

  it('refuses a deactivated product', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.Product.findAll.mockResolvedValue([{ id: 17, name: 'Salted Popcorn', isActive: false }]);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('refuses a product the cinema does not carry', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.CinemaProduct.findAll.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/not carried at this cinema/);
  });

  it('refuses a product withdrawn from the cinema', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({ link: buildLink({ isActive: false }) });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
  });

  it('refuses a product whose date range has passed', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      link: buildLink({ availableUntil: new Date('2020-01-01T00:00:00Z') }),
    });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/no longer available/);
  });

  it('refuses a product outside its availability window', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({
      // Zero-width and on every day, so it never contains the current instant.
      link: buildLink({
        availabilityHours: [{ id: 31, dayOfWeek: 0, startTime: '00:00:00', endTime: '00:00:00' }],
      }),
    });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/not available at this time of day/);
  });

  it('allows a product with no availability windows at all', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder({ link: buildLink({ availabilityHours: [] }) });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(201);
  });

  it('refuses a product with no price at this cinema', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();
    models.ProductPricing.findAll.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', token)
      .send(VALID_ORDER);

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/no price set/);
  });

  it('only considers active price rows', async () => {
    const token = authenticateAs(buildActor());
    creatableOrder();

    await request(app).post('/api/orders').set('Authorization', token).send(VALID_ORDER);

    expect(models.ProductPricing.findAll.mock.calls[0][0].where.isActive).toBe(true);
  });
});

describe('PUT /api/orders/:id/status', () => {
  function orderIn(code) {
    const order = buildOrder({
      statusId: ORDER_STATUS_IDS[code],
      status: { id: ORDER_STATUS_IDS[code], code },
    });
    models.Order.findOne.mockResolvedValue(order);
    return order;
  }

  it('denies a user with only read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(403);
  });

  it('moves an order forward one step', async () => {
    const token = authenticateAs(buildActor());
    orderIn('initiated');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(200);
    expect(models.Order.update.mock.calls[0][0]).toMatchObject({
      statusId: ORDER_STATUS_IDS.confirmed,
    });
  });

  it('refuses a jump past the next step', async () => {
    const token = authenticateAs(buildActor());
    orderIn('initiated');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'delivered' });

    expect(response.status).toBe(409);
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  it('refuses a move backwards', async () => {
    const token = authenticateAs(buildActor());
    orderIn('ready');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(409);
  });

  it('refuses to change a delivered order', async () => {
    const token = authenticateAs(buildActor());
    orderIn('delivered');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'rejected' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/can no longer change/);
  });

  it('allows rejection from any live state', async () => {
    const token = authenticateAs(buildActor());
    orderIn('ready');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'rejected', reason: 'Customer never collected it' });

    expect(response.status).toBe(200);
    expect(models.OrderStatusLog.create.mock.calls[0][0]).toMatchObject({
      previousStatusId: ORDER_STATUS_IDS.ready,
      newStatusId: ORDER_STATUS_IDS.rejected,
      reason: 'Customer never collected it',
    });
    expect(models.Order.update).toHaveBeenCalled();
  });

  it('logs the move with both ends and the acting user', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(models.OrderStatusLog.create.mock.calls[0][0]).toMatchObject({
      orderId: 30,
      previousStatusId: ORDER_STATUS_IDS.confirmed,
      newStatusId: ORDER_STATUS_IDS.preparing,
      changedByUserId: 7,
    });
  });

  it('updates the order and writes the log in one transaction', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(models.Order.update.mock.calls[0][1]).toMatchObject({ transaction: TX });
    expect(models.OrderStatusLog.create.mock.calls[0][1]).toEqual({ transaction: TX });
  });

  it('stamps deliveredAt on delivery', async () => {
    const token = authenticateAs(buildActor());
    orderIn('ready');

    await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'delivered' });

    expect(models.Order.update.mock.calls[0][0].deliveredAt).toBeInstanceOf(Date);
  });

  it('treats a request for the current status as a no-op', async () => {
    const token = authenticateAs(buildActor());
    orderIn('preparing');

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  it('rejects a status that is not a seeded code', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .put('/api/orders/30/status')
      .set('Authorization', token)
      .send({ status: 'cancelled' });

    expect(response.status).toBe(400);
  });

  it('reports an order in another chain as 404', async () => {
    const token = authenticateAs(buildActor({ chainId: 4 }));
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/orders/99/status')
      .set('Authorization', token)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(404);
    expect(cinemaInclude(models.Order.findOne.mock.calls[0][0]).where).toEqual({ chainId: 4 });
  });
});

describe('PUT /api/orders/:id/payment-status', () => {
  function paymentIn(code) {
    const order = buildOrder({
      paymentStatusId: PAYMENT_STATUS_IDS[code],
      paymentStatus: { id: PAYMENT_STATUS_IDS[code], code },
    });
    models.Order.findOne.mockResolvedValue(order);
    return order;
  }

  it('marks a pending payment paid and logs it', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('pending');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'paid', reason: 'Cash at counter' });

    expect(response.status).toBe(200);
    expect(models.Order.update.mock.calls[0][0]).toMatchObject({
      paymentStatusId: PAYMENT_STATUS_IDS.paid,
    });
    expect(models.PaymentStatusLog.create.mock.calls[0][0]).toMatchObject({
      previousStatusId: PAYMENT_STATUS_IDS.pending,
      newStatusId: PAYMENT_STATUS_IDS.paid,
      changedByUserId: 7,
      reason: 'Cash at counter',
    });
  });

  it('never writes a gateway payment id', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('pending');

    await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'paid', razorpayPaymentId: 'pay_forged' });

    expect(models.PaymentStatusLog.create.mock.calls[0][0].razorpayPaymentId).toBeNull();
  });

  it('refuses to refund a payment that was never made', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('pending');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'refunded' });

    expect(response.status).toBe(409);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('allows a refund once paid', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('paid');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'refunded' });

    expect(response.status).toBe(200);
  });

  it('refuses to move a refunded payment anywhere', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('refunded');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'paid' });

    expect(response.status).toBe(409);
  });

  it('lets a failed payment be retried', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('failed');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'pending' });

    expect(response.status).toBe(200);
  });

  it('treats a request for the current payment status as a no-op', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('paid');

    const response = await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'paid' });

    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  it('updates the order and writes the log in one transaction', async () => {
    const token = authenticateAs(buildActor());
    paymentIn('pending');

    await request(app)
      .put('/api/orders/30/payment-status')
      .set('Authorization', token)
      .send({ paymentStatus: 'paid' });

    expect(models.Order.update.mock.calls[0][1]).toMatchObject({ transaction: TX });
    expect(models.PaymentStatusLog.create.mock.calls[0][1]).toEqual({ transaction: TX });
  });
});

describe('GET /api/order-statuses', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/order-statuses');

    expect(response.status).toBe(401);
  });

  it('returns every seeded order status', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));
    models.OrderStatus.findAll.mockResolvedValue([
      { id: 1, code: 'initiated', name: 'Initiated', description: null, isActive: true },
    ]);

    const response = await request(app).get('/api/order-statuses').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ id: 1, code: 'initiated' });
    // Master data, so no pagination block.
    expect(response.body.meta.pagination).toBeUndefined();
  });

  it('returns every seeded payment status', async () => {
    const token = authenticateAs(buildActor());
    models.PaymentStatus.findAll.mockResolvedValue([
      { id: 1, code: 'pending', name: 'Pending', description: null, isActive: true },
    ]);

    const response = await request(app).get('/api/payment-statuses').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data[0].code).toBe('pending');
  });

  it('denies a user without the Orders read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/order-statuses').set('Authorization', token);

    expect(response.status).toBe(403);
  });
});
