/**
 * Calls against /api/products.
 *
 * Same shape as users.service and categories.service: the orval-generated
 * client makes the request and this file unwraps the envelope.
 *
 * Note what is absent - there is no `chainId` on any product body. A product
 * belongs to the chain of its category and the backend copies it from there, so
 * the two can never disagree.
 */

import type {
  GetApiProductsParams,
  PostApiProductsBody,
  Product,
  PutApiProductsIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { getProducts } from '@/api/generated/products/products';
import { ERROR_CODES, type ApiError, type Pagination } from '@/types/api';

const productsApi = getProducts();

const MALFORMED: ApiError = {
  status: null,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'The server returned an unexpected response. Please try again.',
};

export interface ProductPage {
  products: Product[];
  pagination: Pagination | null;
}

export async function listProducts(params: GetApiProductsParams): Promise<ProductPage> {
  const response = await productsApi.getApiProducts(params);

  return { products: response.data ?? [], pagination: response.meta?.pagination ?? null };
}

export async function getProduct(id: number): Promise<Product> {
  const { data } = await productsApi.getApiProductsId(id);

  if (!data) throw MALFORMED;

  return data;
}

export async function createProduct(body: PostApiProductsBody): Promise<Product> {
  const { data } = await productsApi.postApiProducts(body);

  if (!data) throw MALFORMED;

  return data;
}

export async function updateProduct(id: number, body: PutApiProductsIdBody): Promise<Product> {
  const { data } = await productsApi.putApiProductsId(id, body);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * Soft delete: the row stays and isActive becomes false. Order items, pricing
 * and POS mappings all reference it. Idempotent.
 */
export async function deactivateProduct(id: number): Promise<Product> {
  const { data } = await productsApi.deleteApiProductsId(id);

  if (!data) throw MALFORMED;

  return data;
}

/**
 * One page of products that may be an add-on's parent: anything that is not
 * itself an add-on. The backend rejects the rest with "An add-on cannot be the
 * parent of another add-on", so they are not offered.
 *
 * Paged and searchable rather than a fixed slice of the catalogue - the caller
 * passes whatever the user has typed.
 */
export async function listAddonParents(
  params: Pick<GetApiProductsParams, 'search' | 'limit'> = {}
): Promise<Product[]> {
  const response = await productsApi.getApiProducts({
    ...params,
    isAddon: false,
    isActive: true,
    sort: 'name',
    order: 'asc',
  });

  return response.data ?? [];
}
