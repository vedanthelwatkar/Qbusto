import { create } from 'zustand';

import { fetchBoard, transitionOrder } from '../services/kitchen.service';
import type { BoardOrder, FulfilmentStatus } from '../types/kitchen';
import { formatApiError, isConflict, isNotFound, isUnauthenticated } from '../utils/apiError';
import { useAuthStore } from './auth.store';

/**
 * The kitchen board's state.
 *
 * THE TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. Never let an older response overwrite a newer one. Every load carries a
 *    monotonically increasing token; a response whose token is not the current
 *    one is discarded. Without this, a slow poll issued before a search
 *    lands after the search's response and puts the old board back.
 *
 * 2. Never let polls pile up. A poll that fires while the previous one is still
 *    in flight is skipped entirely rather than queued. On a flaky venue LAN,
 *    queueing turns one slow request into a growing backlog of them.
 *
 *    User actions are the deliberate exception - see `load(force)`. Skipping a
 *    poll costs nothing because another follows in seconds; skipping a search
 *    would leave the board showing results for a query the user has changed.
 *
 * The board is also deliberately fail-soft. A failed poll does NOT clear the
 * orders on screen: a cook needs the last known board more than they need an
 * empty one, so a stale board is kept and flagged as stale.
 */

export type SortKey = 'placedAt' | 'showTime';

interface BoardState {
  active: BoardOrder[];
  completed: BoardOrder[];
  /** Server-side totals, which may exceed what one page returned. */
  activeTotal: number;
  completedTotal: number;

  /** True only for the very first load, when there is nothing to show yet. */
  initialLoading: boolean;
  /** True while any load is in flight. Drives a subtle indicator, not a spinner. */
  refreshing: boolean;
  error: string | null;
  /** When the board last successfully synced. Null before the first success. */
  lastSyncedAt: number | null;

  search: string;
  statusFilter: FulfilmentStatus | 'all';
  sort: SortKey;

  /** Orders with a transition in flight, so a button cannot be pressed twice. */
  pending: Set<number>;

  setSearch: (search: string) => void;
  setStatusFilter: (status: FulfilmentStatus | 'all') => void;
  setSort: (sort: SortKey) => void;
  /**
   * @param force Issue the request even if one is already in flight.
   *   Polls pass false (a tick that lands on a busy moment is simply skipped -
   *   another comes along shortly). User actions pass true: a search or filter
   *   change that happened to coincide with a poll must NOT be silently
   *   dropped, or the board would keep showing unfiltered orders until the
   *   next tick. Overlap is bounded because user input is debounced, and the
   *   token guard still discards whichever response is not the newest.
   */
  load: (force?: boolean) => Promise<void>;
  transition: (id: number, status: FulfilmentStatus) => Promise<'ok' | 'conflict' | 'error'>;
  reset: () => void;
}

/**
 * Module-level rather than store state on purpose: these coordinate requests
 * and must never trigger a re-render.
 *
 * `inFlight` guards rule 2, `requestToken` guards rule 1.
 */
let inFlight = false;
let requestToken = 0;

