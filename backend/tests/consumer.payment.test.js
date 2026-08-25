'use strict';

/**
 * Consumer payment-init / payment-verify, against Cashfree.
 *
 * Most of what is asserted here is CONTRACT rather than behaviour, because the
 * Consumer's payment recovery is built on the precise shape of these
 * responses. With no `GET /orders/{id}`, the only authoritative answer to "was
 * this order already paid?" is the 409 these endpoints return, and the only way
 * to resolve an interrupted payment is that payment-verify is idempotent. If
 * either shape changes, the Consumer silently loses the ability to tell
 * "already paid" from "not paid yet" - and the failure mode of that confusion
 * is charging a customer twice.
 *
 * So the assertions on `error.details.paymentStatus` are deliberately exact.
 * They are what `readConflictPaymentStatus()` reads.
 *
 * THE BIG CHANGE FROM THE PREVIOUS PROVIDER
 *
 * payment-verify no longer accepts a signature from the browser, because
 * Cashfree's hosted checkout issues none. It asks Cashfree directly instead.
 * That is why the Cashfree client is the thing mocked here: what is under test
 * is the DECISION we make from a given provider reply, and no network call is
 * ever made.
 *
 * The model layer is mocked too: what is under test is the decision the service
 * makes for a given order row, not the SQL.
 */

const request = require('supertest');

// Credentials must be present before config/env loads, or the service refuses
// to initialise a payment at all.
process.env.CASHFREE_APP_ID = 'TEST_APP_ID';
process.env.CASHFREE_SECRET_KEY = 'test_secret_key_value_at_least_32_characters';
process.env.CASHFREE_ENVIRONMENT = 'test';

/**
 * The provider boundary. Only the three network operations are stubbed; the
 * pure helpers (paise/rupee conversion, id building, error classification) are
 * the real implementations, so a unit mix-up in those still fails a test.
 */
jest.mock('../src/services/cashfree.client', () => {
  const actual = jest.requireActual('../src/services/cashfree.client');
  return {
    ...actual,
    createOrder: jest.fn(),
    fetchOrder: jest.fn(),
    fetchOrderPayments: jest.fn(),
  };
});

