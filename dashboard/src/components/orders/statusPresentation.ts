/**
 * How order and payment statuses are presented.
 *
 * These lived twice — once in OrdersPage and once in OrderDetailsDrawer — and
 * had already drifted: `ready` rendered gold in the table and green in the
 * drawer, so the same order looked like two different states depending on
 * where you were looking. One copy, used by both.
 *
 * Codes come from the backend master tables. `default` covers a code this
 * build has not seen, which is preferable to throwing on an unrecognised value.
 */

import type { Order } from '@/api/generated/cinemaOrderingAPI.schemas';

type StatusCode = Order['status'] | string | null | undefined;
type PaymentCode = Order['paymentStatus'] | string | null | undefined;

/**
 * Order status colours follow the lifecycle: blue while it is being placed,
 * warm while the kitchen holds it, green once the customer has it, red if it
 * was called off.
 */
const ORDER_STATUS_COLOR: Record<string, string> = {
  initiated: 'blue',
  confirmed: 'cyan',
  preparing: 'orange',
  ready: 'gold',
  delivered: 'green',
  rejected: 'red',
};

const PAYMENT_STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  paid: 'green',
  failed: 'red',
  refunded: 'blue',
};

export function orderStatusColor(code: StatusCode): string {
  return (code && ORDER_STATUS_COLOR[code]) || 'default';
}

export function paymentStatusColor(code: PaymentCode): string {
  return (code && PAYMENT_STATUS_COLOR[code]) || 'default';
}

/**
 * Order sources, as the backend records them, with labels staff use.
 *
 * `qr` and `seat_qr` are distinct: a seat QR carries a seat number and the
 * food is run to the seat, a generic QR is scanned in the lobby and collected.
 */
export const ORDER_SOURCES = [
  { label: 'Lobby QR', value: 'qr' },
  { label: 'Seat QR', value: 'seat_qr' },
  { label: 'Kiosk', value: 'kiosk' },
  { label: 'Counter', value: 'counter' },
] as const;

export function orderSourceLabel(source: string | null | undefined): string {
  if (!source) return '-';
  return ORDER_SOURCES.find((entry) => entry.value === source)?.label ?? source;
}
