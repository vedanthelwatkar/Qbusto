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
  loadFromLocalStorage(): void;
  clear(): void;
}

const STORAGE_KEY = 'qbusto_order_context';

const getInitialState = (): Omit<ContextState, 'setContext' | 'loadFromLocalStorage' | 'clear'> => ({
  cinemaId: null,
  screenId: null,
  seatNumber: null,
  showTime: null,
  filmTitle: null,
  source: 'qr',
});

const saveToLocalStorage = (state: Omit<ContextState, 'setContext' | 'loadFromLocalStorage' | 'clear'>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save context to localStorage:', error);
  }
};

const loadFromStorageOrDefault = (): Omit<ContextState, 'setContext' | 'loadFromLocalStorage' | 'clear'> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load context from localStorage:', error);
  }
  return getInitialState();
};

export const useContextStore = create<ContextState>((set, get) => ({
  ...loadFromStorageOrDefault(),
  setContext: (ctx) => {
    set(ctx);
    const state = get();
    saveToLocalStorage({
      cinemaId: state.cinemaId,
      screenId: state.screenId,
      seatNumber: state.seatNumber,
      showTime: state.showTime,
      filmTitle: state.filmTitle,
      source: state.source,
    });
  },
  loadFromLocalStorage: () => {
    set(loadFromStorageOrDefault());
  },
  clear: () => {
    const clearedState = getInitialState();
    set(clearedState);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear context from localStorage:', error);
    }
  },
}));
