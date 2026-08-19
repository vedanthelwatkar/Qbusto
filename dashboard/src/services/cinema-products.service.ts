/**
 * Calls against /api/cinema-products.
 *
 * Same shape as pricing.service: the orval-generated client makes the request
 * and this file unwraps the envelope.
 *
 * The reason this service exists for the dashboard at all is `resolveCinemaProduct`.
 * Availability windows hang off a `cinemaProductId`, not off a product, so a
 * screen that starts from a product and a cinema has to turn that pair into an
 * id before it can read or write a single window.
 *
 * Note what the update body is missing: `cinemaId` and `productId`. Together
 * they are the natural key (UQ_cinema_products), and availability windows hang
 * off this row's id - repointing it would silently move them to another cinema
 * - so the spec leaves both off the PUT.
 */

import type {
  CinemaProduct,
  GetApiCinemaProductsParams,
  PostApiCinemaProductsBody,
  PutApiCinemaProductsIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getCinemaProducts } from '@/api/generated/cinema-products/cinema-products';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const cinemaProductsApi = getCinemaProducts();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface CinemaProductPage {
  cinemaProducts: CinemaProduct[];
  pagination: Pagination | null;
}

export async function listCinemaProducts(
  params: GetApiCinemaProductsParams
): Promise<CinemaProductPage> {
  const response = await cinemaProductsApi.getApiCinemaProducts(params);

  return { cinemaProducts: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

/**
 * The link for one (cinema, product) pair, or null when the cinema does not
 * carry the product.
 *
 * `(cinema_id, product_id)` is unique, so filtering the list on both is a
 * lookup: the page holds one row or none. Null is an ordinary answer here and
 * not an error - most cinemas do not carry most products - so it is returned
 * rather than thrown, and the caller decides what to say about it.
 *
 * `limit: 1` rather than a larger page: the uniqueness constraint is what makes
 * this a lookup, so asking for more rows would only be asking for rows that
 * cannot exist.
 */
export async function resolveCinemaProduct(
  cinemaId: number,
  productId: number
): Promise<CinemaProduct | null> {
  const response = await cinemaProductsApi.getApiCinemaProducts({ cinemaId, productId, limit: 1 });

  return response.data?.[0] ?? null;
}

export async function getCinemaProduct(id: number): Promise<CinemaProduct> {
  const { data } = await cinemaProductsApi.getApiCinemaProductsId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createCinemaProduct(body: PostApiCinemaProductsBody): Promise<CinemaProduct> {
  const { data } = await cinemaProductsApi.postApiCinemaProducts(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateCinemaProduct(
  id: number,
  body: PutApiCinemaProductsIdBody
): Promise<CinemaProduct> {
  const { data } = await cinemaProductsApi.putApiCinemaProductsId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Its availability
 * windows are left alone - withdrawing a product from a cinema should not
 * discard the schedule it had there. Idempotent.
 */
export async function deactivateCinemaProduct(id: number): Promise<CinemaProduct> {
  const { data } = await cinemaProductsApi.deleteApiCinemaProductsId(id);

  if (!data) throw MALFORMED;

  return data;
}
