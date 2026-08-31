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
const logger = require('../config/logger');
const credentials = require('../utils/credentials');

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
 * `models` is required lazily, inside the functions that need it, not at
 * module load. `config/database` and this module are both required very
 * early in the app's dependency graph (consumer.service -> cashfree.client,
 * consumer.service -> config/database), and requiring it at the top of this
 * file risks a circular-require ordering bug the moment anything in
 * config/database ever imports this module back. Nothing here is
 * performance-sensitive enough for the repeated require() (Node caches the
 * module after the first call) to matter.
 */
function db() {
  return require('../config/database');
}

/**
 * Cashfree has two vocabularies for one setting - its API docs say
 * `prod`/`sandbox`, its dashboard says `production`/`test` - so the column
 * accepts all four and this is the ONE place they are collapsed. Anything
 * unrecognised is sandbox: an unknown value must never be the one that takes
 * real money.
 */
function isProduction(environment) {
  return environment === 'prod' || environment === 'production';
}

/**
 * Which Cashfree environment a cinema's checkout session belongs to, as the
 * browser SDK's own `mode` vocabulary.
 *
 * This exists so the CONSUMER no longer has to guess. A payment session is
 * issued against one specific environment (see getClientForCinema below), and
 * handing it to an SDK loaded in the other one simply never opens the
 * checkout - no error, nothing to act on. The Consumer used to pick its mode
 * from a build-time `VITE_CASHFREE_MODE`, which is a second, independent
 * source for a fact this row already settles, and the two could disagree
 * silently across a deploy or across cinemas on different environments.
 * Returning it with the session makes them one value.
 *
 * Reads only `environment` - no secret is fetched and nothing is decrypted,
 * so this is a cheap lookup and not a second handling of a credential. Null
 * when the cinema has no active row; the caller has no session to pair it
 * with in that case anyway.
 */
async function resolveCheckoutMode(cinemaId) {
  const { models } = db();

  const config = await models.PaymentGatewayConfig.findOne({
    where: { cinemaId, isActive: true },
    attributes: ['environment'],
  });

  if (!config) return null;

  return isProduction(config.environment) ? 'production' : 'sandbox';
}

/**
 * Resolve which Cashfree credentials to use for one cinema.
 *
 * PRIMARY SOURCE: `payment_gateway_config`, one encrypted row per cinema,
 * managed from the Dashboard. This is what makes QBusto multi-tenant on
 * payments - two cinemas can run against two entirely different Cashfree
 * merchant accounts.
 *
 * There is NO fallback. `payment_gateway_config` is the only source of
 * Cashfree credentials anywhere in the system - the global CASHFREE_APP_ID /
 * CASHFREE_SECRET_KEY / CASHFREE_ENVIRONMENT variables that used to stand in
 * here no longer exist. A cinema without an active row cannot take payments,
 * and says so at payment-init.
 *
 * `environment` ('test'/'sandbox'/'prod'/'production' - both of Cashfree's own
 * vocabularies, since its API docs and its dashboard disagree) is its own
 * column, added by
 * `20260825000500-add-environment-to-payment-gateway-config.js` - deliberately
 * NOT folded into the existing `gateway_url` column, which stays genuinely
 * unused rather than secretly holding an environment name instead of a URL.
 *
 * @throws {Error} If the cinema has no usable credentials - the caller maps
 *   this to a 503.
 */
