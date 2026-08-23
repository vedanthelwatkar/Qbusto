/**
 * Calls against /api/films.
 *
 * Read-only. The film catalogue lives in the client's `film` table and is
 * synced from their source system, so there is nothing to create or edit here.
 * A film is addressed by the source system's `code`, not by an integer id.
 */

import type { Film, GetApiFilmsParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import { getFilms } from '@/api/generated/films/films';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const filmsApi = getFilms();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface FilmPage {
  films: Film[];
  pagination: Pagination | null;
}

export async function listFilms(params: GetApiFilmsParams): Promise<FilmPage> {
  const response = await filmsApi.getApiFilms(params);

  return { films: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getFilm(code: string): Promise<Film> {
  const { data } = await filmsApi.getApiFilmsCode(code);

  if (!data) throw MALFORMED;

  return data;
}
