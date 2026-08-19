'use strict';

/**
 * Banner routes, mounted at /api/banners.
 *
 * Every route requires authentication plus the matching Banners permission.
 * Rows whose cinema is outside the actor's chain are reported as 404, not 403 -
 * see services/banner.service for the tenant scoping rule.
 */

const express = require('express');

const bannerController = require('../controllers/banner.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const bannerValidators = require('../validators/banner.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/banners:
 *   get:
 *     tags: [Banners]
 *     summary: List banners
 *     description: >
 *       Paginated, ordered by `sequence` by default - the order they are
 *       displayed in. Non-owners see only banners for cinemas in their own
 *       chain. Requires the Banners module read permission.
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
 *           enum: [id, cinemaId, sequence, type, startDate, isActive, createdAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         description: H = header, I = inner.
 *         schema: { type: string, enum: [H, I] }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: A page of banners
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Banner' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.BANNERS, ACTIONS.READ),
  validate(bannerValidators.list),
  bannerController.list
);

/**
 * @openapi
 * /api/banners/{id}:
 *   get:
 *     tags: [Banners]
 *     summary: Get a banner
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The banner
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Banner' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.BANNERS, ACTIONS.READ),
  validate(bannerValidators.getById),
  bannerController.getById
);

/**
 * @openapi
 * /api/banners:
 *   post:
 *     tags: [Banners]
 *     summary: Create a banner
 *     description: >
 *       One row carries one image, so a cinema shows several banners by holding
 *       several rows. `sequence` is unique within a cinema and decides the
 *       display order. The cinema must be active. `endDate` may not fall before
 *       `startDate`. Requires the Banners module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cinemaId, imageUrl]
 *             properties:
 *               cinemaId:  { type: integer }
 *               imageUrl:  { type: string, maxLength: 500 }
 *               type:      { type: string, enum: [H, I], default: H, description: 'H = header, I = inner.' }
 *               sequence:  { type: integer, minimum: 0, default: 0 }
 *               startDate: { type: string, format: date-time, nullable: true }
 *               endDate:   { type: string, format: date-time, nullable: true }
 *               isActive:  { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Banner created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Banner' }
 *       400:
 *         description: Validation failed, or endDate falls before startDate
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: The referenced cinema does not exist, or is in another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: >
 *           A banner with this sequence already exists in the cinema, or the
 *           cinema is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.BANNERS, ACTIONS.EDIT),
  validate(bannerValidators.create),
  bannerController.create
);

/**
 * @openapi
 * /api/banners/{id}:
 *   put:
 *     tags: [Banners]
 *     summary: Update a banner
 *     description: >
 *       `cinemaId` cannot be changed: moving a banner would sidestep the target
 *       cinema's sequence rule. Supplying only one end of the date window is
 *       still checked against the stored value of the other.
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
 *               imageUrl:  { type: string, maxLength: 500 }
 *               type:      { type: string, enum: [H, I] }
 *               sequence:  { type: integer, minimum: 0 }
 *               startDate: { type: string, format: date-time, nullable: true }
 *               endDate:   { type: string, format: date-time, nullable: true }
 *               isActive:  { type: boolean }
 *     responses:
 *       200:
 *         description: Banner updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Banner' }
 *       400:
 *         description: Validation failed, or the resulting date window runs backwards
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A banner with this sequence already exists in the cinema
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.BANNERS, ACTIONS.EDIT),
  validate(bannerValidators.update),
  bannerController.update
);

/**
 * @openapi
 * /api/banners/{id}:
 *   delete:
 *     tags: [Banners]
 *     summary: Deactivate a banner (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row stays, so its sequence stays reserved
 *       and the banner can be brought back. Idempotent. Requires the Banners
 *       module delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Banner deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Banner' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authorize(MODULES.BANNERS, ACTIONS.DELETE),
  validate(bannerValidators.remove),
  bannerController.remove
);

module.exports = router;
