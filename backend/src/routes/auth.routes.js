'use strict';

/**
 * Authentication routes, mounted at /api/auth.
 *
 * /login is the only public endpoint in this router; everything else needs a
 * valid token. None of them use authorize(): a user's own session and password
 * are not gated by the Users module permission.
 */

const express = require('express');

const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const authValidators = require('../validators/auth.validators');

const router = express.Router();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange credentials for an access token
 *     description: >
 *       Returns a signed JWT plus the user's profile and permissions. The token
 *       carries only the user id and role - permissions are reloaded from the
 *       database on every request, so a revoked permission takes effect at once.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, maxLength: 50, example: admin }
 *               password: { type: string, format: password, example: 'S3cret!23' }
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/LoginResult' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401:
 *         description: Unknown username or wrong password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Credentials are correct but the account is deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/login', validate(authValidators.login), authController.login);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: End the current session
 *     description: >
 *       JWT authentication is stateless, so this records the event and returns
 *       success. Clients should discard their stored token. There is no token
 *       blacklist; use a short token lifetime to bound exposure.
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/logout', authenticate(), authController.logout);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Profile, role and permissions of the authenticated user
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: The account has been deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/me', authenticate(), authController.me);

/**
 * @openapi
 * /api/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change your own password
 *     description: >
 *       Requires the current password. Only ever changes the authenticated
 *       user's own password - there is no administrative reset endpoint.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string, format: password }
 *               new_password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 maxLength: 72
 *     responses:
 *       200:
 *         description: Password changed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401:
 *         description: Missing token, or the current password is incorrect
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/change-password',
  authenticate(),
  validate(authValidators.changePassword),
  authController.changePassword
);

module.exports = router;
