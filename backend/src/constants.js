'use strict';

/**
 * Shared constants.
 *
 * MODULES and ROLES mirror the CHECK constraints in the frozen schema
 * (see docs/schema.md). They are duplicated here on purpose: authorize() needs
 * to reject a typo'd module name at boot, before any request reaches the
 * database. If the schema ever changes, both must be updated together.
 */

/** user_permissions.module_name - CK_user_permissions_module_name */
const MODULES = Object.freeze({
  DASHBOARD: 'Dashboard',
  ORDERS: 'Orders',
  PRODUCTS: 'Products',
  CATEGORIES: 'Categories',
  PRICING: 'Pricing',
  BANNERS: 'Banners',
  USERS: 'Users',
  REPORTS: 'Reports',
  POS_INTEGRATIONS: 'POS Integrations',
  SETTINGS: 'Settings',
});

const MODULE_NAMES = Object.freeze(Object.values(MODULES));

/** users.role - CK_users_role */
const ROLES = Object.freeze({
  OWNER: 'owner',
  CHAIN_ADMIN: 'chain_admin',
  CINEMA_ADMIN: 'cinema_admin',
  KITCHEN_STAFF: 'kitchen_staff',
  CINEMA_ACCOUNTANT: 'cinema_accountant',
});

const ROLE_NAMES = Object.freeze(Object.values(ROLES));

/** Permission actions, mapped to their user_permissions column. */
const ACTIONS = Object.freeze({
  READ: 'read',
  EDIT: 'edit',
  DELETE: 'delete',
});

const ACTION_NAMES = Object.freeze(Object.values(ACTIONS));

/** action -> UserPermission attribute holding the grant. */
const ACTION_ATTRIBUTE = Object.freeze({
  [ACTIONS.READ]: 'canRead',
  [ACTIONS.EDIT]: 'canEdit',
  [ACTIONS.DELETE]: 'canDelete',
});

/** Machine-readable error codes returned in error responses. */
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
});

const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
});

module.exports = {
  MODULES,
  MODULE_NAMES,
  ROLES,
  ROLE_NAMES,
  ACTIONS,
  ACTION_NAMES,
  ACTION_ATTRIBUTE,
  ERROR_CODES,
  PAGINATION,
};
