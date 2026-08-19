import { create } from 'zustand';

interface CartItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface CartState {
  items: CartItem[];
  addItem(productId: number, productName: string, unitPrice: number): void;
  updateQuantity(productId: number, quantity: number): void;
  removeItem(productId: number): void;
  clear(): void;
  isEmpty(): boolean;
  itemCount(): number;
  estimatedSubtotal(): number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (productId, productName, unitPrice) => {
    set((state) => {
      const existing = state.items.find((i) => i.productId === productId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return {
        items: [...state.items, { productId, productName, quantity: 1, unitPrice }],
      };
    });
  },
  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
    } else {
      set((state) => ({
        items: state.items.map((i) =>
          i.productId === productId ? { ...i, quantity } : i
        ),
      }));
    }
  },
  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((i) => i.productId !== productId),
    }));
  },
  clear: () => set({ items: [] }),
  isEmpty: () => get().items.length === 0,
  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
  estimatedSubtotal: () =>
    get().items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
}));
