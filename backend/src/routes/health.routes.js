'use strict';

/**
 * Operational endpoints, mounted at the root rather than under /api so that
 * probes stay reachable independently of the API surface.
 */

const express = require('express');

const healthController = require('../controllers/health.controller');

const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: >
 *       Reports that the process is running, along with current database
 *       connectivity. Always returns 200 while the process is alive - including
 *       during a database outage - so use /ready to gate traffic.
 *     security: []
 *     responses:
 *       200:
 *         description: Service is alive
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
 *                         status:        { type: string, example: ok }
 *                         uptimeSeconds: { type: integer, example: 3600 }
 *                         database:
 *                           type: object
 *                           properties:
 *                             connected: { type: boolean, example: true }
 *                             latencyMs:
 *                               type: number
 *                               example: 2.4
 *                               description: Present only when connected.
 *                             error:
 *                               type: string
 *                               example: Database check timed out after 2000ms
 *                               description: Present only when not connected.
 */
router.get('/health', healthController.health);

/**
 * @openapi
 * /ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: >
 *       Verifies database connectivity, that no migrations are pending, and that
 *       required seed data is present. Returns 503 when any check fails.
 *     security: []
 *     responses:
 *       200:
 *         description: Service is ready to accept traffic
 *       503:
 *         description: Service is not ready
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/ready', healthController.ready);

/**
 * @openapi
 * /version:
 *   get:
 *     tags: [Health]
 *     summary: Build and runtime version information
 *     security: []
 *     responses:
 *       200:
 *         description: Version information
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
 *                         name:        { type: string, example: backend }
 *                         version:     { type: string, example: 1.0.0 }
 *                         environment: { type: string, example: development }
 *                         node:        { type: string, example: v24.15.0 }
 *                         sqlServer:   { type: object }
 */
router.get('/version', healthController.version);

module.exports = router;
