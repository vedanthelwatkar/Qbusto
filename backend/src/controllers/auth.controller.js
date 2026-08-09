'use strict';

/**
 * Authentication endpoints.
 *
 * Handlers stay thin: read validated input, call the service, shape a response.
 * Express 5 forwards rejected promises to the error handler, so nothing here
 * needs a try/catch.
 */

const authService = require('../services/auth.service');
const { serializeUser } = require('../services/user.service');
const logger = require('../config/logger');
const { success } = require('../utils/response');

async function login(req, res) {
  const result = await authService.login(req.validated.body);

  logger.info('User logged in', { requestId: req.id, userId: result.user.id });

  return success(res, { message: 'Login successful', data: result });
}

/**
 * Tokens are stateless, so there is nothing to invalidate. The endpoint exists
 * so clients have one place to call when clearing their stored token, and so
 * the event is logged. Deliberately no blacklist: it would turn every
 * authenticated request into a lookup against shared state.
 */
async function logout(req, res) {
  logger.info('User logged out', { requestId: req.id, userId: req.user.id });

  return success(res, { message: 'Logout successful' });
}

/**
 * No query needed: authenticate() has already loaded the user together with
 * their permissions, and excluded the password hash.
 */
async function me(req, res) {
  return success(res, { message: 'Current user', data: serializeUser(req.user) });
}

async function changePassword(req, res) {
  const { current_password: currentPassword, new_password: newPassword } = req.validated.body;

  await authService.changePassword(req.user.id, currentPassword, newPassword);

  logger.info('Password changed', { requestId: req.id, userId: req.user.id });

  return success(res, { message: 'Password changed successfully' });
}

module.exports = { login, logout, me, changePassword };
