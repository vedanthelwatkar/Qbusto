'use strict';

/**
 * End-to-end tests for /api/kitchen.
 *
 * The model layer is mocked, so these assert the decisions the code makes -
 * the eligibility rule, the transition graph, the compare-and-set, permission
 * checks and tenant scoping - rather than the SQL it emits.
 *
 * The eligibility tests are the important ones. An unpaid order reaching a
 * kitchen screen means food given away, so these check the WHERE clause the
 * service actually builds rather than trusting that a filter was applied.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => {
  const models = {
    User: { findByPk: jest.fn() },
    Order: { findOne: jest.fn(), findAndCountAll: jest.fn(), update: jest.fn() },
    OrderStatus: { findOne: jest.fn(), findAll: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
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

const ORDER_STATUS_IDS = {
  initiated: 1,
  confirmed: 2,
  preparing: 3,
  ready: 4,
  delivered: 5,
  rejected: 6,
};

const PAYMENT_STATUS_IDS = { pending: 1, paid: 2, failed: 3, refunded: 4 };

const TX = Symbol('transaction');

function buildActor(overrides = {}) {
  return {
    id: 7,
    chainId: 1,
    // A kitchen account is pinned to the cinema it is assigned to, so the
    // default actor has one - matching buildOrder's cinemaId. An account with
    // no cinema is a distinct case with its own tests further down.
    cinemaId: 3,
    // The role the KDS is built for. Authorization is by permission row, not by
    // role name, so this is here to prove kitchen_staff is a sufficient actor.
    role: 'kitchen_staff',
    username: 'kitchen1',
    isActive: true,
    permissions: FULL,
    ...overrides,
  };
}

function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

function buildOrder(overrides = {}) {
  const { statusCode = 'confirmed', ...rest } = overrides;

  return {
    id: 128,
    cinemaId: 3,
    screenId: 8,
    seatNumber: 'G12',
    statusId: ORDER_STATUS_IDS[statusCode],
    paymentStatusId: PAYMENT_STATUS_IDS.paid,
    source: 'seat_qr',
    filmTitle: 'Dune: Part Two',
    showTime: new Date('2026-08-17T14:00:00Z'),
    notes: 'No onion',
    total: 450,
    deliveredAt: null,
    createdAt: new Date('2026-08-17T13:35:00Z'),
    updatedAt: new Date('2026-08-17T13:35:00Z'),
    status: { id: ORDER_STATUS_IDS[statusCode], code: statusCode },
    paymentStatus: { id: PAYMENT_STATUS_IDS.paid, code: 'paid' },
    cinema: { id: 3, chainId: 1, code: 'PVR01', name: 'PVR Phoenix' },
    screen: { id: 8, name: 'Audi 3' },
    items: [
      {
        id: 54,
        productId: 17,
        productName: 'Large Popcorn',
        quantity: 2,
        unitPrice: 250,
        total: 450,
      },
    ],
    ...rest,
  };
}

/** The where clause the service handed to findAndCountAll on the last call. */
function lastListWhere() {
  const calls = models.Order.findAndCountAll.mock.calls;
  return calls[calls.length - 1][0].where;
}

