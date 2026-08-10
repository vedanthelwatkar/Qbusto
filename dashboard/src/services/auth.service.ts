/**
 * Calls against /api/auth.
 *
 * Every request goes through the orval-generated client, so the URLs, query
 * parameters and body shapes come from shared/openapi.json rather than from
 * anything typed here. What this file adds is the unwrapping: the backend
 * envelope puts payloads under `data`, and the generated types mark that
 * optional because the spec does not declare it required.
 *
 * Anything that rejects here is already an ApiError - services/api.ts normalises
 * it before the promise settles.
 */

import { getAuth } from '@/api/generated/auth/auth';
import { ERROR_CODES, type ApiError } from '@/types/api';
import type { LoginCredentials, User } from '@/types/auth';

const auth = getAuth();

/**
 * A response that came back 2xx but without the payload it promised. Shaped as
 * an ApiError so callers keep the one error type they already handle.
 */
const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export async function login(credentials: LoginCredentials): Promise<{ token: string }> {
  const { data } = await auth.postApiAuthLogin(credentials);

  // The profile in this response is ignored on purpose: the store reloads it
  // from /me, which is the endpoint that guarantees permissions are included.
  if (!data?.token) throw MALFORMED;

  return { token: data.token };
}

export async function fetchCurrentUser(): Promise<User> {
  const { data } = await auth.getApiAuthMe();

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Stateless on the server: it logs the event and returns success. The client
 * still has to discard its own token, which the auth store does regardless of
 * whether this call succeeds.
 */
export async function logout(): Promise<void> {
  await auth.postApiAuthLogout();
}

/**
 * The only endpoint in the API that takes snake_case, which is its agreed
 * contract - the generated body type spells it out, so the conversion happens
 * here and nothing above this line has to know.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await auth.postApiAuthChangePassword({
    current_password: currentPassword,
    new_password: newPassword,
  });
}
