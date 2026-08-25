'use strict';

/**
 * The only module that talks to Cashfree.
 *
 * Everything above this line deals in QBusto vocabulary - an order id, an
 * amount in paise, "was this paid". Provider request shapes, the SDK's
 * constructor, its environment enum and its error shapes stay behind this
 * boundary, so replacing the provider again means rewriting this file and not
 * the payment logic that sits on top of it.
 *
 * MONEY UNITS - THE ONE THING TO GET RIGHT
 *
 * QBusto works in integer paise everywhere (see pricing.service.toPaise), and
 * that is deliberate: integers do not drift. Cashfree's API works in RUPEES as
 * a decimal number - order_amount 250.00, not 25000. The previous provider
 * used paise, so this is a genuine behavioural difference between the two and
 * not a detail that can be carried over silently.
 *
 * The conversion is therefore confined to this module: toRupees on the way
 * out, rupeesToPaise on the way back in. Nothing above ever sees a rupee
 * float, and every comparison performed by the callers is still integer paise
 * against integer paise.
 */

const { Cashfree, CFEnvironment } = require('cashfree-pg');

const env = require('../config/env');

/**
 * Bound how long we WAIT for a provider call. This is not cancellation: if the
 * timeout wins the HTTP request may still be in flight, but our caller stops
 * waiting.
 *
 * The loser's rejection is swallowed explicitly - once we have returned, a
 * late rejection would otherwise surface as an unhandled rejection and, under
 * Node's default, take the process down. The timer is always cleared so a fast
 * success cannot leak one.
 */
function withTimeout(value, ms, label) {
  let timerId;

  const timeout = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  // Normalise first: if the SDK ever returns a non-thenable or throws
  // synchronously, calling .catch() on it afterwards would leak the timer
  // created above, which then fires much later as an unhandled rejection.
  const settled = Promise.resolve(value);
  settled.catch(() => {});

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timerId));
}

/**
 * Lazily built, so importing this module never requires credentials. Tests and
 * any environment without Cashfree configured can load the app; only an actual
 * payment call needs the keys.
 */
let client = null;

function getClient() {
  if (client) return client;

  if (!env.cashfree.configured) {
    throw new Error('Cashfree is not configured');
  }

  client = new Cashfree(
    env.cashfree.isProduction ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
    env.cashfree.appId,
    env.cashfree.secretKey
  );

  return client;
}

/** Test seam. Never called by production code. */
function resetClient() {
  client = null;
}

/**
 * The Cashfree order id for one QBusto order.
 *
 * Deterministic on purpose. Cashfree enforces uniqueness on order_id itself
 * and answers 409 for a duplicate, which makes the provider a second guard on
 * the same invariant the filtered unique index on orders.gateway_order_id
 * already enforces: one gateway order per QBusto order, ever. A random suffix
 * would throw that away and let a retry of a timed-out create silently produce
 * a second payable order for the same food.
 *
 * Cashfree allows 3-45 characters of alphanumerics, underscore and hyphen.
 * This is ~20 for realistic ids and uses only permitted characters.
 */
function buildGatewayOrderId(orderId) {
  return `qbusto_order_${orderId}`;
}

/** Integer paise -> the rupee decimal Cashfree expects. */
function toRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

/**
 * Cashfree's rupee amount -> integer paise.
 *
 * Rounded rather than truncated: 2.50 * 100 is 250.00000000000003 in IEEE 754,
 * and truncating that would turn a correct amount into a mismatch and refuse a
 * real payment.
 *
 * Returns null for anything non-numeric, so a malformed payload fails the
 * caller's comparison rather than coercing to 0 and matching a free order.
 */
