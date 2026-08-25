'use strict';

/**
 * Cashfree webhook endpoint.
 *
 * RESPONSE STRATEGY
 *
 * Cashfree retries a delivery until it receives a 2xx. The status code is
 * therefore a decision about whether a retry could ever help:
 *
 *   400  the request is not a verifiable Cashfree event (bad or missing
 *        signature, missing or stale timestamp, unparseable body). A retry
 *        sends the same bytes and fails identically, but answering 2xx to an
 *        unverified request would mean silently accepting forgeries into our
 *        logs. The request is refused and nothing is written.
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
const env = require('../config/env');
const webhookService = require('../services/paymentwebhook.service');

const SIGNATURE_HEADER = 'x-webhook-signature';
const TIMESTAMP_HEADER = 'x-webhook-timestamp';

/** POST /api/webhooks/cashfree */
async function handleCashfreeWebhook(req, res, next) {
  // express.raw() gives a Buffer. Anything else means the route was wired
  // after a body parser and the signature could never be verified - fail
  // loudly rather than accept unverifiable events.
  const rawBody = req.body;

  if (!env.cashfree.webhooksEnabled) {
    logger.error('Cashfree webhook received but CASHFREE_SECRET_KEY is not configured');
    return res.status(400).json({ success: false, error: { message: 'Webhook not configured' } });
  }

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

  if (!webhookService.verifyWebhookSignature(rawBody, signature, timestamp)) {
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
    });
    return res.status(400).json({ success: false, error: { message: 'Stale delivery' } });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn('Cashfree webhook rejected: body is not valid JSON', { requestId: req.id });
    return res.status(400).json({ success: false, error: { message: 'Invalid payload' } });
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
