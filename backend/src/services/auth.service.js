'use strict';

/**
 * Authentication.
 *
 * Tokens are stateless and carry identity only - the id in `sub` and the role.
 * Permissions are never embedded: middleware/authenticate reloads them on every
 * request, so revoking access takes effect immediately instead of at expiry.
 * That also means logout needs no server-side state; see auth.controller.
 */

const { models } = require('../config/database');
const env = require('../config/env');
const { generateAccessToken } = require('../utils/jwt');
const {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
} = require('../utils/errors');
const { ERROR_CODES } = require('../constants');
const { serializeUser, PERMISSION_ATTRIBUTES } = require('./user.service');

/**
 * Verify credentials and issue an access token.
 *
 * @param {object} credentials
 * @param {string} credentials.username
 * @param {string} credentials.password
 * @returns {Promise<{token: string, expiresIn: string, user: object}>}
 * @throws {AuthenticationError} 401 - unknown username or wrong password.
 * @throws {AuthorizationError}  403 - credentials are correct but the account
 *   is deactivated.
 */
async function login({ username, password }) {
  const user = await models.User.findOne({
    where: { username },
    include: [{ association: 'permissions', attributes: PERMISSION_ATTRIBUTES }],
  });

  const passwordMatches = user ? await user.verifyPassword(password) : false;

  // One message for both failures: saying which one was wrong tells an attacker
  // which usernames exist.
  if (!user || !passwordMatches) {
    throw new AuthenticationError('Invalid username or password');
  }

  // Checked after the password so the response cannot be used to enumerate
  // deactivated accounts. Mirrors the 403 that authenticate() would return.
  if (!user.isActive) {
    throw new AuthorizationError('This account has been deactivated', ERROR_CODES.ACCOUNT_INACTIVE);
  }

  return {
    token: generateAccessToken({ sub: user.id, role: user.role }),
    expiresIn: env.jwt.expiresIn,
    user: serializeUser(user),
  };
}

/**
 * Change the authenticated user's own password.
 *
 * @throws {AuthenticationError} When the current password does not verify.
 * @throws {ValidationError}     When the new password matches the current one.
 */
async function changePassword(userId, currentPassword, newPassword) {
  // Reloaded rather than reusing req.user: authenticate() excludes passwordHash,
  // so the instance it attaches cannot verify a password.
  const user = await models.User.findByPk(userId);
  if (!user) throw new NotFoundError('User');

  if (!(await user.verifyPassword(currentPassword))) {
    throw new AuthenticationError('Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw new ValidationError('New password must be different from the current password');
  }

  user.password = newPassword;

  // `fields` is listed explicitly because Sequelize decides which columns to
  // write before the model's beforeValidate hook runs. `password` is virtual,
  // so on its own it would produce an UPDATE with nothing in it; naming
  // passwordHash here makes sure the hashed value is persisted.
  await user.save({ fields: ['password', 'passwordHash'] });
}

module.exports = { login, changePassword };
