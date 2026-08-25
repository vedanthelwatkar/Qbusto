'use strict';

/**
 * Request schemas for /api/payment-gateway-config.
 *
 * `secretKey` never appears in any RESPONSE schema (see swagger.js's
 * PaymentGatewayConfig definition) - only ever accepted on the way in.
 */

const Joi = require('joi');

const { id } = require('./common.validators');

/**
 * The field-level pieces are exported individually (not just composed into
 * `setCredentials`) so `cinema.validators.js` can require the same Cashfree
 * credential shape on cinema creation without redefining it - one definition
 * of "what a valid gatewayId/secretKey/environment looks like", not two that
 * could drift apart.
 */
const gatewayId = Joi.string().trim().min(1).max(255);
const secretKey = Joi.string().trim().min(1).max(500);
const environment = Joi.string().trim().lowercase().valid('test', 'sandbox', 'prod', 'production');

const getActive = {
  query: Joi.object({ cinemaId: id.required() }),
};

const setCredentials = {
  body: Joi.object({
    cinemaId: id.required(),
    gatewayId: gatewayId.required(),
    secretKey: secretKey.required(),
    environment: environment.default('test'),
  }),
};

const deactivate = {
  query: Joi.object({ cinemaId: id.required() }),
};

module.exports = { getActive, setCredentials, deactivate, gatewayId, secretKey, environment };
