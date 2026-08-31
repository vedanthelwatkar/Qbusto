import { memo } from 'react';

import type { BoardOrder } from '../types/kitchen';
import { fulfilmentElapsed, formatClock, formatElapsedWords, describeDuration, urgencyOf } from '../utils/time';
import { STATUS_ICON, STATUS_LABEL, destinationOf, sourceLabel } from '../utils/workflow';

interface OrderCardProps {
  order: BoardOrder;
  now: number;
  /**
   * This order's running position in the row it is drawn in - the small
   * numbered tile next to the token. Purely a display convenience (how many
   * tickets are on the board right now, read left to right), not a database
   * field; omitted in the Delivered strip, where the tickets are a lookup, not
   * a queue to work through in order.
   */
  position?: number;
  /**
   * Render the condensed form used in the Delivered strip.
   *
   * Finished work is a lookup - "did #28 go out, and when?" - not something
   * anyone cooks from, so it does not need the full ticket. Keeping it full
   * size made the reference strip taller than the live lanes and squeezed the
   * working queues, which is exactly backwards. The full detail is one tap
   * away in the focus view.
   */
  compact?: boolean;
  onOpen: (id: number) => void;
}

/**
 * How many item lines a ticket shows before it says "+N more".
 *
 * The rows share the board's height between them, so a card cannot grow to
 * fit a large order - four lines is what fits at the row height a three-row
 * board leaves, and anything past that is one tap away in the focus view.
 */
const CARD_ITEM_LIMIT = 4;

/**
 * One ticket on the board.
 *
 * Read from two or three metres away, so the order number and the item lines
 * carry the weight and everything else is secondary.
 *
 * MARKUP NOTE
 *
 * The whole card opens the focus view, but the card is NOT wrapped in a
 * <button>: a button may only contain phrasing content, and this card contains
 * a <ul>. Nesting them produces invalid HTML that screen readers flatten into
 * one unreadable label. Instead a transparent button is stretched across the
 * card. There is no second, workflow-advancing control on the card itself -
 * that action lives in the focus view now, so a dense grid of tickets cannot
 * be advanced by a stray tap.
 *
 * Memoised because the board re-renders every second to advance the clocks.
 * That does not help on a tick (`now` changes for everyone), but it does on
 * every other render - a transition elsewhere on the board, or a poll that
 * leaves this order untouched, then costs nothing here.
 */
function OrderCardImpl({ order, now, position, compact = false, onOpen }: OrderCardProps) {
  // A delivered order's clock is stopped, and settled work is never late.
  const { ms: elapsed, settled } = fulfilmentElapsed(order, now);
  const urgency = settled ? 'normal' : urgencyOf(elapsed);

  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
  const hiddenItemCount = Math.max(0, order.items.length - CARD_ITEM_LIMIT);

  return (
    <article
      className={`card card--${order.status} card--${urgency}${compact ? ' card--compact' : ''}`}
      aria-labelledby={`order-${order.id}-token`}
    >
      <button
        type="button"
        className="card__hit"
        onClick={() => onOpen(order.id)}
        aria-label={`Open order ${order.id} in detail`}
      />

      <div className="card__body">
        <header className="card__head">
          <span className="card__identity">
            {typeof position === 'number' && (
              <span className="card__position" aria-hidden="true">
                {position}
              </span>
            )}
            <span className="card__token" id={`order-${order.id}-token`}>
              #{order.id}
            </span>
          </span>

          <div className="card__times">
            <span className="card__time-row">
              <span className="card__time-label">Ordered</span>
              <span className="card__time-value">{formatClock(order.placedAt)}</span>
            </span>
            {/* The show clock only matters while there is still food to make. */}
            {!compact && order.showTime && (
              <span className="card__time-row">
                <span className="card__time-label">Show</span>
                <span className="card__time-value">{formatClock(order.showTime)}</span>
              </span>
            )}
          </div>
        </header>

        <div className="card__where">
          <span className="card__source">{sourceLabel(order.source)}</span>
          <span className="card__destination">{destinationOf(order)}</span>
        </div>

        {compact ? (
          // A count rather than the lines themselves. Nothing is lost - the
          // focus view still lists every item.
          <p className="card__summary">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </p>
        ) : (
          <>
            <ul className="card__items">
              {order.items.slice(0, CARD_ITEM_LIMIT).map((item) => (
                <li key={item.id} className="card__item">
                  <span className="card__item-name">{item.productName}</span>
                  <span className="card__item-qty" aria-label={`quantity ${item.quantity}`}>
                    &times;{item.quantity}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              Said out loud rather than left to a clipped edge: a ticket that
              silently stops at four lines reads as a complete order, and a
              cook would make the wrong food. The focus view has the rest.
            */}
            {hiddenItemCount > 0 && (
              <p className="card__more">+{hiddenItemCount} more</p>
            )}

            {/*
              Special instructions are the one thing on a ticket that changes
              what the kitchen physically does, so they are visually separated
              rather than being another line of body text.
            */}
            {order.notes && (
              <p className="card__notes">
                <span className="card__notes-label">Note</span>
                {order.notes}
              </p>
            )}
          </>
        )}

        <footer className="card__foot">
          {/*
            Status is given three ways - lane, glyph and word - so it never
            depends on colour alone.
          */}
          <span className={`badge badge--${order.status}`}>
            <span aria-hidden="true">{STATUS_ICON[order.status]}</span>
            {STATUS_LABEL[order.status]}
          </span>

          <span className={`card__elapsed card__elapsed--${urgency}`}>
            {urgency !== 'normal' && (
              <span className="card__elapsed-flag" aria-hidden="true">
                {urgency === 'late' ? '!!' : '!'}
              </span>
            )}
            <span aria-hidden="true">{formatElapsedWords(elapsed, settled)}</span>
            <span className="sr-only">
              {settled ? 'took' : 'waiting'} {describeDuration(elapsed)}
              {urgency === 'late' ? ', late' : urgency === 'warning' ? ', running behind' : ''}
            </span>
          </span>
        </footer>
      </div>
    </article>
  );
}

export const OrderCard = memo(OrderCardImpl);