async function resolveCredentials(cinemaId) {
  const { models } = db();

  const config = await models.PaymentGatewayConfig.findOne({
    where: { cinemaId, isActive: true },
    attributes: ['gatewayId', 'gatewaySecretEncrypted', 'environment'],
  });

  if (config) {
    let secretKey;

    try {
      secretKey = credentials.decrypt(config.gatewaySecretEncrypted);
    } catch (error) {
      /*
       * The row exists but its secret cannot be decrypted - almost always
       * because CREDENTIALS_ENCRYPTION_KEY has changed since it was saved
       * (AES-GCM fails its auth tag, it does not return garbage).
       *
       * Re-thrown as the "not configured" error so the caller folds it into
       * the same clean 503 a cinema with no credentials gets. Left as a raw
       * crypto error it escaped every handler in consumer.service.paymentInit
       * and reached the customer as a 500 with a full stack trace - exactly
       * what the "never leak a bad config row to a customer-facing endpoint"
       * rule exists to prevent. The operator detail goes to the log instead.
       */
      logger.error(
        'Stored Cashfree secret could not be decrypted - re-save this cinema credentials',
        { cinemaId, reason: error.message }
      );

      // `cause` keeps the crypto failure attached for anyone debugging from a
      // log or a test, while the MESSAGE stays the generic one the customer
      // is allowed to see. errorHandler serialises only message/name/stack -
      // never `cause` - so this cannot widen what reaches the response.
      throw new Error('Cashfree is not configured for this cinema', { cause: error });
    }

    return { appId: config.gatewayId, secretKey, isProduction: isProduction(config.environment) };
  }

  /*
   * No row, no payment. There is deliberately no deployment-wide credential to
   * fall back to: standing in for a cinema nobody finished configuring would
   * take that cinema's money into whichever merchant account the fallback
   * belonged to, and every signal - checkout, webhook, order status - would
   * look healthy while it happened.
   *
   * The caller maps this to a 503 at payment-init, which is a visible,
   * diagnosable failure at exactly the moment the misconfiguration matters.
   */
  logger.warn('No active payment_gateway_config for this cinema - payments are unavailable', {
    cinemaId,
  });

  throw new Error('Cashfree is not configured for this cinema');
}

/**
 * A fresh Cashfree SDK client for one cinema's credentials.
 *
 * Deliberately NOT cached across calls: a cinema's credentials can be edited
 * from the Dashboard at any time, and a cached client built from a
 * now-rotated secret would keep authenticating with the old one until the
 * process restarted. Constructing the SDK object is cheap - it only assigns
 * a few fields - so there is no real cost to doing it fresh every call.
 */
async function getClientForCinema(cinemaId) {
  const resolved = await resolveCredentials(cinemaId);

  return new Cashfree(
    resolved.isProduction ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
    resolved.appId,
    resolved.secretKey
  );
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
 * `amountPaise` is already the FINAL, post-discount amount - any coupon a
 * customer applied was validated and subtracted entirely within QBusto
 * before this is ever called (see consumer.service.applyCoupon). Cashfree
 * sees a plain order amount and has no coupon/offer concept in this flow at
 * all: no `offer_filters`, no discount reasoning on its side. This is a
 * deliberate reversion - an earlier version of this integration tried
 * routing coupons through Cashfree's own offer system and accepting a
 * short payment as evidence of a valid redemption, which was abandoned in
 * favour of this simpler, strictly-enforced design: QBusto is the only
 * source of truth for what a customer owes, always.
 *
 * `cinemaId` decides which Cashfree merchant account the order is created
 * against (`resolveCredentials`) - each cinema may run its own account.
 *
 * @returns {Promise<{gatewayOrderId: string, paymentSessionId: string|null, orderStatus: string|null}>}
 */
async function createOrder({ orderId, cinemaId, amountPaise, customerMobile, customerEmail }) {
  const gatewayOrderId = buildGatewayOrderId(orderId);

  const client = await getClientForCinema(cinemaId);

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
    client.PGCreateOrder(request, undefined, gatewayOrderId),
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
async function fetchOrder(gatewayOrderId, cinemaId) {
  const client = await getClientForCinema(cinemaId);

  const response = await withTimeout(
    client.PGFetchOrder(gatewayOrderId),
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
async function fetchOrderPayments(gatewayOrderId, cinemaId) {
  const client = await getClientForCinema(cinemaId);

  const response = await withTimeout(
    client.PGOrderFetchPayments(gatewayOrderId),
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

/**
 * True when Cashfree refused the request as unauthenticated/unauthorised -
 * a wrong or revoked APP_ID/SECRET_KEY for the resolved cinema, most likely
 * an operator error in that cinema's `payment_gateway_config` row rather than
 * a bug. Verified live: a corrupted secret produces a 401 here, and 401/403
 * are not otherwise transient (isTransientError only covers 5xx), so without
 * this a bad credential would surface to the customer as a raw, unexplained
 * 500 instead of the same clean "try again shortly, or ask staff" 503 a
 * cinema with no credentials configured at all already gets.
 */
function isAuthError(error) {
  const status = readStatus(error);
  return status === 401 || status === 403;
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
  getClientForCinema,
  resolveCredentials,
  resolveCheckoutMode,
  isTransientError,
  isAuthError,
  isDuplicateOrderError,
  toRupees,
  rupeesToPaise,
  normalisePhone,
  withTimeout,
};
