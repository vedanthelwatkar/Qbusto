/**
 * The user list: query, results and the state of the request that produced
 * them.
 *
 * Only the list lives here. Creating, editing and deactivating are one-shot
 * calls owned by the components that trigger them, which then ask this store to
 * refetch - keeping a second copy of a user in here would only give the table
 * two versions of the truth.
 */

import { create } from 'zustand';

import type { GetApiUsersParams } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as usersService from '@/services/users.service';
import type { Pagination } from '@/types/api';
import type { User } from '@/types/auth';

const DEFAULT_QUERY: GetApiUsersParams = {
  page: 1,
  limit: 20,
  sort: 'createdAt',
  order: 'desc',
};

interface UsersState {
  query: GetApiUsersParams;
  users: User[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  /**
   * Merge into the current query and reload. Any change other than paging
   * resets to page 1: staying on page 4 of a filter that now matches two rows
   * shows an empty table for no visible reason.
   */
  setQuery: (patch: Partial<GetApiUsersParams>) => void;
  fetch: () => Promise<void>;
  /** Back to defaults - used when the screen unmounts. */
  reset: () => void;
}

/**
 * Guards against an out-of-order response: typing quickly in the search box
 * starts several requests, and the slowest one must not be the one that lands.
 */
let latestRequest = 0;

export const useUsersStore = create<UsersState>((set, get) => ({
  query: DEFAULT_QUERY,
  users: [],
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
      const { users, pagination } = await usersService.listUsers(get().query);

      if (requestId !== latestRequest) return;

      set({ users, pagination, loading: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      // The rows are cleared as well as the error being set: leaving stale rows
      // on screen under an error message reads as though they are current.
      set({ users: [], pagination: null, loading: false, error: toApiError(caught).message });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ query: DEFAULT_QUERY, users: [], pagination: null, loading: false, error: null });
  },
}));
