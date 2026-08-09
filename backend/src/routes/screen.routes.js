'use strict';

/**
 * Screen routes, mounted at /api/screens.
 *
 * Every route requires authentication plus the matching Settings permission -
 * see chain.routes for why Settings and not a module of their own.
 *
 * A screen has no chain_id of its own; tenant scope is applied through its
 * cinema. Screens outside the actor's chain are reported as 404, not 403 - see
 * services/screen.service.
 */

const express = require('express');

const screenController = require('../controllers/screen.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const screenValidators = require('../validators/screen.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/screens:
 *   get:
 *     tags: [Screens]
 *     summary: List screens
 *     description: >
 *       Paginated. Non-owners see only screens whose cinema is in their own
 *       chain. Requires the Settings module read permission.
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
 *           enum: [id, name, cinemaId, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         description: Partial match against the screen name.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: cinemaId
 *         description: Narrows within the actor's chain; a cinema outside it simply matches nothing.
 *         schema: { type: integer }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of screens
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Screen' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(screenValidators.list),
  screenController.list
);

/**
 * @openapi
 * /api/screens/{id}:
 *   get:
 *     tags: [Screens]
 *     summary: Get a screen
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The screen
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Screen' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(screenValidators.getById),
  screenController.getById
);

/**
 * @openapi
 * /api/screens:
 *   post:
 *     tags: [Screens]
 *     summary: Create a screen
 *     description: >
 *       The referenced cinema must exist, be in the actor's chain, and be
 *       active. Screen names are unique within a cinema, counting deactivated
 *       screens. Requires the Settings module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, name]
 *             properties:
 *               cinemaId: { type: integer }
 *               name:     { type: string, minLength: 1, maxLength: 50, example: Screen 1 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Screen created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Screen' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced cinema does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: >
 *           A screen with this name already exists in this cinema, or the
 *           cinema is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(screenValidators.create),
  screenController.create
);

/**
 * @openapi
 * /api/screens/{id}:
 *   put:
 *     tags: [Screens]
 *     summary: Update a screen
 *     description: >
 *       `cinemaId` cannot be changed: orders reference a screen, so moving one
 *       between cinemas would rewrite the history of those orders.
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
 *             minProperties: 1
 *             properties:
 *               name:     { type: string, minLength: 1, maxLength: 50 }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Screen updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Screen' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A screen with this name already exists in this cinema
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(screenValidators.update),
  screenController.update
);

/**
 * @openapi
 * /api/screens/{id}:
 *   delete:
 *     tags: [Screens]
 *     summary: Deactivate a screen (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - orders and POS
 *       mappings reference it. Idempotent. Requires the Settings module delete
 *       permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Screen deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Screen' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.DELETE),
  validate(screenValidators.remove),
  screenController.remove
);

module.exports = router;
