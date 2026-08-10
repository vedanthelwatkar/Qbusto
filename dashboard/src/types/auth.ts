/**
 * Authentication and permission shapes.
 *
 * MODULE_NAMES and ROLES mirror the CHECK constraints in the frozen schema (see
 * backend/src/constants.js). They exist here so navigation can be built from a
 * known list - the grants themselves always come from the server.
 */

export const MODULE_NAMES = [
  'Dashboard',
  'Orders',
  'Products',
  'Categories',
  'Pricing',
  'Banners',
  'Users',
  'Reports',
  'POS Integrations',
  'Settings',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export type Role = 'owner' | 'chain_admin' | 'cinema_admin' | 'kitchen_staff' | 'cinema_accountant';

export type PermissionAction = 'read' | 'edit' | 'delete';

export interface UserPermission {
  moduleName: ModuleName;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface User {
  id: number;
  chainId: number;
  cinemaId: number | null;
  role: Role;
  username: string;
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Only present on endpoints that load the user with permissions, such as /api/auth/me. */
  permissions?: UserPermission[];
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  expiresIn: string;
  user: User;
}
