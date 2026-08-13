import { useNavigate } from 'react-router-dom';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { formatMoney } from '@/utils/formatMoney';
import { BagIcon, CloseIcon, MinusIcon, PlusIcon, TrashIcon } from '@/components/icons';
import '../styles/components/cart-drawer.scss';

export default function CartDrawer() {
  const navigate = useNavigate();
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal);
  const cartOpen = useUIStore((state) => state.cartOpen);
  const toggleCart = useUIStore((state) => state.toggleCart);

  const subtotal = estimatedSubtotal();
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

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
        className={`cart-drawer${cartOpen ? ' is-open' : ''}`}
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
          <button className="cart-drawer__close" onClick={toggleCart} aria-label="Close cart">
            <CloseIcon size={20} />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="cart-drawer__empty">
            <span className="state-panel__icon">
              <BagIcon size={28} />
            </span>
            <p className="cart-drawer__empty-title">Your cart is empty</p>
            <p className="cart-drawer__empty-body">
              Add something from the menu and it will show up here.
            </p>
            <button className="btn btn--secondary" onClick={toggleCart}>
              Browse the menu
            </button>
          </div>
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

                  <p className="cart-drawer__item-unit">
                    {formatMoney(item.unitPrice)} each
                  </p>

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
              <p className="cart-drawer__note">
                Final pricing is confirmed at checkout.
              </p>

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
