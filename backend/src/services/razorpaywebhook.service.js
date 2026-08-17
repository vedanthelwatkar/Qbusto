'use strict';

/**
 * Razorpay webhook processing.
 *
 * WHY THIS EXISTS
 *
 * Until now the backend only learned that a payment succeeded when the
 * customer's browser posted the signature to payment-verify. If the browser
 * died first — closed tab, dead battery, cinema wifi — the money moved and the
 * order stayed `pending` forever, with no way for the system to find out. The
 * webhook is Razorpay telling our server directly, independently of the
 * browser.
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
 * and is a no-op. That is the same compare-and-set shape paymentInit already
 * uses for razorpay_order_id, not a new mechanism.
 *
 * EVENT STRATEGY
 *
 * - `payment.captured` is authoritative for success. It is the event that says
 *   money was actually captured, and it carries the payment id, order id,
 *   amount and currency we need to validate and record.
 * - `order.paid` is treated as the same success signal. Our model is one
 *   payment per Razorpay order, so it carries no new information; it is
 *   handled rather than ignored only so that subscribing to it in the
 *   Dashboard cannot break anything. Duplicate suppression makes processing
 *   both harmless.
 * - `payment.authorized` is deliberately NOT treated as success. This codebase
 *   never calls payments.capture(), so an authorized-but-uncaptured payment is
 *   money that has not been taken. Treating it as paid would hand out food for
 *   a payment that later expires.
 * - `payment.failed` is recorded but changes NO order state. See below.
 *
 * WHY payment.failed DOES NOT MARK THE ORDER FAILED
 *
 * `payment.failed` fires per failed *attempt* — a mistyped OTP, a declined
 * card. The order is still perfectly payable, and the existing browser flow
 * deliberately leaves it `pending` so the customer can try again. Writing
 * `failed` onto the order would make paymentInit and paymentVerify return 409
 * for that order forever, locking a customer out of retrying after one
 * mistyped OTP. The Consumer's recovery screen reads that same status, so it
 * would additionally tell them the order "could not be completed" when it
 * simply had not been paid yet.
 */

const crypto = require('crypto');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const env = require('../config/env');
const { toPaise } = require('./pricing.service');
const { applyPaidTransition } = require('./paymenttransition.service');

/** Events that mean "this Razorpay order has been paid". */
const SUCCESS_EVENTS = Object.freeze(['payment.captured', 'order.paid']);
/** Events recorded for audit and dedup, but which change no order state. */
const INFORMATIONAL_EVENTS = Object.freeze(['payment.failed']);

/** Our orders are created in INR only (see paymentInit). */
const EXPECTED_CURRENCY = 'INR';

const OUTCOMES = Object.freeze({
  RECEIVED: 'received',
  APPLIED: 'applied',
  IGNORED: 'ignored',
});

/**
 * Constant-time comparison of the delivered signature against ours.
 *
 * The HMAC is computed over the EXACT bytes Razorpay signed. Re-serialising a
 * parsed body would change key order and whitespace and never match, which is
 * why the route hands us a Buffer.
 *
 * @param {Buffer} rawBody Unparsed request body.
 * @param {string} signature `x-razorpay-signature` header.
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = env.razorpay.webhookSecret;

  // No secret configured means nothing can be verified. Refusing is the only
  // safe answer: accepting would let anyone who can reach the URL mark orders
  // paid.
  if (!secret) return false;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  if (typeof signature !== 'string' || signature.length === 0) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  // timingSafeEqual throws on a length mismatch, and the lengths themselves
  // are not secret (the digest is a fixed width), so this check is safe.
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Pull the fields we care about out of a Razorpay event body.
 *
 * Only documented fields are read, and every one is treated as untrusted: an
 * id from the payload is used to *look up* our own record, never as proof of
 * anything on its own.
 */
function extractEntities(body) {
  const payload = body && body.payload ? body.payload : {};
  const payment = payload.payment && payload.payment.entity ? payload.payment.entity : null;
  const order = payload.order && payload.order.entity ? payload.order.entity : null;

  return {
    // `order.paid` carries both entities; `payment.captured` carries only the
    // payment, whose `order_id` is the link back to our record.
    razorpayOrderId: (payment && payment.order_id) || (order && order.id) || null,
    razorpayPaymentId: (payment && payment.id) || null,
    amount: payment ? payment.amount : order ? order.amount : null,
    currency: payment ? payment.currency : order ? order.currency : null,
  };
}

