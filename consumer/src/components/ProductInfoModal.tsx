import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import Thumbnail from '@/components/Thumbnail';
import { CloseIcon } from '@/components/icons';
import { formatMoney } from '@/utils/formatMoney';
import { trapTab } from '@/utils/focusTrap';
import '../styles/components/product-info.scss';

export interface ProductInfo {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  weight?: string | null;
}

interface ProductInfoModalProps {
  product: ProductInfo;
  onClose: () => void;
}

/**
 * The full details for one product.
 *
 * The card shows only a name and a price now, so this is where a description
 * that used to be clamped to two lines can be read in full. Everything shown
 * here is already on the product the catalogue loaded - opening it costs no
 * request, and nothing is displayed that the Consumer API does not already
 * return.
 *
 * Dialog behaviour follows CheckoutDrawer, the app's only other modal: focus
 * moves to the close button on open, Tab is trapped, Escape closes, and focus
 * returns to whatever opened it. The shared parts of that live in
 * utils/focusTrap so the two cannot drift.
 *
 * PORTALLED TO document.body. It is rendered from inside a product card, which
 * sits in the catalogue's scrolling pane; leaving it there meant `position:
 * fixed` resolved against an ancestor rather than the viewport, and the panel
 * was clipped by the pane and pushed off-screen on a phone. A portal is the
 * only reliable fix - no amount of z-index or overflow tuning on the ancestors
 * gets a fixed element out of a transformed/scrolling container.
 */
export default function ProductInfoModal({ product, onClose }: ProductInfoModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** The control that opened this, so focus can be handed back to it. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (panelRef.current) trapTab(event, panelRef.current);
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);

      // Guarded: the opener may have unmounted while the dialog was open.
      const target = returnFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [onClose]);

  const hasPrice = typeof product.price === 'number' && Number.isFinite(product.price);

  return createPortal(
    <>
      <div className="product-info-overlay" onClick={onClose} aria-hidden="true" />

      <div
        className="product-info"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-info-title"
        ref={panelRef}
      >
        <header className="product-info__header">
          <h2 className="product-info__title" id="product-info-title">
            {product.name}
          </h2>
          <button
            type="button"
            className="product-info__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close product details"
          >
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="product-info__media">
          <Thumbnail
            src={product.imageUrl}
            alt={product.name}
            imgClassName="product-info__image"
            placeholderClassName="product-info__placeholder"
            iconSize={36}
          />
        </div>

        <dl className="product-info__facts">
          <div className="product-info__fact">
            <dt>Price</dt>
            <dd>
              {hasPrice ? (
                formatMoney(product.price as number)
              ) : (
                <span className="product-info__unavailable">Unavailable</span>
              )}
            </dd>
          </div>

          {product.weight && (
            <div className="product-info__fact">
              <dt>Size</dt>
              <dd>{product.weight}</dd>
            </div>
          )}
        </dl>

        {product.description ? (
          <p className="product-info__description">{product.description}</p>
        ) : (
          <p className="product-info__description product-info__description--empty">
            No description available for this item.
          </p>
        )}
      </div>
    </>,
    document.body
  );
}