function rupeesToPaise(amount) {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * A phone number in the 10-digit form Cashfree requires.
 *
 * orders.customer_mobile is nullable and free-form (it may carry +91, spaces
 * or punctuation), but Cashfree rejects a create without a valid
 * customer_phone. Digits are extracted and the last 10 taken, which handles a
 * country prefix; anything that cannot yield 10 digits falls back to the
 * configured placeholder rather than failing the payment outright.
 *
 * This is contact metadata for the provider's own receipts, not something
 * QBusto authenticates against - the order is identified by order_id.
 */
function normalisePhone(raw) {
  const digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  if (digits.length >= 10) return digits.slice(-10);
  return env.cashfree.fallbackCustomerPhone;
}

/**
 * Create the gateway order for a QBusto order.
 *
 * x-idempotency-key is Cashfree's own retry guard, keyed on the same
 * deterministic gateway order id, so a create retried after a network timeout
 * returns the original order rather than making a second one.
 *
 * @returns {Promise<{gatewayOrderId: string, paymentSessionId: string|null, orderStatus: string|null}>}
 */
async function createOrder({ orderId, amountPaise, customerMobile, customerEmail }) {
  const gatewayOrderId = buildGatewayOrderId(orderId);

  const request = {
    order_id: gatewayOrderId,
    order_amount: toRupees(amountPaise),
    order_currency: env.cashfree.currency,
    customer_details: {
      // Alphanumeric only: the API constrains customer_id to 3-50 alphanumeric
      // characters, so the separator used in order_id is not reused here.
      customer_id: `qbustoorder${orderId}`,
      customer_phone: normalisePhone(customerMobile),
      ...(customerEmail ? { customer_email: customerEmail } : {}),
    },
    order_meta: {
      // Server-to-server notification. This is what makes settlement work when
      // the customer never comes back to the app.
      ...(env.cashfree.notifyUrl ? { notify_url: env.cashfree.notifyUrl } : {}),
      ...(env.cashfree.returnUrl ? { return_url: env.cashfree.returnUrl } : {}),
    },
  };

  const response = await withTimeout(
    getClient().PGCreateOrder(request, undefined, gatewayOrderId),
    env.cashfree.timeoutMs,
    'Cashfree order creation'
  );

  const data = response && response.data ? response.data : {};

  return {
    gatewayOrderId: data.order_id || gatewayOrderId,
    paymentSessionId: data.payment_session_id || null,
    orderStatus: data.order_status || null,
  };
}

/**
 * Cashfree's own record of one order.
 *
 * Used both to re-issue a payment session for an interrupted attempt - the
 * session token is short-lived, so it is fetched rather than stored - and as
 * the coarse "is this order PAID" signal.
 *
 * @returns {Promise<{orderStatus: string|null, paymentSessionId: string|null, amountPaise: number|null, currency: string|null}|null>}
 */
async function fetchOrder(gatewayOrderId) {
  const response = await withTimeout(
    getClient().PGFetchOrder(gatewayOrderId),
    env.cashfree.timeoutMs,
    'Cashfree order fetch'
  );

  const data = response && response.data ? response.data : null;
  if (!data) return null;

  return {
    orderStatus: data.order_status || null,
    paymentSessionId: data.payment_session_id || null,
    amountPaise: rupeesToPaise(data.order_amount),
    currency: data.order_currency || null,
  };
}

/**
 * Every payment attempt Cashfree has recorded against one order.
 *
 * This is the authoritative settlement record and the direct replacement for
 * the pull-reconciliation path: it carries the per-attempt status, amount and
 * cf_payment_id, so the caller can confirm a success AND check the amount
 * rather than trusting an order-level flag on its own.
 *
 * @returns {Promise<Array<{paymentId: string|null, status: string|null, amountPaise: number|null, currency: string|null}>>}
 */
async function fetchOrderPayments(gatewayOrderId) {
  const response = await withTimeout(
    getClient().PGOrderFetchPayments(gatewayOrderId),
    env.cashfree.timeoutMs,
    'Cashfree payment fetch'
  );

  const items = response && Array.isArray(response.data) ? response.data : [];

  return items.map((item) => ({
    paymentId: item && item.cf_payment_id != null ? String(item.cf_payment_id) : null,
    status: item ? item.payment_status || null : null,
    amountPaise: item ? rupeesToPaise(item.payment_amount) : null,
    currency: item ? item.payment_currency || null : null,
  }));
}

/**
 * Whether a thrown provider error means "try again later" rather than "this
 * request is wrong".
 *
 * A timeout counts: the caller could not learn anything, which is the same
 * position a 5xx leaves it in. A 4xx does not - retrying an invalid request
 * produces the same invalid request.
 */
function isTransientError(error) {
  if (!error) return false;
  if (typeof error.message === 'string' && error.message.includes('timed out')) return true;

  const status = readStatus(error);

  return status === 500 || status === 502 || status === 503 || status === 504;
}

function readStatus(error) {
  if (!error) return null;
  if (error.response && error.response.status) return error.response.status;
  return error.status || error.statusCode || null;
}

/** The provider's structured error body, when there is one. */
function readErrorBody(error) {
  const data = error && error.response ? error.response.data : null;
  return data && typeof data === 'object' ? data : null;
}

/**
 * True when the provider refused a create because this gateway order already
 * exists.
 *
 * Cashfree signals that TWO different ways, and both have to be handled or a
 * retry becomes a 500 for a customer whose order is perfectly payable:
 *
 *   409  the order_id already exists. Straightforward, and the case the
 *        deterministic order id makes likely.
 *
 *   422 `idempotency_error`  the x-idempotency-key has been used before with a
 *        different request body. Because the key IS the gateway order id here,
 *        this still means "an order already exists for this QBusto order" -
 *        it just arrives under a different status. Verified against the live
 *        sandbox, which answers 422 with type `idempotency_error` rather than
 *        409 when the key is reused.
 *
 * Adopting the existing gateway order in both cases is safe: settlement
 * independently re-checks the amount against our own order total, in the
 * webhook and in reconciliation, so an order created for a different amount
 * can never settle this one - it is refused as an amount mismatch instead.
 */
function isDuplicateOrderError(error) {
  const status = readStatus(error);
  if (status === 409) return true;

  if (status === 422) {
    const body = readErrorBody(error);
    return Boolean(body && body.type === 'idempotency_error');
  }

  return false;
}

module.exports = {
  buildGatewayOrderId,
  createOrder,
  fetchOrder,
  fetchOrderPayments,
  isTransientError,
  isDuplicateOrderError,
  toRupees,
  rupeesToPaise,
  normalisePhone,
  withTimeout,
  resetClient,
};
