'use strict';

/**
 * Order routes, mounted at /api/orders.
 *
 * Every route requires authentication plus the matching Orders permission.
 * Reads need `read`; creating an order and moving either status need `edit`.
 * There is no `delete`: an order is never removed, and `rejected` is how one is
 * called off.
 *
 * Orders whose cinema is outside the actor's chain are reported as 404, not
 * 403 - see services/order.service for the tenant scoping rule.
 *
 * This router carries staff-facing endpoints only. Unauthenticated
 * customer-facing ordering is not part of this phase; see the phase notes.
 */

const express = require('express');

const orderController = require('../controllers/order.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const orderValidators = require('../validators/order.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders
 *     description: >
 *       Paginated, newest first by default. Non-owners see only orders placed at
 *       cinemas in their own chain. `status` and `paymentStatus` are filtered by
 *       status **code**, never by numeric id. `search` matches customer mobile,
 *       customer email, seat number, film title, or the order id exactly.
 *       Each row carries its cinema, screen, both statuses and its items.
 *       Requires the Orders module read permission.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: createdAt
 *           enum: [id, cinemaId, total, createdAt, updatedAt, deliveredAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: screenId
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         description: Order status code.
 *         schema:
 *           type: string
 *           enum: [initiated, confirmed, preparing, ready, delivered, rejected]
 *       - in: query
 *         name: paymentStatus
 *         description: Payment status code.
 *         schema:
 *           type: string
 *           enum: [pending, paid, failed, refunded]
 *       - in: query
 *         name: source
 *         schema: { type: string, enum: [qr, seat_qr, kiosk, counter] }
 *       - in: query
 *         name: createdFrom
 *         description: Lower bound on `createdAt`, inclusive.
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: createdTo
 *         description: Upper bound on `createdAt`, inclusive. Must be later than createdFrom.
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: A page of orders
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Order' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(orderValidators.list),
  orderController.list
);

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get one order in full
 *     description: >
 *       Returns the order with its items, its cinema and screen, both status
 *       master rows, and both audit trails (`statusLogs`, `paymentStatusLogs`)
 *       in chronological order. Requires the Orders module read permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The order
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/OrderDetail' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(orderValidators.getById),
  orderController.getById
);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Place an order
 *     description: >
 *       The request names products and quantities; every price, discount and
 *       total is calculated by the server from `product_pricing` and any amount
 *       sent in the body is discarded. Each product must be carried at the
 *       cinema, active, inside its date range and inside one of its availability
 *       windows, and must have an active price there.
 *
 *
 *       The order, its item snapshots and the opening entry in both audit trails
 *       are written in one transaction. A new order always starts at status
 *       `initiated` with payment status `pending` - neither can be set by the
 *       request.
 *       Requires the Orders module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, items]
 *             properties:
 *               cinemaId: { type: integer }
 *               screenId:
 *                 type: integer
 *                 nullable: true
 *                 description: Must belong to the cinema. Null for counter and kiosk orders.
 *               seatNumber: { type: string, maxLength: 20, nullable: true }
 *               source:
 *                 type: string
 *                 enum: [qr, seat_qr, kiosk, counter]
 *                 nullable: true
 *                 description: >
 *                   Selects which channel discount column in product_pricing
 *                   applies. Null falls back to the row's discountValue.
 *               customerMobile: { type: string, maxLength: 15, nullable: true }
 *               customerEmail: { type: string, format: email, maxLength: 200, nullable: true }
 *               filmTitle:
 *                 type: string
 *                 maxLength: 200
 *                 nullable: true
 *                 description: Display snapshot. Not resolved against a POS in this phase.
 *               showTime: { type: string, format: date-time, nullable: true }
 *               notes: { type: string, maxLength: 500, nullable: true }
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 description: One entry per product. A product may not appear twice.
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId: { type: integer }
 *                     quantity: { type: integer, minimum: 1, maximum: 999 }
 *     responses:
 *       201:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/OrderDetail' }
 *       400:
 *         description: Validation failed, or the same product was listed twice
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The cinema, screen or one of the products does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: >
 *           The cinema or screen is deactivated, or a product is deactivated,
 *           not carried at the cinema, outside its availability, or has no
 *           active price there
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.ORDERS, ACTIONS.EDIT),
  validate(orderValidators.create),
  orderController.create
);

/**
 * @openapi
 * /api/orders/{id}/status:
 *   put:
 *     tags: [Orders]
 *     summary: Move an order to a new status
 *     description: >
 *       Transitions follow a fixed graph and arbitrary jumps are refused:
 *       `initiated` to `confirmed` to `preparing` to `ready` to `delivered`,
 *       with `rejected` reachable from any of those. `delivered` and `rejected`
 *       are terminal.
 *
 *
 *       The order update and the `order_status_logs` entry are written in one
 *       transaction. Asking for the status the order is already in is a no-op:
 *       it returns 200 and writes no log entry. Moving to `delivered` stamps
 *       `deliveredAt`.
 *       Requires the Orders module edit permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [initiated, confirmed, preparing, ready, delivered, rejected]
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 nullable: true
 *                 description: Free text, stored on the log entry.
 *     responses:
 *       200:
 *         description: The order, after the change
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/OrderDetail' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: The order cannot move from its current status to the requested one
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id/status',
  authorize(MODULES.ORDERS, ACTIONS.EDIT),
  validate(orderValidators.updateStatus),
  orderController.updateStatus
);

/**
 * @openapi
 * /api/orders/{id}/payment-status:
 *   put:
 *     tags: [Orders]
 *     summary: Move an order's payment to a new status
 *     description: >
 *       The staff-operated payment path: cash taken at the counter, a refund
 *       granted, a failed attempt written off. Transitions are `pending` to
 *       `paid` or `failed`, `failed` back to `pending` or on to `paid`, and
 *       `paid` to `refunded`, which is terminal.
 *
 *
 *       The order update and the `payment_status_logs` entry are written in one
 *       transaction. Asking for the status the payment is already in is a no-op.
 *       This endpoint takes no gateway identifiers and does not touch the
 *       `razorpay_*` columns - gateway-driven payment confirmation belongs to
 *       the Razorpay integration phase.
 *       Requires the Orders module edit permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentStatus]
 *             properties:
 *               paymentStatus:
 *                 type: string
 *                 enum: [pending, paid, failed, refunded]
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 nullable: true
 *                 description: Free text, stored on the log entry.
 *     responses:
 *       200:
 *         description: The order, after the change
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/OrderDetail' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: The payment cannot move from its current status to the requested one
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id/payment-status',
  authorize(MODULES.ORDERS, ACTIONS.EDIT),
  validate(orderValidators.updatePaymentStatus),
  orderController.updatePaymentStatus
);

module.exports = router;
