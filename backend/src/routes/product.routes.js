'use strict';

/**
 * Product routes, mounted at /api/products.
 *
 * Every route requires authentication plus the matching Products permission.
 * Rows outside the actor's chain are reported as 404, not 403 - see
 * services/product.service for the tenant scoping rule.
 */

const express = require('express');

const productController = require('../controllers/product.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const productValidators = require('../validators/product.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: List products
 *     description: >
 *       Paginated. Non-owners see only products in their own chain. Requires the
 *       Products module read permission.
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
 *           enum: [id, name, categoryId, isAddon, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         description: Partial match against the product name.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: categoryId
 *         schema: { type: integer }
 *       - in: query
 *         name: chainId
 *         description: Owners only; ignored for every other role.
 *         schema: { type: integer }
 *       - in: query
 *         name: isAddon
 *         schema: { type: boolean }
 *       - in: query
 *         name: addonParentId
 *         description: List the add-ons attached to one product.
 *         schema: { type: integer }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of products
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Product' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(productValidators.list),
  productController.list
);

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The product
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Product' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  validate(productValidators.getById),
  productController.getById
);

/**
 * @openapi
 * /api/products:
 *   post:
 *     tags: [Products]
 *     summary: Create a product
 *     description: >
 *       `chainId` is not accepted: a product belongs to the chain of its
 *       category, and the service copies it from there so the two can never
 *       disagree. Product names are unique within a category, counting
 *       deactivated products. Requires the Products module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, name]
 *             properties:
 *               categoryId:    { type: integer }
 *               name:          { type: string, minLength: 1, maxLength: 200 }
 *               description:   { type: string, maxLength: 4000, nullable: true }
 *               weight:        { type: string, maxLength: 50, nullable: true, example: 150g }
 *               imageUrl:      { type: string, maxLength: 500, nullable: true }
 *               taxSlabCode:   { type: string, maxLength: 20, nullable: true }
 *               isAddon:       { type: boolean, default: false }
 *               addonParentId:
 *                 type: integer
 *                 nullable: true
 *                 description: >
 *                   The product this add-on attaches to. Must be in the same
 *                   chain and must not itself be an add-on.
 *               isActive:      { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Product created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Product' }
 *       400:
 *         description: Validation failed, or the add-on parent is itself an add-on
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced category or add-on parent does not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: A product with this name already exists in the category
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(productValidators.create),
  productController.create
);

/**
 * @openapi
 * /api/products/{id}:
 *   put:
 *     tags: [Products]
 *     summary: Update a product
 *     description: >
 *       A product may be re-filed under another category, but only one inside
 *       the same chain.
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
 *               categoryId:    { type: integer }
 *               name:          { type: string, minLength: 1, maxLength: 200 }
 *               description:   { type: string, maxLength: 4000, nullable: true }
 *               weight:        { type: string, maxLength: 50, nullable: true }
 *               imageUrl:      { type: string, maxLength: 500, nullable: true }
 *               taxSlabCode:   { type: string, maxLength: 20, nullable: true }
 *               isAddon:       { type: boolean }
 *               addonParentId: { type: integer, nullable: true }
 *               isActive:      { type: boolean }
 *     responses:
 *       200:
 *         description: Product updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Product' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: >
 *           The name is taken in the target category, or the target category
 *           belongs to a different chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.EDIT),
  validate(productValidators.update),
  productController.update
);

/**
 * @openapi
 * /api/products/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Deactivate a product (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - order items,
 *       pricing and POS mappings all reference it. Idempotent. Requires the
 *       Products module delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Product deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Product' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.DELETE),
  validate(productValidators.remove),
  productController.remove
);

module.exports = router;
