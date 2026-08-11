/**
 * The banner list: query, results and the state of the request that produced
 * them.
 *
 * Mirrors categories.store deliberately. The default ordering is the one the
 * backend uses - ascending `sequence`, which is the order the banners are
 * actually displayed in, and the only ordering in which the list reads as a
 * running order rather than an arbitrary set of rows.
 */

import { create } from 'zustand';

import type { Banner, GetApiBannersParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as bannersService from '@/services/banners.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiBannersParams = {
  page: 1,
  limit: 20,
  sort: 'sequence',
  order: 'asc',
};

interface BannersState {
  query: GetApiBannersParams;
  banners: Banner[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  /**
   * Merge into the current query and reload. Any change other than paging
   * resets to page 1: staying on page 4 of a filter that now matches two rows
   * shows an empty table for no visible reason.
   */
  setQuery: (patch: Partial<GetApiBannersParams>) => void;
  fetch: () => Promise<void>;
  reset: () => void;
}

/** Guards against an out-of-order response while filters are being changed. */
let latestRequest = 0;

export const useBannersStore = create<BannersState>((set, get) => ({
  query: DEFAULT_QUERY,
  banners: [],
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
      const { banners, pagination } = await bannersService.listBanners(get().query);

      if (requestId !== latestRequest) return;

      set({ banners, pagination, loading: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      // Rows are cleared as well as the error being set: stale rows under an
      // error message read as though they are current.
      set({
        banners: [],
        pagination: null,
        loading: false,
        error: toApiError(caught).message,
      });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ query: DEFAULT_QUERY, banners: [], pagination: null, loading: false, error: null });
  },
}));
