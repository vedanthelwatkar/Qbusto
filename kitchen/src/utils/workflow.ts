import type { FulfilmentStatus, OrderSource } from '../types/kitchen';

/**
 * How the fulfilment workflow is presented.
 *
 * The graph itself is the backend's - this mirrors only the part the kitchen
 * can drive, and it exists so a button is never offered for a move the server
 * would reject. The server still validates every transition; this is what stops
 * the UI from asking.
 *
 * Kept deliberately in step with fulfilment.service.KDS_ALLOWED_TARGETS
 * (preparing, ready, delivered). `rejected` is a Dashboard decision and
 * `confirmed` is set by payment, so neither appears here.
 */

/** The single forward action available from each status, or null if none. */
const NEXT_ACTION: Record<FulfilmentStatus, { status: FulfilmentStatus; label: string } | null> = {
  confirmed: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'delivered', label: 'Mark delivered' },
  delivered: null,
};

export function nextAction(status: FulfilmentStatus) {
  return NEXT_ACTION[status];
}

/** Lane headings. `confirmed` reads as "new" to a cook, not as "confirmed". */
export const STATUS_LABEL: Record<FulfilmentStatus, string> = {
  confirmed: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
};

/**
 * A short text marker per status.
 *
 * Status is conveyed by lane, by this label and by an icon - never by colour
 * alone, which a cook with a colour vision deficiency, or a screen with a
 * washed-out panel, would not be able to read.
 */
export const STATUS_ICON: Record<FulfilmentStatus, string> = {
  confirmed: '●', // filled circle - waiting
  preparing: '◑', // half-filled - in progress
  ready: '✓', // check - done cooking
  delivered: '✔', // heavy check - handed over
};

/**
 * How an order reached us, in the words staff use.
 *
 * The backend stores four sources. `qr` and `seat_qr` are distinct: a seat QR
 * carries a seat number and the food is run to the seat, a generic QR is
 * scanned in the lobby and collected at the counter.
 */
export const SOURCE_LABEL: Record<OrderSource, string> = {
  seat_qr: 'Seat QR',
  qr: 'Lobby QR',
  kiosk: 'Kiosk',
  counter: 'Counter',
};

export function sourceLabel(source: OrderSource | null): string {
  return source ? SOURCE_LABEL[source] : 'Unknown source';
}

/**
 * Where the food goes.
 *
 * A seat number means it is run to the seat. Without one it is a collection,
 * which is what `counter` and `kiosk` orders are. This reads the data rather
 * than assuming the source implies the destination.
 */
export function destinationOf(order: {
  seatNumber: string | null;
  screenName: string | null;
}): string {
  if (order.seatNumber) {
    return order.screenName ? `${order.screenName} · ${order.seatNumber}` : order.seatNumber;
  }

  return order.screenName ?? 'Counter pickup';
}
