/**
 * The session list: query, results and the state of the request that produced
 * them.
 *
 * Mirrors screens.store deliberately. Only the list lives here; create, edit
 * and cancel are one-shot calls owned by the components that trigger them,
 * which then ask this store to refetch.
 *
 * Ordered by start time by default, because a schedule is read chronologically
 * rather than by when each row happened to be entered.
 */

import { create } from 'zustand';

import type { GetApiSessionsParams, Session } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as sessionsService from '@/services/sessions.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiSessionsParams = {
  page: 1,
  limit: 20,
  sort: 'startsAt',
  order: 'asc',
};

interface SessionsState {
  query: GetApiSessionsParams;
  sessions: Session[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  /**
   * Merge into the current query and reload. Any change other than paging
   * resets to page 1: staying on page 4 of a filter that now matches two rows
   * shows an empty table for no visible reason.
   */
  setQuery: (patch: Partial<GetApiSessionsParams>) => void;
  fetch: () => Promise<void>;
  reset: () => void;
}

/** Guards against an out-of-order response while the filters are being changed. */
let latestRequest = 0;

export const useSessionsStore = create<SessionsState>((set, get) => ({
  query: DEFAULT_QUERY,
  sessions: [],
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
      const { sessions, pagination } = await sessionsService.listSessions(get().query);

      if (requestId !== latestRequest) return;

      set({ sessions, pagination, loading: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      // Rows are cleared as well as the error being set: stale rows under an
      // error message read as though they are current.
      set({
        sessions: [],
        pagination: null,
        loading: false,
        error: toApiError(caught).message,
      });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ query: DEFAULT_QUERY, sessions: [], pagination: null, loading: false, error: null });
  },
}));
