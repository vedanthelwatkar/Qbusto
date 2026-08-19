/**
 * The response envelope every backend endpoint uses.
 *
 * Mirrors backend/src/utils/response.js and the SuccessResponse / ErrorResponse
 * schemas in shared/openapi.json. Payloads always sit under `data`; anything a
 * client needs about the request itself sits under `meta`.
 *
 * `Pagination` and `ResponseMeta` are the spec's own, re-exported rather than
 * restated - the spec now describes the pagination block that list endpoints put
 * in `meta`.
 */

import type { Pagination, ResponseMeta } from '@/api/generated/cinemaOrderingAPI.schemas';

export type { Pagination, ResponseMeta };

export interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ResponseMeta;
}

/** Machine-readable codes from backend/src/constants.js. */
export const ERROR_CODES = {
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
  /** Client-side only: the request never reached the server. */
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * What every rejected request from services/api.ts carries.
 *
 * `status` is null when the request never got a response at all, which is the
 * one case the backend cannot describe for us.
 */
export interface ApiError {
  status: number | null;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}