export const useBoardStore = create<BoardState>((set, get) => ({
  active: [],
  completed: [],
  activeTotal: 0,
  completedTotal: 0,
  initialLoading: true,
  refreshing: false,
  error: null,
  lastSyncedAt: null,
  search: '',
  statusFilter: 'all',
  sort: 'placedAt',
  pending: new Set<number>(),

  // Every one of these is a user action, so it forces the request through
  // rather than letting it collide with an in-flight poll and vanish.
  setSearch: (search) => {
    set({ search });
    void get().load(true);
  },

  setStatusFilter: (statusFilter) => {
    set({ statusFilter });
    void get().load(true);
  },

  setSort: (sort) => {
    set({ sort });
    void get().load(true);
  },

  reset: () => {
    // Invalidate anything in flight so a response from the previous session
    // cannot populate the board after sign-out.
    requestToken += 1;
    inFlight = false;
    set({
      active: [],
      completed: [],
      activeTotal: 0,
      completedTotal: 0,
      initialLoading: true,
      refreshing: false,
      error: null,
      lastSyncedAt: null,
      search: '',
      statusFilter: 'all',
      pending: new Set<number>(),
    });
  },

  load: async (force = false) => {
    // Rule 2: a poll that lands while another is running is skipped, never
    // queued - on a flaky venue LAN, queueing turns one slow request into a
    // growing backlog. A forced (user-initiated) load is exempt: dropping it
    // would leave the board showing results for a filter the user changed.
    if (inFlight && !force) return;

    const { search, statusFilter, sort } = get();
    const token = ++requestToken;
    inFlight = true;
    set({ refreshing: true });

    try {
      // Both lanes in one round trip. Fired together rather than sequentially
      // so a poll costs one wait, not two.
      const [activePage, completedPage] = await Promise.all([
        fetchBoard({
          scope: 'active',
          status: statusFilter === 'all' ? undefined : statusFilter,
          search,
          sort,
        }),
        fetchBoard({ scope: 'completed', search, sort }),
      ]);

      // Rule 1: a newer request has superseded this one.
      if (token !== requestToken) return;

      set({
        active: activePage.orders,
        completed: completedPage.orders,
        activeTotal: activePage.total,
        completedTotal: completedPage.total,
        initialLoading: false,
        error: null,
        lastSyncedAt: Date.now(),
      });
    } catch (error) {
      if (token !== requestToken) return;

      // An expired token is the one failure that must not be retried silently
      // forever - it would poll a 401 every ten seconds until someone noticed.
      if (isUnauthenticated(error)) {
        useAuthStore.getState().signOut();
        return;
      }

      // Fail soft: the orders already on screen are kept. Only the error and
      // the sync time change, which is what marks the board stale.
      set({ error: formatApiError(error), initialLoading: false });
    } finally {
      // Only the newest request owns these flags. A superseded forced load
      // finishing late must not clear `refreshing` while its replacement is
      // still running, nor reopen the gate the newer request is holding.
      if (token === requestToken) {
        set({ refreshing: false });
        inFlight = false;
      }
    }
  },

  /**
   * Apply one workflow step.
   *
   * The board is updated from the SERVER's response, never from an assumption
   * about what the transition did. If another screen moved the order first,
   * the server returns the state it is actually in and that is what lands on
   * screen - the losing display corrects itself rather than showing a status
   * that was never written.
   */
  transition: async (id, status) => {
    // Double-submit guard: a second press while the first is in flight is
    // dropped. Wall-mounted touchscreens generate double taps constantly.
    if (get().pending.has(id)) return 'ok';

    set((state) => ({ pending: new Set(state.pending).add(id) }));

    try {
      const updated = await transitionOrder(id, status);

      if (updated) applyOrderUpdate(set, updated);

      return 'ok';
    } catch (error) {
      if (isUnauthenticated(error)) {
        useAuthStore.getState().signOut();
        return 'error';
      }

      // 409 (someone else moved it) and 404 (it left the board entirely) both
      // mean our copy is wrong. Re-read rather than guessing at the new state.
      if (isConflict(error) || isNotFound(error)) {
        set({ error: formatApiError(error) });
        void get().load();
        return 'conflict';
      }

      set({ error: formatApiError(error) });
      return 'error';
    } finally {
      set((state) => {
        const pending = new Set(state.pending);
        pending.delete(id);
        return { pending };
      });
    }
  },
}));

/**
 * Move an order into the lane its new status puts it in.
 *
 * Done locally so the screen reflects a transition immediately rather than at
 * the next poll, but from the server's returned status - so this is applying a
 * confirmed fact, not an optimistic guess.
 */
function applyOrderUpdate(
  set: (partial: (state: BoardState) => Partial<BoardState>) => void,
  updated: BoardOrder
) {
  set((state) => {
    const withoutOrder = (list: BoardOrder[]) => list.filter((order) => order.id !== updated.id);

    if (updated.status === 'delivered') {
      return {
        active: withoutOrder(state.active),
        completed: [updated, ...withoutOrder(state.completed)],
        error: null,
      };
    }

    const active = withoutOrder(state.active);
    // Keep the queue order stable: put it back where it was, by placed time.
    const restored = [...active, updated].sort(
      (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
    );

    return { active: restored, completed: withoutOrder(state.completed), error: null };
  });
}