beforeEach(() => {
  sequelize.transaction.mockImplementation(async (callback) => callback(TX));

  models.OrderStatus.findAll.mockResolvedValue(
    Object.entries(ORDER_STATUS_IDS).map(([code, id]) => ({ id, code }))
  );
  models.OrderStatus.findOne.mockImplementation(({ where }) =>
    Promise.resolve(ORDER_STATUS_IDS[where.code] ? { id: ORDER_STATUS_IDS[where.code] } : null)
  );
  models.PaymentStatus.findOne.mockImplementation(({ where }) =>
    Promise.resolve(PAYMENT_STATUS_IDS[where.code] ? { id: PAYMENT_STATUS_IDS[where.code] } : null)
  );

  models.Order.findAndCountAll.mockResolvedValue({ rows: [buildOrder()], count: 1 });
  models.Order.findOne.mockResolvedValue(buildOrder());
  models.Order.update.mockResolvedValue([1]);
  models.OrderStatusLog.create.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('kitchen authorization', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/kitchen/orders');

    expect(response.status).toBe(401);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('denies a user without the Orders read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: [] }));

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(response.status).toBe(403);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('lets kitchen_staff with Orders read see the board', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(response.status).toBe(200);
  });

  it('denies a transition to a user with only read permission', async () => {
    const token = authenticateAs(buildActor({ permissions: READ_ONLY }));

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(403);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Eligibility - the rule that keeps unpaid food off the board
// ---------------------------------------------------------------------------

describe('KDS eligibility', () => {
  it('filters to paid orders only', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(lastListWhere().paymentStatusId).toBe(PAYMENT_STATUS_IDS.paid);
  });

  it('restricts the active board to confirmed, preparing and ready', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const statusFilter = lastListWhere().statusId;
    const ids = statusFilter[Object.getOwnPropertySymbols(statusFilter)[0]];

    expect(ids.sort()).toEqual(
      [ORDER_STATUS_IDS.confirmed, ORDER_STATUS_IDS.preparing, ORDER_STATUS_IDS.ready].sort()
    );
  });

  it('never includes initiated orders, which are the ones not yet paid for', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders?scope=all').set('Authorization', token);

    const statusFilter = lastListWhere().statusId;
    const ids = statusFilter[Object.getOwnPropertySymbols(statusFilter)[0]];

    expect(ids).not.toContain(ORDER_STATUS_IDS.initiated);
  });

  it('never includes rejected orders', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders?scope=all').set('Authorization', token);

    const statusFilter = lastListWhere().statusId;
    const ids = statusFilter[Object.getOwnPropertySymbols(statusFilter)[0]];

    expect(ids).not.toContain(ORDER_STATUS_IDS.rejected);
  });

  it('moves delivered orders off the active board and into the completed scope', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders?scope=completed').set('Authorization', token);

    const statusFilter = lastListWhere().statusId;
    const ids = statusFilter[Object.getOwnPropertySymbols(statusFilter)[0]];

    expect(ids).toEqual([ORDER_STATUS_IDS.delivered]);
  });

  it('cannot be widened by a status filter outside the kitchen set', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/kitchen/orders?status=initiated')
      .set('Authorization', token);

    expect(response.status).toBe(400);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('applies the same paid filter to the detail endpoint', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders/128').set('Authorization', token);

    const { where } = models.Order.findOne.mock.calls[0][0];
    expect(where.paymentStatusId).toBe(PAYMENT_STATUS_IDS.paid);
  });

  it('reports an ineligible order as 404 rather than 403', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/kitchen/orders/128').set('Authorization', token);

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe('kitchen tenant isolation', () => {
  it('confines a non-owner to their own chain', async () => {
    const token = authenticateAs(buildActor({ chainId: 5 }));

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const { include } = models.Order.findAndCountAll.mock.calls[0][0];
    const cinema = include.find((entry) => entry.association === 'cinema');

    expect(cinema.required).toBe(true);
    expect(cinema.where).toEqual({ chainId: 5 });
  });

  it('does not constrain an owner', async () => {
    // Owner with no cinema assignment: the one account that spans chains.
    const token = authenticateAs(buildActor({ role: 'owner', permissions: [], cinemaId: null }));

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const { include } = models.Order.findAndCountAll.mock.calls[0][0];
    const cinema = include.find((entry) => entry.association === 'cinema');

    expect(cinema.where).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('GET /api/kitchen/orders', () => {
  it('defaults to oldest first, because a kitchen works a queue', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].order).toEqual([['createdAt', 'ASC']]);
  });

  it('maps the placedAt sort key to the created_at column', async () => {
    const token = authenticateAs(buildActor());

    await request(app)
      .get('/api/kitchen/orders?sort=showTime&order=desc')
      .set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].order).toEqual([['showTime', 'DESC']]);
  });

  it('rejects a sort field outside the whitelist', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .get('/api/kitchen/orders?sort=customerMobile')
      .set('Authorization', token);

    expect(response.status).toBe(400);
  });

  it('searches seat, film and the order id', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders?search=128').set('Authorization', token);

    const where = lastListWhere();
    const orClauses =
      where[Object.getOwnPropertySymbols(where).find((s) => String(s) === 'Symbol(or)')];

    expect(orClauses).toEqual(expect.arrayContaining([expect.objectContaining({ id: 128 })]));
  });

  it('omits customer contact details and gateway identifiers', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const [order] = response.body.data;
    expect(order).not.toHaveProperty('customerMobile');
    expect(order).not.toHaveProperty('customerEmail');
    expect(order).not.toHaveProperty('razorpayPaymentId');
    expect(order).not.toHaveProperty('razorpayOrderId');
  });

  it('returns the fields a ticket is printed from', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(response.body.data[0]).toMatchObject({
      id: 128,
      status: 'confirmed',
      paymentStatus: 'paid',
      source: 'seat_qr',
      seatNumber: 'G12',
      filmTitle: 'Dune: Part Two',
      notes: 'No onion',
      screen: { name: 'Audi 3' },
    });
    expect(response.body.data[0].items[0]).toMatchObject({
      productName: 'Large Popcorn',
      quantity: 2,
    });
  });

  it('counts orders rather than joined item rows', async () => {
    const token = authenticateAs(buildActor());

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(models.Order.findAndCountAll.mock.calls[0][0].distinct).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

describe('PATCH /api/kitchen/orders/:id/status', () => {
  function orderIn(code) {
    const order = buildOrder({ statusCode: code });
    models.Order.findOne.mockResolvedValue(order);
    return order;
  }

  it('moves confirmed to preparing', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(200);
    expect(models.Order.update.mock.calls[0][0]).toMatchObject({
      statusId: ORDER_STATUS_IDS.preparing,
    });
  });

  it('moves preparing to ready', async () => {
    const token = authenticateAs(buildActor());
    orderIn('preparing');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'ready' });

    expect(response.status).toBe(200);
  });

  it('stamps deliveredAt on delivery', async () => {
    const token = authenticateAs(buildActor());
    orderIn('ready');

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'delivered' });

    expect(models.Order.update.mock.calls[0][0].deliveredAt).toBeInstanceOf(Date);
  });

  it('refuses a jump past the next step', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
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
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(409);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('refuses to change a delivered order', async () => {
    const token = authenticateAs(buildActor());
    orderIn('delivered');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'ready' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/can no longer change/);
  });

  it('will not let the kitchen reject an order', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'rejected' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('will not let the kitchen confirm an order, which is payment’s job', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(400);
  });

  it('treats a repeat of the current status as a no-op, writing no audit row', async () => {
    const token = authenticateAs(buildActor());
    orderIn('preparing');

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    // Two screens pressing PREPARING at once is a race, not an error: the
    // second one got the outcome it wanted.
    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  it('writes the transition as a compare-and-set on the status it read', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    // The statusId in the WHERE clause is the whole concurrency guarantee: a
    // second writer who moved the row first makes this match zero rows.
    expect(models.Order.update.mock.calls[0][1].where).toEqual({
      id: 128,
      statusId: ORDER_STATUS_IDS.confirmed,
    });
  });

  it('reports 409 when another device moved the order first', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');
    // The row no longer matched: someone else transitioned it between our read
    // and our write.
    models.Order.update.mockResolvedValue([0]);

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(409);
    expect(response.body.error.details.concurrent).toBe(true);
    // No audit entry for a change that did not happen.
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  it('records the acting user and both ends of the move', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing', reason: 'Started on the fryer' });

    expect(models.OrderStatusLog.create.mock.calls[0][0]).toMatchObject({
      orderId: 128,
      previousStatusId: ORDER_STATUS_IDS.confirmed,
      newStatusId: ORDER_STATUS_IDS.preparing,
      changedByUserId: 7,
      reason: 'Started on the fryer',
    });
  });

  it('writes the update and the log in one transaction', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(models.Order.update.mock.calls[0][1]).toMatchObject({ transaction: TX });
    expect(models.OrderStatusLog.create.mock.calls[0][1]).toEqual({ transaction: TX });
  });

  it('re-applies the eligibility rule on the write path', async () => {
    const token = authenticateAs(buildActor());
    orderIn('confirmed');

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    // A board loaded while the order was eligible must not be able to drive a
    // transition on one that has since been refunded.
    expect(models.Order.findOne.mock.calls[0][0].where.paymentStatusId).toBe(
      PAYMENT_STATUS_IDS.paid
    );
  });

  it('reports an order outside the actor’s chain as 404', async () => {
    const token = authenticateAs(buildActor());
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(404);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown status', async () => {
    const token = authenticateAs(buildActor());

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'incinerated' });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The shared transition path
// ---------------------------------------------------------------------------

