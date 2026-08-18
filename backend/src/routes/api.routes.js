'use strict';

/**
 * API router, mounted at /api by src/app.js.
 *
 * Each resource router owns its own authenticate()/authorize() wiring so that
 * public endpoints (login) and protected ones can live side by side.
 */

const express = require('express');

const authRoutes = require('./auth.routes');
const availabilityRoutes = require('./availability.routes');
const bannerRoutes = require('./banner.routes');
const categoryRoutes = require('./category.routes');
const chainRoutes = require('./chain.routes');
const cinemaRoutes = require('./cinema.routes');
const cinemaProductRoutes = require('./cinemaproduct.routes');
const consumerRoutes = require('./consumer.routes');
const kitchenRoutes = require('./kitchen.routes');
const orderRoutes = require('./order.routes');
const { orderStatusRouter, paymentStatusRouter } = require('./orderstatus.routes');
const pricingRoutes = require('./pricing.routes');
const productRoutes = require('./product.routes');
const screenRoutes = require('./screen.routes');
const userRoutes = require('./user.routes');
const { success } = require('../utils/response');

const router = express.Router();

/**
 * @openapi
 * /api:
 *   get:
 *     tags: [Meta]
 *     summary: API index
 *     description: Confirms the API is mounted and reachable.
 *     security: []
 *     responses:
 *       200:
 *         description: API is mounted
 */
router.get('/', (req, res) => success(res, { message: 'QBusto API' }));

// Consumer API routes - PUBLIC, unauthenticated
router.use('/consumer', consumerRoutes);

// Staff API routes - authenticated and authorized
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/chains', chainRoutes);
router.use('/cinemas', cinemaRoutes);
router.use('/screens', screenRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/cinema-products', cinemaProductRoutes);
router.use('/product-availability-hours', availabilityRoutes);
router.use('/product-pricing', pricingRoutes);
router.use('/banners', bannerRoutes);
router.use('/orders', orderRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/order-statuses', orderStatusRouter);
router.use('/payment-statuses', paymentStatusRouter);

module.exports = router;