/**
 * The durable idempotency key for a delivery.
 *
 * `x-razorpay-event-id` is the right key when it is present: it is unique per
 * event, so a redelivery of the same event reuses it. But the installed
 * Razorpay SDK (v2.9.8) contains no reference to that header anywhere — it
 * knows about `X-Razorpay-Signature` and nothing else — so nothing in the
 * material available to this project guarantees it is always sent. Making
 * correctness depend on it alone would mean an endpoint that silently loses
 * its deduplication if Razorpay ever omits it.
 *
 * The fallback is derived from the payload, which IS guaranteed: an event is
 * always *about* a payment or an order, and that entity's id is what the event
 * carries. A given payment is captured once and fails once, so
 * `payment.captured:pay_xxx` identifies exactly the same logical event that
 * the header would have.
 *
 * This is defence in depth rather than the only guard: the compare-and-set on
 * the order row already makes a duplicate delivery a no-op, and the
 * post-payment seam sits inside that. A dedup miss cannot double a state
 * transition or a side effect; it could only add a second audit row.
 *
 * Returns null when neither is available, which is not an event we can process
 * safely.
 */
function resolveEventKey(headerEventId, event, entities) {
  if (headerEventId) return headerEventId;

  const subject = entities.razorpayPaymentId || entities.razorpayOrderId;
  return subject ? `${event}:${subject}` : null;
}

/**
 * Apply a verified event.
 *
 * The whole thing runs in one transaction so the dedup record and the state
 * change commit together. A crash between them would otherwise mark an event
 * processed without having processed it, and Razorpay's retry would then be
 * suppressed as a duplicate — the payment would be lost.
 *
 * @returns {Promise<{outcome: string, reason?: string, orderId?: number}>}
 */
async function processWebhookEvent({ eventId, event, body }) {
  const entities = extractEntities(body);

  // Header when present, payload-derived otherwise. See resolveEventKey.
  const eventKey = resolveEventKey(eventId, event, entities);
  if (!eventKey) {
    return { outcome: OUTCOMES.IGNORED, reason: 'no_dedup_key' };
  }

  // Fast path for the common retry. Not the correctness guarantee — the unique
  // constraint below is — just a way to avoid opening a transaction for an
  // event we have already handled.
  const seen = await models.RazorpayWebhookEvent.findOne({
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
      // the whole transaction rolls back — the other request owns the work.
      const record = await models.RazorpayWebhookEvent.create(
        {
          eventId: eventKey,
          event,
          razorpayOrderId: entities.razorpayOrderId,
          razorpayPaymentId: entities.razorpayPaymentId,
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
        // Recorded, deliberately inert. See the header note.
        return finish(OUTCOMES.IGNORED, 'informational_event');
      }

      if (!SUCCESS_EVENTS.includes(event)) {
        return finish(OUTCOMES.IGNORED, 'unsubscribed_event');
      }

      if (!entities.razorpayOrderId) {
        return finish(OUTCOMES.IGNORED, 'missing_razorpay_order_id');
      }

      const order = await models.Order.findOne({
        where: { razorpayOrderId: entities.razorpayOrderId },
        attributes: ['id', 'total', 'paymentStatusId'],
        transaction,
      });

      // An event for a Razorpay order that is not ours. Recorded so retries
      // are recognised, but nothing is mutated.
      if (!order) {
        return finish(OUTCOMES.IGNORED, 'unknown_razorpay_order');
      }

      // Integer paise on both sides — toPaise rounds to an integer and
      // Razorpay sends an integer. No floating-point money comparison.
      const expectedPaise = toPaise(order.total);
      if (!Number.isInteger(entities.amount) || entities.amount !== expectedPaise) {
        logger.error('Razorpay webhook amount mismatch', {
          eventId: eventKey,
          orderId: order.id,
          expectedPaise,
          receivedPaise: entities.amount,
        });
        return finish(OUTCOMES.IGNORED, 'amount_mismatch', order.id);
      }

      if (entities.currency && entities.currency !== EXPECTED_CURRENCY) {
        logger.error('Razorpay webhook currency mismatch', {
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
          razorpayPaymentId: entities.razorpayPaymentId,
          reason: `Payment confirmed by Razorpay webhook (${event})`,
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
    // responds non-2xx and Razorpay retries — acknowledging here would drop
    // the payment permanently.
    throw error;
  }
}

module.exports = {
  verifyWebhookSignature,
  processWebhookEvent,
  SUCCESS_EVENTS,
  INFORMATIONAL_EVENTS,
  OUTCOMES,
};
