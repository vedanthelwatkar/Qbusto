/**
 * The axios instance every request goes through.
 *
 * `baseURL` is the server root, not the API root: the backend mounts its router
 * at /api, so request paths here start with '/api/...'. Putting /api in the
 * base URL as well would produce /api/api/... - hence VITE_API_URL is
 * documented as http://localhost:4567 with no path.
 *
 * Two things happen here that callers should not have to repeat: the bearer
 * token is attached, and every failure is normalised into an ApiError so a
 * component never has to know whether it is holding an axios error, a backend
 * envelope, or a dead network.
 */

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

import { ERROR_CODES, type ApiError, type ErrorResponse } from '@/types/api';
import { clearStoredToken, getStoredToken } from '@/utils/token';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Called when the server rejects our credential.
 *
 * Registered by the auth store rather than imported, so this module does not
 * depend on the store that depends on it.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * Endpoints where a 401 is about a password in the request body, not about the
 * session.
 *
 * /api/auth/change-password answers a wrong current password with 401 - so
 * without this, a user who fat-fingers their old password would be signed out
 * by the very request meant to keep them signed in. Login is here for the same
 * reason: a failed sign-in attempt should leave an existing session alone.
 */
const CREDENTIAL_ENDPOINTS = ['/api/auth/login', '/api/auth/change-password'];

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);
    const url = error instanceof AxiosError ? (error.config?.url ?? '') : '';
    const isCredentialCheck = CREDENTIAL_ENDPOINTS.some((endpoint) => url.endsWith(endpoint));

    // 401 otherwise means the token is missing, malformed or expired - it will
    // not start working, so drop it here rather than letting every later
    // request fail. A 403 is deliberately left alone: the credential is fine,
    // this particular action is not, and signing the user out would be wrong.
    if (apiError.status === 401 && !isCredentialCheck) {
      clearStoredToken();
      onUnauthorized?.();
    }

    return Promise.reject(apiError);
  }
);

/**
 * Turn anything axios rejects with into an ApiError.
 *
 * Backend messages are written to be shown to a client, so they are passed
 * through. A 5xx is the exception: whatever it says may describe internals, so
 * it is replaced with a generic line.
 */
export function toApiError(error: unknown): ApiError {
  // Checked before isApiError, and not after: an AxiosError carries `code`,
  // `message` and `status` of its own, so it satisfies the ApiError shape and
  // would be passed straight through - handing the UI "Request failed with
  // status code 401" instead of what the server actually said.
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? null;

    if (status === null) {
      return {
        status: null,
        code: ERROR_CODES.NETWORK_ERROR,
        message: 'Unable to reach the server. Check your connection and try again.',
      };
    }

    if (status >= 500) {
      return {
        status,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Something went wrong on the server. Please try again.',
      };
    }

    const body = error.response?.data as ErrorResponse | undefined;

    if (body?.error?.message) {
      return {
        status,
        code: body.error.code,
        message: body.error.message,
        details: body.error.details,
      };
    }

    return { status, code: ERROR_CODES.INTERNAL_ERROR, message: 'Request failed.' };
  }

  // Already normalised - this is a rejection that passed through the response
  // interceptor and is being read again by a component.
  if (isApiError(error)) return error;

  return {
    status: null,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Something went wrong. Please try again.',
  };
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    // An AxiosError has all three of these, so the shape alone cannot tell the
    // two apart. Excluding it here keeps that true no matter what order the
    // checks above end up in.
    !(value instanceof AxiosError) &&
    'code' in value &&
    'message' in value &&
    'status' in value
  );
}

/**
 * Mutator for orval-generated clients (see orval.config.js). Kept here so
 * generated code and hand-written services share one instance, one token and
 * one error shape.
 */
export const customInstance = <T>(config: AxiosRequestConfig): Promise<T> =>
  api(config).then((response) => response.data as T);

export default api;
