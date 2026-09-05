import { create } from 'zustand';

export interface CartItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  /**
   * Snapshot of the product's image, so the cart can show what was added
   * without refetching the catalogue. Either an external URL or an
   * `/uploads/...` path - resolveImageUrl handles both at render time.
   */
  imageUrl?: string | null;
  specialInstructions: string | null;
}

interface CartState {
  items: CartItem[];
  addItem(
    productId: number,
    productName: string,
    unitPrice: number,
    imageUrl?: string | null
  ): void;
  updateQuantity(productId: number, quantity: number): void;
  updateSpecialInstructions(productId: number, specialInstructions: string): void;
  removeItem(productId: number): void;
  clear(): void;
  isEmpty(): boolean;
  itemCount(): number;
  estimatedSubtotal(): number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (productId, productName, unitPrice, imageUrl = null) => {
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
        items: [
          ...state.items,
          {
            productId,
            productName,
            quantity: 1,
            unitPrice,
            imageUrl,
            specialInstructions: null,
          },
        ],
      };
    });
  },
  updateSpecialInstructions: (productId, specialInstructions) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.productId === productId
          ? { ...item, specialInstructions: specialInstructions || null }
          : item
      ),
    }));
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
