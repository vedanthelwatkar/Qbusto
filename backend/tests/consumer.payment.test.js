'use strict';

/**
 * Consumer payment-init / payment-verify.
 *
 * These two endpoints had no test coverage at all, despite being the only
 * place in the product where money moves.
 *
 * Most of what is asserted here is CONTRACT rather than behaviour, because the
 * Consumer's payment recovery is built on the precise shape of these
 * responses. With no `GET /orders/{id}`, the only authoritative answer to "was
 * this order already paid?" is the 409 that payment-init returns once the
 * order leaves the pending state, and the only way to resolve an interrupted
 * payment is that payment-verify is idempotent. If either shape changes, the
 * Consumer silently loses the ability to tell "already paid" from "not paid" —
 * and the failure mode of that confusion is charging a customer twice.
 *
 * So the assertions on `error.details.paymentStatus` and on the
 * `razorpaySignature` detail field are deliberately exact. They are what
 * `readConflictPaymentStatus()` and `isSignatureVerificationFailure()` read.
 *
 * The model layer is mocked: what is under test is the decision the service
 * makes for a given order row, not the SQL.
 */

const request = require('supertest');

/**
 * Reconciliation talks to Razorpay. The SDK is mocked so no network call is
 * ever made: what is under test is the DECISION we make from a given reply.
 */
const mockFetchPayments = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: jest.fn(), fetchPayments: mockFetchPayments },
  }))
);