jest.mock('../src/config/database', () => {
  const models = {
    Order: { findByPk: jest.fn(), findOne: jest.fn(), update: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    PaymentStatusLog: { create: jest.fn() },
    // confirmOnPayment runs at the post-payment seam: a paid order becomes work
    // for the kitchen by moving initiated -> confirmed.
    OrderStatus: { findOne: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models, sequelize } = require('../src/config/database');
const cashfree = require('../src/services/cashfree.client');
const createApp = require('../src/app');

const app = createApp();

const ORDER_ID = 42;
const GATEWAY_ORDER_ID = 'qbusto_order_42';
const GATEWAY_PAYMENT_ID = '5114910151';
const SESSION_ID = 'session_TESTonly_abc123';
const ORDER_TOTAL = '250.00';
const ORDER_TOTAL_PAISE = 25000;

const PENDING_STATUS_ID = 1;
const PAID_STATUS_ID = 2;
const INITIATED_STATUS_ID = 21;
const CONFIRMED_STATUS_ID = 22;

/** An order row as paymentInit/paymentVerify select it. */
function buildOrder(overrides = {}) {
  const { paymentStatusCode = 'pending', ...rest } = overrides;
  return {
    id: ORDER_ID,
    total: ORDER_TOTAL,
    gatewayOrderId: GATEWAY_ORDER_ID,
    customerMobile: '9876543210',
    customerEmail: null,
    paymentStatusId: PENDING_STATUS_ID,
    paymentStatus: { code: paymentStatusCode },
    ...rest,
  };
}

/** One payment attempt as the Cashfree client normalises it. */
function payment(overrides = {}) {
  return {
    paymentId: GATEWAY_PAYMENT_ID,
    status: 'SUCCESS',
    amountPaise: ORDER_TOTAL_PAISE,
    currency: 'INR',
    ...overrides,
  };
}

function initRequest() {
  return request(app).post(`/api/consumer/orders/${ORDER_ID}/payment-init`).send({});
}

function verifyRequest() {
  return request(app).post(`/api/consumer/orders/${ORDER_ID}/payment-verify`).send({});
}

beforeEach(() => {
  jest.clearAllMocks();

  sequelize.transaction.mockImplementation(async (callback) => callback('TX'));
  models.PaymentStatus.findOne.mockImplementation(async ({ where }) =>
    where.code === 'paid' ? { id: PAID_STATUS_ID } : { id: PENDING_STATUS_ID }
  );
  models.Order.update.mockResolvedValue([1]);
  models.PaymentStatusLog.create.mockResolvedValue({});
  models.OrderStatus.findOne.mockImplementation(async ({ where }) =>
    where.code === 'confirmed' ? { id: CONFIRMED_STATUS_ID } : { id: INITIATED_STATUS_ID }
  );
  models.OrderStatusLog.create.mockResolvedValue({});

  // Default provider posture: nothing has been paid.
  cashfree.fetchOrderPayments.mockResolvedValue([]);
  cashfree.fetchOrder.mockResolvedValue({
    orderStatus: 'ACTIVE',
    paymentSessionId: SESSION_ID,
    amountPaise: ORDER_TOTAL_PAISE,
    currency: 'INR',
  });
  cashfree.createOrder.mockResolvedValue({
    gatewayOrderId: GATEWAY_ORDER_ID,
    paymentSessionId: SESSION_ID,
    orderStatus: 'ACTIVE',
  });
});

// ---------------------------------------------------------------------------
// payment-init
// ---------------------------------------------------------------------------

describe('POST /api/consumer/orders/:orderId/payment-init', () => {
  test('creates a gateway order and returns a payment session', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.gatewayOrderId).toBe(GATEWAY_ORDER_ID);
    expect(response.body.data.paymentSessionId).toBe(SESSION_ID);
    expect(response.body.data.amount).toBe(ORDER_TOTAL_PAISE);
    expect(response.body.data.currency).toBe('INR');
  });

  test('the gateway order is created for the order total, in paise at our boundary', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));

    await initRequest();

    expect(cashfree.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, amountPaise: ORDER_TOTAL_PAISE })
    );
  });

  test('the gateway order id is stored with a compare-and-set on NULL', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));

    await initRequest();

    // One gateway order per QBusto order, ever - backed by the filtered
    // unique index.
    expect(models.Order.update).toHaveBeenCalledWith(
      { gatewayOrderId: GATEWAY_ORDER_ID },
      { where: { id: ORDER_ID, gatewayOrderId: null } }
    );
  });

  test('is idempotent: an order that already has a gateway order creates no second one', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.gatewayOrderId).toBe(GATEWAY_ORDER_ID);
    expect(cashfree.createOrder).not.toHaveBeenCalled();
    // The Consumer calls this endpoint to probe an interrupted attempt. If it
    // created a second gateway order each time, that probe would be a
    // side-effecting operation and could not be used for recovery.
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a resumed attempt gets a FRESH session, because sessions expire', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrder.mockResolvedValue({
      orderStatus: 'ACTIVE',
      paymentSessionId: 'session_FRESH_xyz',
      amountPaise: ORDER_TOTAL_PAISE,
      currency: 'INR',
    });

    const response = await initRequest();

    expect(response.body.data.paymentSessionId).toBe('session_FRESH_xyz');
  });

  test('a duplicate-order 409 from the provider adopts the existing order rather than failing', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));
    const conflict = new Error('order exists');
    conflict.response = { status: 409 };
    cashfree.createOrder.mockRejectedValue(conflict);

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.gatewayOrderId).toBe(GATEWAY_ORDER_ID);
  });

  test('a 422 idempotency conflict also adopts the existing order', async () => {
    // Cashfree answers 422 with type `idempotency_error` when the idempotency
    // key has been reused - which, since the key IS the gateway order id, still
    // means the order exists. Verified against the live sandbox.
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));
    const conflict = new Error('Request failed with status code 422');
    conflict.response = { status: 422, data: { type: 'idempotency_error' } };
    cashfree.createOrder.mockRejectedValue(conflict);

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.gatewayOrderId).toBe(GATEWAY_ORDER_ID);
  });

  test('a 422 that is NOT an idempotency conflict is not swallowed', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));
    const invalid = new Error('Request failed with status code 422');
    invalid.response = { status: 422, data: { type: 'validation_error' } };
    cashfree.createOrder.mockRejectedValue(invalid);

    const response = await initRequest();

    // A real validation problem must surface, not be mistaken for a duplicate.
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  test('a provider outage is a 503, not a 500', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));
    const outage = new Error('bad gateway');
    outage.response = { status: 502 };
    cashfree.createOrder.mockRejectedValue(outage);

    const response = await initRequest();

    expect(response.status).toBe(503);
  });

  test('a paid order is refused with 409 carrying the authoritative payment status', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'paid' }));

    const response = await initRequest();

    expect(response.status).toBe(409);
    // Exactly what readConflictPaymentStatus() reads. An object, not an array,
    // and the status under `paymentStatus`.
    expect(response.body.error.details).toEqual({
      orderId: ORDER_ID,
      paymentStatus: 'paid',
    });
  });

  test('the 409 status is reported for non-paid terminal states too', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'failed' }));

    const response = await initRequest();

    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('failed');
  });

  test('an unknown order is a 404, not a payment failure', async () => {
    models.Order.findByPk.mockResolvedValue(null);

    const response = await initRequest();

    expect(response.status).toBe(404);
  });

  test('never returns the secret key', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await initRequest();

    expect(JSON.stringify(response.body)).not.toContain(process.env.CASHFREE_SECRET_KEY);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation on re-init - "user paid but never came back"
// ---------------------------------------------------------------------------

describe('reconciliation when a customer returns to an interrupted payment', () => {
  test('a payment found at the gateway settles the order and answers 409 paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);

    const response = await initRequest();

    // Same 409 shape a settled order returns, so the Consumer's existing
    // recovery reads it and moves to confirmation.
    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('paid');

    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatusId: PAID_STATUS_ID,
        gatewayPaymentId: GATEWAY_PAYMENT_ID,
      }),
      expect.objectContaining({ where: { id: ORDER_ID, paymentStatusId: PENDING_STATUS_ID } })
    );
  });

  test('a PENDING payment at the gateway does NOT settle the order', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment({ status: 'PENDING' })]);

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test.each([['FAILED'], ['USER_DROPPED'], ['CANCELLED'], ['VOID'], ['NOT_ATTEMPTED']])(
    'a %s payment does not settle the order and leaves it payable',
    async (status) => {
      models.Order.findByPk.mockResolvedValue(buildOrder());
      cashfree.fetchOrderPayments.mockResolvedValue([payment({ status })]);

      const response = await initRequest();

      expect(response.status).toBe(200);
      expect(response.body.data.paymentSessionId).toBe(SESSION_ID);
      expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
    }
  );

  test('a successful payment for the WRONG amount is refused', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment({ amountPaise: 100 })]);

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a successful payment in the wrong currency is refused', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment({ currency: 'USD' })]);

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('an unreachable gateway does NOT block payment-init', async () => {
    // payment-init and payment-verify treat unreachability differently on
    // purpose: here, not knowing is the status quo and the customer must still
    // be able to pay.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockRejectedValue(new Error('Cashfree payment fetch timed out'));

    const response = await initRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.paymentSessionId).toBe(SESSION_ID);
  });

  test('a provider error during reconciliation is swallowed, leaving the order payable', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockRejectedValue(new Error('Cashfree reconciliation timed out'));

    const response = await initRequest();

    // Not knowing is the status quo: the customer can still pay.
    expect(response.status).toBe(200);
    expect(response.body.data.paymentSessionId).toBe(SESSION_ID);
  });
});

