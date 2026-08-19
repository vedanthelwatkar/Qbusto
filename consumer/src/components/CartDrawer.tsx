import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import StatePanel from '@/components/StatePanel';
import { formatMoney } from '@/utils/formatMoney';
import { BagIcon, CloseIcon, MinusIcon, PlusIcon, TrashIcon } from '@/components/icons';
import '../styles/components/cart-drawer.scss';

/** Everything inside the sheet that can hold focus. */
const FOCUSABLE =
  'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function CartDrawer() {
  const navigate = useNavigate();
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal);
  const cartOpen = useUIStore((state) => state.cartOpen);
  const toggleCart = useUIStore((state) => state.toggleCart);

  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** The control that opened the sheet, so focus can be handed back to it. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const subtotal = estimatedSubtotal();
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  /**
   * The sheet is a modal: it covers the page behind an overlay, so it has to
   * behave like one. Previously it could only be dismissed by pointing at the
   * overlay or the close button, and focus stayed on the page underneath — a
   * keyboard user could tab through controls they could not see.
   */
  useEffect(() => {
    if (!cartOpen) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button rather than the panel: it is the reliable escape
    // route, and it reads the sheet's label on the way in.
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        toggleCart();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      /**
       * Focus can end up outside the sheet without the customer moving it:
       * removing the last cart item unmounts the button they just pressed and
       * the browser drops focus to <body>. Treating that as "at the boundary"
       * pulls it back in on the next Tab in either direction — otherwise a
       * forward Tab from <body> walks into the page behind the overlay.
       */
      const outside = !panelRef.current.contains(active);

      // Wrap at both ends so Tab can never land on the page behind the sheet.
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cartOpen, toggleCart]);

  // Hand focus back to whatever opened the sheet. Split from the effect above
  // so it runs on close only and never fights the focus call on open.
  useEffect(() => {
    if (cartOpen) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // Only if it is still in the document — the opener may have unmounted.
    if (target && document.contains(target)) target.focus();
  }, [cartOpen]);

  const handleCheckout = () => {
    toggleCart();
    navigate('/checkout');
  };

  return (
    <>
      {cartOpen && <div className="cart-overlay" onClick={toggleCart} aria-hidden="true" />}

      {/* The panel stays mounted so it can animate, so it must be hidden from
          assistive tech and the tab order while closed. */}
      <aside
        ref={panelRef}
        className={`cart-drawer${cartOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!cartOpen}
        aria-label="Your cart"
      >
        <div className="cart-drawer__grabber" aria-hidden="true" />

        <header className="cart-drawer__header">
          <div className="cart-drawer__heading">
            <h2 className="cart-drawer__title">Your cart</h2>
            {itemCount > 0 && (
              <span className="cart-drawer__count">
                {itemCount === 1 ? '1 item' : `${itemCount} items`}
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            className="cart-drawer__close"
            onClick={toggleCart}
            aria-label="Close cart"
          >
            <CloseIcon size={20} />
          </button>
        </header>

        {items.length === 0 ? (
          <StatePanel
            icon={<BagIcon size={28} />}
            titleAs="p"
            title="Your cart is empty"
            body="Add something from the menu and it will show up here."
            actions={
              <button className="btn btn--secondary" onClick={toggleCart}>
                Browse the menu
              </button>
            }
          />
        ) : (
          <>
            <ul className="cart-drawer__items">
              {items.map((item) => (
                <li key={item.productId} className="cart-drawer__item">
                  <div className="cart-drawer__item-top">
                    <h3 className="cart-drawer__item-name">{item.productName}</h3>
                    <span className="cart-drawer__item-total">
                      {formatMoney(item.unitPrice * item.quantity)}
                    </span>
                  </div>

                  <p className="cart-drawer__item-unit">{formatMoney(item.unitPrice)} each</p>

                  <div className="cart-drawer__item-controls">
                    <div className="cart-drawer__stepper">
                      <button
                        className="cart-drawer__step"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        aria-label={
                          item.quantity === 1
                            ? `Remove ${item.productName} from cart`
                            : `Decrease quantity of ${item.productName}`
                        }
                      >
                        <MinusIcon size={18} />
                      </button>
                      <span className="cart-drawer__qty" aria-live="polite">
                        <span className="sr-only">{item.productName} quantity: </span>
                        {item.quantity}
                      </span>
                      <button
                        className="cart-drawer__step"
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        aria-label={`Increase quantity of ${item.productName}`}
                      >
                        <PlusIcon size={18} />
                      </button>
                    </div>

                    <button
                      className="cart-drawer__remove"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Remove ${item.productName} from cart`}
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="cart-drawer__footer">
              <div className="cart-drawer__summary">
                <span className="cart-drawer__summary-label">Estimated subtotal</span>
                <span className="cart-drawer__summary-value">{formatMoney(subtotal)}</span>
              </div>
              <p className="cart-drawer__note">Final pricing is confirmed at checkout.</p>

              <button className="btn btn--primary btn--block" onClick={handleCheckout}>
                Proceed to checkout
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
