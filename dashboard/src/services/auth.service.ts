/**
 * Calls against /api/auth.
 *
 * Thin on purpose: each function is one request, unwrapping `data` from the
 * response envelope. Anything that rejects here is already an ApiError.
 */

import api from '@/services/api';
import type { SuccessResponse } from '@/types/api';
import type { LoginCredentials, LoginResult, User } from '@/types/auth';

export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  const { data } = await api.post<SuccessResponse<LoginResult>>('/api/auth/login', credentials);

  return data.data;
}

export async function fetchCurrentUser(): Promise<User> {
  const { data } = await api.get<SuccessResponse<User>>('/api/auth/me');

  return data.data;
}

/**
 * Stateless on the server: it logs the event and returns success. The client
 * still has to discard its own token, which the auth store does regardless of
 * whether this call succeeds.
 */
export async function logout(): Promise<void> {
  await api.post('/api/auth/logout');
}

/**
 * The only endpoint in the API that takes snake_case, which is its agreed
 * contract (see backend/src/validators/auth.validators.js). The conversion
 * stays here so nothing above this line has to know.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await api.post('/api/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
