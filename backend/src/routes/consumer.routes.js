'use strict';

/**
 * Consumer API routes - public, unauthenticated endpoints.
 *
 * No authenticate() middleware: these routes are intentionally public.
 * Staff endpoints remain at /api/orders etc. with authentication.
 * Consumer endpoints are at /api/consumer/* for complete isolation.
 */

const express = require('express');
const consumerController = require('../controllers/consumer.controller');
const validate = require('../middleware/validate');
const consumerValidators = require('../validators/consumer.validators');

const router = express.Router();

// Catalog endpoints (read-only, publicly accessible)

/**
 * @openapi
 * /api/consumer/cinemas/{id}:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: Get cinema details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Cinema found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Cinema'
 *       404:
 *         description: Cinema not found
 */
router.get('/cinemas/:id', consumerController.getCinema);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/screens/{id}:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: Get screen details
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Screen found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Screen'
 *       404:
 *         description: Screen not found or doesn't belong to cinema
 */
router.get('/cinemas/:cinemaId/screens/:id', consumerController.getScreen);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/categories:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: List categories available at a cinema
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Categories list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Category'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         pagination:
 *                           $ref: '#/components/schemas/Pagination'
 *       404:
 *         description: Cinema not found
 */
router.get('/cinemas/:cinemaId/categories', consumerController.getCategories);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/products:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: List products available at a cinema
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: categoryId
 *         in: query
 *         schema: { type: integer }
 *       - name: search
 *         in: query
 *         schema: { type: string, maxLength: 100 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Products list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Product'
 *                     meta:
 *                       type: object
 *                       properties:
 *                         pagination:
 *                           $ref: '#/components/schemas/Pagination'
 *       404:
 *         description: Cinema not found
 */
router.get('/cinemas/:cinemaId/products', consumerController.getProducts);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/products/{id}:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: Get product details
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Product found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
router.get('/cinemas/:cinemaId/products/:id', consumerController.getProductDetail);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/banners:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: Get banners for a cinema
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: type
 *         in: query
 *         schema: { type: string, enum: [H, I] }
 *         description: H=Header, I=Inner
 *     responses:
 *       200:
 *         description: Banners list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Banner'
 *       404:
 *         description: Cinema not found
 */
router.get('/cinemas/:cinemaId/banners', consumerController.getBanners);
/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/sessions:
 *   get:
 *     tags: [Consumer - Catalog]
 *     summary: Get bookable sessions for a cinema
 *     description: >
 *       Scheduled screenings at this cinema that have not started yet,
 *       earliest first. Each session joins a film to an auditorium at a time.
 *
 *
 *       The Consumer offers these as a single picker at checkout, and the
 *       selected session supplies the order's `screenId`, `filmTitle` and
 *       `showTime` together, so the customer does not enter the three
 *       separately and they cannot disagree.
 *
 *
 *       Sessions whose film or auditorium is no longer active are excluded, so
 *       every option offered can actually be ordered against.
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Sessions list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ConsumerSession'
 *       404:
 *         description: Cinema not found
 */
router.get('/cinemas/:cinemaId/sessions', consumerController.getSessions);

// Order endpoints

/**
 * @openapi
 * /api/consumer/orders:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Create order (idempotent via Idempotency-Key header)
 *     parameters:
 *       - name: Idempotency-Key
 *         in: header
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, source, items]
 *             properties:
 *               cinemaId:
 *                 type: integer
 *               screenId:
 *                 type: integer
 *                 nullable: true
 *               seatNumber:
 *                 type: string
 *                 nullable: true
 *               source:
 *                 type: string
 *                 enum: [qr, seat_qr, kiosk, counter]
 *               customerMobile:
 *                 type: string
 *                 nullable: true
 *               customerEmail:
 *                 type: string
 *                 nullable: true
 *               filmTitle:
 *                 type: string
 *                 nullable: true
 *               showTime:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               couponCode:
 *                 type: string
 *                 nullable: true
 *                 description: >
 *                   Validated and applied server-side against the cinema's
 *                   offers - see POST .../coupons/validate to preview the
 *                   discount first. An invalid/expired/out-of-range code is
 *                   a 400 naming the couponCode field.
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId:
 *                       type: integer
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
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
 *                     data:
 *                       type: object
 *                       properties:
 *                         orderId:
 *                           type: integer
 *                         status:
 *                           type: string
 *                           enum: [initiated]
 *                         paymentStatus:
 *                           type: string
 *                           enum: [pending]
 *                         subtotal:
 *                           type: number
 *                           format: decimal
 *                         discount:
 *                           type: number
 *                           format: decimal
 *                           description: Total discount - product-level pricing discount plus couponDiscount, if any.
 *                         couponDiscount:
 *                           type: number
 *                           format: decimal
 *                           description: The portion of `discount` contributed by `couponCode`. 0 when no coupon was applied.
 *                         total:
 *                           type: number
 *                           format: decimal
 *                         currency:
 *                           type: string
 *                           example: INR
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               productId:
 *                                 type: integer
 *                               productName:
 *                                 type: string
 *                               quantity:
 *                                 type: integer
 *                               unitPrice:
 *                                 type: number
 *                               lineTotal:
 *                                 type: number
 *                         customerMobile:
 *                           type: string
 *                           nullable: true
 *                         customerEmail:
 *                           type: string
 *                           nullable: true
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *       400:
 *         description: Validation failed
 *       409:
 *         description: Resource conflict (unavailable cinema/product)
 */
router.post('/orders', validate(consumerValidators.createOrder), consumerController.createOrder);

/**
 * @openapi
 * /api/consumer/cinemas/{cinemaId}/coupons/validate:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Preview a coupon's discount before placing an order
 *     description: >
 *       Validates a coupon code against the cinema's `offers` and computes
 *       the discount from the SAME items/source the order would actually be
 *       created with - the subtotal is recomputed from live pricing here,
 *       never trusted from the client, so the discount matches exactly what
 *       `POST /api/consumer/orders` would apply for an identical cart.
 *       Creates nothing.
 *     parameters:
 *       - name: cinemaId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, source, items]
 *             properties:
 *               code:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [qr, seat_qr, kiosk, counter]
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId: { type: integer }
 *                     quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         valid: { type: boolean }
 *                         message: { type: string, nullable: true }
 *                         discount: { type: number, nullable: true, description: 'Rupees, only present when valid.' }
 *                         subtotal: { type: number }
 *       404:
 *         description: Cinema not found
 */
router.post(
  '/cinemas/:cinemaId/coupons/validate',
  validate(consumerValidators.validateCoupon),
  consumerController.validateCoupon
);

/**
 * @openapi
 * /api/consumer/orders/{orderId}/payment-init:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Initialize a Cashfree hosted-checkout payment (idempotent)
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Payment initialized
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         orderId:
 *                           type: integer
 *                         gatewayOrderId:
 *                           type: string
 *                           nullable: true
 *                           description: >
 *                             The payment gateway's order identifier. Null only
 *                             when `paymentStatus` is `paid` - a coupon covered
 *                             the order in full, so no gateway order was ever
 *                             created.
 *                         paymentSessionId:
 *                           type: string
 *                           nullable: true
 *                           description: >
 *                             Short-lived token for the Cashfree hosted checkout.
 *                             Null when a session could not be issued (the caller
 *                             should retry rather than treat it as a failure), or
 *                             when `paymentStatus` is `paid` and there is nothing
 *                             to check out.
 *                         amount:
 *                           type: integer
 *                           description: Amount in paise. 0 when `paymentStatus` is `paid`.
 *                         currency:
 *                           type: string
 *                           example: INR
 *                         paymentStatus:
 *                           type: string
 *                           enum: [paid]
 *                           description: >
 *                             Present ONLY when a coupon discounted the order to
 *                             zero: the order was confirmed as paid immediately,
 *                             with no gateway involved at all, and the caller
 *                             should skip straight to the confirmation screen
 *                             rather than opening a checkout with nothing to pay.
 *                             Absent (not `pending`) for the ordinary case where
 *                             there is a real amount to collect.
 *       404:
 *         description: Order not found
 *       409:
 *         description: >
 *           Order not in pending payment state. `error.details.paymentStatus`
 *           carries the authoritative status and is what the Consumer's
 *           recovery flow reads.
 *       503:
 *         description: Payment provider temporarily unavailable
 */
router.post('/orders/:orderId/payment-init', consumerController.paymentInit);

/**
 * @openapi
 * /api/consumer/orders/{orderId}/payment-verify:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Confirm a payment with the gateway (idempotent)
 *     description: >
 *       Asks Cashfree directly whether this order has been paid, and settles it
 *       if so. Takes no payment identity from the caller: Cashfree's hosted
 *       checkout hands the browser no cryptographic credential, so anything a
 *       client supplied would be an unverifiable assertion. The request means
 *       only "my checkout finished, please look".
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Payment confirmed by the gateway
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         orderId:
 *                           type: integer
 *                         paymentStatus:
 *                           type: string
 *                           enum: [paid]
 *       400:
 *         description: Order has no gateway order
 *       404:
 *         description: Order not found
 *       409:
 *         description: >
 *           Either the order has already left the pending state, or the gateway
 *           was reached and holds no successful payment yet.
 *           `error.details.paymentStatus` distinguishes the two.
 *           When `paymentStatus` is `pending`, `error.details.gatewayPending`
 *           says whether an attempt is still IN FLIGHT at the gateway (a UPI
 *           collect the customer has not approved yet). `true` means the
 *           caller must NOT offer another payment - the outstanding attempt can
 *           still succeed. `false` means every attempt reached a terminal
 *           non-success, so nothing was charged and retrying is safe.
 *       503:
 *         description: >
 *           The gateway could not be consulted, so the outcome is unknown. This
 *           is deliberately NOT a 409 `pending`: the caller must treat it as
 *           "ask again", not as evidence that nothing was charged.
 */
router.post('/orders/:orderId/payment-verify', consumerController.paymentVerify);

module.exports = router;