// ---------------------------------------------------------------------------
// payment-verify
// ---------------------------------------------------------------------------

describe('POST /api/consumer/orders/:orderId/payment-verify', () => {
  test('confirms a payment the gateway reports as successful', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);

    const response = await verifyRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
  });

  test('takes no payment identity from the caller', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);

    // A caller inventing a payment id and a "signature" changes nothing: the
    // answer comes from the gateway, keyed on OUR stored gateway order id.
    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({ gatewayPaymentId: 'attacker_supplied', signature: 'nonsense' });

    expect(response.status).toBe(200);
    expect(cashfree.fetchOrderPayments).toHaveBeenCalledWith(GATEWAY_ORDER_ID);
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayPaymentId: GATEWAY_PAYMENT_ID }),
      expect.anything()
    );
  });

  test('a caller cannot settle an order the gateway has not paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([]);

    const response = await verifyRequest();

    expect(response.status).toBe(409);
    // "Not yet known", never "failed": the webhook may still settle it.
    expect(response.body.error.details.paymentStatus).toBe('pending');
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('an UNREACHABLE gateway is a 503, never a "pending" conflict', async () => {
    // The distinction this protects is the one that prevents a double charge.
    // The Consumer reads a `pending` conflict as "the gateway holds no
    // payment, so paying again is safe" and discards the attempt record. If a
    // network failure were reported that way, a customer whose payment had in
    // fact succeeded would be invited to pay a second time.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockRejectedValue(new Error('Cashfree payment fetch timed out'));

    const response = await verifyRequest();

    expect(response.status).toBe(503);
    // Crucially NOT a 409 carrying paymentStatus - that shape is what the
    // Consumer treats as authoritative.
    expect(response.body.error.details && response.body.error.details.paymentStatus).toBeUndefined();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a REACHED gateway reporting no payment is a 409 pending, which is retryable', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([]);

    const response = await verifyRequest();

    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('pending');
  });

  // -------------------------------------------------------------------------
  // In-flight (PENDING) payments - the double-charge guard
  // -------------------------------------------------------------------------

  /**
   * A UPI collect sits PENDING while the customer is still in their UPI app,
   * and it can become SUCCESS minutes later. Reporting that as "nothing was
   * taken, try again" is how the outstanding payment plus a retry become two
   * charges, so these assertions are about the exact shape the Consumer reads
   * to decide whether a Pay button may be shown.
   */
  test('a PENDING payment is reported as gatewayPending, not as safely retryable', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment({ status: 'PENDING' })]);

    const response = await verifyRequest();

    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('pending');
    // The flag the Consumer branches on to suppress a second payment.
    expect(response.body.error.details.gatewayPending).toBe(true);
    // And nothing is settled on the strength of a pending attempt.
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a PENDING attempt is detected even alongside terminal failures', async () => {
    // A customer who failed once and then started a UPI collect. The failure
    // must not mask the outstanding attempt.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([
      payment({ status: 'FAILED', paymentId: '1' }),
      payment({ status: 'PENDING', paymentId: '2' }),
    ]);

    const response = await verifyRequest();

    expect(response.body.error.details.gatewayPending).toBe(true);
  });

  test('a PENDING attempt counts even when its amount is not final', async () => {
    // An in-flight attempt may not carry a settled amount yet. The safe
    // reading of any outstanding attempt is still "do not invite a retry", so
    // the pending check is deliberately not amount-filtered.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([
      payment({ status: 'PENDING', amountPaise: null }),
    ]);

    const response = await verifyRequest();

    expect(response.body.error.details.gatewayPending).toBe(true);
  });

  test.each([['FAILED'], ['USER_DROPPED'], ['CANCELLED'], ['VOID'], ['NOT_ATTEMPTED']])(
    'a terminal %s payment stays retryable (gatewayPending false)',
    async (status) => {
      models.Order.findByPk.mockResolvedValue(buildOrder());
      cashfree.fetchOrderPayments.mockResolvedValue([payment({ status })]);

      const response = await verifyRequest();

      expect(response.status).toBe(409);
      expect(response.body.error.details.paymentStatus).toBe('pending');
      // Nothing was taken, so the Consumer may offer another payment.
      expect(response.body.error.details.gatewayPending).toBe(false);
    }
  );

  test('no payment attempt at all stays retryable', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([]);

    const response = await verifyRequest();

    expect(response.status).toBe(409);
    expect(response.body.error.details.gatewayPending).toBe(false);
  });

  test('an unreachable gateway never claims gatewayPending either way', async () => {
    // 503 carries no payment claim at all - see the reachability test above.
    // This guards against the unreachable branch quietly reporting a shape the
    // Consumer would read as "safe to retry".
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockRejectedValue(new Error('Cashfree payment fetch timed out'));

    const response = await verifyRequest();

    expect(response.status).toBe(503);
    expect(response.body.error.details && response.body.error.details.gatewayPending).toBeUndefined();
  });

  test('a SUCCESS alongside a PENDING still settles the order exactly once', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([
      payment({ status: 'PENDING', paymentId: '1' }),
      payment({ status: 'SUCCESS', paymentId: '2' }),
    ]);

    const response = await verifyRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
    expect(models.PaymentStatusLog.create).toHaveBeenCalledTimes(1);
    expect(models.OrderStatusLog.create).toHaveBeenCalledTimes(1);
  });

  test('is idempotent: re-verifying an already paid order succeeds without rewriting', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'paid' }));

    const response = await verifyRequest();

    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
    // No second transition, no second kitchen ticket.
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('an order with no gateway order is a 400', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ gatewayOrderId: null }));

    const response = await verifyRequest();

    expect(response.status).toBe(400);
  });

  test('an unknown order is a 404', async () => {
    models.Order.findByPk.mockResolvedValue(null);

    const response = await verifyRequest();

    expect(response.status).toBe(404);
  });

  test('a refunded order is refused with its authoritative status', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'refunded' }));

    const response = await verifyRequest();

    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('refunded');
  });
});

