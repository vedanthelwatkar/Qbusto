import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { useCartStore } from '@/stores/cart.store';
import { useContextStore } from '@/stores/context.store';
import { useUIStore } from '@/stores/ui.store';
import { createOrderIdempotent } from '@/services/orders.service';
import { formatMoney } from '@/utils/formatMoney';
import { formatApiError } from '@/utils/formatApiError';
import { orderFingerprint, getOrCreateIdempotencyKey } from '@/utils/checkoutSession';
import { isoToLocalInput, localInputToIso, isValidLocalDateTime } from '@/utils/showTime';
import { AlertIcon, ChevronLeftIcon, LockIcon } from '@/components/icons';
import type {
  PostApiConsumerOrdersBody,
  PostApiConsumerOrders201Data,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/checkout.scss';

/**
 * Seat identity is captured as row + seat but the API carries a single
 * `seatNumber` string (STRING(20)), so the two are joined as e.g. "A5".
 */
const ROW_PATTERN = /^[A-Za-z]{1,2}$/;
const SEAT_PATTERN = /^\d{1,3}$/;
const MOBILE_PATTERN = /^\d{10}$/;

const checkoutSchema = z.object({
  customerMobile: z
    .string()
    .min(1, 'WhatsApp Number is required')
    .refine(
      (val) => MOBILE_PATTERN.test(val),
      'Enter a valid 10-digit WhatsApp number'
    ),
  rowNumber: z
    .string()
    .min(1, 'Row number is required')
    .refine((val) => ROW_PATTERN.test(val), 'Enter a valid row, for example A'),
  seatNumber: z
    .string()
    .min(1, 'Seat number is required')
    .refine((val) => SEAT_PATTERN.test(val), 'Enter a valid seat number, for example 5'),
  showTime: z
    .string()
    .min(1, 'Please select valid show time.')
    .refine((val) => isValidLocalDateTime(val), 'Please select valid show time.'),
  customerEmail: z
    .string()
    .optional()
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      'Invalid email format'
    ),
  // No screenId/filmTitle here: they are no longer user-editable. Both still
  // travel on the order, taken from the context store where the QR put them.
});

type CheckoutFormData = z.infer<typeof checkoutSchema>;

interface CheckoutState {
  createdOrder: PostApiConsumerOrders201Data | null;
}

