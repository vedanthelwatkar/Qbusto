'use strict';

/**
 * Chain routes, mounted at /api/chains.
 *
 * Every route requires authentication plus the matching Settings permission.
 * Chains, cinemas and screens share the Settings module because the frozen
 * CK_user_permissions_module_name constraint has no entry for them.
 *
 * Rows outside the actor's chain are reported as 404, not 403 - see
 * services/chain.service for the tenant scoping rule.
 */

const express = require('express');

const chainController = require('../controllers/chain.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const chainValidators = require('../validators/chain.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/chains:
 *   get:
 *     tags: [Chains]
 *     summary: List chains
 *     description: >
 *       Paginated. Non-owners see only their own chain. Requires the Settings
 *       module read permission.
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
 *           enum: [id, name, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         description: Partial match against the chain name.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of chains
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Chain' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(chainValidators.list),
  chainController.list
);

/**
 * @openapi
 * /api/chains/{id}:
 *   get:
 *     tags: [Chains]
 *     summary: Get a chain
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The chain
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Chain' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(chainValidators.getById),
  chainController.getById
);

/**
 * @openapi
 * /api/chains:
 *   post:
 *     tags: [Chains]
 *     summary: Create a chain
 *     description: >
 *       Owners only. Every other role is pinned to their own chain by tenant
 *       scope, so a chain they created would be unreadable to them. Also
 *       requires the Settings module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:         { type: string, minLength: 2, maxLength: 100 }
 *               logoImageUrl: { type: string, maxLength: 500, nullable: true }
 *               isActive:     { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Chain created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Chain' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Missing the Settings edit permission, or not an owner
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: A chain with this name already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(chainValidators.create),
  chainController.create
);

/**
 * @openapi
 * /api/chains/{id}:
 *   put:
 *     tags: [Chains]
 *     summary: Update a chain
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
 *               name:         { type: string, minLength: 2, maxLength: 100 }
 *               logoImageUrl: { type: string, maxLength: 500, nullable: true }
 *               isActive:     { type: boolean }
 *     responses:
 *       200:
 *         description: Chain updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Chain' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A chain with this name already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.EDIT),
  validate(chainValidators.update),
  chainController.update
);

/**
 * @openapi
 * /api/chains/{id}:
 *   delete:
 *     tags: [Chains]
 *     summary: Deactivate a chain (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - cinemas, users,
 *       categories and products all reference it. Idempotent. Requires the
 *       Settings module delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Chain deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Chain' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.SETTINGS, ACTIONS.DELETE),
  validate(chainValidators.remove),
  chainController.remove
);

module.exports = router;
