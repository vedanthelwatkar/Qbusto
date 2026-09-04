'use strict';

/**
 * Cashfree webhook endpoint.
 *
 * PER-CINEMA CREDENTIALS - WHAT CHANGED AND WHY IT IS STILL SAFE
 *
 * Cashfree credentials are no longer one global pair: each cinema may run its
 * own Cashfree merchant account (`payment_gateway_config`, one encrypted row
 * per cinema). That means "verify this delivery" can no longer start from a
 * single known secret - which cinema's secret to try has to be worked out
 * from the delivery itself first.
 *
 * `webhookService.verifyIncomingWebhook` does this: it reads ONLY
 * `data.order.order_id` out of the still-unverified body to look up which
 * QBusto order, and therefore which cinema, the delivery claims to be about,
 * resolves that cinema's secret, and verifies the signature against it. That
 * one field is safe to read early because it is never trusted for anything
 * except choosing a candidate secret - an attacker gains nothing by naming
 * any order_id they like, since they still cannot produce a valid signature
 * without that specific cinema's key. Every other field is only available
 * after verification succeeds, exactly as before.
 *
 * RESPONSE STRATEGY (unchanged)
 *
 * Cashfree retries a delivery until it receives a 2xx. The status code is
 * therefore a decision about whether a retry could ever help:
 *
 *   400  the request is not a verifiable Cashfree event (bad or missing
 *        signature, missing or stale timestamp, unparseable body, or an
 *        order_id naming no cinema this deployment can resolve credentials
 *        for). A retry sends the same bytes and fails identically, but
 *        answering 2xx to an unverified request would mean silently
 *        accepting forgeries into our logs. The request is refused and
 *        nothing is written.
 *
 *   200  the event was verified and reached a decision - applied, a duplicate,
 *        or ignored for a reason no retry can change (unknown order, amount
 *        mismatch, an already-settled order). The work is committed before
 *        this is sent.
 *
 *   5xx  something transient failed, typically the database. Cashfree must
 *        retry, so this is never swallowed. This is the one that matters most:
 *        a database error answered with 200 would lose a real payment.
 */

const logger = require('../config/logger');
const webhookService = require('../services/paymentwebhook.service');

const SIGNATURE_HEADER = 'x-webhook-signature';
const TIMESTAMP_HEADER = 'x-webhook-timestamp';

/** POST /api/webhooks/cashfree */
async function handleCashfreeWebhook(req, res, next) {
  // express.raw() gives a Buffer. Anything else means the route was wired
  // after a body parser and the signature could never be verified - fail
  // loudly rather than accept unverifiable events.
  const rawBody = req.body;

  const signature = req.get(SIGNATURE_HEADER);
  const timestamp = req.get(TIMESTAMP_HEADER);

  if (!signature) {
    logger.warn('Cashfree webhook rejected: missing signature', { requestId: req.id });
    return res.status(400).json({ success: false, error: { message: 'Missing signature' } });
  }

  // Unlike the previous provider's optional event-id header, this one is NOT
  // optional: the timestamp is part of the signed material, so without it no
  // signature can be computed at all.
  if (!timestamp) {
    logger.warn('Cashfree webhook rejected: missing timestamp', { requestId: req.id });
    return res.status(400).json({ success: false, error: { message: 'Missing timestamp' } });
  }

  // Resolves which cinema this delivery claims to be about, and verifies the
  // signature against THAT cinema's secret. No single global "is Cashfree
  // configured" gate any more - deliberately: with credentials per cinema,
  // whether verification is even possible is itself part of what this call
  // determines, not something knowable in advance of it.
  const { verified, body } = await webhookService.verifyIncomingWebhook(
    rawBody,
    signature,
    timestamp
  );

  if (!verified) {
    // Deliberately terse and deliberately logged without the body: a forged
    // request should not be able to write attacker-chosen content into logs.
    // The signature itself is never logged either.
    logger.warn('Cashfree webhook rejected: signature verification failed', {
      requestId: req.id,
      bodyBytes: Buffer.isBuffer(rawBody) ? rawBody.length : null,
    });
    return res.status(400).json({ success: false, error: { message: 'Invalid signature' } });
  }

  // Checked only after the signature verifies, so the value can be trusted.
  // This is what stops a delivery captured off the wire being replayed weeks
  // later with its signature still intact.
  if (!webhookService.isTimestampFresh(timestamp)) {
    logger.warn('Cashfree webhook rejected: timestamp outside accepted window', {
      requestId: req.id,
      // Both sides of the comparison, so a rejection says whether the cause is
      // server clock drift or a timestamp that is not in the expected unit.
      receivedTimestamp: timestamp,
      serverEpochSeconds: Math.floor(Date.now() / 1000),
    });
    return res.status(400).json({ success: false, error: { message: 'Stale delivery' } });
  }

  // `JSON.parse` happily returns null, a number or a string for well-formed
  // JSON that is not an object, and reading `.type` off null throws - which
  // would reach the shared handler as a 500 and tell Cashfree to keep retrying
  // a body that could never be processed. Anything that is not an object is
  // simply not an event.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, error: { message: 'Invalid payload' } });
  }

  // Cashfree names the event `type` rather than `event`.
  const event = typeof body.type === 'string' ? body.type : null;
  if (!event) {
    return res.status(400).json({ success: false, error: { message: 'Missing event type' } });
  }

  try {
    const result = await webhookService.processWebhookEvent({ event, body });

    logger.info('Cashfree webhook processed', {
      requestId: req.id,
      event,
      outcome: result.outcome,
      reason: result.reason || null,
      orderId: result.orderId || null,
    });

    // Committed by the time this is sent.
    return res.status(200).json({ success: true, data: { outcome: result.outcome } });
  } catch (error) {
    // Non-2xx so Cashfree retries. Passed to the error handler, which logs it
    // and emits the standard envelope without leaking internals.
    return next(error);
  }
}

module.exports = { handleCashfreeWebhook };
