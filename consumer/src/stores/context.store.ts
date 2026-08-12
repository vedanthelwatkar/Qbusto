import { create } from 'zustand';

type OrderSource = 'qr' | 'seat_qr' | 'kiosk' | 'counter';

interface ContextState {
  cinemaId: number | null;
  screenId: number | null;
  seatNumber: string | null;
  showTime: string | null;
  filmTitle: string | null;
  source: OrderSource;
  setContext(ctx: Partial<ContextState>): void;
  clear(): void;
}

export const useContextStore = create<ContextState>((set) => ({
  cinemaId: null,
  screenId: null,
  seatNumber: null,
  showTime: null,
  filmTitle: null,
  source: 'qr',
  setContext: (ctx) => set(ctx),
  clear: () =>
    set({
      cinemaId: null,
      screenId: null,
      seatNumber: null,
      showTime: null,
      filmTitle: null,
      source: 'qr',
    }),
}));
