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

/**
 * order_statuses.code, mirroring the rows seeded by
 * seeders/20260809010000-seed-order-statuses.
 *
 * These are the application-level identifiers for an order's lifecycle. The
 * numeric ids are database detail and are never written into application logic:
 * the service resolves a code to an id at the point of use. Duplicated here for
 * the same reason MODULES is - a typo should be a startup/validation failure,
 * not a query that silently matches nothing.
 */
const ORDER_STATUSES = Object.freeze({
  INITIATED: 'initiated',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  DELIVERED: 'delivered',
  REJECTED: 'rejected',
});

const ORDER_STATUS_CODES = Object.freeze(Object.values(ORDER_STATUSES));

/**
 * payment_statuses.code, mirroring
 * seeders/20260809010100-seed-payment-statuses.
 */
const PAYMENT_STATUSES = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

const PAYMENT_STATUS_CODES = Object.freeze(Object.values(PAYMENT_STATUSES));

/** orders.source - CK_orders_source */
const ORDER_SOURCES = Object.freeze({
  QR: 'qr',
  SEAT_QR: 'seat_qr',
  KIOSK: 'kiosk',
  COUNTER: 'counter',
});

const ORDER_SOURCE_NAMES = Object.freeze(Object.values(ORDER_SOURCES));

/**
 * pos_integrations.provider - CK_pos_integrations_provider.
 *
 * Mirrored here for the same reason as MODULES: a typo'd provider should fail
 * at the registry, not silently match no adapter. Note the spelling
 * `showbizz` - it is what the frozen schema's CHECK constraint contains, and
 * the application must not "correct" it.
 *
 * A value appearing here means the database accepts it. It does NOT mean an
 * adapter exists for it - see src/pos/providerRegistry.js.
 */
const POS_PROVIDERS = Object.freeze({
  VISTA: 'vista',
  SHOWBIZZ: 'showbizz',
  IMPACT: 'impact',
  QBUSTO: 'qbusto',
});

const POS_PROVIDER_NAMES = Object.freeze(Object.values(POS_PROVIDERS));

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
  ORDER_STATUSES,
  ORDER_STATUS_CODES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_CODES,
  ORDER_SOURCES,
  ORDER_SOURCE_NAMES,
  POS_PROVIDERS,
  POS_PROVIDER_NAMES,
  ERROR_CODES,
  PAGINATION,
};
