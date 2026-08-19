/**
 * The availability schedule for one product at one cinema.
 *
 * Unlike the list stores, this one holds a two-step load. Availability windows
 * hang off a `cinemaProductId`, and the product screen only knows a product and
 * a cinema, so the store first resolves (cinemaId, productId) -> cinemaProduct
 * and only then fetches windows. Both steps are exposed separately because they
 * fail differently: the first can legitimately come back empty - most cinemas do
 * not carry most products - while the second coming back empty means something
 * else entirely.
 *
 * Changing cinema clears the previous cinema's windows before the new request
 * starts. Leaving them on screen under a new cinema's name would be worse than
 * showing nothing, because it looks like an answer.
 */

import { create } from 'zustand';

import type {
  CinemaProduct,
  ProductAvailabilityHour,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as availabilityService from '@/services/availability.service';
import * as cinemaProductsService from '@/services/cinema-products.service';

/**
 * Windows are read a page at a time like everything else, but the whole set is
 * needed at once: a weekly schedule missing its last page is a wrong schedule,
 * not a shorter one. So this pages through to the total the server reports
 * rather than assuming one page covers it.
 */
const PAGE_SIZE = 100;

/**
 * Stops a paging loop if `meta.pagination` ever disagrees with what is actually
 * returned. Seven days of windows will never come close to this.
 */
const MAX_PAGES = 20;

interface AvailabilityState {
  /** The product the schedule is being viewed for. */
  productId: number | null;
  /** The cinema chosen for it, or null before one is chosen. */
  cinemaId: number | null;

  /**
   * The resolved link. Null both before a resolve has happened and when the
   * cinema does not carry the product - `resolved` tells the two apart.
   */
  cinemaProduct: CinemaProduct | null;
  /** True once a resolve has completed, whatever its answer. */
  resolved: boolean;
  resolving: boolean;
  resolveError: string | null;

  hours: ProductAvailabilityHour[];
  loadingHours: boolean;
  hoursError: string | null;

  /** Start on a product, with no cinema chosen yet. */
  open: (productId: number) => void;
  /** Choose (or clear) the cinema, then resolve and load. */
  selectCinema: (cinemaId: number | null) => void;
  /** Re-run the current cinema's resolve and load, after a failure or a change. */
  reload: () => void;
  /** Reload only the windows, once the link is already resolved. */
  refreshHours: () => Promise<void>;
  reset: () => void;
}

/**
 * Guards against an out-of-order response while the cinema is being changed.
 * Shared by both steps, so a resolve for a cinema the user has already moved on
 * from cannot go on to fetch that cinema's windows.
 */
let latestRequest = 0;

/**
 * Nothing resolved and nothing loaded. A function rather than a constant so
 * each use gets its own `hours` array instead of sharing one.
 */
function empty(): Pick<
  AvailabilityState,
  | 'cinemaProduct'
  | 'resolved'
  | 'resolving'
  | 'resolveError'
  | 'hours'
  | 'loadingHours'
  | 'hoursError'
> {
  return {
    cinemaProduct: null,
    resolved: false,
    resolving: false,
    resolveError: null,
    hours: [],
    loadingHours: false,
    hoursError: null,
  };
}

/** Every window for one link, following the server's pagination to the end. */
async function fetchAllHours(cinemaProductId: number): Promise<ProductAvailabilityHour[]> {
  const collected: ProductAvailabilityHour[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { availabilityHours, pagination } = await availabilityService.listAvailabilityHours({
      cinemaProductId,
      page,
      limit: PAGE_SIZE,
      sort: 'dayOfWeek',
      order: 'asc',
    });

    collected.push(...availabilityHours);

    const total = pagination?.total;

    if (availabilityHours.length === 0 || total === undefined || collected.length >= total) {
      break;
    }
  }

  return collected;
}

export const useAvailabilityStore = create<AvailabilityState>((set, get) => ({
  productId: null,
  cinemaId: null,
  ...empty(),

  open: (productId) => {
    latestRequest += 1;
    set({ productId, cinemaId: null, ...empty() });
  },

  selectCinema: (cinemaId) => {
    // Cleared before the request starts, not when it returns: the previous
    // cinema's schedule must not be readable while the new one is loading.
    set({ cinemaId, ...empty() });

    if (cinemaId === null) {
      latestRequest += 1;
      return;
    }

    get().reload();
  },

  reload: () => {
    const { cinemaId, productId } = get();

    if (cinemaId === null || productId === null) return;

    const requestId = ++latestRequest;

    set({ ...empty(), resolving: true });

    void cinemaProductsService
      .resolveCinemaProduct(cinemaId, productId)
      .then(async (cinemaProduct) => {
        if (requestId !== latestRequest) return;

        // A cinema that does not carry the product is an ordinary answer, and
        // the end of the load - there is no id to hang windows off.
        if (!cinemaProduct?.id) {
          set({ cinemaProduct: null, resolved: true, resolving: false });
          return;
        }

        set({ cinemaProduct, resolved: true, resolving: false, loadingHours: true });

        try {
          const hours = await fetchAllHours(cinemaProduct.id);

          if (requestId !== latestRequest) return;

          set({ hours, loadingHours: false });
        } catch (caught) {
          if (requestId !== latestRequest) return;

          set({ hours: [], loadingHours: false, hoursError: toApiError(caught).message });
        }
      })
      .catch((caught: unknown) => {
        if (requestId !== latestRequest) return;

        set({ resolving: false, resolved: false, resolveError: toApiError(caught).message });
      });
  },

  refreshHours: async () => {
    const cinemaProductId = get().cinemaProduct?.id;

    if (cinemaProductId === undefined) return;

    const requestId = ++latestRequest;

    set({ loadingHours: true, hoursError: null });

    try {
      const hours = await fetchAllHours(cinemaProductId);

      if (requestId !== latestRequest) return;

      set({ hours, loadingHours: false });
    } catch (caught) {
      if (requestId !== latestRequest) return;

      set({ hours: [], loadingHours: false, hoursError: toApiError(caught).message });
    }
  },

  reset: () => {
    latestRequest += 1;
    set({ productId: null, cinemaId: null, ...empty() });
  },
}));
