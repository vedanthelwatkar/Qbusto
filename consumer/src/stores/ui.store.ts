import { create } from 'zustand';

interface UIState {
  cartOpen: boolean;
  paymentLoading: boolean;
  errorMessage: string | null;
  toggleCart(): void;
  setPaymentLoading(loading: boolean): void;
  setError(message: string | null): void;
}

export const useUIStore = create<UIState>((set) => ({
  cartOpen: false,
  paymentLoading: false,
  errorMessage: null,
  toggleCart: () => set((state) => ({ cartOpen: !state.cartOpen })),
  setPaymentLoading: (loading) => set({ paymentLoading: loading }),
  setError: (message) => set({ errorMessage: message }),
}));