// ---------------------------------------------------------------------------
// The post-payment seam
// ---------------------------------------------------------------------------

/**
 * The kitchen side effect lives at the post-payment seam, which is reached
 * exactly once per order by whichever source discovered the payment first.
 *
 * These tests are what stop a future change from attaching it to "a webhook
 * arrived" or "verify was called" instead - three discovery paths for one
 * payment, and three kitchen tickets for one order.
 */
describe('payment starts fulfilment, exactly once', () => {
  test('a paid order becomes work for the kitchen', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);

    await verifyRequest();

    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: CONFIRMED_STATUS_ID }),
      expect.objectContaining({ where: { id: ORDER_ID, statusId: INITIATED_STATUS_ID } })
    );
  });

  test('verify losing the race to the webhook produces no second ticket', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);
    // The compare-and-set matches zero rows: the webhook already moved it.
    models.Order.update.mockResolvedValue([0]);

    const response = await verifyRequest();

    // Still reported as paid - it IS paid, whoever recorded it.
    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });

  test('a duplicate verify call does not produce a second ticket', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    cashfree.fetchOrderPayments.mockResolvedValue([payment()]);

    await verifyRequest();

    const firstTicketCalls = models.OrderStatusLog.create.mock.calls.length;
    expect(firstTicketCalls).toBe(1);

    // Second call: the order is now paid, so the idempotent short-circuit
    // returns before any transition.
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'paid' }));
    await verifyRequest();

    expect(models.OrderStatusLog.create).toHaveBeenCalledTimes(firstTicketCalls);
  });
});
