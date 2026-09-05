/**
 * Thin wrapper around Orval-generated consumer API client.
 * Reuses generated types; does not duplicate request/response shapes.
 * Uses generated getConsumerCatalog() functions, never manually calls customInstance.
 */

import { getConsumerCatalog } from '@/api/generated/consumer-catalog/consumer-catalog';
import type { OrderSource } from '@/stores/context.store';
import type {
  Category,
  Product,
  Banner,
  Cinema,
  ConsumerSession,
} from '@/api/generated/cinemaOrderingAPI.schemas';

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
  const first = await fetchCategories(cinemaId, {
    limit: MAX_PAGE_SIZE,
    page: 1,
  });
  const total = first.meta?.pagination?.total ?? first.data.length;

  const all = [...first.data];
  let page = 2;

  // `all.length < total` alone would loop forever if the server ever returned
  // an empty page while still reporting a larger total, hence the page bound
  // and the empty-page break below.
  while (all.length < total && page <= MAX_CATEGORY_PAGES) {
    const next = await fetchCategories(cinemaId, {
      limit: MAX_PAGE_SIZE,
      page,
    });
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
    source,
    seat,
  }: {
    categoryId?: number;
    search?: string;
    limit?: number;
    page?: number;
    /**
     * The channel to price against - the same `source` the order will carry.
     * Omitting it prices as `qr`, which is what the catalogue did
     * unconditionally before prices varied by source.
     */
    source?: OrderSource;
    /**
     * The seat this visit is for, sent as EVIDENCE for a `seat_qr` source
     * rather than as data: the backend derives the source it prices against
     * from the two together, and a `seat_qr` claim with no seat behind it is
     * priced at the lobby rate (backend pricing.service.deriveSource). Sending
     * it here is what makes the card's price and the bill's price agree for a
     * genuine seat scan.
     */
    seat?: string | null;
  } = {}
): Promise<ProductsResponse> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdProducts(cinemaId, {
    categoryId,
    search,
    limit,
    page,
    source,
    seat: seat || undefined,
  });
  return {
    data: response.data.data || [],
    meta: response.data.meta,
  };
}

/**
 * Hard stop for the product paging loop, on the same reasoning as
 * MAX_CATEGORY_PAGES: it bounds a bad `total`, it is not a claim about how many
 * products a cinema may carry.
 */
const MAX_PRODUCT_PAGES = 20;

/**
 * Every product the cinema currently sells, in the API's own order.
 *
 * The catalogue is one continuous list grouped by category, so it needs the
 * whole set rather than a page of it. This pages properly against
 * `meta.pagination.total` instead of asking for one large page and assuming it
 * covered everything - `total` is the count AFTER the backend's availability
 * filter (consumer.service.getProducts slices in JS), so it is the honest
 * number to loop against, and this stays correct if a cinema ever exceeds one
 * page.
 *
 * `search` is passed through because the backend applies it before that filter;
 * a search therefore returns the whole matching set, not a page of it.
 */
export async function fetchAllProducts(
  cinemaId: number,
  {
    search,
    source,
    seat,
  }: { search?: string; source?: OrderSource; seat?: string | null } = {}
): Promise<Product[]> {
  const first = await fetchProducts(cinemaId, {
    search,
    source,
    seat,
    limit: MAX_PAGE_SIZE,
    page: 1,
  });
  const total = first.meta?.pagination?.total ?? first.data.length;

  const all = [...first.data];
  let page = 2;

  while (all.length < total && page <= MAX_PRODUCT_PAGES) {
    const next = await fetchProducts(cinemaId, {
      search,
      source,
      seat,
      limit: MAX_PAGE_SIZE,
      page,
    });
    if (next.data.length === 0) break;
    all.push(...next.data);
    page += 1;
  }

  return all;
}

/**
 * Fetch a single product detail.
 */
export async function fetchProductDetail(
  cinemaId: number,
  productId: number,
  source?: OrderSource,
  seat?: string | null
): Promise<Product> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdProductsId(cinemaId, productId, {
    source,
    seat: seat || undefined,
  });
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

/**
 * The screenings a customer may order against, chronological.
 *
 * Backs the checkout picker. One selected session carries the screen, the film
 * and the start time together, which is why checkout asks for a session rather
 * than for those three values separately.
 *
 * WHY `screenId` IS SENT
 *
 * It is the QR's screen, and it is the only thing this app contributes to
 * deciding which show is running right now. The server does the deciding -
 * cinema, screen and its OWN clock against each screening's start and end -
 * and flags the answer `isCurrent`, which the drawer preselects.
 *
 * Deliberately no time is sent. The device's clock is not evidence: a phone
 * with the wrong date would otherwise select the wrong show, or none.
 */
export async function fetchSessions(
  cinemaId: number,
  screenId?: number | null
): Promise<ConsumerSession[]> {
  const response = await catalogClient.getApiConsumerCinemasCinemaIdSessions(
    cinemaId,
    screenId ? { screenId } : undefined
  );
  return response.data.data || [];
}

/**
 * The cinema itself, for the welcome banner shown above the menu search.
 */
export async function fetchCinema(cinemaId: number): Promise<Cinema> {
  const response = await catalogClient.getApiConsumerCinemasId(cinemaId);
  return response.data.data ?? {};
}
