/**
 * Permission checks for the UI.
 *
 * This decides what to *show*, never what is allowed. The backend re-checks
 * every request against user_permissions (backend/src/middleware/authorize.js)
 * and remains the only authority; hiding a menu entry here is a convenience, so
 * a user who types the URL anyway gets a 403 from the server, not free access.
 *
 * The one rule duplicated from the backend is the owner bypass, because the
 * grants an owner would need are never written to the table - without it an
 * owner would see an empty sidebar.
 */

import type { ModuleName, PermissionAction, Role, User, UserPermission } from '@/types/auth';

const ACTION_ATTRIBUTE: Record<
  PermissionAction,
  keyof Pick<UserPermission, 'canRead' | 'canEdit' | 'canDelete'>
> = {
  read: 'canRead',
  edit: 'canEdit',
  delete: 'canDelete',
};

export function hasPermission(
  user: User | null,
  moduleName: ModuleName,
  action: PermissionAction = 'read'
): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;

  const attribute = ACTION_ATTRIBUTE[action];

  return (user.permissions ?? []).some(
    (permission) => permission.moduleName === moduleName && permission[attribute] === true
  );
}

/** Human-readable role label for the header, the user menu and the table. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  chain_admin: 'Chain admin',
  cinema_admin: 'Cinema admin',
  kitchen_staff: 'Kitchen staff',
  cinema_accountant: 'Accountant',
};

/**
 * The label for a role that the generated types treat as optional, because the
 * spec does not mark any User field required. Every user the API returns has
 * one; this only keeps the display honest if one ever does not.
 */
export function roleLabel(role: Role | undefined): string {
  return role ? ROLE_LABELS[role] : 'Unknown role';
}

export function displayName(user: User | null): string {
  if (!user) return '';

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  return fullName || user.username || '';
}
