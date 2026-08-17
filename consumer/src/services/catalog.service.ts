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

/** The endpoint's own ceiling (controller: `Math.min(limit, 100)`). */
const MAX_PAGE_SIZE = 100;

/**
 * Hard stop for the category paging loop. Ten pages of 100 is far beyond any
 * real cinema's category list; the bound exists so a bad `total` can never
 * spin this forever, not because 1000 is a meaningful product limit.
 */
const MAX_CATEGORY_PAGES = 10;

/**
 * Every category the cinema carries.
 *
 * The rail is navigation, not a list: a category that is missing from it is
 * unreachable, so this cannot stop at the first page the way the product grid
 * does. It pages properly against `meta.pagination.total` rather than asking
 * for one large page and assuming it covered everything — the caller has no
 * way to know it did.
 */
export async function fetchAllCategories(cinemaId: number): Promise<Category[]> {
  const first = await fetchCategories(cinemaId, { limit: MAX_PAGE_SIZE, page: 1 });
  const total = first.meta?.pagination?.total ?? first.data.length;

  const all = [...first.data];
  let page = 2;

  // `all.length < total` alone would loop forever if the server ever returned
  // an empty page while still reporting a larger total, hence the page bound
  // and the empty-page break below.
  while (all.length < total && page <= MAX_CATEGORY_PAGES) {
    const next = await fetchCategories(cinemaId, { limit: MAX_PAGE_SIZE, page });
    if (next.data.length === 0) break;
    all.push(...next.data);
    page += 1;
  }

  return all;
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
