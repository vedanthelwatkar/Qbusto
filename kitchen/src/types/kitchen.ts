import type { KitchenOrder, KitchenOrderItemsItem } from '../api/generated/cinemaOrderingAPI.schemas';

/**
 * The KDS domain model.
 *
 * `KitchenOrder` comes from the generated client and is the contract. These
 * types narrow it rather than redefining it: the generated schema makes every
 * field optional because OpenAPI cannot express "always present in a 200", and
 * a board that has to null-check `id` on every render is unreadable.
 *
 * Nothing here invents a field. Everything is either on KitchenOrder already,
 * or derived from it on this side (elapsed time, urgency, which lane it is in).
 */

export type FulfilmentStatus = 'confirmed' | 'preparing' | 'ready' | 'delivered';

/** Order source, as the backend records it. */
export type OrderSource = 'qr' | 'seat_qr' | 'kiosk' | 'counter';

/**
 * A board order with the fields the UI genuinely requires made non-optional.
 *
 * Produced by `toBoardOrder`, which is the single place a raw KitchenOrder is
 * checked. An order missing an id or a status is dropped there rather than
 * being rendered as a broken card.
 */
export interface BoardOrder {
  id: number;
  status: FulfilmentStatus;
  paymentStatus: string | null;
  source: OrderSource | null;
  seatNumber: string | null;
  filmTitle: string | null;
  showTime: string | null;
  /** Order-level special instructions. The only free text an order carries. */
  notes: string | null;
  total: number | null;
  cinemaName: string | null;
  screenName: string | null;
  items: BoardOrderItem[];
  /** ISO timestamp the order was placed. Elapsed time is derived from this. */
  placedAt: string;
  deliveredAt: string | null;
}

export interface BoardOrderItem {
  id: number;
  productName: string;
  quantity: number;
}

/** How overdue an order is. Drives colour, icon AND text - never colour alone. */
export type Urgency = 'normal' | 'warning' | 'late';

/**
 * Narrow a generated KitchenOrder into a BoardOrder.
 *
 * Returns null when the row cannot be displayed honestly. That should not
 * happen against this backend - the serializer always sends id and status - but
 * the generated types permit it, and silently rendering `#undefined` on a wall
 * display is worse than omitting the card.
 */
export function toBoardOrder(raw: KitchenOrder): BoardOrder | null {
  if (typeof raw.id !== 'number' || !raw.status || !raw.placedAt) return null;

  return {
    id: raw.id,
    status: raw.status as FulfilmentStatus,
    paymentStatus: raw.paymentStatus ?? null,
    source: (raw.source as OrderSource | null) ?? null,
    seatNumber: raw.seatNumber ?? null,
    filmTitle: raw.filmTitle ?? null,
    showTime: raw.showTime ?? null,
    notes: raw.notes ?? null,
    total: typeof raw.total === 'number' ? raw.total : null,
    cinemaName: raw.cinema?.name ?? null,
    screenName: raw.screen?.name ?? null,
    items: (raw.items ?? []).map(toBoardItem).filter((item): item is BoardOrderItem => item !== null),
    placedAt: raw.placedAt,
    deliveredAt: raw.deliveredAt ?? null,
  };
}

function toBoardItem(raw: KitchenOrderItemsItem): BoardOrderItem | null {
  if (typeof raw.id !== 'number' || !raw.productName || typeof raw.quantity !== 'number') {
    return null;
  }

  return { id: raw.id, productName: raw.productName, quantity: raw.quantity };
}
