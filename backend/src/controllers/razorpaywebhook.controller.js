'use strict';

/**
 * Razorpay webhook endpoint.
 *
 * RESPONSE STRATEGY
 *
 * Razorpay retries a delivery until it receives a 2xx. The status code is
 * therefore a decision about whether a retry could ever help:
 *
 *   400  the request is not a verifiable Razorpay event (bad or missing
 *        signature, missing event id, unparseable body). A retry sends the
 *        same bytes and fails identically, but answering 2xx to an unverified
 *        request would mean silently accepting forgeries into our logs. The
 *        request is refused and nothing is written.
 *
 *   200  the event was verified and reached a decision — applied, a duplicate,
 *        or ignored for a reason no retry can change (unknown order, amount
 *        mismatch, an already-settled order). The work is committed before
 *        this is sent.
 *
 *   5xx  something transient failed, typically the database. Razorpay must
 *        retry, so this is never swallowed. This is the one that matters most:
 *        a database error answered with 200 would lose a real payment.
 */

const logger = require('../config/logger');
const env = require('../config/env');
const webhookService = require('../services/razorpaywebhook.service');

const SIGNATURE_HEADER = 'x-razorpay-signature';
const EVENT_ID_HEADER = 'x-razorpay-event-id';

/** POST /api/webhooks/razorpay */
async function handleRazorpayWebhook(req, res, next) {
  // express.raw() gives a Buffer. Anything else means the route was wired
  // after a body parser and the signature could never be verified — fail
  // loudly rather than accept unverifiable events.
  const rawBody = req.body;

  if (!env.razorpay.webhooksEnabled) {
    logger.error('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured');
    return res.status(400).json({ success: false, error: { message: 'Webhook not configured' } });
  }

  const signature = req.get(SIGNATURE_HEADER);
  const eventId = req.get(EVENT_ID_HEADER);

  if (!signature) {
    logger.warn('Razorpay webhook rejected: missing signature', { requestId: req.id });
    return res.status(400).json({ success: false, error: { message: 'Missing signature' } });
  }

  if (!webhookService.verifyWebhookSignature(rawBody, signature)) {
    // Deliberately terse and deliberately logged without the body: a forged
    // request should not be able to write attacker-chosen content into logs.
    logger.warn('Razorpay webhook rejected: signature verification failed', {
      requestId: req.id,
      bodyBytes: Buffer.isBuffer(rawBody) ? rawBody.length : null,
    });
    return res.status(400).json({ success: false, error: { message: 'Invalid signature' } });
  }

  // A missing `x-razorpay-event-id` is NOT rejected. The installed SDK never
  // references that header, so nothing available to this project guarantees it
  // is always sent, and refusing a properly signed event because an
  // unguaranteed header was absent would drop a real payment notification.
  // The service falls back to a key derived from the payload; see
  // resolveEventKey. It only gives up if neither is available.
  if (!eventId) {
    logger.info('Razorpay webhook has no event-id header; using payload-derived key', {
      requestId: req.id,
    });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn('Razorpay webhook rejected: body is not valid JSON', { requestId: req.id });
    return res.status(400).json({ success: false, error: { message: 'Invalid payload' } });
  }

  // `JSON.parse` happily returns null, a number or a string for well-formed
  // JSON that is not an object, and reading `.event` off null throws — which
  // reached the shared handler as a 500 and told Razorpay to keep retrying a
  // body that could never be processed. Anything that is not an object is
  // simply not an event.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, error: { message: 'Invalid payload' } });
  }

  const event = typeof body.event === 'string' ? body.event : null;
  if (!event) {
    return res.status(400).json({ success: false, error: { message: 'Missing event type' } });
  }

  try {
    const result = await webhookService.processWebhookEvent({ eventId, event, body });

    logger.info('Razorpay webhook processed', {
      requestId: req.id,
      eventId,
      event,
      outcome: result.outcome,
      reason: result.reason || null,
      orderId: result.orderId || null,
    });

    // Committed by the time this is sent.
    return res.status(200).json({ success: true, data: { outcome: result.outcome } });
  } catch (error) {
    // Non-2xx so Razorpay retries. Passed to the error handler, which logs it
    // and emits the standard envelope without leaking internals.
    return next(error);
  }
}

module.exports = { handleRazorpayWebhook };
