'use strict';

/**
 * Session routes, mounted at /api/sessions.
 *
 * Read-only. The schedule lives in the client's `session` table and is synced
 * from their source system, so QBusto reads it and does not write it.
 *
 * PERMISSIONS
 *
 * Authorised against Settings, alongside chains, cinemas and screens. Tenant
 * scope is applied in the service through the session's cinema code, so a
 * Settings grant never reaches another chain's schedule.
 */

const express = require('express');

const sessionController = require('../controllers/session.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const sessionValidators = require('../validators/session.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

router.use(authenticate());

/**
 * @openapi
 * /api/sessions:
 *   get:
 *     tags: [Sessions]
 *     summary: List sessions
 *     description: >
 *       The screening schedule as the source system supplies it, earliest
 *       first. Scoped to the caller's chain through each session's cinema.
 *
 *
 *       The auditorium is identified by `screenName` as the source system
 *       names it, not by a `screens.id`.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: filmCode
 *         schema: { type: string, maxLength: 20 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Lower bound on startsAt.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Upper bound on startsAt.
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [sessionId, startsAt, endsAt, filmCode, screenName, status]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Sessions
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
 *                         $ref: '#/components/schemas/Session'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(sessionValidators.list),
  sessionController.list
);

/**
 * @openapi
 * /api/sessions/{id}:
 *   get:
 *     tags: [Sessions]
 *     summary: Get one session by its source-system session id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: The source system's session id, unique within a cinema.
 *     responses:
 *       200:
 *         description: Session
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Session'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(sessionValidators.getById),
  sessionController.getById
);

module.exports = router;
