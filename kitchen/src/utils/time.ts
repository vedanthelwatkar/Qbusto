import { DELAY_LATE_MS, DELAY_WARNING_MS } from '../config';
import type { Urgency } from '../types/kitchen';

/**
 * Time formatting and the delay rule.
 *
 * The thresholds themselves live in config.ts. This file decides what to do
 * with them, in one place, so no component compares a duration to a number.
 */

/** Milliseconds an order has been waiting. Never negative, even under clock skew. */
export function elapsedMs(placedAt: string, now: number): number {
  const placed = new Date(placedAt).getTime();
  if (Number.isNaN(placed)) return 0;

  // A venue display's clock can sit ahead of the server's. Showing "-3:00"
  // would look broken; clamping to zero degrades gracefully.
  return Math.max(0, now - placed);
}

/**
 * The clock a card shows, and whether it is still running.
 *
 * A live order counts up from when it was placed - the customer has been
 * waiting since they paid, so that is the number that matters.
 *
 * A DELIVERED order's clock stops. It freezes at how long fulfilment actually
 * took, and it is never marked late: flagging finished work as overdue is
 * worse than useless, because a red `!!` on a ticket that already went out
 * trains staff to ignore the flag on the ones that have not.
 *
 * `settled` is what callers use to drop the urgency styling and to relabel the
 * figure - it is a duration, not a countdown, once the food is gone.
 */
export function fulfilmentElapsed(
  order: { status: string; placedAt: string; deliveredAt: string | null },
  now: number
): { ms: number; settled: boolean } {
  if (order.status !== 'delivered') {
    return { ms: elapsedMs(order.placedAt, now), settled: false };
  }

  // Historical rows predating the deliveredAt stamp have no end time. Show the
  // running figure rather than a wrong one, but still treat it as settled so
  // it is not painted as late.
  if (!order.deliveredAt) {
    return { ms: elapsedMs(order.placedAt, now), settled: true };
  }

  const delivered = new Date(order.deliveredAt).getTime();
  const placed = new Date(order.placedAt).getTime();

  if (Number.isNaN(delivered) || Number.isNaN(placed)) {
    return { ms: 0, settled: true };
  }

  return { ms: Math.max(0, delivered - placed), settled: true };
}

/**
 * How overdue an order is.
 *
 * Measured from when it was placed, not from when the kitchen picked it up:
 * the customer has been waiting since they paid.
 */
export function urgencyOf(elapsed: number): Urgency {
  if (elapsed >= DELAY_LATE_MS) return 'late';
  if (elapsed >= DELAY_WARNING_MS) return 'warning';
  return 'normal';
}

/**
 * A running duration, as a kitchen reads it: `MM:SS` under an hour, `H:MM:SS`
 * over. Zero-padded so the digits do not jump around as they tick.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The same duration in words, for screen readers.
 *
 * The digits are the fast read for someone glancing at a wall; this is what a
 * non-visual user gets instead, since "12:04" read aloud is ambiguous.
 */
export function describeDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);

  if (totalMinutes < 1) return 'under a minute';
  if (totalMinutes === 1) return '1 minute';
  if (totalMinutes < 60) return `${totalMinutes} minutes`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = hours === 1 ? '1 hour' : `${hours} hours`;

  return minutes === 0 ? hourPart : `${hourPart} ${minutes} minutes`;
}

/** Wall-clock time, e.g. "1:35 PM". Empty string for a missing timestamp. */
export function formatClock(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Full date for the header, e.g. "18 Aug 2026". */
export function formatDate(date: Date): string {
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}
