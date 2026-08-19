import { useEffect, useRef } from 'react';

import type { BoardOrder } from '../types/kitchen';
import {
  fulfilmentElapsed,
  formatClock,
  formatDuration,
  describeDuration,
  urgencyOf,
} from '../utils/time';
import { STATUS_ICON, STATUS_LABEL, destinationOf, nextAction, sourceLabel } from '../utils/workflow';

interface OrderDetailProps {
  order: BoardOrder;
  now: number;
  pending: boolean;
  onClose: () => void;
  onAdvance: (order: BoardOrder) => void;
}

/**
 * The focused ticket.
 *
 * Everything on this screen is a real column on the order. Fields a KDS
 * conventionally shows that this schema has no room for - per-item modifiers,
 * combo composition, a separate booking reference, a prep station - are absent
 * rather than filled with plausible-looking values. `notes` is the order-level
 * instruction the consumer app collects, and it is the only free text an order
 * carries.
 *
 * Rendered as a modal dialog: focus moves in on open, Escape closes, and the
 * background is inert to a screen reader while it is up.
 */
export function OrderDetail({ order, now, pending, onClose, onAdvance }: OrderDetailProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Stopped once delivered - see fulfilmentElapsed.
  const { ms: elapsed, settled } = fulfilmentElapsed(order, now);
  const urgency = settled ? 'normal' : urgencyOf(elapsed);
  const action = nextAction(order.status);

  // Escape closes, and focus starts somewhere sensible rather than on the body.
  useEffect(() => {
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className={`detail detail--${urgency}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-token"
        // The backdrop closes; a click inside must not bubble up to it.
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail__head">
          <div className="detail__identity">
            <span className="detail__token" id="detail-token">
              #{order.id}
            </span>
            <span className="detail__source">{sourceLabel(order.source)}</span>
          </div>

          <div className="detail__clocks">
            <div className="detail__clock">
              <span className="detail__clock-label">Order time</span>
              <span className="detail__clock-value">{formatClock(order.placedAt)}</span>
            </div>
            {order.showTime && (
              <div className="detail__clock">
                <span className="detail__clock-label">Show time</span>
                <span className="detail__clock-value">{formatClock(order.showTime)}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="detail__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close order detail"
          >
            &times;
          </button>
        </header>

        <div className="detail__where">
          <span className="detail__where-item">
            <span className="detail__where-label">Destination</span>
            {destinationOf(order)}
          </span>
          {/* Only rendered when the backend actually has a film for this order. */}
          {order.filmTitle && (
            <span className="detail__where-item">
              <span className="detail__where-label">Film</span>
              {order.filmTitle}
            </span>
          )}
        </div>

        <div className="detail__body">
          <section className="detail__items" aria-label="Items">
            <h2 className="detail__section-title">Items</h2>
            <ul>
              {order.items.map((item) => (
                <li key={item.id} className="detail__item">
                  <span className="detail__item-name">{item.productName}</span>
                  <span className="detail__item-qty">&times;{item.quantity}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="detail__notes-panel" aria-label="Special instructions">
            <h2 className="detail__section-title">Special instructions</h2>
            {order.notes ? (
              <p className="detail__notes">{order.notes}</p>
            ) : (
              // Said plainly rather than left blank: an empty panel reads as a
              // loading failure, and a cook needs to know there is nothing
              // special about this order.
              <p className="detail__notes detail__notes--empty">None</p>
            )}
          </section>
        </div>

        <footer className="detail__foot">
          <div className="detail__facts">
            <div className="detail__fact">
              <span className="detail__fact-label">Status</span>
              <span className={`badge badge--${order.status}`}>
                <span aria-hidden="true">{STATUS_ICON[order.status]}</span>
                {STATUS_LABEL[order.status]}
              </span>
            </div>

            {/*
              Shown, never acted on. The kitchen has no way to change payment
              state and must not imply otherwise - it is here so staff can
              answer a question at the counter.
            */}
            <div className="detail__fact">
              <span className="detail__fact-label">Payment</span>
              <span className="detail__fact-value">{order.paymentStatus ?? 'unknown'}</span>
            </div>

            <div className="detail__fact">
              {/* A finished order reports how long it took, not how long it
                  has been waiting - those are different questions. */}
              <span className="detail__fact-label">{settled ? 'Total time' : 'Elapsed'}</span>
              <span className={`detail__fact-value detail__fact-value--${urgency}`}>
                <span aria-hidden="true">{formatDuration(elapsed)}</span>
                <span className="sr-only">{describeDuration(elapsed)}</span>
              </span>
            </div>
          </div>

          {action ? (
            <button
              type="button"
              className="detail__action"
              onClick={() => onAdvance(order)}
              disabled={pending}
            >
              {pending ? 'Working…' : action.label}
            </button>
          ) : (
            <p className="detail__done">This order is complete.</p>
          )}
        </footer>
      </div>
    </div>
  );
}
