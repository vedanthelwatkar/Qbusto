/**
 * The film list: query, results and the state of the request that produced
 * them.
 *
 * Mirrors screens.store deliberately. Only the list lives here; create, edit
 * and deactivate are one-shot calls owned by the components that trigger them,
 * which then ask this store to refetch.
 *
 * Films are reference data with no tenant of their own, so unlike screens there
 * is no cinema filter.
 */

import { create } from 'zustand';

import type { Film, GetApiFilmsParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as filmsService from '@/services/films.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiFilmsParams = {
  page: 1,
  limit: 20,
  sort: 'title',
  order: 'asc',
};

interface FilmsState {
  query: GetApiFilmsParams;
  films: Film[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  /**
   * Merge into the current query and reload. Any change other than paging
   * resets to page 1: staying on page 4 of a filter that now matches two rows
   * shows an empty table for no visible reason.
   */
  setQuery: (patch: Partial<GetApiFilmsParams>) => void;
  fetch: () => Promise<void>;
  reset: () => void;
}

/** Guards against an out-of-order response while the search box is being typed in. */
let latestRequest = 0;

export const useFilmsStore = create<FilmsState>((set, get) => ({
  query: DEFAULT_QUERY,
  films: [],
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
      const { films, pagination } = await filmsService.listFilms(get().query);

      if (requestId !== latestRequest) return;

      set({ films, pagination, loading: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      // Rows are cleared as well as the error being set: stale rows under an
      // error message read as though they are current.
      set({
        films: [],
        pagination: null,
        loading: false,
        error: toApiError(caught).message,
      });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ query: DEFAULT_QUERY, films: [], pagination: null, loading: false, error: null });
  },
}));
