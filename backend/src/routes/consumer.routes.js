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
router.post('/orders', consumerController.createOrder);

/**
 * @openapi
 * /api/consumer/orders/{orderId}/payment-init:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Initialize Razorpay payment (idempotent)
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
 *                         razorpayOrderId:
 *                           type: string
 *                           description: Razorpay order ID
 *                         razorpayKeyId:
 *                           type: string
 *                           description: Razorpay public key
 *                         amount:
 *                           type: integer
 *                           description: Amount in paise
 *                         currency:
 *                           type: string
 *                           example: INR
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order not in pending payment state
 *       503:
 *         description: Razorpay API unavailable
 */
router.post('/orders/:orderId/payment-init', consumerController.paymentInit);

/**
 * @openapi
 * /api/consumer/orders/{orderId}/payment-verify:
 *   post:
 *     tags: [Consumer - Orders]
 *     summary: Verify Razorpay payment signature (idempotent)
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
 *             required: [razorpayPaymentId, razorpaySignature]
 *             properties:
 *               razorpayPaymentId:
 *                 type: string
 *               razorpaySignature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
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
 *         description: Invalid signature or missing Razorpay order
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order not in pending payment state
 */
router.post('/orders/:orderId/payment-verify', consumerController.paymentVerify);

module.exports = router;
