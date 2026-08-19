/**
 * Calls against /api/categories.
 *
 * Same shape as users.service: the orval-generated client makes the request and
 * this file unwraps the envelope. No URL, query parameter or body type is
 * written by hand - they all come from shared/openapi.json.
 */

import { getCategories } from '@/api/generated/categories/categories';
import type {
  Category,
  GetApiCategoriesParams,
  PostApiCategoriesBody,
  PutApiCategoriesIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const categoriesApi = getCategories();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface CategoryPage {
  categories: Category[];
  pagination: Pagination | null;
}

export async function listCategories(params: GetApiCategoriesParams): Promise<CategoryPage> {
  const response = await categoriesApi.getApiCategories(params);

  return { categories: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getCategory(id: number): Promise<Category> {
  const { data } = await categoriesApi.getApiCategoriesId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createCategory(body: PostApiCategoriesBody): Promise<Category> {
  const { data } = await categoriesApi.postApiCategories(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateCategory(id: number, body: PutApiCategoriesIdBody): Promise<Category> {
  const { data } = await categoriesApi.putApiCategoriesId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Products under the
 * category are left alone - the backend does not cascade. Idempotent.
 */
export async function deactivateCategory(id: number): Promise<Category> {
  const { data } = await categoriesApi.deleteApiCategoriesId(id);

  if (!data) throw MALFORMED;

  return data;
}
