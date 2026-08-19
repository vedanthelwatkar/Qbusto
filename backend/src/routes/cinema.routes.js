'use strict';

/**
 * Cinema routes, mounted at /api/cinemas.
 *
 * Every route requires authentication plus the matching Settings permission -
 * see chain.routes for why Settings and not a module of their own.
 *
 * Rows outside the actor's chain are reported as 404, not 403 - see
 * services/cinema.service for the tenant scoping rule.
 */

const express = require('express');

const cinemaController = require('../controllers/cinema.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const cinemaValidators = require('../validators/cinema.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/cinemas:
 *   get:
 *     tags: [Cinemas]
 *     summary: List cinemas
 *     description: >
 *       Paginated. Non-owners see only cinemas in their own chain. Requires the
 *       Settings module read permission.
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
 *           enum: [id, code, name, city, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         description: Partial match against name, code or city.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: chainId
 *         description: Owners only; ignored for every other role, which is already scoped to one chain.
 *         schema: { type: integer }
 *       - in: query
 *         name: city
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of cinemas
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Cinema' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(cinemaValidators.list),
  cinemaController.list
);

/**
 * @openapi
 * /api/cinemas/{id}:
 *   get:
 *     tags: [Cinemas]
 *     summary: Get a cinema
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The cinema
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Cinema' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(cinemaValidators.getById),
  cinemaController.getById
);

/**
 * @openapi
 * /api/cinemas:
 *   post:
 *     tags: [Cinemas]
 *     summary: Create a cinema
 *     description: >
 *       `chainId` is honoured only for owners; every other role creates within
 *       their own chain. The referenced chain must exist and be active. `code` appears in QR
 *       ordering URLs, is stored upper case, and is unique across the whole
 *       system. Requires the Settings module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               chainId:         { type: integer, description: Owners only; ignored otherwise. }
 *               code:            { type: string, minLength: 2, maxLength: 10, pattern: '^[A-Z0-9-]+$' }
 *               name:            { type: string, minLength: 2, maxLength: 100 }
 *               location:        { type: string, maxLength: 255, nullable: true }
 *               city:            { type: string, maxLength: 100, nullable: true }
 *               gstNumber:       { type: string, maxLength: 50, nullable: true }
 *               fssaiNumber:     { type: string, maxLength: 50, nullable: true }
 *               activeSince:     { type: string, format: date-time, nullable: true }
 *               smsEnabled:      { type: boolean, default: false }
 *               whatsappEnabled: { type: boolean, default: false }
 *               isActive:        { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Cinema created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Cinema' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced chain does not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: A cinema with this code already exists, or the chain is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(cinemaValidators.create),
  cinemaController.create
);

/**
 * @openapi
 * /api/cinemas/{id}:
 *   put:
 *     tags: [Cinemas]
 *     summary: Update a cinema
 *     description: >
 *       `chainId` cannot be changed: moving a cinema between chains would carry
 *       its screens, orders and pricing across a tenant boundary.
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
 *               code:            { type: string, minLength: 2, maxLength: 10, pattern: '^[A-Z0-9-]+$' }
 *               name:            { type: string, minLength: 2, maxLength: 100 }
 *               location:        { type: string, maxLength: 255, nullable: true }
 *               city:            { type: string, maxLength: 100, nullable: true }
 *               gstNumber:       { type: string, maxLength: 50, nullable: true }
 *               fssaiNumber:     { type: string, maxLength: 50, nullable: true }
 *               activeSince:     { type: string, format: date-time, nullable: true }
 *               smsEnabled:      { type: boolean }
 *               whatsappEnabled: { type: boolean }
 *               isActive:        { type: boolean }
 *     responses:
 *       200:
 *         description: Cinema updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Cinema' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A cinema with this code already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(cinemaValidators.update),
  cinemaController.update
);

/**
 * @openapi
 * /api/cinemas/{id}:
 *   delete:
 *     tags: [Cinemas]
 *     summary: Deactivate a cinema (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - screens, orders
 *       and pricing all reference it. Idempotent. Requires the Settings module
 *       delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Cinema deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Cinema' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.DELETE),
  validate(cinemaValidators.remove),
  cinemaController.remove
);

module.exports = router;
