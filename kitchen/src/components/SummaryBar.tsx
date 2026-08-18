import type { BoardOrder } from '../types/kitchen';
import { elapsedMs, urgencyOf } from '../utils/time';

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

  return (
    <footer className="summary" aria-label="Board summary">
      <Stat label="New" value={counts.newOrders} />
      <Stat label="Preparing" value={counts.preparing} />
      <Stat label="Ready" value={counts.ready} />
      <Stat label="Delayed" value={counts.delayed} tone={counts.delayed > 0 ? 'alert' : undefined} />
      <Stat label="Delivered" value={completed.length} />

      <div className="summary__total">
        <span className="summary__total-label">Active orders</span>
        <span className="summary__total-value">
          {active.length}
          {truncated && <span className="summary__total-of"> of {activeTotal}</span>}
        </span>
      </div>
    </footer>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'alert' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{String(value).padStart(2, '0')}</span>
    </div>
  );
}
