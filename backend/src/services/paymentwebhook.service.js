'use strict';

/**
 * Cashfree webhook processing.
 *
 * WHY THIS EXISTS
 *
 * Without it the backend would only learn that a payment succeeded when the
 * customer's browser told us so. If the browser dies first - closed tab, dead
 * battery, cinema wifi - the money moves and the order stays `pending`
 * forever, with no way for the system to find out. The webhook is Cashfree
 * telling our server directly, independently of the browser.
 *
 * IT DOES NOT REPLACE payment-verify
 *
 * The browser path still gives immediate confirmation, which is what lets the
 * customer see their order confirmed straight away. The webhook is the second,
 * slower path to the same truth. Both converge on one state transition:
 *
 *     orders.payment_status_id: pending -> paid
 *
 * applied with a conditional UPDATE that only matches a still-pending row. Two
 * writers racing therefore cannot both apply it: the second matches zero rows
 * and is a no-op.
 *
 * SIGNATURE - THE CASHFREE SPECIFICATION, WHICH DIFFERS FROM THE PREVIOUS ONE
 *
 * Cashfree signs `x-webhook-timestamp` CONCATENATED WITH the raw body, using
 * HMAC-SHA256 keyed on the CLIENT SECRET, encoded BASE64. Three differences
 * from the previous provider, each of which silently breaks verification if
 * carried over:
 *
 *   - the timestamp is part of the signed material, not just a header
 *   - the digest is base64, not hex
 *   - the key is the API secret key, not a separate per-webhook secret
 *
 * Verified against the cashfree-pg SDK's own PGVerifyWebhookSignature and
 * against Cashfree's published reference implementation, which agree exactly.
 *
 * EVENT STRATEGY
 *
 * - PAYMENT_SUCCESS_WEBHOOK is authoritative for success and carries the
 *   payment id, order id, amount and currency needed to validate and record.
 * - PAYMENT_FAILED_WEBHOOK and PAYMENT_USER_DROPPED_WEBHOOK are recorded but
 *   change NO order state. See below.
 * - Anything else is recorded and ignored.
 *
 * WHY A FAILED OR DROPPED PAYMENT DOES NOT MARK THE ORDER FAILED
 *
 * Both fire per failed *attempt* - a mistyped UPI PIN, a declined card, a
 * customer who opened a UPI app and closed it. The order is still perfectly
 * payable, and the flow deliberately leaves it `pending` so the customer can
 * try again. Writing `failed` onto the order would make payment-init and
 * payment-verify return 409 for it forever, locking a customer out of retrying
 * after one mistyped PIN. The Consumer's recovery screen reads that same
 * status, so it would additionally tell them the order "could not be
 * completed" when it simply had not been paid yet.
 *
 * PAYMENT_USER_DROPPED_WEBHOOK is exactly the "opened UPI and closed it"
 * case, and it is the clearest example of why this rule matters.
 */

const crypto = require('crypto');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const { toPaise } = require('./pricing.service');
const cashfree = require('./cashfree.client');
const { rupeesToPaise } = cashfree;
const { applyPaidTransition } = require('./paymenttransition.service');

/** Events that mean "this gateway order has been paid". */
const SUCCESS_EVENTS = Object.freeze(['PAYMENT_SUCCESS_WEBHOOK']);

/** Events recorded for audit and dedup, but which change no order state. */
const INFORMATIONAL_EVENTS = Object.freeze([
  'PAYMENT_FAILED_WEBHOOK',
  'PAYMENT_USER_DROPPED_WEBHOOK',
]);

/** Our orders are created in INR only (see cashfree.client.createOrder). */
const EXPECTED_CURRENCY = 'INR';

/**
 * How far out of date a delivery may be before it is refused.
 *
 * The timestamp is inside the signed material, so an attacker cannot alter it
 * without invalidating the signature. Bounding it turns the signature into a
 * time-limited credential: a delivery captured off the wire cannot be replayed
 * indefinitely. Generous enough to absorb clock skew and Cashfree's own retry
 * backoff, which is why it is minutes rather than seconds.
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 15 * 60;

const OUTCOMES = Object.freeze({
  RECEIVED: 'received',
  APPLIED: 'applied',
  IGNORED: 'ignored',
});

/**
 * Constant-time comparison of the delivered signature against ours.
 *
 * The HMAC is computed over the EXACT bytes Cashfree signed. Re-serialising a
 * parsed body would change key order, whitespace and - the trap specific to
 * this provider - decimal formatting, since JSON.stringify turns an amount of
 * 170.00 back into 170. That is why the route hands us a Buffer and why the
 * body is parsed only AFTER verification.
 *
 * The SDK ships its own verifier, but it compares with `===` and throws on
 * mismatch. This is the same algorithm with a constant-time comparison and a
 * boolean result, which is both a stronger guarantee and a shape the caller
 * can act on without exception control flow.
 *
 * @param {Buffer} rawBody Unparsed request body.
 * @param {string} signature `x-webhook-signature` header.
 * @param {string} timestamp `x-webhook-timestamp` header.
 * @returns {boolean}
 */
