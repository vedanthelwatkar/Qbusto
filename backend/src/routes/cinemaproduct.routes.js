'use strict';

/**
 * Cinema product routes, mounted at /api/cinema-products.
 *
 * Every route requires authentication plus the matching Products permission: a
 * cinema_product is product configuration, and the frozen permission-module list
 * has no module of its own for it. This matches product_availability_hours,
 * which hangs off these rows and is guarded the same way.
 *
 * Rows whose cinema is outside the actor's chain are reported as 404, not 403 -
 * see services/cinemaproduct.service for the tenant scoping rule.
 */

const express = require('express');

const cinemaProductController = require('../controllers/cinemaproduct.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const cinemaProductValidators = require('../validators/cinemaproduct.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/cinema-products:
 *   get:
 *     tags: [Cinema Products]
 *     summary: List cinema/product links
 *     description: >
 *       Paginated. Non-owners see only links whose cinema is in their own chain.
 *       Filtering by both `cinemaId` and `productId` resolves a single link,
 *       which is how a client turns a (cinema, product) pair into the
 *       `cinemaProductId` that availability windows hang off.
 *       Requires the Products module read permission.
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
 *           default: sequence
 *           enum: [id, cinemaId, productId, sequence, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: productId
 *         schema: { type: integer }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of cinema/product links
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/CinemaProduct' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(cinemaProductValidators.list),
  cinemaProductController.list
);

/**
 * @openapi
 * /api/cinema-products/{id}:
 *   get:
 *     tags: [Cinema Products]
 *     summary: Get a cinema/product link
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The cinema/product link
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/CinemaProduct' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(cinemaProductValidators.getById),
  cinemaProductController.getById
);

/**
 * @openapi
 * /api/cinema-products:
 *   post:
 *     tags: [Cinema Products]
 *     summary: Carry a product at a cinema
 *     description: >
 *       Creates the link that availability windows attach to. The cinema and the
 *       product must belong to the same chain, and both must be active.
 *       (cinemaId, productId) is unique. `availableUntil` must be later than
 *       `availableFrom` when both are given.
 *       Requires the Products module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, productId]
 *             properties:
 *               cinemaId:  { type: integer }
 *               productId: { type: integer }
 *               sequence:
 *                 type: integer
 *                 minimum: 0
 *                 default: 0
 *                 description: Display order within the cinema. Not unique.
 *               availableFrom:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Start of a date-range offer. Null means no lower bound.
 *               availableUntil:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: End of a date-range offer. Null means no upper bound.
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Link created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/CinemaProduct' }
 *       400:
 *         description: Validation failed, or availableUntil is not later than availableFrom
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced cinema or product does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: >
 *           The product is already carried at this cinema, the cinema and product
 *           belong to different chains, or one of them is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(cinemaProductValidators.create),
  cinemaProductController.create
);

/**
 * @openapi
 * /api/cinema-products/{id}:
 *   put:
 *     tags: [Cinema Products]
 *     summary: Update a cinema/product link
 *     description: >
 *       `cinemaId` and `productId` cannot be changed: together they are the
 *       natural key, and availability windows hang off this row's id, so
 *       repointing it would silently move them to another cinema.
 *       `availableUntil` must be later than `availableFrom` in the resulting row.
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
 *               sequence:       { type: integer, minimum: 0 }
 *               availableFrom:  { type: string, format: date-time, nullable: true }
 *               availableUntil: { type: string, format: date-time, nullable: true }
 *               isActive:       { type: boolean }
 *     responses:
 *       200:
 *         description: Link updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/CinemaProduct' }
 *       400:
 *         description: Validation failed, or availableUntil is not later than availableFrom
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(cinemaProductValidators.update),
  cinemaProductController.update
);

/**
 * @openapi
 * /api/cinema-products/{id}:
 *   delete:
 *     tags: [Cinema Products]
 *     summary: Withdraw a product from a cinema (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row stays, and so do its availability
 *       windows - withdrawing a product should not discard the schedule it had
 *       at that cinema. Idempotent. Requires the Products module delete
 *       permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Link deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/CinemaProduct' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.DELETE),
  validate(cinemaProductValidators.remove),
  cinemaProductController.remove
);

module.exports = router;