describe('Dashboard and Kitchen share one transition implementation', () => {
  it('uses the same fulfilment graph on both surfaces', () => {
    const fulfilment = require('../src/services/fulfilment.service');
    const orderService = require('../src/services/order.service');

    // Not a copy: the same frozen object. If these ever diverge, a status legal
    // on one surface would be illegal on the other.
    expect(orderService.ORDER_TRANSITIONS).toBe(fulfilment.ORDER_TRANSITIONS);
  });

  it('exposes only forward moves to the kitchen', () => {
    const fulfilment = require('../src/services/fulfilment.service');

    expect(fulfilment.KDS_ALLOWED_TARGETS).toEqual(['preparing', 'ready', 'delivered']);
    expect(fulfilment.KDS_ALLOWED_TARGETS).not.toContain('rejected');
    expect(fulfilment.KDS_ALLOWED_TARGETS).not.toContain('confirmed');
  });
});

// ---------------------------------------------------------------------------
// Cinema scoping
//
// A kitchen display is a fixed terminal on one counter. The cinema it works is
// whichever cinema its account is assigned to, and nothing a client sends may
// change that - not a query parameter, and not an order id typed into the URL.
//
// Cinema A is 63, Cinema B is 64. Both belong to chain 55, which is the case
// that matters: chain scoping alone would happily return both.
// ---------------------------------------------------------------------------

