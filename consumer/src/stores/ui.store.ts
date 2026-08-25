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
  /**
   * Put the UI back to how a new customer should find it.
   *
   * Needed because `cartOpen` outlives the cart's CONTENTS. Clearing the cart
   * on abandonment left this flag true, so the next customer pressing "Start
   * your order" was shown an open sheet reading "your cart is empty" - the
   * previous session's UI state, with the previous session's data removed.
   *
   * A separate action rather than folding it into `toggleCart` so that a
   * reset reads as a reset at every call site.
   */
  reset(): void;
}

export const useUIStore = create<UIState>((set) => ({
  cartOpen: false,
  toggleCart: () => set((state) => ({ cartOpen: !state.cartOpen })),
  reset: () => set({ cartOpen: false }),
}));
