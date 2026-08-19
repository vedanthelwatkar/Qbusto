'use strict';

/**
 * Razorpay webhook endpoint.
 *
 * Every request here goes through the REAL Express stack built by createApp(),
 * not an isolated helper. That matters more than usual: the single most
 * fragile thing about this feature is middleware ordering, and a test that
 * called the controller directly would still pass on the day someone moved the
 * webhook mount below express.json() and broke signature verification for
 * every real delivery. Signatures are computed here the way Razorpay computes
 * them — HMAC-SHA256 over the exact request bytes — so the raw-body path is
 * exercised end to end.
 *
 * The model layer is mocked; what is asserted is the decision the service
 * makes and, just as importantly, the mutations it does NOT make.
 */

const crypto = require('crypto');
const request = require('supertest');

const WEBHOOK_SECRET = 'test_webhook_secret_value_at_least_32_chars';

// Must be set before config/env is loaded by the app factory.
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

jest.mock('../src/config/database', () => {
  const models = {
    Order: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
    PaymentStatus: { findOne: jest.fn() },
    PaymentStatusLog: { create: jest.fn() },
    // confirmOnPayment runs at the post-payment seam: a paid order becomes work
    // for the kitchen by moving initiated -> confirmed.
    OrderStatus: { findOne: jest.fn() },
    OrderStatusLog: { create: jest.fn() },
    RazorpayWebhookEvent: { findOne: jest.fn(), create: jest.fn() },
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

const WEBHOOK_PATH = '/api/webhooks/razorpay';

const ORDER_ID = 77;
const RZP_ORDER_ID = 'order_TESTwebhook01';
const RZP_PAYMENT_ID = 'pay_TESTwebhook01';
const ORDER_TOTAL = '250.00';
const ORDER_TOTAL_PAISE = 25000;

const PENDING_STATUS_ID = 1;
const PAID_STATUS_ID = 2;

/** A payment.captured body in Razorpay's documented shape. */
function capturedEvent(overrides = {}) {
  const { amount = ORDER_TOTAL_PAISE, currency = 'INR', orderId = RZP_ORDER_ID } = overrides;
  return {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: RZP_PAYMENT_ID,
          entity: 'payment',
          amount,
          currency,
          status: 'captured',
          order_id: orderId,
        },
      },
    },
    created_at: 1755400000,
  };
}

function failedEvent() {
  return {
    entity: 'event',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: RZP_PAYMENT_ID,
          amount: ORDER_TOTAL_PAISE,
          currency: 'INR',
          status: 'failed',
          order_id: RZP_ORDER_ID,
        },
      },
    },
    created_at: 1755400000,
  };
}

