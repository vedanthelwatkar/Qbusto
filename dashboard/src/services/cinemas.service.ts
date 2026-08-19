/**
 * Calls against /api/cinemas.
 *
 * Same shape as chains.service: the orval-generated client makes the request
 * and this file unwraps the envelope.
 *
 * Note what is absent from the update body - there is no `chainId`. A cinema
 * cannot be moved between chains, because its screens, orders and pricing would
 * cross a tenant boundary with it, so the spec does not offer the field and
 * neither does this module.
 */

import type {
  Cinema,
  GetApiCinemasParams,
  PostApiCinemasBody,
  PutApiCinemasIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getCinemas } from '@/api/generated/cinemas/cinemas';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const cinemasApi = getCinemas();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface CinemaPage {
  cinemas: Cinema[];
  pagination: Pagination | null;
}

export async function listCinemas(params: GetApiCinemasParams): Promise<CinemaPage> {
  const response = await cinemasApi.getApiCinemas(params);

  return { cinemas: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getCinema(id: number): Promise<Cinema> {
  const { data } = await cinemasApi.getApiCinemasId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createCinema(body: PostApiCinemasBody): Promise<Cinema> {
  const { data } = await cinemasApi.postApiCinemas(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateCinema(id: number, body: PutApiCinemasIdBody): Promise<Cinema> {
  const { data } = await cinemasApi.putApiCinemasId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Screens, orders and
 * pricing all reference it. Idempotent.
 */
export async function deactivateCinema(id: number): Promise<Cinema> {
  const { data } = await cinemasApi.deleteApiCinemasId(id);

  if (!data) throw MALFORMED;

  return data;
}