jest.mock('../src/config/database', () => {
  const models = {
    Order: { findByPk: jest.fn(), update: jest.fn() },
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
const createApp = require('../src/app');

const app = createApp();

const ORDER_ID = 42;
const RAZORPAY_ORDER_ID = 'order_TESTonly000001';
const RAZORPAY_PAYMENT_ID = 'pay_TESTonly000001';

/** An order row as paymentInit/paymentVerify select it. */
function buildOrder(overrides = {}) {
  const { paymentStatusCode = 'pending', ...rest } = overrides;
  return {
    id: ORDER_ID,
    total: '250.00',
    razorpayOrderId: RAZORPAY_ORDER_ID,
    paymentStatusId: 1,
    paymentStatus: { code: paymentStatusCode },
    ...rest,
  };
}

/**
 * The signature Razorpay would produce for this order/payment pair. Computed
 * with the same HMAC the service uses, so the "valid signature" case exercises
 * the real comparison rather than a stubbed one.
 */
function validSignature(secret, razorpayOrderId, paymentId) {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${paymentId}`)
    .digest('hex');
}

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';

  // Default: a transaction that just runs its callback.
  sequelize.transaction.mockImplementation(async (callback) => callback('TX'));
  models.PaymentStatus.findOne.mockImplementation(async ({ where }) =>
    where.code === 'paid' ? { id: 2 } : { id: 1 }
  );
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
// payment-init
// ---------------------------------------------------------------------------

describe('POST /api/consumer/orders/:orderId/payment-init', () => {
  test('is idempotent: an order that already has a razorpay order returns the same id', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.razorpayOrderId).toBe(RAZORPAY_ORDER_ID);
    // The Consumer calls this endpoint to probe an interrupted attempt. If it
    // created a second razorpay order each time, that probe would be a
    // side-effecting operation and could not be used for recovery.
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a paid order is refused with 409 carrying the authoritative payment status', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'paid' }));

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

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

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('failed');
  });

  test('an unknown order is a 404, not a payment failure', async () => {
    models.Order.findByPk.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(404);
  });

  test('never returns the razorpay key secret', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(JSON.stringify(response.body)).not.toContain('test_secret');
  });
});

// ---------------------------------------------------------------------------
// payment-verify
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
  const CONFIRMED_STATUS_ID = 22;
  const INITIATED_STATUS_ID = 21;

  test('a paid order becomes work for the kitchen', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    // initiated -> confirmed is what makes the order visible to the KDS.
    expect(models.Order.update).toHaveBeenCalledWith(
      { statusId: CONFIRMED_STATUS_ID },
      expect.objectContaining({
        where: { id: ORDER_ID, statusId: INITIATED_STATUS_ID },
      })
    );
    expect(models.OrderStatusLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        newStatusId: CONFIRMED_STATUS_ID,
        // No human made this change, so the audit row records none.
        changedByUserId: null,
        reason: 'Payment confirmed',
      }),
      expect.anything()
    );
  });

  test('the fulfilment write is a compare-and-set on initiated', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    const confirmCall = models.Order.update.mock.calls.find(
      ([values]) => values.statusId === CONFIRMED_STATUS_ID
    );

    // An order a human already confirmed, or already rejected, is left alone.
    expect(confirmCall[1].where.statusId).toBe(INITIATED_STATUS_ID);
  });

  test('a payment that lost the race creates no kitchen work', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    // The paid transition matched zero rows: a webhook got there first, and it
    // already confirmed the order.
    models.Order.update.mockResolvedValue([0]);

    await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    // The seam was never reached, so no second ticket and no second audit row.
    expect(models.OrderStatusLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/consumer/orders/:orderId/payment-verify', () => {
  test('a valid signature marks the order paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({ razorpayPaymentId: RAZORPAY_PAYMENT_ID }),
      expect.anything()
    );
  });

  test('is idempotent: re-verifying an already-paid order succeeds without rewriting it', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'paid' }));

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: 'anything',
      });

    // This is the property the whole recovery flow rests on: a Consumer that
    // lost the response, was refreshed, or reconnected can re-send the same
    // credentials to learn the truth, and cannot take a second payment by
    // doing so.
    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('an invalid signature is a 400 whose details name the signature field', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: 'definitely-not-the-right-signature',
      });

    expect(response.status).toBe(400);
    // isSignatureVerificationFailure() looks for an ARRAY of details with a
    // `razorpaySignature` field. It treats that as permanent and stops
    // offering payment, so the shape has to stay exactly this.
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details.some((d) => d.field === 'razorpaySignature')).toBe(true);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('an order with no razorpay order id is a 400 that is NOT a signature rejection', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ razorpayOrderId: null }));

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: 'whatever',
      });

    expect(response.status).toBe(400);
    // Both cases are 400, so status alone cannot separate them. This one must
    // not look like a signature rejection, or the Consumer would show the
    // permanent "do not pay again" screen for a recoverable condition.
    const details = response.body.error.details;
    const looksLikeSignatureRejection =
      Array.isArray(details) && details.some((d) => d && d.field === 'razorpaySignature');
    expect(looksLikeSignatureRejection).toBe(false);
  });

  test('a refunded order is refused with 409 rather than being re-paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ paymentStatusCode: 'refunded' }));

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: 'anything',
      });

    expect(response.status).toBe(409);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a tampered payment id does not verify against a signature for another payment', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: 'pay_SOMEONE_ELSES',
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    expect(response.status).toBe(400);
    expect(models.Order.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Convergence with the webhook path
// ---------------------------------------------------------------------------

describe('payment-verify converges with the webhook', () => {
  test('the paid transition is a compare-and-set, not an unconditional write', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    // The status read happens outside the transaction, so the webhook can
    // commit `paid` in between. Without the pending guard in the WHERE clause
    // this write lands anyway and the two paths both "apply" the transition.
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: expect.objectContaining({ paymentStatusId: expect.anything() }),
      })
    );
  });

  test('an order already marked paid by the webhook mid-request writes no second status log', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    // The webhook won: the conditional update matches zero rows.
    models.Order.update.mockResolvedValue([0]);

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-verify`)
      .send({
        razorpayPaymentId: RAZORPAY_PAYMENT_ID,
        razorpaySignature: validSignature('test_secret', RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID),
      });

    // The customer is still told the truth: the payment IS paid.
    expect(response.status).toBe(200);
    expect(response.body.data.paymentStatus).toBe('paid');

    // But the transition already happened once, so it must not be logged
    // again. This is the seam where post-payment side effects will be
    // attached, and a duplicate here becomes a duplicate kitchen ticket.
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation with Razorpay (payment-init on an already-initialised order)
// ---------------------------------------------------------------------------

describe('reconciliation against Razorpay records', () => {
  beforeEach(() => {
    mockFetchPayments.mockReset();
  });

  test('a captured payment for the exact amount settles the order and reports it as paid', async () => {
    // Neither the browser callback nor the webhook ever arrived; Razorpay's
    // own records are the only remaining source of truth.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockResolvedValue({
      items: [{ id: RAZORPAY_PAYMENT_ID, status: 'captured', amount: 25000, currency: 'INR' }],
    });

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    // The 409 shape payment-init already used for a settled order, so the
    // Consumer's existing recovery moves straight to confirmation.
    expect(response.status).toBe(409);
    expect(response.body.error.details.paymentStatus).toBe('paid');
    expect(models.Order.update).toHaveBeenCalledWith(
      expect.objectContaining({ razorpayPaymentId: RAZORPAY_PAYMENT_ID }),
      expect.objectContaining({
        where: expect.objectContaining({ paymentStatusId: expect.anything() }),
      })
    );
  });

  test('an authorized-but-uncaptured payment does NOT mark the order paid', async () => {
    // This codebase never calls payments.capture(), so authorised money has
    // not been taken. Accepting it would hand out food for nothing.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockResolvedValue({
      items: [{ id: RAZORPAY_PAYMENT_ID, status: 'authorized', amount: 25000 }],
    });

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a captured payment for the WRONG amount does not mark the order paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockResolvedValue({
      items: [{ id: RAZORPAY_PAYMENT_ID, status: 'captured', amount: 100 }],
    });

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a failed payment does not mark the order paid', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockResolvedValue({
      items: [{ id: RAZORPAY_PAYMENT_ID, status: 'failed', amount: 25000 }],
    });

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('no payments at all leaves the order payable', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockResolvedValue({ items: [] });

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.razorpayOrderId).toBe(RAZORPAY_ORDER_ID);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('a Razorpay outage does not break a legitimate retry', async () => {
    // Not knowing is the status quo. Failing here would block a customer
    // retrying a genuinely failed payment whenever Razorpay is unreachable.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockRejectedValue(new Error('ECONNRESET'));

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.razorpayOrderId).toBe(RAZORPAY_ORDER_ID);
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  test('reconciliation is not attempted for an order that was never initialised', async () => {
    // No razorpay order exists yet, so there is nothing to reconcile against
    // and no reason to spend a Razorpay API call on every first payment.
    models.Order.findByPk.mockResolvedValue(buildOrder({ razorpayOrderId: null }));
    mockFetchPayments.mockResolvedValue({ items: [] });

    await request(app).post(`/api/consumer/orders/${ORDER_ID}/payment-init`).send({});

    expect(mockFetchPayments).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation timeout
// ---------------------------------------------------------------------------

describe('reconciliation is bounded in time', () => {
  beforeEach(() => {
    mockFetchPayments.mockReset();
  });

  test('a Razorpay call that never settles does not hang payment-init', async () => {
    // A promise that never resolves or rejects - the actual production
    // failure mode. A rejected promise would prove nothing here, because the
    // existing catch already handles rejections; what has to be proven is
    // that we stop WAITING on a request that simply never answers.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    mockFetchPayments.mockReturnValue(new Promise(() => {}));

    const startedAt = Date.now();
    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});
    const elapsed = Date.now() - startedAt;

    // Payment stays usable: the customer is handed their razorpay order.
    expect(response.status).toBe(200);
    expect(response.body.data.razorpayOrderId).toBe(RAZORPAY_ORDER_ID);

    // A timeout is not evidence about the payment, so nothing is written.
    expect(models.Order.update).not.toHaveBeenCalled();
    expect(models.PaymentStatusLog.create).not.toHaveBeenCalled();

    // Bounded, and by the timeout rather than by luck.
    expect(elapsed).toBeGreaterThanOrEqual(3500);
    expect(elapsed).toBeLessThan(8000);
  }, 15000);

  test('a late rejection after the timeout does not crash the process', async () => {
    // The losing promise rejects after we have already responded. Without an
    // attached handler this is an unhandled rejection, which Node terminates on
    // by default.
    models.Order.findByPk.mockResolvedValue(buildOrder());

    let rejectLate;
    mockFetchPayments.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLate = reject;
      })
    );

    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);

    const response = await request(app)
      .post(`/api/consumer/orders/${ORDER_ID}/payment-init`)
      .send({});
    expect(response.status).toBe(200);

    rejectLate(new Error('socket hang up'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  }, 15000);
});
