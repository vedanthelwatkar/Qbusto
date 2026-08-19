import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useCartStore } from '@/stores/cart.store';
import { useContextStore } from '@/stores/context.store';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { formatMoney } from '@/utils/formatMoney';
import StatePanel from '@/components/StatePanel';
import { AlertIcon, CheckIcon } from '@/components/icons';
import '../styles/pages/confirmation.scss';

export default function ConfirmationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const clearCart = useCartStore((state) => state.clear);
  // From the persisted QR context, so it survives a refresh of this page —
  // unlike the cart, which is in-memory and would vanish.
  const seatNumber = useContextStore((state) => state.seatNumber);
  const clearCustomerData = useContextStore((state) => state.clearCustomerData);

  // Safety: orderId must be a strictly positive integer (digits only, no leading zero)
  if (!orderId || !/^[1-9]\d*$/.test(orderId)) {
    return (
      <div className="confirmation">
        <StatePanel
          icon={<AlertIcon size={28} />}
          tone="error"
          title="Order not found"
          body="We couldn't display this order confirmation. If you completed a payment, your order is safe — please check with the counter."
          actions={
            <button
              className="btn btn--primary"
              onClick={() => navigate('/', { replace: true })}
            >
              Back to home
            </button>
          }
        />
      </div>
    );
  }

  // Passed from the payment page after backend verification. Optional: this
  // page must render correctly when the state is absent (e.g. a direct visit).
  const navState = location.state as { amount?: number | null } | null;
  const amountPaise = typeof navState?.amount === 'number' ? navState.amount : null;

  const handleDone = () => {
    // Clear cart after payment is verified and confirmed by user
    clearCart();
    // End the checkout session so the next order mints a fresh idempotency key
    // rather than reusing this completed order's.
    clearCheckoutSession();
    // Forget this customer, keep the installation. On a shared kiosk the next
    // person would otherwise walk up to the previous customer's seat, film and
    // show time already filled in. Deliberately here and not earlier: the seat
    // is read back on this very screen, so clearing it before the customer
    // acknowledges would blank their own confirmation.
    clearCustomerData();
    // Return to screensaver
    navigate('/', { replace: true });
  };

  return (
    <div className="confirmation">
      <div className="confirmation__card">
        <span className="confirmation__mark" aria-hidden="true">
          <CheckIcon size={34} />
        </span>

        <h1 className="confirmation__title">Order placed</h1>
        <p className="confirmation__lede">
          Payment received. The counter is preparing your order now.
        </p>

        <dl className="confirmation__receipt">
          <div className="confirmation__row">
            <dt>Order reference</dt>
            <dd className="confirmation__ref">#{orderId}</dd>
          </div>
          {amountPaise !== null && (
            <div className="confirmation__row">
              <dt>Amount paid</dt>
              <dd className="confirmation__amount">{formatMoney(amountPaise / 100)}</dd>
            </div>
          )}
          {seatNumber && (
            <div className="confirmation__row">
              <dt>Delivering to</dt>
              <dd className="confirmation__seat">Seat {seatNumber}</dd>
            </div>
          )}
        </dl>

        <p className="confirmation__next">
          Quote this reference number when you collect your order.
        </p>

        <button className="btn btn--primary btn--lg btn--block" onClick={handleDone}>
          Done
        </button>
      </div>
    </div>
  );
}
