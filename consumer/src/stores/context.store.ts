import { create } from 'zustand';

type OrderSource = 'qr' | 'seat_qr' | 'kiosk' | 'counter';

interface ContextState {
  cinemaId: number | null;
  screenId: number | null;
  /**
   * Row and seat, kept SEPARATE end to end.
   *
   * The URL carries them separately (`?row=A&seat=5`), the checkout form has a
   * field for each, and they are stored apart here. They are joined into the
   * single `seatNumber` string only at the boundary that genuinely requires
   * one: the order payload, whose column is a single VARCHAR. `seatLabel()`
   * below is the one place that join happens.
   */
  row: string | null;
  seat: string | null;
  showTime: string | null;
  filmTitle: string | null;
  source: OrderSource;
  setContext(ctx: Partial<ContextState>): void;
  /** Row and seat as one label, e.g. 'A5'. Null unless both are known. */
  seatLabel(): string | null;
  loadFromLocalStorage(): void;
  clearCustomerData(): void;
  clear(): void;
}

const STORAGE_KEY = 'qbusto_order_context';

/**
 * Which fields belong to the CUSTOMER rather than to the installation.
 *
 * This split exists because a kiosk is shared. cinemaId, screenId and source
 * are configured once when the device is set up and must survive between
 * customers - losing them would mean re-provisioning the kiosk. Seat, show
 * time and film belong to whoever is standing there right now, and leaving
 * them behind would show the next customer the previous one's seat.
 *
 * On a phone the same reset is harmless: a QR scan re-supplies every one of
 * these values, so there is nothing to preserve between scans.
 */
const CUSTOMER_FIELDS = {
  row: null,
  seat: null,
  showTime: null,
  filmTitle: null,
} as const;

const getInitialState = (): Omit<
  ContextState,
  'setContext' | 'seatLabel' | 'loadFromLocalStorage' | 'clearCustomerData' | 'clear'
> => ({
  cinemaId: null,
  screenId: null,
  row: null,
  seat: null,
  showTime: null,
  filmTitle: null,
  source: 'qr',
});

const saveToLocalStorage = (
  state: Omit<ContextState, 'setContext' | 'seatLabel' | 'loadFromLocalStorage' | 'clearCustomerData' | 'clear'>
) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save context to localStorage:', error);
  }
};

const loadFromStorageOrDefault = (): Omit<
  ContextState,
  'setContext' | 'seatLabel' | 'loadFromLocalStorage' | 'clearCustomerData' | 'clear'
> => {
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
      row: state.row,
      seat: state.seat,
      showTime: state.showTime,
      filmTitle: state.filmTitle,
      source: state.source,
    });
  },
  /**
   * The two halves joined, for the one place that needs a single string: the
   * order payload's `seatNumber` column. Null unless BOTH are known - a row
   * with no seat identifies nothing, and 'A' alone could not be split back.
   */
  seatLabel: () => {
    const { row, seat } = get();
    return row && seat ? `${row}${seat}` : null;
  },
  loadFromLocalStorage: () => {
    set(loadFromStorageOrDefault());
  },
  /**
   * End of one customer's session: forget them, keep the installation.
   *
   * Called once the order has been placed and acknowledged. Anything earlier
   * would wipe details the customer is still using - the seat they typed is
   * read back on the confirmation screen.
   */
  clearCustomerData: () => {
    set(CUSTOMER_FIELDS);
    const state = get();
    saveToLocalStorage({
      cinemaId: state.cinemaId,
      screenId: state.screenId,
      row: null,
      seat: null,
      showTime: null,
      filmTitle: null,
      source: state.source,
    });
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
