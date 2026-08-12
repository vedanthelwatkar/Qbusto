/**
 * Thin wrapper around Orval-generated consumer API client.
 * Reuses generated types; does not duplicate request/response shapes.
 * Uses generated getConsumerCatalog() functions, never manually calls customInstance.
 */

import { getConsumerCatalog } from '@/api/generated/consumer-catalog/consumer-catalog';
import type { Category, Product, Banner } from '@/api/generated/cinemaOrderingAPI.schemas';

export interface CategoriesResponse {
  data: Category[];
  meta?: {
    pagination?: {
      page?: number;
      limit?: number;
      total?: number;
      totalPages?: number;
    };
  };
}

export interface ProductsResponse {
  data: Product[];
  meta?: {
    pagination?: {
      page?: number;
      limit?: number;
      total?: number;
      totalPages?: number;
    };
  };
}

export interface BannersResponse {
  data: Banner[];
}

const catalogClient = getConsumerCatalog();

/**
 * Fetch categories for a cinema (paginated).
 */
export async function fetchCategories(
  cinemaId: number,
  { limit = 50, page = 1 } = {}
): Promise<CategoriesResponse> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdCategories(cinemaId, {
    limit,
    page,
  });
  return {
    data: response.data.data || [],
    meta: response.data.meta,
  };
}

/**
 * Fetch products for a cinema (paginated, optionally filtered by category or search).
 */
export async function fetchProducts(
  cinemaId: number,
  {
    categoryId,
    search,
    limit = 50,
    page = 1,
  }: {
    categoryId?: number;
    search?: string;
    limit?: number;
    page?: number;
  } = {}
): Promise<ProductsResponse> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdProducts(cinemaId, {
    categoryId,
    search,
    limit,
    page,
  });
  return {
    data: response.data.data || [],
    meta: response.data.meta,
  };
}

/**
 * Fetch a single product detail.
 */
export async function fetchProductDetail(
  cinemaId: number,
  productId: number
): Promise<Product> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdProductsId(cinemaId, productId);
  return response.data.data || {};
}

/**
 * Fetch banners for a cinema (by type: H = header, I = inner).
 */
export async function fetchBanners(
  cinemaId: number,
  { type }: { type?: 'H' | 'I' } = {}
): Promise<BannersResponse> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdBanners(cinemaId, {
    ...(type && { type }),
  });
  return {
    data: response.data.data || [],
  };
}
