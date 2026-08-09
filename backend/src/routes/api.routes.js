'use strict';

/**
 * API router, mounted at /api by src/app.js.
 *
 * Each resource router owns its own authenticate()/authorize() wiring so that
 * public endpoints (login) and protected ones can live side by side.
 */

const express = require('express');

const authRoutes = require('./auth.routes');
const chainRoutes = require('./chain.routes');
const cinemaRoutes = require('./cinema.routes');
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

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/chains', chainRoutes);
router.use('/cinemas', cinemaRoutes);
router.use('/screens', screenRoutes);

module.exports = router;
