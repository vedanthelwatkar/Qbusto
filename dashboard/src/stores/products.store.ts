/**
 * The product list: query, results and the state of the request that produced
 * them.
 *
 * Mirrors users.store and categories.store deliberately. Only the list lives
 * here; create, edit and deactivate are one-shot calls owned by the components
 * that trigger them, which then ask this store to refetch.
 */

import { create } from 'zustand';

import type { GetApiProductsParams, Product } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as productsService from '@/services/products.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiProductsParams = {
  page: 1,
  limit: 20,
  sort: 'createdAt',
  order: 'desc',
};

interface ProductsState {
  query: GetApiProductsParams;
  products: Product[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  /**
   * Merge into the current query and reload. Any change other than paging
   * resets to page 1: staying on page 4 of a filter that now matches two rows
   * shows an empty table for no visible reason.
   */
  setQuery: (patch: Partial<GetApiProductsParams>) => void;
  fetch: () => Promise<void>;
  reset: () => void;
}

/** Guards against an out-of-order response while the search box is being typed in. */
let latestRequest = 0;

export const useProductsStore = create<ProductsState>((set, get) => ({
  query: DEFAULT_QUERY,
  products: [],
  pagination: null,
  loading: false,
  error: null,

  setQuery: (patch) => {
    const isPaging = 'page' in patch || 'limit' in patch;

    set({ query: { ...get().query, ...(isPaging ? {} : { page: 1 }), ...patch } });

    void get().fetch();
  },

  fetch: async () => {
    const requestId = ++latestRequest;

    set({ loading: true, error: null });

    try {
      const { products, pagination } = await productsService.listProducts(get().query);

      if (requestId !== latestRequest) return;

      set({ products, pagination, loading: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      // Rows are cleared as well as the error being set: stale rows under an
      // error message read as though they are current.
      set({ products: [], pagination: null, loading: false, error: toApiError(caught).message });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ query: DEFAULT_QUERY, products: [], pagination: null, loading: false, error: null });
  },
}));