/**
 * @param {Buffer} rawBody
 * @param {string} signature
 * @param {string} timestamp
 * @param {string} secret The CINEMA this delivery claims to be about's
 *   Cashfree secret key - see `resolveSigningSecret`. No longer a single
 *   global value: each cinema may run its own Cashfree merchant account, so
 *   there is no one secret that could verify every delivery.
 */
function verifyWebhookSignature(rawBody, signature, timestamp, secret) {
  // No secret resolved means nothing can be verified. Refusing is the only
  // safe answer: accepting would let anyone who can reach the URL mark orders
  // paid.
  if (!secret) return false;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  if (typeof timestamp !== 'string' || timestamp.length === 0) return false;

  // Signed material is timestamp + raw body, in that order.
  const signedPayload = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);

  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('base64');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on a length mismatch, and the lengths themselves
  // are not secret (the digest is a fixed width), so this check is safe.
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Read `data.order.order_id` out of an UNVERIFIED body, tolerating anything
 * malformed by returning null.
 *
 * This is the one deliberate exception to "never read the body before the
 * signature verifies" (see the header note on `processWebhookEvent`, and the
 * webhook route's own comment on raw-body mounting). It exists because
 * verification itself now needs a piece of the body first: WHICH cinema's
 * secret to try is no longer knowable without knowing which QBusto order the
 * delivery claims to be about.
 *
 * This is safe specifically because the value is used ONLY to pick a
 * candidate secret, never as a fact acted upon. An attacker can put any
 * `order_id` they like in a forged body - real or invented - and it buys
 * them nothing: they still cannot produce a valid signature over it without
 * that specific cinema's secret key, which forging the field does not reveal.
 * If the guess is wrong, or the order does not exist, verification simply
 * fails the same way it would for any other unverifiable delivery.
 */
function readUnverifiedGatewayOrderId(rawBody) {
  try {
    const body = JSON.parse(rawBody.toString('utf8'));
    const orderId = body && body.data && body.data.order && body.data.order.order_id;
    return typeof orderId === 'string' && orderId ? orderId : null;
  } catch {
    return null;
  }
}

/**
 * The Cashfree secret key to verify a delivery against, resolved from the
 * (unverified) gateway order id it claims to be about.
 *
 * ONE SOURCE, AND ONLY ONE
 *
 * The secret always comes from the owning cinema's `payment_gateway_config`
 * row, via `cashfree.resolveCredentials`. There is no global credential left
 * to try, so a delivery whose `order_id` matches no QBusto order yields no
 * secret at all and is refused as unverifiable.
 *
 * That is a deliberate trade. It costs the audit record for an unknown
 * `order_id`, which `processWebhookEvent` would otherwise file as
 * `unknown_gateway_order`. What it buys is that nothing is ever verified
 * against a key belonging to a different merchant account - and an unknown
 * order id is, by definition, not one this system issued, so there is nothing
 * of ours to settle either way. Failing closed is the correct direction for
 * an unauthenticated, internet-facing endpoint.
 *
 * @returns {Promise<string|null>} null when no cinema owns the delivery, or
 *   when the owning cinema's credentials cannot be resolved.
 */
async function resolveSigningSecret(gatewayOrderId) {
  if (gatewayOrderId) {
    const order = await models.Order.findOne({
      where: { gatewayOrderId },
      attributes: ['id', 'cinemaId'],
    });

    if (order) {
      try {
        const resolved = await cashfree.resolveCredentials(order.cinemaId);
        return resolved.secretKey || null;
      } catch (error) {
        logger.warn('Could not resolve Cashfree credentials while verifying a webhook', {
          cinemaId: order.cinemaId,
          reason: error && error.message ? error.message : 'unknown',
        });
        return null;
      }
    }
  }

  return null;
}

/**
 * Verifies one incoming delivery end to end: resolves which cinema it claims
 * to belong to, resolves that cinema's secret, and checks the signature
 * against it.
 *
 * Returns the ALREADY-PARSED body on success, so the controller never parses
 * the raw bytes a second time - the parse that happened here to read
 * `order_id` produced a value that, once the signature has verified, is now
 * trustworthy in full, not just in the one field that was read from it early.
 *
 * @returns {Promise<{verified: boolean, body: object|null}>}
 */
