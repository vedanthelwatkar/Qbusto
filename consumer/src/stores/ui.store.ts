import { create } from 'zustand';

/**
 * Cross-component UI state. Only the cart sheet qualifies: it is opened from
 * the catalog's floating bar and closed from inside the sheet itself, so the
 * flag cannot live in either component.
 *
 * `errorMessage`/`setError` and `paymentLoading`/`setPaymentLoading` used to
 * sit here too. Neither earned it — errors are owned by the page that raised
 * them (a global one meant checkout's failure could paint over the menu), and
 * the payment flag had no reader at all.
 */
interface UIState {
  cartOpen: boolean;
  toggleCart(): void;
}

export const useUIStore = create<UIState>((set) => ({
  cartOpen: false,
  toggleCart: () => set((state) => ({ cartOpen: !state.cartOpen })),
}));
