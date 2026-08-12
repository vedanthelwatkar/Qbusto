import { useNavigate } from 'react-router-dom';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { formatMoney } from '@/utils/formatMoney';
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

  const handleCheckout = () => {
    toggleCart();
    navigate('/checkout');
  };

  return (
    <>
      {/* Overlay */}
      {cartOpen && (
        <div className="cart-overlay" onClick={toggleCart} aria-hidden="true" />
      )}

      {/* Drawer */}
      <div className={`cart-drawer ${cartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>Your Cart</h2>
          <button
            className="btn-close"
            onClick={toggleCart}
            aria-label="Close cart"
          >
            ✕
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cart-empty">
            <p>Your cart is empty</p>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {items.map((item) => (
                <div key={item.productId} className="cart-item">
                  <div className="item-info">
                    <h3>{item.productName}</h3>
                    <p className="item-price">
                      {formatMoney(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>

                  <div className="item-controls">
                    <button
                      className="btn-qty"
                      onClick={() =>
                        updateQuantity(item.productId, item.quantity - 1)
                      }
                      aria-label={`Decrease quantity for ${item.productName}`}
                    >
                      −
                    </button>
                    <span className="qty-display">{item.quantity}</span>
                    <button
                      className="btn-qty"
                      onClick={() =>
                        updateQuantity(item.productId, item.quantity + 1)
                      }
                      aria-label={`Increase quantity for ${item.productName}`}
                    >
                      +
                    </button>
                    <button
                      className="btn-remove"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Remove ${item.productName}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-footer">
              <div className="cart-summary">
                <div className="summary-row">
                  <span>Subtotal (estimate)</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
              </div>

              <button
                className="btn-checkout"
                onClick={handleCheckout}
                aria-label="Proceed to checkout"
              >
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