async function verifyIncomingWebhook(rawBody, signature, timestamp) {
  const gatewayOrderId = readUnverifiedGatewayOrderId(rawBody);
  const secret = await resolveSigningSecret(gatewayOrderId);

  if (!verifyWebhookSignature(rawBody, signature, timestamp, secret)) {
    return { verified: false, body: null };
  }

  // The signature is now known good, so this parse - unlike the one inside
  // readUnverifiedGatewayOrderId - produces a body every field of which can
  // be trusted. A parse failure here would be a contradiction (the bytes just
  // verified against a valid HMAC), but is handled rather than assumed
  // impossible.
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { verified: false, body: null };
  }

  return { verified: true, body };
}

/**
 * Whether the delivery's timestamp is recent enough to accept.
 *
 * Checked only after the signature verifies, so this can trust the value.
 * A non-numeric timestamp is refused rather than treated as 0, which would
 * otherwise make every malformed value look infinitely stale in one direction
 * and pass in the other.
 */
function isTimestampFresh(timestamp, nowSeconds = Math.floor(Date.now() / 1000)) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  return Math.abs(nowSeconds - value) <= MAX_TIMESTAMP_SKEW_SECONDS;
}

/**
 * Pull the fields we care about out of a Cashfree event body.
 *
 * Only documented fields are read, and every one is treated as untrusted: an
 * id from the payload is used to *look up* our own record, never as proof of
 * anything on its own.
 *
 * Amounts are converted to integer paise here so that every comparison
 * downstream is integer-to-integer. Cashfree sends rupees as a decimal.
 */
function extractEntities(body) {
  const data = body && body.data ? body.data : {};
  const order = data.order || null;
  const payment = data.payment || null;

  return {
    gatewayOrderId: order && order.order_id ? String(order.order_id) : null,
    gatewayPaymentId:
      payment && payment.cf_payment_id != null ? String(payment.cf_payment_id) : null,
    paymentStatus: payment ? payment.payment_status || null : null,
    // Payment amount is the money that actually moved; the order amount is
    // what was asked for. Prefer the former and fall back to the latter.
    amountPaise: payment
      ? rupeesToPaise(payment.payment_amount)
      : order
        ? rupeesToPaise(order.order_amount)
        : null,
    currency: payment
      ? payment.payment_currency || null
      : order
        ? order.order_currency || null
        : null,
  };
}

/**
 * The durable idempotency key for a delivery.
 *
 * Cashfree does not send a dedicated event-id header, so unlike the previous
 * provider there is no header to prefer. The key is derived from the payload,
 * which is guaranteed: an event is always *about* a payment attempt, and
 * `cf_payment_id` identifies that attempt uniquely. A given attempt succeeds
 * once and fails once, so `PAYMENT_SUCCESS_WEBHOOK:<cf_payment_id>` names
 * exactly one logical event.
 *
 * The order id is the fallback for an event that somehow carries no payment
 * entity. That is coarser - it would collapse two events of the same type for
 * one order - but such an event carries no payment to apply anyway, so
 * collapsing it loses nothing.
 *
 * This is defence in depth rather than the only guard: the compare-and-set on
 * the order row already makes a duplicate delivery a no-op, and the
 * post-payment seam sits inside that. A dedup miss cannot double a state
 * transition or a side effect; it could only add a second audit row.
 */
function resolveEventKey(event, entities) {
  const subject = entities.gatewayPaymentId || entities.gatewayOrderId;
  return subject ? `${event}:${subject}` : null;
}

/**
 * Apply a verified event.
 *
 * The whole thing runs in one transaction so the dedup record and the state
 * change commit together. A crash between them would otherwise mark an event
 * processed without having processed it, and Cashfree's retry would then be
 * suppressed as a duplicate - the payment would be lost.
 *
 * @returns {Promise<{outcome: string, reason?: string, orderId?: number}>}
 */
