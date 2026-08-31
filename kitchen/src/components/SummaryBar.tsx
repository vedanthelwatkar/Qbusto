import type { BoardOrder } from '../types/kitchen';
import { elapsedMs, formatClock, formatDate, urgencyOf } from '../utils/time';

interface SummaryBarProps {
  active: BoardOrder[];
  completed: BoardOrder[];
  now: number;
  /** Server-side total, which may exceed the page we hold. */
  activeTotal: number;
}

/**
 * The counts along the bottom of the board.
 *
 * Every figure here is derived from the orders actually loaded - nothing is
 * assumed and nothing is a placeholder. `delayed` is computed from the same
 * urgency rule the cards use, so a card showing a late flag is guaranteed to
 * be inside that count.
 *
 * When the server reports more active orders than this page holds, the total
 * says so rather than quietly under-reporting.
 */
export function SummaryBar({ active, completed, now, activeTotal }: SummaryBarProps) {
  const counts = active.reduce(
    (acc, order) => {
      if (order.status === 'confirmed') acc.newOrders += 1;
      if (order.status === 'preparing') acc.preparing += 1;
      if (order.status === 'ready') acc.ready += 1;
      if (urgencyOf(elapsedMs(order.placedAt, now)) !== 'normal') acc.delayed += 1;
      return acc;
    },
    { newOrders: 0, preparing: 0, ready: 0, delayed: 0 }
  );

  const truncated = activeTotal > active.length;
  // "Total orders" is everything currently on screen either way - the active
  // queues plus the recent Delivered window - not a server-side count, so it
  // agrees with what a cook can actually see and tap into.
  const totalOnScreen = active.length + completed.length;

  return (
    <footer className="summary" aria-label="Board summary">
      <Stat label="Pending" value={counts.newOrders} icon="●" />
      <Stat label="Prepare" value={counts.preparing} icon="◑" />
      <Stat label="Ready" value={counts.ready} icon="✓" />
      <Stat
        label="Delayed"
        value={counts.delayed}
        icon="!"
        tone={counts.delayed > 0 ? 'alert' : undefined}
      />
      <Stat label="Delivered" value={completed.length} icon="✔" />

      <div className="summary__total">
        <span className="summary__total-label">Total orders</span>
        <span className="summary__total-value">
          {totalOnScreen}
          {truncated && <span className="summary__total-of"> ({active.length} of {activeTotal} active)</span>}
        </span>
      </div>

      <div className="summary__brand">
        <img className="summary__mark" src="/favicon-192x192.png" alt="" aria-hidden="true" />
        <span className="summary__name">QBusto</span>
      </div>

      <div className="summary__clock">
        <span className="summary__time">{formatClock(new Date(now).toISOString())}</span>
        <span className="summary__date">{formatDate(new Date(now))}</span>
      </div>
    </footer>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: string; tone?: 'alert' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__label">
        <span aria-hidden="true">{icon}</span> {label}
      </span>
      <span className="stat__value">{String(value).padStart(2, '0')}</span>
    </div>
  );
}
