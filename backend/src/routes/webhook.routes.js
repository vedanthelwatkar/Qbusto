'use strict';

/**
 * Server-to-server webhook routes.
 *
 * Mounted directly by src/app.js rather than under the /api router, for two
 * reasons that are both deliberate:
 *
 *  1. Raw body. Signature verification must hash the exact bytes Razorpay
 *     signed, so this router has to be mounted BEFORE the global
 *     express.json() parser. Mounting it inside api.routes.js would put it
 *     after that parser, and the original bytes would already be gone.
 *
 *  2. No customer rate limiter. /api is wrapped in apiLimiter; Razorpay's
 *     retries and bursts are not customer traffic, and a 429 would make it
 *     retry an event it had every right to deliver. The endpoint is protected
 *     by its HMAC signature, which is a stronger control than an IP bucket.
 *
 * There is no authenticate()/authorize() here on purpose: the caller is
 * Razorpay, not a QBusto user, and the signature is the authentication.
 */

const express = require('express');

const logger = require('../config/logger');
const { handleRazorpayWebhook } = require('../controllers/razorpaywebhook.controller');

const router = express.Router();

// Raw body, scoped to this router only. The matcher accepts any content type
// rather than only application/json, so a delivery with an unexpected or
// absent Content-Type still arrives as a Buffer instead of silently becoming
// an empty object and failing verification for the wrong reason.
const RAW_BODY_LIMIT = '1mb';

router.post(
  '/razorpay',
  express.raw({ type: '*/*', limit: RAW_BODY_LIMIT }),
  handleRazorpayWebhook
);

/**
 * Router-scoped error handler for failures raised by express.raw() itself,
 * before the controller ever runs.
 *
 * Without this, a body over the size limit reached the shared error handler as
 * an unrecognised error and became a 500. Two things were wrong with that: a
 * 500 tells Razorpay the failure is transient and worth retrying, when a body
 * that is too large will be exactly as large on every retry; and outside
 * production the shared handler attaches the stack to the response, which for
 * this expected condition is noise pointing at absolute filesystem paths.
 *
 * This is additive and scoped to this router. Everything it does not
 * recognise — above all database and transaction failures, which MUST stay
 * 5xx so Razorpay retries them — is passed straight through to the shared
 * handler untouched.
 *
 * These are answered with 4xx rather than 200 deliberately. A 2xx would tell
 * Razorpay the event was handled; nothing here was handled, and if such a
 * delivery ever were legitimate, acknowledging it would silently lose a
 * payment. A 4xx lets their bounded retries exhaust and surfaces the delivery
 * as failed in the Dashboard, where a human can see it.
 *
 * The four-argument signature is required: Express identifies error handlers
 * by arity, so `next` must be declared even where it is only used to delegate.
 */
router.use((err, req, res, next) => {
  const BODY_ERRORS = {
    'entity.too.large': 413,
    'entity.parse.failed': 400,
    'encoding.unsupported': 415,
    'request.aborted': 400,
  };

  const status = err && err.type ? BODY_ERRORS[err.type] : undefined;
  if (!status) return next(err);

  logger.warn('Razorpay webhook rejected before verification', {
    requestId: req.id,
    type: err.type,
    // Length only. The body is unverified at this point and must not be logged.
    contentLength: req.get('content-length') || null,
  });

  return res.status(status).json({
    success: false,
    error: { message: 'Webhook request could not be accepted' },
  });
});

module.exports = router;