async function processWebhookEvent({ event, body }) {
  const entities = extractEntities(body);

  const eventKey = resolveEventKey(event, entities);
  if (!eventKey) {
    return { outcome: OUTCOMES.IGNORED, reason: 'no_dedup_key' };
  }

  // Fast path for the common retry. Not the correctness guarantee - the unique
  // constraint below is - just a way to avoid opening a transaction for an
  // event we have already handled.
  const seen = await models.PaymentWebhookEvent.findOne({
    where: { eventId: eventKey },
    attributes: ['id', 'outcome'],
  });

  if (seen) {
    return { outcome: OUTCOMES.IGNORED, reason: 'duplicate_event' };
  }

  try {
    return await sequelize.transaction(async (transaction) => {
      // Claim the event first. If a concurrent delivery of the same event is
      // mid-flight, this blocks on the unique index and then violates it, and
      // the whole transaction rolls back - the other request owns the work.
      const record = await models.PaymentWebhookEvent.create(
        {
          eventId: eventKey,
          event,
          gatewayOrderId: entities.gatewayOrderId,
          gatewayPaymentId: entities.gatewayPaymentId,
          orderId: null,
          outcome: OUTCOMES.RECEIVED,
        },
        { transaction }
      );

      const finish = async (outcome, reason, orderId = null) => {
        await record.update({ outcome, reason, orderId }, { transaction });
        return { outcome, reason, orderId };
      };

      if (INFORMATIONAL_EVENTS.includes(event)) {
        // Recorded, deliberately inert. See the header note: a failed or
        // dropped attempt must leave the order payable.
        return finish(OUTCOMES.IGNORED, 'informational_event');
      }

      if (!SUCCESS_EVENTS.includes(event)) {
        return finish(OUTCOMES.IGNORED, 'unsubscribed_event');
      }

      if (!entities.gatewayOrderId) {
        return finish(OUTCOMES.IGNORED, 'missing_gateway_order_id');
      }

      // A success event whose payment did not actually succeed. Should not
      // happen, but the event type and the payment status are two independent
      // assertions and only one of them is about the money.
      if (entities.paymentStatus && entities.paymentStatus !== 'SUCCESS') {
        logger.error('Cashfree success webhook carried a non-success payment status', {
          eventId: eventKey,
          paymentStatus: entities.paymentStatus,
        });
        return finish(OUTCOMES.IGNORED, 'payment_not_successful');
      }

      const order = await models.Order.findOne({
        where: { gatewayOrderId: entities.gatewayOrderId },
        attributes: ['id', 'total', 'paymentStatusId'],
        transaction,
      });

      // An event for a gateway order that is not ours. Recorded so retries are
      // recognised, but nothing is mutated. This is also the guard against a
      // valid signature from our own account being applied to someone else's
      // order id.
      if (!order) {
        return finish(OUTCOMES.IGNORED, 'unknown_gateway_order');
      }

      // Integer paise on both sides - toPaise rounds to an integer and
      // rupeesToPaise rounded the provider's decimal. No floating-point money
      // comparison.
      const expectedPaise = toPaise(order.total);
      if (!Number.isInteger(entities.amountPaise) || entities.amountPaise !== expectedPaise) {
        logger.error('Cashfree webhook amount mismatch', {
          eventId: eventKey,
          orderId: order.id,
          expectedPaise,
          receivedPaise: entities.amountPaise,
        });
        return finish(OUTCOMES.IGNORED, 'amount_mismatch', order.id);
      }

      if (entities.currency && entities.currency !== EXPECTED_CURRENCY) {
        logger.error('Cashfree webhook currency mismatch', {
          eventId: eventKey,
          orderId: order.id,
          received: entities.currency,
        });
        return finish(OUTCOMES.IGNORED, 'currency_mismatch', order.id);
      }

      // Shared with the browser-verify and reconciliation paths. Only the
      // caller that actually moves the row runs the post-payment seam inside
      // it, so a duplicate delivery, or a browser verify that already won,
      // cannot produce a second effect.
      const { transitioned } = await applyPaidTransition(
        {
          orderId: order.id,
          gatewayPaymentId: entities.gatewayPaymentId,
          reason: `Payment confirmed by Cashfree webhook (${event})`,
        },
        transaction
      );

      if (!transitioned) {
        return finish(OUTCOMES.IGNORED, 'already_settled', order.id);
      }

      return finish(OUTCOMES.APPLIED, null, order.id);
    });
  } catch (error) {
    // A concurrent delivery won the race for this event id.
    if (error.name === 'SequelizeUniqueConstraintError') {
      return { outcome: OUTCOMES.IGNORED, reason: 'duplicate_event' };
    }
    // Anything else is transient as far as we know. Rethrow so the caller
    // responds non-2xx and Cashfree retries - acknowledging here would drop
    // the payment permanently.
    throw error;
  }
}

module.exports = {
  verifyWebhookSignature,
  verifyIncomingWebhook,
  isTimestampFresh,
  processWebhookEvent,
  SUCCESS_EVENTS,
  INFORMATIONAL_EVENTS,
  OUTCOMES,
  MAX_TIMESTAMP_SKEW_SECONDS,
};
