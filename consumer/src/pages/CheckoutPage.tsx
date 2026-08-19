import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { useCartStore } from '@/stores/cart.store';
import { useContextStore } from '@/stores/context.store';
import { createOrderIdempotent } from '@/services/orders.service';
import { formatMoney } from '@/utils/formatMoney';
import { mapCheckoutError } from '@/utils/checkoutErrors';
import { orderFingerprint, getOrCreateIdempotencyKey } from '@/utils/checkoutSession';
import { isoToLocalInput, localInputToIso, isValidLocalDateTime } from '@/utils/showTime';
import { AlertIcon, ChevronDownIcon, ChevronLeftIcon, LockIcon } from '@/components/icons';
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

/**
 * The screen is identified by its numeric id, because that is what the order
 * carries - `orders.screen_id` is a foreign key, not a name.
 *
 * Entered as a number for now. The backend resolves it against the current
 * cinema and answers "Screen not found" if it does not belong there, so a
 * wrong number fails clearly rather than attaching the order to the wrong
 * auditorium. A picker listing the cinema's screens by name is the intended
 * replacement; it needs a public endpoint that does not exist yet.
 */
const SCREEN_ID_PATTERN = /^\d{1,9}$/;

/** orders.film_title is VARCHAR(200). */
const FILM_TITLE_MAX = 200;

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
  screenId: z
    .string()
    .min(1, 'Screen number is required')
    .refine((val) => SCREEN_ID_PATTERN.test(val.trim()), 'Enter the screen number, for example 3')
    // Zero is rejected here rather than left to the backend, which treats a
    // falsy screenId as "no screen given" and stores null. Without this a
    // customer typing 0 into a required field gets an order with no screen and
    // no error to tell them.
    .refine((val) => Number(val.trim()) >= 1, 'Screen number must be 1 or higher'),
  filmTitle: z
    .string()
    // Checked on the trimmed value: a string of spaces satisfies a plain
    // minimum length, then trims to empty on submit, and the backend stores
    // null for it - the same silent loss of a required field.
    .refine((val) => val.trim().length > 0, 'Film name is required')
    .refine(
      (val) => val.trim().length <= FILM_TITLE_MAX,
      `Film name must be ${FILM_TITLE_MAX} characters or fewer`
    ),
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
  // Screen and film are entered here and prefilled from the QR context where
  // it supplied them, so a customer who scanned a generic lobby code can still
  // say which auditorium and film the order is for.
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
  const setContext = useContextStore((state) => state.setContext);

  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    createdOrder: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  /**
   * Mobile only. The summary sits above the form on a phone, so a long cart
   * pushed the first input below the fold — the customer had to scroll past
   * what they were buying before they could start typing. Collapsed by
   * default, with the count and total still on the header so nothing the
   * customer needs at a glance is hidden. CSS forces it open on desktop,
   * where the summary is a sidebar and there is nothing to save.
   */
  const [summaryOpen, setSummaryOpen] = useState(false);

  const prefilledSeat = splitSeat(seatNumber);

  const {
    register,
    handleSubmit,
    setError,
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
      // Prefilled from the QR context when it carried them; empty otherwise.
      screenId: screenId ? String(screenId) : '',
      filmTitle: filmTitle ?? '',
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

    // What the customer actually asked for, which is not necessarily what the
    // QR said — the seat fields are editable precisely so it can be corrected.
    const submittedSeat = `${data.rowNumber.toUpperCase()}${data.seatNumber}`;
    const submittedScreenId = Number(data.screenId.trim());
    const submittedFilmTitle = data.filmTitle.trim();

    try {
      const orderData: PostApiConsumerOrdersBody = {
        cinemaId,
        // What the customer entered, which is not necessarily what the QR
        // said - the fields are editable so a generic lobby code can still be
        // corrected to the right auditorium and film. The backend resolves
        // screenId against this cinema and rejects one that does not belong.
        screenId: submittedScreenId,
        seatNumber: submittedSeat,
        source,
        customerMobile: data.customerMobile,
        customerEmail: data.customerEmail || null,
        filmTitle: submittedFilmTitle,
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

      // Align the stored context with the seat the order was actually accepted
      // for. The QR value was only ever a prefill; leaving it in place meant
      // the confirmation screen read it back and told a customer who had
      // corrected their seat that the food was going to the original one.
      // Done only after the backend accepted the order, so the context can
      // never claim a seat that no order exists for.
      const contextChanges: Parameters<typeof setContext>[0] = {};
      if (submittedSeat !== seatNumber) contextChanges.seatNumber = submittedSeat;
      if (submittedScreenId !== screenId) contextChanges.screenId = submittedScreenId;
      if (submittedFilmTitle !== filmTitle) contextChanges.filmTitle = submittedFilmTitle;

      if (Object.keys(contextChanges).length > 0) {
        setContext(contextChanges);
      }

      // Navigation handled by useEffect watching createdOrder. isSubmitting is
      // deliberately left true: the order exists, and re-enabling the form
      // during the navigation delay would invite a second submit.
      setCheckoutState((prev) => ({
        ...prev,
        createdOrder: orderResponse,
      }));
    } catch (err) {
      /*
       * Put the failure where the customer can act on it.
       *
       * The backend rejects a screen that does not belong to this cinema, and
       * that is a wrong value in a specific box - showing it in the banner as
       * "Item not found" left the customer with no idea which field to fix.
       * Anything that is not about one input still goes to the banner above
       * the submit button.
       */
      const mapped = mapCheckoutError(err);

      if (mapped.field) {
        setLocalError(null);
        // shouldFocus moves the cursor to the offending input, matching how a
        // failed client-side validation behaves.
        setError(mapped.field, { type: 'server', message: mapped.message }, { shouldFocus: true });
      } else {
        setLocalError(mapped.message);
      }

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
        {/* Same information the bare "Step 1 of 2" carried, plus a glance-able
            sense of progress. The text stays for assistive tech. */}
        <span className="steps">
          <span className="steps__track" aria-hidden="true">
            <span className="steps__dot steps__dot--done" />
            <span className="steps__dot" />
          </span>
          <span className="steps__label">Step 1 of 2</span>
        </span>
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
              </div>
            </fieldset>

            {/* Its own group: a show time is not part of a seat, and grouping
                it under "Your seat" made the form read as though it were.
                The control, its validation and the submitted value are
                unchanged — only the heading it sits under moved. */}
            <fieldset className="checkout__group" disabled={busy}>
              <legend className="checkout__group-title">Your show</legend>
              <p className="checkout__group-hint">
                So the kitchen knows where to send your order and when. Prefilled
                from your QR code where available.
              </p>

              <div className="checkout__fields checkout__fields--pair">
                <div className="field">
                  <label className="field__label" htmlFor="screen">
                    Screen No. <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="screen"
                    type="text"
                    inputMode="numeric"
                    maxLength={9}
                    placeholder="3"
                    aria-required="true"
                    aria-invalid={errors.screenId ? 'true' : undefined}
                    aria-describedby={errors.screenId ? 'screen-error' : undefined}
                    {...register('screenId')}
                  />
                  {errors.screenId && (
                    <span className="field__error" id="screen-error">
                      {errors.screenId.message}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="film">
                    Film <span className="field__required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="film"
                    type="text"
                    maxLength={200}
                    placeholder="Avengers: Endgame"
                    aria-required="true"
                    aria-invalid={errors.filmTitle ? 'true' : undefined}
                    aria-describedby={errors.filmTitle ? 'film-error' : undefined}
                    {...register('filmTitle')}
                  />
                  {errors.filmTitle && (
                    <span className="field__error" id="film-error">
                      {errors.filmTitle.message}
                    </span>
                  )}
                </div>
              </div>

              <div className="checkout__fields">
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
            {/* Mobile header and disclosure control. Hidden on desktop, where
                the static head below takes over and the body is always open. */}
            <button
              type="button"
              className="checkout__summary-toggle"
              aria-expanded={summaryOpen}
              aria-controls="order-summary"
              onClick={() => setSummaryOpen((open) => !open)}
            >
              <span className="checkout__summary-title">Your order</span>
              <span className="checkout__summary-meta">
                <span className="checkout__summary-count">
                  {itemCount === 1 ? '1 item' : `${itemCount} items`}
                </span>
                <span className="checkout__summary-amount">
                  {formatMoney(estimatedSubtotal)}
                </span>
                <ChevronDownIcon size={18} className="checkout__summary-chevron" />
              </span>
            </button>

            <div
              id="order-summary"
              className={`checkout__summary-body${summaryOpen ? ' is-open' : ''}`}
            >
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
                <span className="checkout__total-value">
                  {formatMoney(estimatedSubtotal)}
                </span>
              </div>

              <p className="checkout__total-note">
                Taxes and any discounts are applied by the cinema when your order is
                confirmed. The final amount is shown on the payment screen.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