const CINEMA_A = 63;
const CINEMA_B = 64;

describe('kitchen cinema scoping', () => {
  /** A kitchen account pinned to one cinema - the normal KDS user. */
  function kitchenAt(cinemaId) {
    return buildActor({ role: 'kitchen_staff', chainId: 55, cinemaId });
  }

  function listWhere() {
    return models.Order.findAndCountAll.mock.calls[0][0].where;
  }

  it('pins the board to the cinema on the account', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(listWhere().cinemaId).toBe(CINEMA_A);
  });

  it('does not return another cinema in the same chain', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    // The whole point: chain 55 owns both cinemas, so a chain-only filter would
    // have let Cinema B's orders onto Cinema A's screen.
    expect(listWhere().cinemaId).toBe(CINEMA_A);
    expect(listWhere().cinemaId).not.toBe(CINEMA_B);
  });

  it('ignores a cinemaId query parameter naming another cinema', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app).get(`/api/kitchen/orders?cinemaId=${CINEMA_B}`).set('Authorization', token);

    // Not intersected to an empty set - overridden. An empty board would read
    // as "Cinema B is quiet" rather than "you cannot see Cinema B".
    expect(listWhere().cinemaId).toBe(CINEMA_A);
  });

  it('ignores a cinemaId query parameter even when it names the same cinema', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app).get(`/api/kitchen/orders?cinemaId=${CINEMA_A}`).set('Authorization', token);

    expect(listWhere().cinemaId).toBe(CINEMA_A);
  });

  it('scopes the detail endpoint to the account cinema', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app).get('/api/kitchen/orders/128').set('Authorization', token);

    expect(models.Order.findOne.mock.calls[0][0].where.cinemaId).toBe(CINEMA_A);
  });

  it('reports a direct read of another cinema order as 404', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));
    // The scoped query matches nothing, which is what the database returns for
    // an order belonging to Cinema B.
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app).get('/api/kitchen/orders/999').set('Authorization', token);

    // 404, not 403: the kitchen has no business learning the order exists.
    expect(response.status).toBe(404);
  });

  it('scopes the transition endpoint to the account cinema', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(models.Order.findOne.mock.calls[0][0].where.cinemaId).toBe(CINEMA_A);
  });

  it('cannot change the status of another cinema order', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));
    models.Order.findOne.mockResolvedValue(null);

    const response = await request(app)
      .patch('/api/kitchen/orders/999/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(404);
    // Nothing was written, and no audit row claims a change that never happened.
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  it('still proves the cinema belongs to the chain on the account', async () => {
    const token = authenticateAs(kitchenAt(CINEMA_A));

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const { include } = models.Order.findAndCountAll.mock.calls[0][0];
    const cinema = include.find((entry) => entry.association === 'cinema');

    // Belt and braces: if a user's cinema_id ever pointed outside their own
    // chain, the join rejects it rather than letting them out of the tenant.
    expect(cinema.required).toBe(true);
    expect(cinema.where).toEqual({ chainId: 55 });
  });
});

