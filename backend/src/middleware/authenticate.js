'use strict';

/**
 * JWT authentication.
 *
 * On success attaches:
 *   req.user  - the User model instance, with `permissions` included
 *   req.auth  - the decoded token payload
 *
 * Status codes:
 *   401 - no token, malformed token, expired token, or the subject no longer
 *         exists. The credential itself is not usable.
 *   403 - token verified and the user exists, but the account is deactivated.
 *         The credential is valid; the account is not permitted.
 */

const { models } = require('../config/database');
const { verifyAccessToken, extractBearerToken } = require('../utils/jwt');
const { AuthenticationError, AuthorizationError } = require('../utils/errors');
const { ERROR_CODES } = require('../constants');

function authenticate() {
  return async function authenticateMiddleware(req, res, next) {
    try {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new AuthenticationError('Authorization header must be "Bearer <token>"');
      }

      // Throws AuthenticationError for expired / invalid / wrong-issuer tokens.
      const payload = verifyAccessToken(token);

      const userId = Number(payload.sub);
      if (!Number.isInteger(userId)) {
        throw new AuthenticationError('Invalid authentication token');
      }

      // Loaded fresh on every request: a revoked permission or a deactivated
      // account takes effect immediately rather than at token expiry.
      // Permissions come along so authorize() needs no further query.
      const user = await models.User.findByPk(userId, {
        attributes: { exclude: ['passwordHash'] },
        include: [
          {
            association: 'permissions',
            attributes: ['moduleName', 'canRead', 'canEdit', 'canDelete'],
          },
        ],
      });

      if (!user) {
        throw new AuthenticationError('Invalid authentication token');
      }

      if (!user.isActive) {
        throw new AuthorizationError(
          'This account has been deactivated',
          ERROR_CODES.ACCOUNT_INACTIVE
        );
      }

      req.user = user;
      req.auth = payload;

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = authenticate;
