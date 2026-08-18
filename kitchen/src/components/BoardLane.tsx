import type { BoardOrder, FulfilmentStatus } from '../types/kitchen';
import { STATUS_ICON, STATUS_LABEL } from '../utils/workflow';
import { OrderCard } from './OrderCard';

interface BoardLaneProps {
  status: FulfilmentStatus;
  orders: BoardOrder[];
  now: number;
  pending: Set<number>;
  onOpen: (id: number) => void;
  onAdvance: (order: BoardOrder) => void;
}

/**
 * One workflow queue.
 *
 * Lanes are always rendered, even when empty. A kitchen learns the board's
 * shape and reads it by position; a lane that disappears when it empties makes
 * every other lane jump sideways, which is exactly the wrong behaviour on a
 * screen people scan rather than read.
 */
export function BoardLane({ status, orders, now, pending, onOpen, onAdvance }: BoardLaneProps) {
  return (
    <section className={`lane lane--${status}`} aria-labelledby={`lane-${status}`}>
      <h2 className="lane__head" id={`lane-${status}`}>
        <span className="lane__icon" aria-hidden="true">
          {STATUS_ICON[status]}
        </span>
        <span className="lane__title">{STATUS_LABEL[status]}</span>
        <span className="lane__count" aria-label={`${orders.length} orders`}>
          {orders.length}
        </span>
      </h2>

      <div className="lane__cards">
        {orders.length === 0 ? (
          <p className="lane__empty">Nothing here</p>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              pending={pending.has(order.id)}
              // Finished work is a lookup, not a ticket to cook from.
              compact={status === 'delivered'}
              onOpen={onOpen}
              onAdvance={onAdvance}
            />
          ))
        )}
      </div>
    </section>
  );
}