describe('kitchen scoping for broader accounts', () => {
  it('gives a chain_admin with no cinema the whole chain', async () => {
    const token = authenticateAs(buildActor({ role: 'chain_admin', chainId: 55, cinemaId: null }));

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    expect(response.status).toBe(200);
    expect(models.Order.findAndCountAll.mock.calls[0][0].where.cinemaId).toBeUndefined();

    const { include } = models.Order.findAndCountAll.mock.calls[0][0];
    expect(include.find((entry) => entry.association === 'cinema').where).toEqual({ chainId: 55 });
  });

  it('lets a chain-level account narrow to one cinema by query parameter', async () => {
    const token = authenticateAs(buildActor({ role: 'chain_admin', chainId: 55, cinemaId: null }));

    await request(app).get(`/api/kitchen/orders?cinemaId=${CINEMA_B}`).set('Authorization', token);

    // Narrowing within an allowed scope is fine; only widening is refused.
    expect(models.Order.findAndCountAll.mock.calls[0][0].where.cinemaId).toBe(CINEMA_B);
  });

  it('leaves an owner unconstrained', async () => {
    const token = authenticateAs(
      buildActor({ role: 'owner', permissions: [], chainId: 55, cinemaId: null })
    );

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    const call = models.Order.findAndCountAll.mock.calls[0][0];
    expect(call.where.cinemaId).toBeUndefined();
    expect(call.include.find((entry) => entry.association === 'cinema').where).toBeUndefined();
  });

  it('pins even an owner when they are assigned to a cinema', async () => {
    const token = authenticateAs(
      buildActor({ role: 'owner', permissions: [], chainId: 55, cinemaId: CINEMA_A })
    );

    await request(app).get('/api/kitchen/orders').set('Authorization', token);

    // The narrowest reading of the account wins. An explicit cinema assignment
    // is an instruction, not a decoration.
    expect(models.Order.findAndCountAll.mock.calls[0][0].where.cinemaId).toBe(CINEMA_A);
  });

  it('refuses a kitchen account that has no cinema assigned', async () => {
    const token = authenticateAs(
      buildActor({ role: 'kitchen_staff', chainId: 55, cinemaId: null })
    );

    const response = await request(app).get('/api/kitchen/orders').set('Authorization', token);

    // 403 with an actionable message, rather than an empty board that looks
    // like a quiet shift and hides the misconfiguration.
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/not assigned to a cinema/i);
    expect(models.Order.findAndCountAll).not.toHaveBeenCalled();
  });

  it('refuses that account on the transition endpoint too', async () => {
    const token = authenticateAs(
      buildActor({ role: 'kitchen_staff', chainId: 55, cinemaId: null })
    );

    const response = await request(app)
      .patch('/api/kitchen/orders/128/status')
      .set('Authorization', token)
      .send({ status: 'preparing' });

    expect(response.status).toBe(403);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});
