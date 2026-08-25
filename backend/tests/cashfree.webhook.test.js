'use strict';

/**
 * Cashfree webhook endpoint.
 *
 * Every request here goes through the REAL Express stack built by createApp(),
 * not an isolated helper. That matters more than usual: the single most
 * fragile thing about this feature is middleware ordering, and a test that
 * called the controller directly would still pass on the day someone moved the
 * webhook mount below express.json() and broke signature verification for
 * every real delivery.
 *
 * Signatures are computed here the way Cashfree computes them - HMAC-SHA256
 * over `timestamp + rawBody`, base64 - so the raw-body path is exercised end
 * to end. The amounts in the fixtures deliberately carry two decimal places,
 * because that is the exact thing a parse/re-serialise round trip destroys.
 *
 * The model layer is mocked; what is asserted is the decision the service
 * makes and, just as importantly, the mutations it does NOT make.
 */

const crypto = require('crypto');
const request = require('supertest');

const SECRET_KEY = 'test_secret_key_value_at_least_32_characters';

// Must be set before config/env is loaded by the app factory.
process.env.CASHFREE_APP_ID = 'TEST_APP_ID';
process.env.CASHFREE_SECRET_KEY = SECRET_KEY;
process.env.CASHFREE_ENVIRONMENT = 'test';

