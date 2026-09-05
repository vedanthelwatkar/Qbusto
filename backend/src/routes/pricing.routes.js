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
 *           enum: [id, cinemaId, productId, isActive, createdAt, updatedAt]
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
 *       One row holds the product's whole week at that cinema, so this is the
 *       only call needed to configure all seven days. The cinema and the
 *       product must belong to the same chain, and (cinemaId, productId) is
 *       unique.
 *
 *
 *       At least one day must carry a price. A null day price means the
 *       product is NOT SOLD that day - it does not mean free. Which day applies
 *       to a given moment is the QBusto business day, 06:00 to 06:00, so an
 *       order placed at 01:00 on Monday pays Sunday's price.
 *
 *
 *       Each day has its own discount, independently of every other day - a
 *       Wednesday discount never applies on Thursday. A day's discount amount
 *       requires that SAME day's discount type to be set, and is capped at 100
 *       when that type is `P`.
 *       Requires the Pricing module edit permission.
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
 *               mondayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayPrice:   { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayPrice: { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayPrice:  { type: number, format: double, minimum: 0, nullable: true }
 *               fridayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayPrice:  { type: number, format: double, minimum: 0, nullable: true }
 *               sundayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Monday's discount only - P = percentage, F = flat amount.
 *               mondayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Tuesday's discount only - P = percentage, F = flat amount.
 *               tuesdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Wednesday's discount only - P = percentage, F = flat amount.
 *               wednesdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Thursday's discount only - P = percentage, F = flat amount.
 *               thursdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Friday's discount only - P = percentage, F = flat amount.
 *               fridayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Saturday's discount only - P = percentage, F = flat amount.
 *               saturdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountType:
 *                 type: string
 *                 enum: [P, F]
 *                 nullable: true
 *                 description: Sunday's discount only - P = percentage, F = flat amount.
 *               sundayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
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
 *       Writes the product's whole week at that cinema in one call. A day sent
 *       as null becomes unpriced, which makes the product unsellable that day;
 *       a day omitted entirely is left as it was.
 *
 *
 *       `cinemaId` and `productId` cannot be changed: together they are the
 *       natural key, so changing one identifies a different row rather than
 *       editing this one.
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
 *               mondayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayPrice:   { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayPrice: { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayPrice:  { type: number, format: double, minimum: 0, nullable: true }
 *               fridayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayPrice:  { type: number, format: double, minimum: 0, nullable: true }
 *               sundayPrice:    { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               mondayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               mondayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               tuesdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               tuesdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               wednesdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               wednesdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               thursdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               thursdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               fridayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               fridayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               saturdayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               saturdayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountType:      { type: string, enum: [P, F], nullable: true }
 *               sundayDiscountValue:     { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnQr:        { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnKiosk:     { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnSeatQr:    { type: number, format: double, minimum: 0, nullable: true }
 *               sundayDiscountOnCounter:   { type: number, format: double, minimum: 0, nullable: true }
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
