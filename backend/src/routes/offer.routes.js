'use strict';

/**
 * Offer routes, mounted at /api/offers.
 *
 * Every route requires authentication plus the matching Offers permission.
 * Rows whose cinema is outside the actor's chain are reported as 404, not
 * 403 - see services/offer.service for the tenant scoping rule.
 */

const express = require('express');

const offerController = require('../controllers/offer.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const offerValidators = require('../validators/offer.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

router.use(authenticate());

/**
 * @openapi
 * /api/offers:
 *   get:
 *     tags: [Offers]
 *     summary: List offers
 *     description: >
 *       Paginated. Non-owners see only offers for cinemas in their own chain.
 *       Requires the Offers module read permission.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [id, cinemaId, code, status, validFrom, createdAt], default: createdAt }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Offers list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Offer' }
 *                     meta:
 *                       type: object
 *                       properties:
 *                         pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', authorize(MODULES.OFFERS, ACTIONS.READ), validate(offerValidators.list), offerController.list);

/**
 * @openapi
 * /api/offers/{id}:
 *   get:
 *     tags: [Offers]
 *     summary: Get an offer
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The offer
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Offer' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.OFFERS, ACTIONS.READ),
  validate(offerValidators.getById),
  offerController.getById
);

/**
 * @openapi
 * /api/offers:
 *   post:
 *     tags: [Offers]
 *     summary: Create an offer (coupon)
 *     description: >
 *       A cinema-scoped coupon, validated and applied entirely within QBusto
 *       - Cashfree plays no part in coupon handling. `code` is unique within
 *       the cinema. `discountType` of 'percentage' (case-insensitive) treats
 *       `discAmount` as a percent of the cart, capped by `maxDiscAmount`;
 *       anything else treats it as a flat rupee amount. `status` is free
 *       text, for the operator's own vocabulary. Requires the Offers module
 *       edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, code, name, discountType, discAmount]
 *             properties:
 *               cinemaId:       { type: integer }
 *               code:           { type: string, maxLength: 50 }
 *               name:           { type: string, maxLength: 150 }
 *               discountType:   { type: string, maxLength: 30, description: '"percentage" drives % math; anything else is treated as a flat rupee amount.' }
 *               description:    { type: string, maxLength: 500, nullable: true }
 *               tnc:            { type: string, maxLength: 2000, nullable: true }
 *               status:         { type: string, default: active, description: 'Free text, e.g. "active"/"inactive".' }
 *               discAmount:     { type: number, format: decimal }
 *               maxDiscAmount:  { type: number, format: decimal, nullable: true, description: 'Only meaningful when discountType is "percentage" - caps the discount.' }
 *               minTxnAmount:   { type: number, format: decimal, nullable: true }
 *               maxTxnAmount:   { type: number, format: decimal, nullable: true }
 *               maxTxnLimit:    { type: integer, nullable: true, description: 'Redemption count cap, not an amount.' }
 *               validFrom:      { type: string, format: date-time, nullable: true }
 *               validUntil:     { type: string, format: date-time, nullable: true }
 *     responses:
 *       201:
 *         description: Offer created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Offer' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced cinema does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: An offer with this code already exists in the cinema, or the cinema is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.OFFERS, ACTIONS.EDIT),
  validate(offerValidators.create),
  offerController.create
);

/**
 * @openapi
 * /api/offers/{id}:
 *   put:
 *     tags: [Offers]
 *     summary: Update an offer
 *     description: >
 *       `cinemaId` cannot be changed. Requires the Offers module edit
 *       permission.
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
 *               code:           { type: string, maxLength: 50 }
 *               name:           { type: string, maxLength: 150 }
 *               discountType:   { type: string, maxLength: 30 }
 *               description:    { type: string, maxLength: 500, nullable: true }
 *               tnc:            { type: string, maxLength: 2000, nullable: true }
 *               status:         { type: string }
 *               discAmount:     { type: number, format: decimal }
 *               maxDiscAmount:  { type: number, format: decimal, nullable: true }
 *               minTxnAmount:   { type: number, format: decimal, nullable: true }
 *               maxTxnAmount:   { type: number, format: decimal, nullable: true }
 *               maxTxnLimit:    { type: integer, nullable: true }
 *               validFrom:      { type: string, format: date-time, nullable: true }
 *               validUntil:     { type: string, format: date-time, nullable: true }
 *     responses:
 *       200:
 *         description: Offer updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Offer' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: An offer with this code already exists in the cinema
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.OFFERS, ACTIONS.EDIT),
  validate(offerValidators.update),
  offerController.update
);

/**
 * @openapi
 * /api/offers/{id}:
 *   delete:
 *     tags: [Offers]
 *     summary: Delete an offer
 *     description: >
 *       A genuine delete, not soft - unless the coupon has actually been
 *       redeemed on at least one order, in which case it is refused with a
 *       409: an order's history must never silently lose which coupon it
 *       used. Set `status` to something other than "active" instead of
 *       deleting a coupon that has been used. Requires the Offers module
 *       delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Offer deleted
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Offer' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: This coupon has been redeemed on at least one order and cannot be deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete(
  '/:id',
  authorize(MODULES.OFFERS, ACTIONS.DELETE),
  validate(offerValidators.remove),
  offerController.remove
);

module.exports = router;
