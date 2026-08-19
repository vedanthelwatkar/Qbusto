/**
 * Authentication and permission types.
 *
 * The shapes themselves are not written here - they are re-exported from the
 * orval output, which is generated from shared/openapi.json, which the backend
 * writes. Anything declared by the spec must come through that chain or the two
 * sides can drift silently.
 *
 * What is left here is what the spec does not describe: the action names the UI
 * uses to talk about a permission row.
 */

import {
  UserPermissionModuleName,
  UserRole,
  type PostApiAuthLoginBody,
  type User,
  type UserPermission,
  type UserPermissionInput,
} from '@/api/generated/cinemaOrderingAPI.schemas';

export type { User, UserPermission, UserPermissionInput };

export type ModuleName = UserPermissionModuleName;
export type Role = UserRole;

/** Every module the backend authorises against, in the order the UI shows them. */
export const MODULE_NAMES = Object.values(UserPermissionModuleName);

export const ROLES = Object.values(UserRole);

/** The three flags on a user_permissions row, named as the UI talks about them. */
export type PermissionAction = 'read' | 'edit' | 'delete';

export type LoginCredentials = PostApiAuthLoginBody;
