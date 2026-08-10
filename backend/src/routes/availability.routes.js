'use strict';

/**
 * Product availability hour routes, mounted at /api/product-availability-hours.
 *
 * Authorized against the Products module, as specified - availability is part
 * of managing a product rather than a module of its own.
 *
 * The parent is a cinema_product, so tenant scope runs hour -> cinema_product ->
 * cinema.chain_id. Rows outside the actor's chain are reported as 404.
 */

const express = require('express');

const availabilityController = require('../controllers/availability.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const availabilityValidators = require('../validators/availability.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/product-availability-hours:
 *   get:
 *     tags: [Product Availability Hours]
 *     summary: List availability windows
 *     description: >
 *       Paginated. Non-owners see only windows whose cinema is in their own
 *       chain. Requires the Products module read permission.
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
 *           default: id
 *           enum: [id, cinemaProductId, dayOfWeek, startTime, endTime, createdAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: cinemaProductId
 *         schema: { type: integer }
 *       - in: query
 *         name: dayOfWeek
 *         description: 0 = every day, 1 = Monday ... 7 = Sunday.
 *         schema: { type: integer, minimum: 0, maximum: 7 }
 *     responses:
 *       200:
 *         description: A page of availability windows
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/ProductAvailabilityHour' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(availabilityValidators.list),
  availabilityController.list
);

/**
 * @openapi
 * /api/product-availability-hours/{id}:
 *   get:
 *     tags: [Product Availability Hours]
 *     summary: Get an availability window
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The availability window
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductAvailabilityHour' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(availabilityValidators.getById),
  availabilityController.getById
);

/**
 * @openapi
 * /api/product-availability-hours:
 *   post:
 *     tags: [Product Availability Hours]
 *     summary: Create an availability window
 *     description: >
 *       Attaches to a cinema_product, so the window applies to one product at
 *       one cinema. `startTime` must be earlier than `endTime`, and the window
 *       may not overlap another for the same cinema_product. A window on day 0
 *       (every day) is checked against every other day. Requires the Products
 *       module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaProductId, dayOfWeek, startTime, endTime]
 *             properties:
 *               cinemaProductId: { type: integer }
 *               dayOfWeek:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 7
 *                 description: 0 = every day, 1 = Monday ... 7 = Sunday.
 *               startTime: { type: string, example: '09:00', description: 'HH:MM or HH:MM:SS' }
 *               endTime:   { type: string, example: '17:30', description: 'HH:MM or HH:MM:SS' }
 *     responses:
 *       201:
 *         description: Availability window created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductAvailabilityHour' }
 *       400:
 *         description: Validation failed, or endTime is not later than startTime
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced cinema product does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: The window overlaps an existing one
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(availabilityValidators.create),
  availabilityController.create
);

/**
 * @openapi
 * /api/product-availability-hours/{id}:
 *   put:
 *     tags: [Product Availability Hours]
 *     summary: Replace an availability window
 *     description: >
 *       The whole range is required: half a range has no meaning, and comparing
 *       one new time against one stored time is not a check worth trusting.
 *       `cinemaProductId` cannot be changed.
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
 *             required: [dayOfWeek, startTime, endTime]
 *             properties:
 *               dayOfWeek: { type: integer, minimum: 0, maximum: 7 }
 *               startTime: { type: string, example: '09:00' }
 *               endTime:   { type: string, example: '17:30' }
 *     responses:
 *       200:
 *         description: Availability window updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductAvailabilityHour' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: The window overlaps an existing one
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(availabilityValidators.update),
  availabilityController.update
);

/**
 * @openapi
 * /api/product-availability-hours/{id}:
 *   delete:
 *     tags: [Product Availability Hours]
 *     summary: Delete an availability window
 *     description: >
 *       A hard delete. product_availability_hours has no `is_active` column and
 *       nothing references a window, so the row is removed outright - unlike
 *       every other module in this phase. Requires the Products module delete
 *       permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Availability window deleted, returned as it last existed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductAvailabilityHour' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.DELETE),
  validate(availabilityValidators.remove),
  availabilityController.remove
);

module.exports = router;
