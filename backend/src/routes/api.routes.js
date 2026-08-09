'use strict';

/**
 * API router, mounted at /api by src/app.js.
 *
 * Phase 2 mounts resource routers below, e.g.:
 *   router.use('/auth', require('./auth.routes'));
 *   router.use('/products', require('./product.routes'));
 *
 * Each resource router owns its own authenticate()/authorize() wiring so that
 * public endpoints (login) and protected ones can live side by side.
 */

const express = require('express');

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

module.exports = router;