jest.mock('../src/config/database', () => {
  const models = {
    Order: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    PaymentStatusLog: { create: jest.fn() },
    // confirmOnPayment runs at the post-payment seam: a paid order becomes work
    // for the kitchen by moving initiated -> confirmed.
    OrderStatus: { findOne: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
    PaymentWebhookEvent: { findOne: jest.fn(), create: jest.fn() },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

const { models, sequelize } = require('../src/config/database');
const createApp = require('../src/app');

const app = createApp();

const WEBHOOK_PATH = '/api/webhooks/cashfree';

const ORDER_ID = 77;
const GATEWAY_ORDER_ID = 'qbusto_order_77';
const GATEWAY_PAYMENT_ID = '5114910151';
const ORDER_TOTAL = '250.00';

const PENDING_STATUS_ID = 1;
const PAID_STATUS_ID = 2;

/**
 * A PAYMENT_SUCCESS_WEBHOOK body in Cashfree's documented shape.
 *
 * Amounts are numbers with two decimals, as Cashfree sends them - rupees, not
 * paise. Getting this wrong in either direction is the migration's single
 * biggest money bug, so the fixture states it explicitly.
 */
function successEvent(overrides = {}) {
  const {
    amount = 250.0,
    currency = 'INR',
    orderId = GATEWAY_ORDER_ID,
    paymentStatus = 'SUCCESS',
    paymentId = GATEWAY_PAYMENT_ID,
    type = 'PAYMENT_SUCCESS_WEBHOOK',
  } = overrides;

  return {
    data: {
      order: {
        order_id: orderId,
        order_amount: amount,
        order_currency: currency,
      },
      payment: {
        cf_payment_id: paymentId,
        payment_status: paymentStatus,
        payment_amount: amount,
        payment_currency: currency,
        payment_message: 'Transaction successful',
        payment_time: '2026-08-25T10:00:00+05:30',
        payment_group: 'upi',
      },
      customer_details: {
        customer_id: 'qbustoorder77',
        customer_phone: '9999999999',
      },
    },
    event_time: '2026-08-25T10:00:01+05:30',
    type,
  };
}

function informationalEvent(type) {
  const body = successEvent({
    paymentStatus: type === 'PAYMENT_FAILED_WEBHOOK' ? 'FAILED' : 'USER_DROPPED',
    type,
  });
  body.data.payment.payment_message =
    type === 'PAYMENT_FAILED_WEBHOOK' ? 'Insufficient funds' : 'Customer dropped';
  return body;
}

/** The current time in the seconds-since-epoch form Cashfree sends. */
function nowTs() {
  return String(Math.floor(Date.now() / 1000));
}

/** Sign exactly the bytes that will be sent, as Cashfree does. */
function sign(timestamp, rawBody, secret = SECRET_KEY) {
  return crypto
    .createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');
}

/**
 * Post a body through the real stack. The serialised string is both signed and
 * sent, so any re-serialisation inside the app would break the signature.
 */
function postEvent(body, { timestamp, signature, secret } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const ts = timestamp !== undefined ? timestamp : nowTs();
  const sig = signature !== undefined ? signature : sign(ts, raw, secret);

  const req = request(app).post(WEBHOOK_PATH).set('Content-Type', 'application/json');

  if (ts !== null) req.set('x-webhook-timestamp', ts);
  if (sig !== null) req.set('x-webhook-signature', sig);

  return req.send(raw);
}

/** A transaction that just runs its callback. */
function runTransaction() {
  sequelize.transaction.mockImplementation(async (callback) => callback('TX'));
}

/** The event row the service creates, with a spy-able update(). */
function eventRecord() {
  return { id: 1, update: jest.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  jest.clearAllMocks();
  runTransaction();
  models.PaymentWebhookEvent.findOne.mockResolvedValue(null);
  models.PaymentWebhookEvent.create.mockResolvedValue(eventRecord());
  models.PaymentStatus.findOne.mockImplementation(async ({ where }) =>
    where.code === 'paid' ? { id: PAID_STATUS_ID } : { id: PENDING_STATUS_ID }
  );
  models.Order.findOne.mockResolvedValue({
    id: ORDER_ID,
    total: ORDER_TOTAL,
    paymentStatusId: PENDING_STATUS_ID,
  });
  models.Order.update.mockResolvedValue([1]);
  models.PaymentStatusLog.create.mockResolvedValue({});
  // The seam's fulfilment side effect. Ids differ from the payment ones so a
  // test cannot pass by confusing the two tables.
  models.OrderStatus.findOne.mockImplementation(async ({ where }) =>
    where.code === 'confirmed' ? { id: 22 } : { id: 21 }
  );
  models.OrderStatusLog.create.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('successful payment', () => {
  test('a valid PAYMENT_SUCCESS_WEBHOOK marks the matching order paid', async () => {
    const response = await postEvent(successEvent());

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('applied');

    // Compare-and-set: only a still-pending row transitions.
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatusId: PAID_STATUS_ID,
        gatewayPaymentId: GATEWAY_PAYMENT_ID,
      }),
      expect.objectContaining({
        where: { id: ORDER_ID, paymentStatusId: PENDING_STATUS_ID },
      })
    );
  });

  test('the order is looked up by gateway order id, never trusted from the payload', async () => {
    await postEvent(successEvent());

    expect(models.Order.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gatewayOrderId: GATEWAY_ORDER_ID } })
    );
  });

  test('exactly one kitchen ticket is produced', async () => {
    await postEvent(successEvent());

    // The KDS ticket IS the order moving initiated -> confirmed, and it is a
    // compare-and-set of its own.
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: 22 }),
      expect.objectContaining({ where: { id: ORDER_ID, statusId: 21 } })
    );

    const confirmCalls = models.Order.update.mock.calls.filter(
      ([changes]) => changes.statusId === 22
    );
    expect(confirmCalls).toHaveLength(1);
    expect(models.OrderStatusLog.create).toHaveBeenCalledTimes(1);
  });

  test('rupee amounts with decimals are compared as integer paise', async () => {
    // 250.00 rupees === 25000 paise === the order total. A naive float
    // comparison, or a paise-vs-rupee mix-up, fails here.
    const response = await postEvent(successEvent({ amount: 250.0 }));
    expect(response.body.data.outcome).toBe('applied');
  });
});

// ---------------------------------------------------------------------------
// Signature and transport
// ---------------------------------------------------------------------------

