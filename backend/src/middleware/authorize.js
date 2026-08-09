'use strict';

/**
 * Permission checks against the user_permissions table.
 *
 *   router.get('/products', authenticate(), authorize(MODULES.PRODUCTS, ACTIONS.READ), handler);
 *
 * The `owner` role bypasses the table entirely - owners are unconditionally
 * allowed. Every other role needs a matching user_permissions row with the
 * relevant can_read / can_edit / can_delete flag set.
 *
 * Module and action names are validated when the middleware is *built*, not
 * when a request arrives, so a typo like authorize('Product', 'read') throws at
 * startup instead of silently denying every request in production.
 */

const { AuthorizationError, AuthenticationError } = require('../utils/errors');
const { MODULE_NAMES, ACTION_NAMES, ACTION_ATTRIBUTE, ROLES } = require('../constants');

/**
 * @param {string} moduleName One of constants.MODULE_NAMES.
 * @param {string} action     One of constants.ACTION_NAMES ('read'|'edit'|'delete').
 * @returns {import('express').RequestHandler}
 */
function authorize(moduleName, action) {
  if (!MODULE_NAMES.includes(moduleName)) {
    throw new Error(
      `authorize(): unknown module "${moduleName}". Expected one of: ${MODULE_NAMES.join(', ')}`
    );
  }
  if (!ACTION_NAMES.includes(action)) {
    throw new Error(
      `authorize(): unknown action "${action}". Expected one of: ${ACTION_NAMES.join(', ')}`
    );
  }

  const attribute = ACTION_ATTRIBUTE[action];

  return function authorizeMiddleware(req, res, next) {
    const { user } = req;

    // A programming error rather than a client error: authorize() was mounted
    // without authenticate() in front of it.
    if (!user) {
      return next(new AuthenticationError('Authentication is required to access this resource'));
    }

    if (user.role === ROLES.OWNER) {
      return next();
    }

    const permissions = user.permissions || [];
    const granted = permissions.some(
      (permission) => permission.moduleName === moduleName && permission[attribute] === true
    );

    if (!granted) {
      return next(
        new AuthorizationError(`You do not have permission to ${action} ${moduleName}`, undefined, {
          module: moduleName,
          action,
        })
      );
    }

    return next();
  };
}

module.exports = authorize;