/** Sign exactly the bytes that will be sent, as Razorpay does. */
function sign(rawBody, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Post a body through the real stack. The serialised string is both signed and
 * sent, so any re-serialisation inside the app would break the signature.
 */
function postEvent(body, { eventId = 'evt_test_0001', signature, secret } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = signature !== undefined ? signature : sign(raw, secret);

  const req = request(app)
    .post(WEBHOOK_PATH)
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId);

  if (sig !== null) req.set('x-razorpay-signature', sig);

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
  runTransaction();
  models.RazorpayWebhookEvent.findOne.mockResolvedValue(null);
  models.RazorpayWebhookEvent.create.mockResolvedValue(eventRecord());
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
  test('a valid payment.captured marks the matching order paid', async () => {
    const response = await postEvent(capturedEvent());

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('applied');

    // Compare-and-set: only a still-pending row transitions.
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatusId: PAID_STATUS_ID,
        razorpayPaymentId: RZP_PAYMENT_ID,
      }),
      expect.objectContaining({
        where: { id: ORDER_ID, paymentStatusId: PENDING_STATUS_ID },
        transaction: 'TX',
      })
    );
    expect(models.PaymentStatusLog.create).toHaveBeenCalledTimes(1);
  });

  test('order.paid is accepted as the same success signal', async () => {
    const body = {
      entity: 'event',
      event: 'order.paid',
      contains: ['payment', 'order'],
      payload: {
        payment: {
          entity: {
            id: RZP_PAYMENT_ID,
            amount: ORDER_TOTAL_PAISE,
            currency: 'INR',
            order_id: RZP_ORDER_ID,
          },
        },
        order: {
          entity: { id: RZP_ORDER_ID, amount: ORDER_TOTAL_PAISE, currency: 'INR' },
        },
      },
    };

    const response = await postEvent(body, { eventId: 'evt_order_paid_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('applied');
  });

  test('order.paid without a payment entity does not erase a recorded payment id', async () => {
    // Razorpay documents order.paid as carrying both entities. If a delivery
    // ever arrives without the payment one, spreading a null payment id into
    // the update would wipe the value the browser path had already stored.
    const body = {
      entity: 'event',
      event: 'order.paid',
      contains: ['order'],
      payload: {
        order: { entity: { id: RZP_ORDER_ID, amount: ORDER_TOTAL_PAISE, currency: 'INR' } },
      },
    };

    const response = await postEvent(body, { eventId: 'evt_order_paid_nopayment' });

    expect(response.status).toBe(200);
    const [changes] = models.Order.update.mock.calls[0];
    expect(changes).not.toHaveProperty('razorpayPaymentId');
  });

  test('payment.authorized is not treated as payment', async () => {
    // This codebase never calls payments.capture(), so an authorized payment
    // is money that has not been taken.
    const body = capturedEvent();
    body.event = 'payment.authorized';

    const response = await postEvent(body, { eventId: 'evt_authorized_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Signature security
// ---------------------------------------------------------------------------

describe('signature verification', () => {
  test('an invalid signature is rejected with zero database mutation', async () => {
    const response = await postEvent(capturedEvent(), { signature: 'a'.repeat(64) });

    expect(response.status).toBe(400);
    expect(models.RazorpayWebhookEvent.create).not.toHaveBeenCalled();
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a missing signature is rejected', async () => {
    const response = await postEvent(capturedEvent(), { signature: null });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a signature from a different secret is rejected', async () => {
    const response = await postEvent(capturedEvent(), { secret: 'someone_elses_secret' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a payload modified after signing is rejected', async () => {
    // Sign the genuine body, then send a tampered one that pays a different
    // order. This is the attack the raw-body requirement exists to stop.
    const genuine = JSON.stringify(capturedEvent());
    const signature = sign(genuine);

    const tampered = JSON.stringify(capturedEvent({ amount: 1 }));

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', 'evt_tampered_1')
      .set('x-razorpay-signature', signature)
      .send(tampered);

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a signed event with no event-id header is still processed, keyed off the payload', async () => {
    // The installed SDK never references x-razorpay-event-id, so its presence
    // is not guaranteed. Refusing a properly signed event because that header
    // was absent would drop a real payment notification.
    const raw = JSON.stringify(capturedEvent());

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(raw))
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('applied');

    // Deduplicated on a key derived from the payment the event is about.
    const [record] = models.RazorpayWebhookEvent.create.mock.calls[0];
    expect(record.eventId).toBe(`payment.captured:${RZP_PAYMENT_ID}`);
  });

  test('a redelivery without the header dedups against the same payload key', async () => {
    models.RazorpayWebhookEvent.findOne.mockResolvedValue({ id: 5, outcome: 'applied' });

    const raw = JSON.stringify(capturedEvent());
    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(raw))
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();

    // Proves the lookup used the derived key, not an undefined header value.
    const [{ where }] = models.RazorpayWebhookEvent.findOne.mock.calls[0];
    expect(where.eventId).toBe(`payment.captured:${RZP_PAYMENT_ID}`);
  });

  test('a signed event with neither header nor identifiable subject is not processed', async () => {
    const body = { entity: 'event', event: 'payment.captured', payload: {} };
    const raw = JSON.stringify(body);

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(raw))
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency and convergence
// ---------------------------------------------------------------------------

describe('duplicate and out-of-order delivery', () => {
  test('a redelivered event id is a no-op', async () => {
    models.RazorpayWebhookEvent.findOne.mockResolvedValue({ id: 9, outcome: 'applied' });

    const response = await postEvent(capturedEvent(), { eventId: 'evt_dup_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a concurrent duplicate losing the unique constraint is acknowledged, not failed', async () => {
    // Simulates the second of two simultaneous deliveries: the pre-check saw
    // nothing, but the insert violated the unique index.
    const uniqueError = new Error('duplicate key');
    uniqueError.name = 'SequelizeUniqueConstraintError';
    models.RazorpayWebhookEvent.create.mockRejectedValue(uniqueError);

    const response = await postEvent(capturedEvent(), { eventId: 'evt_race_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
  });

  test('an order already paid by browser verification is not written again', async () => {
    // Compare-and-set matches zero rows because the row is no longer pending.
    models.Order.update.mockResolvedValue([0]);

    const response = await postEvent(capturedEvent(), { eventId: 'evt_after_browser_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    // The decisive assertion: no second status-log row, so no duplicate
    // downstream effect from the two paths reporting the same payment.
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });

  test('a late payment.failed cannot downgrade a paid order', async () => {
    const response = await postEvent(failedEvent(), { eventId: 'evt_late_failed_1' });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    // payment.failed never writes order state at all, so ordering cannot
    // matter — there is no path by which it could overwrite `paid`.
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('payment.failed leaves the order pending so the customer can retry', async () => {
    await postEvent(failedEvent(), { eventId: 'evt_failed_retry_1' });

    // Marking the order failed would make payment-init return 409 forever and
    // lock the customer out after one mistyped OTP.
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

describe('payload validation', () => {
  test('an unknown razorpay order mutates nothing', async () => {
    models.Order.findOne.mockResolvedValue(null);

    const response = await postEvent(capturedEvent({ orderId: 'order_NOTOURS' }), {
      eventId: 'evt_unknown_1',
    });

    // 200: a retry can never make this order exist.
    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('an amount mismatch does not mark the order paid', async () => {
    const response = await postEvent(capturedEvent({ amount: 100 }), {
      eventId: 'evt_amount_1',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a currency mismatch does not mark the order paid', async () => {
    const response = await postEvent(capturedEvent({ currency: 'USD' }), {
      eventId: 'evt_currency_1',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.outcome).toBe('ignored');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a body that is not JSON is rejected', async () => {
    const response = await postEvent('not-json-at-all', { eventId: 'evt_badjson_1' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe('malformed and oversized requests', () => {
  test('an oversized body is refused with 4xx, not 500, and leaks no internals', async () => {
    const big = 'x'.repeat(1024 * 1024 + 5000);

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', 'evt_oversized_1')
      .set('x-razorpay-signature', 'deadbeef')
      .send(big);

    // A 500 would tell Razorpay the failure is transient and worth retrying,
    // but the body is exactly as large every time.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    // The shared handler attaches a stack outside production; this path must
    // not reach it.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/stack|PayloadTooLargeError|node_modules/i);

    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a correctly signed body of literal null does not crash the endpoint', async () => {
    // Well-formed JSON that is not an object. Reading `.event` off null threw,
    // which surfaced as a 500 and an unbounded retry loop.
    const response = await postEvent('null', { eventId: 'evt_null_body' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a correctly signed JSON array is rejected as not an event', async () => {
    const response = await postEvent('[]', { eventId: 'evt_array_body' });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

describe('transient failure', () => {
  test('a database failure returns 5xx so Razorpay retries', async () => {
    sequelize.transaction.mockRejectedValue(new Error('connection reset'));

    const response = await postEvent(capturedEvent(), { eventId: 'evt_dbfail_1' });

    // The critical one: answering 2xx here would tell Razorpay the payment was
    // handled and permanently lose it.
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// Middleware integration
// ---------------------------------------------------------------------------

describe('middleware stack', () => {
  test('normal JSON API routes still parse JSON after the raw-body mount', async () => {
    // The raw-body exception is scoped to /api/webhooks. If it leaked, every
    // other endpoint would receive a Buffer and break.
    const response = await request(app).get('/api').set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('the webhook route is reached without customer authentication', async () => {
    // A 400 (not 401/403) proves the request got as far as signature checking
    // rather than being stopped by auth middleware.
    const response = await postEvent(capturedEvent(), { signature: 'b'.repeat(64) });

    expect(response.status).toBe(400);
  });
});
