import type { BoardOrder, FulfilmentStatus } from '../types/kitchen';
import { STATUS_ICON, STATUS_LABEL } from '../utils/workflow';
import { OrderCard } from './OrderCard';

interface BoardLaneProps {
  status: FulfilmentStatus;
  orders: BoardOrder[];
  now: number;
  /**
   * Where this row's numbering starts. The board numbers tickets once, running
   * across all rows in workflow order, rather than restarting at 1 in each -
   * see the position comment on OrderCard.
   */
  startIndex: number;
  onOpen: (id: number) => void;
  pendingOrderIds: Set<number>;
  onAdvance: (order: BoardOrder) => void;
}

/**
 * One workflow queue, drawn as a horizontally-scrolling row.
 *
 * An EMPTY row renders nothing at all. The older three-column board kept its
 * empty lanes deliberately - a lane vanishing made the other two jump
 * sideways, and the board was read by position under a visible heading. This
 * layout has neither: rows carry no visible label, so an empty one is a box
 * that cannot even say which status it stands for, and it costs vertical
 * space on a screen that wants it for tickets. Status is read off each
 * ticket's own colour and badge instead, so nothing depends on a row holding
 * its place. When every row is empty, App renders its own board-level message.
 *
 * The heading is screen-reader only (`sr-only`, no styled class of its own):
 * the row still needs an accessible name for aria-labelledby.
 */
export function BoardLane({ status, orders, now, startIndex, onOpen, pendingOrderIds, onAdvance }: BoardLaneProps) {
  if (orders.length === 0) return null;

  return (
    <section className={`lane lane--${status}`} aria-labelledby={`lane-${status}`}>
      <h2 className="sr-only" id={`lane-${status}`}>
        <span aria-hidden="true">{STATUS_ICON[status]}</span> {STATUS_LABEL[status]} ({orders.length})
      </h2>

      <div className="lane__cards">
        {orders.map((order, index) => (
          <OrderCard
            key={order.id}
            order={order}
            now={now}
            position={status === 'delivered' ? undefined : startIndex + index + 1}
            // Finished work is a lookup, not a ticket to cook from.
            compact={status === 'delivered'}
            onOpen={onOpen}
            pending={pendingOrderIds.has(order.id)}
            onAdvance={onAdvance}
          />
        ))}
      </div>
    </section>
  );
}
