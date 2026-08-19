'use strict';

/**
 * Product pricing routes, mounted at /api/product-pricing.
 *
 * Every route requires authentication plus the matching Pricing permission.
 * Rows whose cinema is outside the actor's chain are reported as 404, not 403 -
 * see services/pricing.service for the tenant scoping rule.
 */

const express = require('express');

const pricingController = require('../controllers/pricing.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const pricingValidators = require('../validators/pricing.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/product-pricing:
 *   get:
 *     tags: [Product Pricing]
 *     summary: List price rows
 *     description: >
 *       Paginated. Non-owners see only pricing for cinemas in their own chain.
 *       Requires the Pricing module read permission.
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
 *           enum: [id, cinemaId, productId, dayOfWeek, basePrice, isActive, createdAt, updatedAt]
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
 *         name: dayOfWeek
 *         description: 0 = every day, 1 = Monday ... 7 = Sunday.
 *         schema: { type: integer, minimum: 0, maximum: 7 }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of price rows
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/ProductPricing' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.PRICING, ACTIONS.READ),
  validate(pricingValidators.list),
  pricingController.list
);

/**
 * @openapi
 * /api/product-pricing/{id}:
 *   get:
 *     tags: [Product Pricing]
 *     summary: Get a price row
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The price row
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductPricing' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.PRICING, ACTIONS.READ),
  validate(pricingValidators.getById),
  pricingController.getById
);

/**
 * @openapi
 * /api/product-pricing:
 *   post:
 *     tags: [Product Pricing]
 *     summary: Create a price row
 *     description: >
 *       The cinema and the product must belong to the same chain.
 *       (cinemaId, productId, dayOfWeek) is unique. Discount amounts require
 *       `discountType` to be set, and are capped at 100 when it is `P`.
 *       Requires the Pricing module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, productId, basePrice]
 *             properties:
 *               cinemaId:  { type: integer }
 *               productId: { type: integer }
 *               dayOfWeek:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 7
 *                 default: 0
 *                 description: 0 = every day, 1 = Monday ... 7 = Sunday.
 *               basePrice: { type: number, format: double, minimum: 0, example: 250.00 }
 *               discountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: P = percentage, F = flat amount. Governs every discount below.
 *               discountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnQr:      { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnKiosk:   { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnSeatQr:  { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnCounter: { type: number, format: double, minimum: 0, nullable: true }
 *               isActive:          { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Price row created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductPricing' }
 *       400:
 *         description: >
 *           Validation failed, a percentage exceeded 100, or a discount amount
 *           was supplied without a discountType
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
 *           A price already exists for this cinema, product and day, or the
 *           cinema and product belong to different chains
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.PRICING, ACTIONS.EDIT),
  validate(pricingValidators.create),
  pricingController.create
);

/**
 * @openapi
 * /api/product-pricing/{id}:
 *   put:
 *     tags: [Product Pricing]
 *     summary: Update a price row
 *     description: >
 *       `cinemaId`, `productId` and `dayOfWeek` cannot be changed: together they
 *       are the natural key, so changing one identifies a different row rather
 *       than editing this one.
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
 *               basePrice:         { type: number, format: double, minimum: 0 }
 *               discountType:      { type: string, enum: [P, F], nullable: true }
 *               discountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnQr:      { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnKiosk:   { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnSeatQr:  { type: number, format: double, minimum: 0, nullable: true }
 *               discountOnCounter: { type: number, format: double, minimum: 0, nullable: true }
 *               isActive:          { type: boolean }
 *     responses:
 *       200:
 *         description: Price row updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductPricing' }
 *       400:
 *         description: >
 *           Validation failed, or the result would leave a discount amount
 *           without a discountType
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/:id',
  authorize(MODULES.PRICING, ACTIONS.EDIT),
  validate(pricingValidators.update),
  pricingController.update
);

/**
 * @openapi
 * /api/product-pricing/{id}:
 *   delete:
 *     tags: [Product Pricing]
 *     summary: Deactivate a price row (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - historical orders
 *       are priced from it. Idempotent. Requires the Pricing module delete
 *       permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Price row deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/ProductPricing' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.PRICING, ACTIONS.DELETE),
  validate(pricingValidators.remove),
  pricingController.remove
);

module.exports = router;
