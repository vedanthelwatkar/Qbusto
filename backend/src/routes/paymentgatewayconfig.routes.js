'use strict';

/**
 * Per-cinema Cashfree credential routes, mounted at /api/payment-gateway-config.
 *
 * Scoped to the Settings module - the same permission that already governs
 * cinema/screen/chain configuration - rather than a new module, since this
 * is cinema-level configuration in the same sense those are.
 *
 * `secretKey` is accepted on write and never appears in any response - see
 * services/paymentgatewayconfig.service for how it is encrypted at rest.
 */

const express = require('express');

const configController = require('../controllers/paymentgatewayconfig.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const configValidators = require('../validators/paymentgatewayconfig.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

router.use(authenticate());

/**
 * @openapi
 * /api/payment-gateway-config:
 *   get:
 *     tags: [Settings]
 *     summary: Get a cinema's active Cashfree credentials (metadata only)
 *     description: >
 *       Never returns the secret key itself - only whether one is configured
 *       (`hasSecret`), the App ID, and the environment. Requires the
 *       Settings module read permission.
 *     parameters:
 *       - in: query
 *         name: cinemaId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The active config
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/PaymentGatewayConfig' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(configValidators.getActive),
  configController.getActive
);

/**
 * @openapi
 * /api/payment-gateway-config:
 *   put:
 *     tags: [Settings]
 *     summary: Replace a cinema's active Cashfree credentials
 *     description: >
 *       The previous active config, if any, is deactivated (not deleted) and
 *       a new one is created, in one transaction. `secretKey` is encrypted
 *       before it is ever written to the database and is not returned in the
 *       response. Requires the Settings module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, gatewayId, secretKey]
 *             properties:
 *               cinemaId:    { type: integer }
 *               gatewayId:   { type: string, maxLength: 255, description: "Cashfree's APP_ID." }
 *               secretKey:   { type: string, maxLength: 500, description: "Cashfree's SECRET_KEY. Encrypted at rest; never returned." }
 *               environment: { type: string, enum: [test, sandbox, prod, production], default: test }
 *     responses:
 *       200:
 *         description: Credentials saved
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/PaymentGatewayConfig' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(configValidators.setCredentials),
  configController.setCredentials
);

/**
 * @openapi
 * /api/payment-gateway-config:
 *   delete:
 *     tags: [Settings]
 *     summary: Deactivate a cinema's active Cashfree credentials
 *     description: >
 *       The row is deactivated, not deleted - a historical record of which
 *       credential this cinema was on stays available. Requires the
 *       Settings module delete permission.
 *     parameters:
 *       - in: query
 *         name: cinemaId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Config deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/PaymentGatewayConfig' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.DELETE),
  validate(configValidators.deactivate),
  configController.deactivate
);

module.exports = router;