/** Split a stored seat such as "A5" back into its row and seat parts. */
function splitSeat(seat: string | null): { row: string; seat: string } {
  if (!seat) return { row: '', seat: '' };
  const match = seat.trim().match(/^([A-Za-z]{1,2})\s*(\d{1,3})$/);
  if (!match) return { row: '', seat: '' };
  return { row: match[1].toUpperCase(), seat: match[2] };
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const cartIsEmpty = useCartStore((state) => state.isEmpty());
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal());
  const cinemaId = useContextStore((state) => state.cinemaId) as number;
  const screenId = useContextStore((state) => state.screenId);
  const seatNumber = useContextStore((state) => state.seatNumber);
  const showTime = useContextStore((state) => state.showTime);
  const filmTitle = useContextStore((state) => state.filmTitle);
  const source = useContextStore((state) => state.source);
  const setError = useUIStore((state) => state.setError);

  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    createdOrder: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const prefilledSeat = splitSeat(seatNumber);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    // RHF focuses the first invalid control on a failed submit by default
    // (shouldFocusError), which is what we want here.
    defaultValues: {
      customerMobile: '',
      customerEmail: '',
      rowNumber: prefilledSeat.row,
      seatNumber: prefilledSeat.seat,
      // QR supplies an absolute ISO instant; the control needs local wall-clock.
      showTime: isoToLocalInput(showTime),
    },
  });

  // Navigate to payment after successful order creation
  useEffect(() => {
    if (checkoutState.createdOrder?.orderId) {
      sessionStorage.setItem(
        'qbusto_order_id',
        checkoutState.createdOrder.orderId.toString()
      );
      const timeoutId = setTimeout(() => {
        navigate('/payment', { replace: true });
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [checkoutState.createdOrder?.orderId, navigate]);

  // Redirect to catalog if cart is empty
  useEffect(() => {
    if (cartIsEmpty && !checkoutState.createdOrder) {
      navigate('/catalog', { replace: true });
    }
  }, [cartIsEmpty, checkoutState.createdOrder, navigate]);

  const onSubmit = async (data: CheckoutFormData) => {
    setIsSubmitting(true);
    setLocalError(null);

    try {
      const orderData: PostApiConsumerOrdersBody = {
        cinemaId,
        // From the context store (QR), no longer from a form field. The order
        // contract is unchanged; only the manual inputs were removed.
        screenId,
        seatNumber: `${data.rowNumber.toUpperCase()}${data.seatNumber}`,
        source,
        customerMobile: data.customerMobile,
        customerEmail: data.customerEmail || null,
        filmTitle: filmTitle || null,
        showTime: localInputToIso(data.showTime),
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      };

      // Derived from the payload actually being sent, so resubmitting the same
      // order reuses the key (no duplicate) while any correction to the cart or
      // the details starts a new attempt and is not replayed as the old order.
      const idempotencyKey = getOrCreateIdempotencyKey(
        orderFingerprint(orderData),
        uuidv4
      );

      const orderResponse = await createOrderIdempotent(orderData, idempotencyKey);

      // A 2xx with no order body would otherwise leave the form locked forever,
      // since isSubmitting is intentionally not reset on the success path.
      if (!orderResponse?.orderId) {
        setLocalError('We could not confirm your order. Please try again.');
        setIsSubmitting(false);
        return;
      }

      // Navigation handled by useEffect watching createdOrder. isSubmitting is
      // deliberately left true: the order exists, and re-enabling the form
      // during the navigation delay would invite a second submit.
      setCheckoutState((prev) => ({
        ...prev,
        createdOrder: orderResponse,
      }));
    } catch (err) {
      const message = formatApiError(err);
      setLocalError(message);
      setError(message);
      setIsSubmitting(false);
    }
  };

  const itemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const orderPlaced = Boolean(checkoutState.createdOrder?.orderId);
  const busy = isSubmitting || orderPlaced;

  return (
    <div className="checkout">
      <header className="checkout__topbar">
        <button
          type="button"
          className="checkout__back"
          onClick={() => navigate('/catalog')}
          disabled={busy}
        >
          <ChevronLeftIcon size={18} />
          Menu
        </button>
        <span className="checkout__step">Step 1 of 2</span>
      </header>

      <div className="checkout__layout">
        <main className="checkout__main">
          <div className="checkout__intro">
            <h1 className="checkout__title">Almost there</h1>
            <p className="checkout__lede">
              Tell us where you are sitting so we can bring your order to your seat.
            </p>
          </div>

          {localError && (
            <div className="alert alert--error" role="alert">
              <AlertIcon size={18} />
              <p>{localError}</p>
            </div>
          )}

          <form className="checkout__form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <fieldset className="checkout__group" disabled={busy}>
              <legend className="checkout__group-title">Contact</legend>
              <p className="checkout__group-hint">
                We use this to reach you about your order.
              </p>

              <div className="checkout__fields">
                <div className="field">
                  <label className="field__label" htmlFor="mobile">
                    WhatsApp No. <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="10-digit number"
                    aria-required="true"
                    aria-invalid={errors.customerMobile ? 'true' : undefined}
                    aria-describedby={errors.customerMobile ? 'mobile-error' : undefined}
                    {...register('customerMobile')}
                  />
                  {errors.customerMobile && (
                    <span className="field__error" id="mobile-error">
                      {errors.customerMobile.message}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="email">
                    Email <span className="field__optional">Optional</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    aria-invalid={errors.customerEmail ? 'true' : undefined}
                    aria-describedby={errors.customerEmail ? 'email-error' : undefined}
                    {...register('customerEmail')}
                  />
                  {errors.customerEmail && (
                    <span className="field__error" id="email-error">
                      {errors.customerEmail.message}
                    </span>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className="checkout__group" disabled={busy}>
              <legend className="checkout__group-title">Your seat</legend>
              <p className="checkout__group-hint">
                Prefilled from your QR code where available.
              </p>

              <div className="checkout__fields checkout__fields--pair">
                <div className="field">
                  <label className="field__label" htmlFor="row">
                    Row No. <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="row"
                    type="text"
                    autoCapitalize="characters"
                    maxLength={2}
                    placeholder="A"
                    aria-required="true"
                    aria-invalid={errors.rowNumber ? 'true' : undefined}
                    aria-describedby={errors.rowNumber ? 'row-error' : undefined}
                    {...register('rowNumber')}
                  />
                  {errors.rowNumber && (
                    <span className="field__error" id="row-error">
                      {errors.rowNumber.message}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="seat">
                    Seat No. <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="seat"
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="5"
                    aria-required="true"
                    aria-invalid={errors.seatNumber ? 'true' : undefined}
                    aria-describedby={errors.seatNumber ? 'seat-error' : undefined}
                    {...register('seatNumber')}
                  />
                  {errors.seatNumber && (
                    <span className="field__error" id="seat-error">
                      {errors.seatNumber.message}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="showtime">
                    Show Time <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="showtime"
                    type="datetime-local"
                    aria-required="true"
                    aria-invalid={errors.showTime ? 'true' : undefined}
                    aria-describedby={errors.showTime ? 'showtime-error' : undefined}
                    {...register('showTime')}
                  />
                  {errors.showTime && (
                    <span className="field__error" id="showtime-error">
                      {errors.showTime.message}
                    </span>
                  )}
                </div>

              </div>
            </fieldset>

            <div className="checkout__actions">
              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner spinner--sm spinner--on-primary" />
                    {orderPlaced ? 'Taking you to payment…' : 'Placing your order…'}
                  </>
                ) : (
                  'Place Order'
                )}
              </button>
              <p className="checkout__secure">
                <LockIcon size={14} />
                Payment is processed securely by Razorpay.
              </p>
            </div>
          </form>
        </main>

        <aside className="checkout__aside" aria-label="Order summary">
          <div className="checkout__summary">
            <div className="checkout__summary-head">
              <h2 className="checkout__summary-title">Your order</h2>
              <span className="checkout__summary-count">
                {itemCount === 1 ? '1 item' : `${itemCount} items`}
              </span>
            </div>

            <ul className="checkout__lines">
              {cartItems.map((item) => (
                <li key={item.productId} className="checkout__line">
                  <span className="checkout__line-qty">{item.quantity}×</span>
                  <span className="checkout__line-name">{item.productName}</span>
                  <span className="checkout__line-price">
                    {formatMoney(item.quantity * item.unitPrice)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="checkout__total">
              <span className="checkout__total-label">Estimated subtotal</span>
              <span className="checkout__total-value">{formatMoney(estimatedSubtotal)}</span>
            </div>

            <p className="checkout__total-note">
              Taxes and any discounts are applied by the cinema when your order is
              confirmed. The final amount is shown on the payment screen.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
