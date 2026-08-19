'use strict';

/**
 * User management routes, mounted at /api/users.
 *
 * Every route requires authentication plus the matching Users permission.
 * Owners bypass the permission table (see middleware/authorize) but are still
 * subject to authentication.
 *
 * Rows outside the actor's chain are reported as 404, not 403 - see
 * services/user.service for the tenant scoping rule.
 */

const express = require('express');

const userController = require('../controllers/user.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const userValidators = require('../validators/user.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 *     description: >
 *       Paginated. Non-owners see only users in their own chain. Requires the
 *       Users module read permission.
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
 *           enum: [id, username, role, firstName, lastName, isActive, createdAt, updatedAt]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         description: Partial match against username, first name or last name.
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [owner, chain_admin, cinema_admin, kitchen_staff, cinema_accountant]
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: A page of users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.USERS, ACTIONS.READ),
  validate(userValidators.list),
  userController.list
);

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user with their permissions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id',
  authorize(MODULES.USERS, ACTIONS.READ),
  validate(userValidators.getById),
  userController.getById
);

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user
 *     description: >
 *       The user and their permission rows are written in a single transaction.
 *       `chainId` is honoured only for owners; every other role creates within
 *       their own chain. Requires the Users module edit permission.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role, username, password]
 *             properties:
 *               chainId:   { type: integer, description: Owners only; ignored otherwise. }
 *               cinemaId:  { type: integer, nullable: true }
 *               role:
 *                 type: string
 *                 enum: [owner, chain_admin, cinema_admin, kitchen_staff, cinema_accountant]
 *               username:  { type: string, minLength: 3, maxLength: 50 }
 *               password:  { type: string, format: password, minLength: 8, maxLength: 72 }
 *               firstName: { type: string, maxLength: 50, nullable: true }
 *               lastName:  { type: string, maxLength: 50, nullable: true }
 *               mobile:    { type: string, maxLength: 15, nullable: true }
 *               isActive:  { type: boolean, default: true }
 *               permissions:
 *                 type: array
 *                 items: { $ref: '#/components/schemas/UserPermissionInput' }
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: >
 *           Missing the Users edit permission, or an attempt to assign a role
 *           above your own or grant a permission you do not hold.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Username already taken, or the cinema belongs to another chain
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/',
  authorize(MODULES.USERS, ACTIONS.EDIT),
  validate(userValidators.create),
  userController.create
);

/**
 * @openapi
 * /api/users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Update a user
 *     description: >
 *       Send `permissions` to replace the user's permission set entirely; omit
 *       it to leave permissions untouched. The update and the permission
 *       replacement share one transaction. `chainId` cannot be changed, and
 *       passwords are changed only through /api/auth/change-password.
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
 *               cinemaId:  { type: integer, nullable: true }
 *               role:
 *                 type: string
 *                 enum: [owner, chain_admin, cinema_admin, kitchen_staff, cinema_accountant]
 *               username:  { type: string, minLength: 3, maxLength: 50 }
 *               firstName: { type: string, maxLength: 50, nullable: true }
 *               lastName:  { type: string, maxLength: 50, nullable: true }
 *               mobile:    { type: string, maxLength: 15, nullable: true }
 *               isActive:  { type: boolean }
 *               permissions:
 *                 type: array
 *                 items: { $ref: '#/components/schemas/UserPermissionInput' }
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: >
 *           Missing the Users edit permission, an attempt to change your own
 *           role, to assign a role above your own, or to grant a permission you
 *           do not hold.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: >
 *           Username taken, the cinema belongs to another chain, or an attempt
 *           to deactivate your own account.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put(
  '/:id',
  authorize(MODULES.USERS, ACTIONS.EDIT),
  validate(userValidators.update),
  userController.update
);

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Deactivate a user (soft delete)
 *     description: >
 *       Sets `is_active` to false. The row is never removed - orders, status
 *       logs and audit columns reference it. Permission rows are kept so
 *       reactivating restores previous access. Idempotent. Requires the Users
 *       module delete permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: User deactivated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: You cannot deactivate your own account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete(
  '/:id',
  authorize(MODULES.USERS, ACTIONS.DELETE),
  validate(userValidators.remove),
  userController.remove
);

module.exports = router;
