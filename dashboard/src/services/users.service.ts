/**
 * Calls against /api/users.
 *
 * Same shape as auth.service: the orval-generated client makes the request, and
 * this file unwraps the envelope. No URL, query parameter or body type is
 * written by hand - they all come from shared/openapi.json.
 */

import { getChains } from '@/api/generated/chains/chains';
import { getCinemas } from '@/api/generated/cinemas/cinemas';
import { getUsers as getUsersApi } from '@/api/generated/users/users';
import type {
  Chain,
  Cinema,
  GetApiUsersParams,
  PostApiUsersBody,
  PutApiUsersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';
import type { User } from '@/types/auth';

const usersApi = getUsersApi();
const chainsApi = getChains();
const cinemasApi = getCinemas();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface UserPage {
  users: User[];
  pagination: Pagination | null;
}

export async function listUsers(params: GetApiUsersParams): Promise<UserPage> {
  const response = await usersApi.getApiUsers(params);

  // meta.pagination is typed by the spec, so this needs no cast - it is absent
  // only if the endpoint stops paginating.
  return { users: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

/** A single user, with their permissions loaded - the list endpoint omits those. */
export async function getUser(id: number): Promise<User> {
  const { data } = await usersApi.getApiUsersId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createUser(body: PostApiUsersBody): Promise<User> {
  const { data } = await usersApi.postApiUsers(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateUser(id: number, body: PutApiUsersIdBody): Promise<User> {
  const { data } = await usersApi.putApiUsersId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/** Soft delete: the row stays and isActive becomes false. Idempotent. */
export async function deactivateUser(id: number): Promise<User> {
  const { data } = await usersApi.deleteApiUsersId(id);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Lookups for the user form's chain and cinema selects.
 *
 * They live here rather than in a module of their own because the user form is
 * the only screen that needs them. Both are authorised as Settings, not Users,
 * so a chain administrator with only the Users permission gets a 403 - the form
 * treats that as "no list available" and falls back to entering the id.
 */
export async function listChains(): Promise<Chain[]> {
  const response = await chainsApi.getApiChains({ limit: 100, isActive: true });

  return response.data ?? [];
}

export async function listCinemas(chainId?: number): Promise<Cinema[]> {
  const response = await cinemasApi.getApiCinemas({ limit: 100, isActive: true, chainId });

  return response.data ?? [];
}
