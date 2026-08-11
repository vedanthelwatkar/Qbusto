'use strict';

/**
 * Status master-table routes, mounted at /api/order-statuses and
 * /api/payment-statuses by api.routes.
 *
 * Read-only. These are the seeded lifecycle tables, and nothing in the
 * application creates or edits a status row - the codes are part of the
 * contract, not configuration.
 *
 * They exist so a client can render a status filter or a transition control
 * without hardcoding a list that would then drift from the database. Guarded by
 * the Orders read permission, since order status is what they describe.
 *
 * Not tenant-scoped: statuses are global, and there is nothing chain-specific
 * about the word "preparing".
 */

const express = require('express');

const orderController = require('../controllers/order.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const orderValidators = require('../validators/order.validators');
const { MODULES, ACTIONS } = require('../constants');

const orderStatusRouter = express.Router();
const paymentStatusRouter = express.Router();

orderStatusRouter.use(authenticate());
paymentStatusRouter.use(authenticate());

/**
 * @openapi
 * /api/order-statuses:
 *   get:
 *     tags: [Order Statuses]
 *     summary: List order lifecycle statuses
 *     description: >
 *       The `order_statuses` master table. Six seeded rows, returned whole
 *       rather than paginated. Application logic addresses these by `code`;
 *       the numeric `id` is database detail and should not be sent back in
 *       filters or request bodies. Requires the Orders module read permission.
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Every order status
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/OrderStatus' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
orderStatusRouter.get(
  '/',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(orderValidators.listStatuses),
  orderController.listOrderStatuses
);

/**
 * @openapi
 * /api/payment-statuses:
 *   get:
 *     tags: [Order Statuses]
 *     summary: List payment lifecycle statuses
 *     description: >
 *       The `payment_statuses` master table. Four seeded rows, returned whole
 *       rather than paginated. Addressed by `code`, like order statuses.
 *       Requires the Orders module read permission.
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Every payment status
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/OrderStatus' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
paymentStatusRouter.get(
  '/',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(orderValidators.listStatuses),
  orderController.listPaymentStatuses
);

module.exports = { orderStatusRouter, paymentStatusRouter };
