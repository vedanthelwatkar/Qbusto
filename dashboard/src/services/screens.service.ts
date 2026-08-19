/**
 * Calls against /api/screens.
 *
 * Same shape as cinemas.service: the orval-generated client makes the request
 * and this file unwraps the envelope.
 *
 * A screen carries no chain of its own - tenant scope reaches it through its
 * cinema - and `cinemaId` appears only on create. Orders reference a screen, so
 * moving one between cinemas would rewrite the history of those orders; the
 * update body has no such field.
 */

import type {
  GetApiScreensParams,
  PostApiScreensBody,
  PutApiScreensIdBody,
  Screen,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getScreens } from '@/api/generated/screens/screens';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const screensApi = getScreens();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface ScreenPage {
  screens: Screen[];
  pagination: Pagination | null;
}

export async function listScreens(params: GetApiScreensParams): Promise<ScreenPage> {
  const response = await screensApi.getApiScreens(params);

  return { screens: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getScreen(id: number): Promise<Screen> {
  const { data } = await screensApi.getApiScreensId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createScreen(body: PostApiScreensBody): Promise<Screen> {
  const { data } = await screensApi.postApiScreens(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateScreen(id: number, body: PutApiScreensIdBody): Promise<Screen> {
  const { data } = await screensApi.putApiScreensId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Orders and POS
 * mappings reference it. Idempotent.
 */
export async function deactivateScreen(id: number): Promise<Screen> {
  const { data } = await screensApi.deleteApiScreensId(id);

  if (!data) throw MALFORMED;

  return data;
}