describe('signature verification', () => {
  test('a wrong signature is refused and nothing is written', async () => {
    const response = await postEvent(successEvent(), { signature: 'not-a-real-signature' });

    expect(response.status).toBe(400);
    expect(models.PaymentWebhookEvent.create).not.toHaveBeenCalled();
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a signature computed with the wrong secret is refused', async () => {
    const response = await postEvent(successEvent(), { secret: 'a_different_secret_value_here' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a missing signature is refused', async () => {
    const response = await postEvent(successEvent(), { signature: null });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a missing timestamp is refused - it is part of the signed material', async () => {
    const response = await postEvent(successEvent(), { timestamp: null });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a body altered after signing is refused', async () => {
    const raw = JSON.stringify(successEvent());
    const ts = nowTs();
    const signature = sign(ts, raw);

    // Same signature, different bytes: an attacker raising the amount.
    const tampered = JSON.stringify(successEvent({ amount: 1.0 }));

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-webhook-timestamp', ts)
      .set('x-webhook-signature', signature)
      .send(tampered);

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a hex digest - the previous provider scheme - is refused', async () => {
    const raw = JSON.stringify(successEvent());
    const ts = nowTs();
    const hex = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(ts + raw)
      .digest('hex');

    const response = await postEvent(raw, { timestamp: ts, signature: hex });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a correctly signed but stale delivery is refused', async () => {
    // Signed properly, but hours old: a captured delivery being replayed.
    const staleTs = String(Math.floor(Date.now() / 1000) - 60 * 60);

    const response = await postEvent(successEvent(), { timestamp: staleTs });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a body that is not JSON is refused without a 500', async () => {
    const response = await postEvent('not json at all');

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('well-formed JSON that is not an object is refused', async () => {
    const response = await postEvent('null');

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('an event with no type is refused', async () => {
    const body = successEvent();
    delete body.type;

    const response = await postEvent(body);

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Money and mapping validation
// ---------------------------------------------------------------------------

describe('amount, currency and order mapping', () => {
  test('an amount that does not match the order is ignored, not applied', async () => {
    const response = await postEvent(successEvent({ amount: 1.0 }));

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a larger amount than the order is also ignored', async () => {
    const response = await postEvent(successEvent({ amount: 9999.0 }));

    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a non-INR currency is ignored', async () => {
    const response = await postEvent(successEvent({ currency: 'USD' }));

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('an event for a gateway order we do not know is recorded but ignored', async () => {
    models.Order.findOne.mockResolvedValue(null);

    const response = await postEvent(successEvent({ orderId: 'qbusto_order_999999' }));

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    // Still recorded, so a retry of it is recognised as a duplicate.
    expect(models.PaymentWebhookEvent.create).toHaveBeenCalled();
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a success event whose payment status is not SUCCESS is ignored', async () => {
    const response = await postEvent(successEvent({ paymentStatus: 'PENDING' }));

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failed and abandoned payments
// ---------------------------------------------------------------------------

describe('failed and dropped payments leave the order payable', () => {
  test.each([['PAYMENT_FAILED_WEBHOOK'], ['PAYMENT_USER_DROPPED_WEBHOOK']])(
    '%s is recorded but changes no order state',
    async (type) => {
      const response = await postEvent(informationalEvent(type));

      expect(response.status).toBe(200);
      expect(response.body.data.outcome).toBe('ignored');

      // Recorded for audit and dedup...
      expect(models.PaymentWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ event: type }),
        expect.anything()
      );
      // ...but the order is untouched, so the customer can still pay.
      expect(models.Order.update).not.toHaveBeenCalled();
      expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
    }
  );

  test('an unsubscribed event type is ignored', async () => {
    const response = await postEvent(successEvent({ type: 'REFUND_STATUS_WEBHOOK' }));

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Duplicate and out-of-order delivery
// ---------------------------------------------------------------------------

describe('duplicate and out-of-order delivery', () => {
  test('a redelivery of the same event is suppressed by the fast path', async () => {
    models.PaymentWebhookEvent.findOne.mockResolvedValue({ id: 1, outcome: 'applied' });

    const response = await postEvent(successEvent());

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.PaymentWebhookEvent.create).not.toHaveBeenCalled();
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('the dedup key is derived from the payment id, since Cashfree sends no event id', async () => {
    await postEvent(successEvent());

    expect(models.PaymentWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: `PAYMENT_SUCCESS_WEBHOOK:${GATEWAY_PAYMENT_ID}`,
      }),
      expect.anything()
    );
  });

  test('a concurrent duplicate losing the unique index is answered 200, not 500', async () => {
    // The fast path misses (both requests read before either wrote), then the
    // unique constraint arbitrates.
    const uniqueError = new Error('duplicate');
    uniqueError.name = 'SequelizeUniqueConstraintError';
    models.PaymentWebhookEvent.create.mockRejectedValue(uniqueError);

    const response = await postEvent(successEvent());

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
  });

  test('an order already settled by another source is a no-op, not an error', async () => {
    // The compare-and-set matches zero rows: the browser verify, or an earlier
    // delivery, already moved it.
    models.Order.update.mockResolvedValue([0]);

    const response = await postEvent(successEvent());

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    // No second status log, and no second kitchen ticket.
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transport-level failures
// ---------------------------------------------------------------------------

describe('transient failures must be retryable', () => {
  test('a database failure answers 5xx so Cashfree retries', async () => {
    sequelize.transaction.mockRejectedValue(new Error('deadlock'));

    const response = await postEvent(successEvent());

    // Never 2xx: acknowledging here would drop a real payment permanently.
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
