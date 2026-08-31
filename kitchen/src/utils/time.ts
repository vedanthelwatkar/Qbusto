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
 * The elapsed figure in words, for the board's cards: "5 min ago" for a
 * still-waiting order (it was PLACED that long ago), "Took 12 min" once it has
 * settled (`fulfilmentElapsed`'s `settled` flag) - a finished order did not
 * happen "ago", it took a duration. The focus view keeps the precise `MM:SS`
 * clock from `formatDuration` instead; this is only for the card, which is
 * read from across the room and does not need second-level precision.
 */
export function formatElapsedWords(ms: number, settled: boolean): string {
  const magnitude = coarseDuration(ms);

  if (settled) return magnitude ? `Took ${magnitude}` : 'Took under a minute';
  return magnitude ? `${magnitude} ago` : 'Just now';
}

/**
 * The largest unit that still says something useful, and only that unit.
 *
 * Minutes alone were wrong at the top end: an order left on the board over a
 * weekend rendered as "9220 min ago", which is a number nobody converts in
 * their head. It steps up to hours and then days so the figure stays short
 * enough to read from across the room. Returns '' for under a minute, which
 * the caller words as "Just now" rather than "0 min".
 */
function coarseDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hr' : `${hours} hrs`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
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

/**
 * The cinema's timezone. Mirrors APP_TIMEZONE in the backend's environment.
 *
 * Pinned rather than left to the device: a kitchen display is a fixed screen
 * someone imaged once, and if its clock is on the wrong zone every ticket
 * shows the wrong time while looking entirely normal. Timestamps arrive as UTC
 * instants, so rendering them in a chosen zone is well-defined.
 *
 * Only the two WALL-CLOCK formatters below use it. The elapsed/urgency maths
 * above is deliberately untouched: those are differences between instants, and
 * a duration has no timezone.
 */
const CINEMA_TIME_ZONE = 'Asia/Kolkata';

/** Wall-clock time, e.g. "1:35 PM". Empty string for a missing timestamp. */
export function formatClock(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], {
    timeZone: CINEMA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Full date for the header, e.g. "18 Aug 2026". */
export function formatDate(date: Date): string {
  return date.toLocaleDateString([], {
    timeZone: CINEMA_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
