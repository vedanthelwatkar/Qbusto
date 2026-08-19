'use strict';

/**
 * Category routes, mounted at /api/categories.
 *
 * Every route requires authentication plus the matching Categories permission.
 * Rows outside the actor's chain are reported as 404, not 403 - see
 * services/category.service for the tenant scoping rule.
 */

const express = require('express');

const categoryController = require('../controllers/category.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const categoryValidators = require('../validators/category.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/categories:
 *   get:
 *     tags: [Categories]
 *     summary: List categories
 *     description: >
 *       Paginated. Non-owners see only categories in their own chain. Requires
 *       the Categories module read permission.
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
 *         description: Partial match against the category name.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: chainId
 *         description: Owners only; ignored for every other role, which is already scoped to one chain.
 *         schema: { type: integer }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of categories
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.CATEGORIES, ACTIONS.READ),
  validate(categoryValidators.list),
  categoryController.list
);

/**
 * @openapi
 * /api/categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a category
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The category
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.CATEGORIES, ACTIONS.READ),
  validate(categoryValidators.getById),
  categoryController.getById
);

/**
 * @openapi
 * /api/categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a category
 *     description: >
 *       `chainId` is honoured only for owners; every other role creates within
 *       their own chain. Category names are unique within a chain, counting
 *       deactivated categories. Requires the Categories module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               chainId:     { type: integer, description: Owners only; ignored otherwise. }
 *               name:        { type: string, minLength: 1, maxLength: 200 }
 *               description: { type: string, maxLength: 4000, nullable: true }
 *               imageUrl:    { type: string, maxLength: 500, nullable: true }
 *               isActive:    { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Category created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced chain does not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: A category with this name already exists in the chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.CATEGORIES, ACTIONS.EDIT),
  validate(categoryValidators.create),
  categoryController.create
);

/**
 * @openapi
 * /api/categories/{id}:
 *   put:
 *     tags: [Categories]
 *     summary: Update a category
 *     description: >
 *       `chainId` cannot be changed: moving a category between chains would drag
 *       its products across a tenant boundary.
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
 *               name:        { type: string, minLength: 1, maxLength: 200 }
 *               description: { type: string, maxLength: 4000, nullable: true }
 *               imageUrl:    { type: string, maxLength: 500, nullable: true }
 *               isActive:    { type: boolean }
 *     responses:
 *       200:
 *         description: Category updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A category with this name already exists in the chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.CATEGORIES, ACTIONS.EDIT),
  validate(categoryValidators.update),
  categoryController.update
);

/**
 * @openapi
 * /api/categories/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Deactivate a category (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - products and
 *       cinema_categories reference it. Products under the category are left
 *       untouched; this is not a cascade. Idempotent. Requires the Categories
 *       module delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Category deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.CATEGORIES, ACTIONS.DELETE),
  validate(categoryValidators.remove),
  categoryController.remove
);

module.exports = router;
