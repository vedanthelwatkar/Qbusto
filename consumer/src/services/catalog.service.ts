/**
 * Thin wrapper around Orval-generated consumer API client.
 * Reuses generated types; does not duplicate request/response shapes.
 */

import { customInstance } from '@/api/axios-instance';
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

/**
 * Fetch categories for a cinema (paginated).
 */
export async function fetchCategories(
  cinemaId: number,
  { limit = 50, page = 1 } = {}
): Promise<CategoriesResponse> {
  const response = await customInstance<CategoriesResponse>({
    url: `/api/consumer/cinemas/${cinemaId}/categories`,
    method: 'GET',
    params: { limit, page },
  });
  return response.data;
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
  const response = await customInstance<ProductsResponse>({
    url: `/api/consumer/cinemas/${cinemaId}/products`,
    method: 'GET',
    params: { categoryId, search, limit, page },
  });
  return response.data;
}

/**
 * Fetch a single product detail.
 */
export async function fetchProductDetail(
  cinemaId: number,
  productId: number
): Promise<Product> {
  const response = await customInstance<{ data: Product }>({
    url: `/api/consumer/cinemas/${cinemaId}/products/${productId}`,
    method: 'GET',
  });
  return response.data.data;
}

/**
 * Fetch banners for a cinema (by type: H = header, I = inner).
 */
export async function fetchBanners(
  cinemaId: number,
  { type }: { type?: 'H' | 'I' } = {}
): Promise<BannersResponse> {
  const response = await customInstance<BannersResponse>({
    url: `/api/consumer/cinemas/${cinemaId}/banners`,
    method: 'GET',
    params: type ? { type } : {},
  });
  return response.data;
}
