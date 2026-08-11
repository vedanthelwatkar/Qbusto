/**
 * Orders state management.
 *
 * Mirrors pricing.store structure: query state drives list fetches,
 * pagination resets on non-page changes. Status/payment-status master
 * data is loaded once and cached in this store rather than globally.
 */

import { create } from 'zustand';

import type {
  GetApiOrdersParams,
  Order,
  OrderStatus,
} from '@/api/generated/cinemaOrderingAPI.schemas';

// Payment statuses share the same master-status shape as order statuses; the
// generated spec has no distinct `PaymentStatus` type (GetApiPaymentStatuses200
// returns `OrderStatus[]` too), so this is an alias rather than a duplicate type.
type PaymentStatus = OrderStatus;
import { toApiError } from '@/services/api';
import * as ordersService from '@/services/orders.service';
import type { Pagination } from '@/types/api';

const DEFAULT_QUERY: GetApiOrdersParams = {
  page: 1,
  limit: 20,
  sort: 'createdAt',
  order: 'desc',
};

interface OrdersState {
  // List query and results
  query: GetApiOrdersParams;
  orders: Order[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;

  // Status/payment-status master data
  orderStatuses: OrderStatus[];
  paymentStatuses: PaymentStatus[];
  statusesLoading: boolean;

  // Actions
  setQuery: (patch: Partial<GetApiOrdersParams>) => void;
  fetch: () => Promise<void>;
  fetchStatuses: () => Promise<void>;
  reset: () => void;
}

let latestRequest = 0;

export const useOrdersStore = create<OrdersState>((set, get) => ({
  query: DEFAULT_QUERY,
  orders: [],
  pagination: null,
  loading: false,
  error: null,

  orderStatuses: [],
  paymentStatuses: [],
  statusesLoading: false,

  setQuery: (patch) => {
    const isPaging = 'page' in patch || 'limit' in patch;
    set({
      query: {
        ...get().query,
        ...(isPaging ? {} : { page: 1 }),
        ...patch,
      },
    });
    void get().fetch();
  },

  fetch: async () => {
    const requestId = ++latestRequest;
    set({ loading: true, error: null });

    try {
      const page = await ordersService.listOrders(get().query);
      if (requestId === latestRequest) {
        set({ orders: page.orders, pagination: page.pagination, loading: false });
      }
    } catch (err) {
      if (requestId === latestRequest) {
        set({ error: toApiError(err).message, loading: false });
      }
    }
  },

  fetchStatuses: async () => {
    if (get().orderStatuses.length > 0) return;

    set({ statusesLoading: true });
    try {
      const [orderStatuses, paymentStatuses] = await Promise.all([
        ordersService.getOrderStatuses(),
        ordersService.getPaymentStatuses(),
      ]);
      set({ orderStatuses, paymentStatuses, statusesLoading: false });
    } catch (err) {
      set({ statusesLoading: false, error: toApiError(err).message });
    }
  },

  reset: () => {
    set({
      query: DEFAULT_QUERY,
      orders: [],
      pagination: null,
      loading: false,
      error: null,
    });
  },
}));
