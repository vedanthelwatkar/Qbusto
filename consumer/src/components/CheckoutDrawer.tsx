import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

import { useCartStore } from "@/stores/cart.store";
import { useContextStore } from "@/stores/context.store";
import { useUIStore } from "@/stores/ui.store";
import StatePanel from "@/components/StatePanel";
import Thumbnail from "@/components/Thumbnail";
import { formatMoney } from "@/utils/formatMoney";
import { mapCheckoutError } from "@/utils/checkoutErrors";
import { fetchCinema, fetchSessions } from "@/services/catalog.service";
import { placeOrder, previewCoupon } from "@/services/orders.service";
import type { ConsumerSession } from "@/api/generated/cinemaOrderingAPI.schemas";
import {
  AlertIcon,
  BagIcon,
  CloseIcon,
  LockIcon,
  MinusIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
} from "@/components/icons";
import "../styles/components/cart-drawer.scss";
import { formatTime } from "@/utils/datetime";

/** Everything inside the sheet that can hold focus. */
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Seat identity is captured as row + seat but the API carries a single
 * `seatNumber` string (STRING(20)), so the two are joined into e.g. "A5" at
 * that boundary only - the URL, this form and the context store all keep row
 * and seat apart.
 */
const ROW_PATTERN = /^[A-Za-z]{1,2}$/;
const SEAT_PATTERN = /^\d{1,3}$/;
const MOBILE_PATTERN = /^\d{10}$/;

/**
 * One selection stands in for screen, film and start time.
 *
 * Those are three columns on the order, but they are not three decisions: a
 * customer knows which screening they are sitting in, not which auditorium id
 * it maps to. Only the session id is validated here; the three values it
 * carries are read off the selected session at submit time, so they cannot
 * drift apart.
 */
const checkoutSchema = z.object({
  sessionId: z.string().min(1, "Please choose your show"),
  rowNumber: z
    .string()
    .min(1, "Row is required")
    .refine((val) => ROW_PATTERN.test(val), "Enter a valid row, for example A"),
  seatNumber: z
    .string()
    .min(1, "Seat is required")
    .refine(
      (val) => SEAT_PATTERN.test(val),
      "Enter a valid seat number, for example 5",
    ),
  customerMobile: z
    .string()
    .min(1, "WhatsApp number is required")
    .refine(
      (val) => MOBILE_PATTERN.test(val),
      "Enter a valid 10-digit WhatsApp number",
    ),
  customerEmail: z
    .string()
    .optional()
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      "Invalid email format",
    ),
});

type CheckoutFormData = z.infer<typeof checkoutSchema>;

/**
 * One option's label, e.g. "IMAX - Interstellar - 07:30 PM".
 *
 * Screen first, then film, then start time: the order the client's own
 * scheduling report uses, and the order a customer reads it in - they know
 * which auditorium they are sitting in before they think about the title.
 *
 * No date. The list spans at most six hours, so no clock time can repeat
 * within it and the time alone is unambiguous - even when the window crosses
 * midnight and the options are not all on the same calendar day.
 *
 * Rendered in the cinema's timezone, not the device's: a kiosk or phone set to
 * the wrong zone would otherwise offer the right shows under the wrong times.
 */
function sessionLabel(session: ConsumerSession): string {
  const time = formatTime(session.startsAt);

  // Joined on the parts that are present: a missing screen name or title must
  // not leave a stray separator, or produce an option labelled " - - 07:30 PM".
  return [session.screenName, session.filmTitle, time]
    .filter(Boolean)
    .join(" - ");
}

/**
 * The API failure fields that the picker is now responsible for.
 *
 * The backend still validates film and show time individually, so a
 * rejection can name either. There is no longer an input for them, and an
 * error attached to a field that is not on screen is an error the customer
 * never sees, so both are shown against the picker. The screen itself is no
 * longer one of these - an unresolved screen now surfaces as a `seatRow`
 * error, which `mapCheckoutError` already routes to the row input.
 */
const SESSION_FIELDS = new Set(["filmTitle", "showTime"]);

/**
 * Cart and checkout in one sheet over the catalogue.
 *
 * Checkout used to be its own route. Sending a customer to a separate page to
 * type their seat meant losing sight of what they were buying, and the page
 * carried a full form for values the backend treats as optional. Both now live
 * here, over a dimmed menu, so the order and the details are visible together.
 *
 * Payment is untouched. This creates the order and hands off to /payment
 * exactly as the checkout page did - the payment state machine, its recovery
 * and its reconciliation all still live there and are the only thing that
 * decides whether money moved.
 */
export default function CheckoutDrawer() {
  const navigate = useNavigate();

  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal);

  const cartOpen = useUIStore((state) => state.cartOpen);
  const toggleCart = useUIStore((state) => state.toggleCart);

  const cinemaId = useContextStore((state) => state.cinemaId) as number;
  /*
   * The screen the QR was printed for.
   *
   * Used ONLY to ask the backend which show is running on it right now (see
   * the sessions effect). It is deliberately never sent as the order's screen
   * - that is resolved from the chosen show's screen NAME plus the seat row,
   * because a QR's screenId is fixed at print time and, at a cinema whose
   * screen data is one row per seat row, points at a seat-row record rather
   * than an auditorium.
   */
  const screenId = useContextStore((state) => state.screenId);
  const contextRow = useContextStore((state) => state.row);
  const contextSeat = useContextStore((state) => state.seat);
  const filmTitle = useContextStore((state) => state.filmTitle);
  const source = useContextStore((state) => state.source);
  const setContext = useContextStore((state) => state.setContext);

  const [sessions, setSessions] = useState<ConsumerSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsFailed, setSessionsFailed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Coupon: validated ENTIRELY server-side (see previewCoupon) - this state
  // only remembers the last accepted answer to show it back to the customer.
  // The order itself re-validates the same code at creation, so a stale
  // `appliedCoupon` here can never actually apply a discount that is no
  // longer valid; it can only, at worst, show a discount on screen for a
  // moment before the cart is corrected.
  /*
   * Whether this cinema accepts coupon codes at all - `cinemas.offers_enabled`.
   * Defaults true (fail open): hiding the section is cosmetic, and
   * coupon.service.validateCoupon is the actual enforcement, so a stale or
   * failed fetch here cannot let a coupon through at a cinema with offers off.
   */
  const [offersEnabled, setOffersEnabled] = useState(true);
  const offersRequestedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!cartOpen || offersRequestedFor.current === cinemaId) return;

    offersRequestedFor.current = cinemaId;
    fetchCinema(cinemaId).then(
      (cinema) => {
        if (offersRequestedFor.current !== cinemaId) return;
        setOffersEnabled(cinema.offersEnabled !== false);
      },
      () => {
        // Leave it at the fail-open default; retry next time the sheet opens.
        offersRequestedFor.current = null;
      },
    );
  }, [cartOpen, cinemaId]);

  const [couponInput, setCouponInput] = useState("");
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** The control that opened the sheet, so focus can be handed back to it. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const subtotal = estimatedSubtotal();
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  // Row and seat arrive already separated, so there is nothing to split.
  const prefilledSeat = { row: contextRow ?? "", seat: contextSeat ?? "" };

  const couponDiscount = appliedCoupon?.discount ?? 0;
  // Display only - the backend recomputes this independently at order
  // creation from the same items/coupon, and that computation is the one
  // that actually decides what the customer pays.
  const estimatedTotal = Math.max(0, subtotal - couponDiscount);

  /**
   * The cart fingerprint an applied coupon's discount was validated against.
   * A discount computed for one cart is not necessarily still correct for a
   * different one (min/max cart value rules, a different subtotal for a
   * percentage coupon), so a coupon is cleared the moment the cart it was
   * checked against changes - never silently kept and shown against a total
   * it was never actually validated for. The order itself re-validates the
   * code again regardless, so this is a display correctness concern, not a
   * security one.
   */
  const itemsFingerprint = items
    .map((item) => `${item.productId}:${item.quantity}`)
    .join(",");
  const appliedCouponFingerprintRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      sessionId: "",
      // Starts empty: the row is a dropdown of the CHOSEN show's rows, so
      // there is nothing to select until a show is picked (see the effect
      // below, which fills it in - from the URL context when possible).
      rowNumber: "",
      seatNumber: prefilledSeat.seat,
      customerMobile: "",
      customerEmail: "",
    },
  });

  /**
   * Which cinema's sessions have been requested.
   *
   * A ref, not state, and deliberately not an effect dependency. Tracking
   * "already asked" in state would put a value the effect writes into its own
   * dependency list: setting it would re-run the effect, the re-run would tear
   * down the first one, and the response it discarded would never arrive.
   */
  const sessionsRequestedFor = useRef<number | null>(null);

  /**
   * Load the cinema's sessions the first time the sheet is opened.
   *
   * Deferred until then rather than fetched with the catalogue: most customers
   * browse without opening the cart, and the list is only ever read here.
   *
   * There is no cleanup that cancels the request. Closing the sheet does not
   * abandon the load - the customer is very likely to reopen it, and the list
   * is the same either way. A response is only dropped when it is genuinely
   * stale, meaning the cinema changed while it was in flight.
   */
  useEffect(() => {
    if (!cartOpen || sessionsRequestedFor.current === cinemaId) return;

    sessionsRequestedFor.current = cinemaId;
    setSessionsLoading(true);
    setSessionsFailed(false);

    /*
     * The QR's screen goes with the request.
     *
     * It is the only input the auto-selection takes from this device: the
     * server matches it to an auditorium, checks its OWN clock against each
     * screening's start and end, and flags the one running now. Sending a time
     * from here instead would let a phone with a wrong clock pick the wrong
     * show.
     */
    fetchSessions(cinemaId, screenId).then(
      (loaded) => {
        if (sessionsRequestedFor.current !== cinemaId) return;
        setSessions(loaded);
        setSessionsLoading(false);

        /*
         * PRESELECT THE SHOW THE CUSTOMER IS SITTING IN.
         *
         * `isCurrent` is the server's answer, not a guess made here - at most
         * one session in the list carries it. Only ever applied to an EMPTY
         * field, so a customer who has already chosen a different show does
         * not have their choice overwritten when the list refreshes.
         *
         * When nothing is running - between shows, or a QR with no screen -
         * the field stays empty and the customer picks, exactly as before.
         */
        const current = loaded.find((candidate) => candidate.isCurrent);

        if (current?.id !== undefined && !getValues("sessionId")) {
          setValue("sessionId", String(current.id), { shouldValidate: false });
        }
      },
      () => {
        if (sessionsRequestedFor.current !== cinemaId) return;
        setSessionsFailed(true);
        setSessionsLoading(false);
        // Clear the marker so reopening the sheet retries rather than sitting
        // on a failure the customer cannot get past.
        sessionsRequestedFor.current = null;
      },
    );
  }, [cartOpen, cinemaId, screenId, getValues, setValue]);

  /**
   * Whether the order is in flight, readable from the keydown handler without
   * being an effect dependency.
   *
   * The handler needs the current value to refuse Escape mid-submit. Listing
   * `submitting`/`placed` as dependencies instead made the whole effect re-run
   * on every submit and every failure: it would re-capture an element inside
   * the sheet as the focus-return target and pull focus back to the close
   * button, stealing it from the field the failure was just reported on.
   */
  const busyRef = useRef(false);

  // Kept in step with the state the handler reports on, so the ref is never a
  // stale copy of it.
  useEffect(() => {
    busyRef.current = submitting || placed;
  }, [submitting, placed]);

  /**
   * The sheet is a modal: it covers the page behind an overlay, so it has to
   * behave like one - focus starts inside it, Tab cannot leave it, and Escape
   * closes it.
   */
  useEffect(() => {
    if (!cartOpen) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button rather than the panel: it is the reliable escape
    // route, and it reads the sheet's label on the way in.
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Never while the order is being placed: the request is already in
        // flight, and closing here would hide the outcome of it.
        if (busyRef.current) return;
        event.preventDefault();
        toggleCart();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      /**
       * Focus can end up outside the sheet without the customer moving it:
       * removing the last cart item unmounts the button they just pressed and
       * the browser drops focus to <body>. Treating that as "at the boundary"
       * pulls it back in on the next Tab in either direction.
       */
      const outside = !panelRef.current.contains(active);

      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cartOpen, toggleCart]);

  // Hand focus back to whatever opened the sheet. Split from the effect above
  // so it runs on close only and never fights the focus call on open.
  useEffect(() => {
    if (cartOpen) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // Only if it is still in the document - the opener may have unmounted.
    if (target && document.contains(target)) target.focus();
  }, [cartOpen]);

  const selectedSession = sessions.find(
    (session) => String(session.id) === watch("sessionId"),
  );

  /**
   * Keeps the row dropdown's value in sync with the rows the CURRENT show
   * actually has, rather than a value left over from a different show (or
   * from before any show was chosen).
   *
   * - No show picked, or the show has no known rows (seatRows empty - a
   *   cinema whose screen data doesn't carry rows): the field is cleared.
   * - The value already selected is still one of this show's rows (e.g. the
   *   customer flips between two shows on the same screen): left alone.
   * - Otherwise: prefilled from the row the QR/URL supplied, when that row is
   *   actually one of this show's, else left empty for the customer to pick.
   */
  useEffect(() => {
    const rows = selectedSession?.seatRows ?? [];
    const current = getValues("rowNumber");

    if (rows.length === 0) {
      if (current) setValue("rowNumber", "");
      return;
    }

    if (current && rows.includes(current)) return;

    const fromContext = prefilledSeat.row.toUpperCase();
    setValue("rowNumber", rows.includes(fromContext) ? fromContext : "");
  }, [selectedSession, getValues, setValue, prefilledSeat.row]);

  // See the fingerprint comment above `itemsFingerprint`: a coupon applied
  // against a cart that has since changed is cleared rather than shown
  // against a total it was never actually checked for.
  useEffect(() => {
    if (!appliedCoupon) return;
    if (appliedCouponFingerprintRef.current === itemsFingerprint) return;

    setAppliedCoupon(null);
    setCouponMessage("Your cart changed, so please re-apply your coupon.");
    // Reacting to external state (the cart store) changing, not to a plain
    // render. This previously carried an eslint-disable for
    // react-hooks/set-state-in-effect; the rule no longer reports here, and
    // keeping a dead directive is itself a lint warning.
  }, [itemsFingerprint, appliedCoupon]);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;

    setCouponChecking(true);
    setCouponMessage(null);

    try {
      /*
       * The seat as the FORM currently holds it, not as the context store
       * holds it.
       *
       * It is evidence for a `seat_qr` source, and the backend derives that
       * source from the seat the ORDER carries - which is this form's row and
       * seat, joined the same way submit joins them below. Reading the store
       * instead would preview against a seat the customer may have just
       * changed, and the previewed subtotal would then not be the one they
       * are charged. Partial input yields no seat, exactly as submit's join
       * of an incomplete pair would.
       */
      const previewRow = getValues("rowNumber")?.trim().toUpperCase();
      const previewSeat = getValues("seatNumber")?.trim();
      const previewSeatLabel =
        previewRow && previewSeat ? `${previewRow}${previewSeat}` : null;

      const result = await previewCoupon(
        cinemaId,
        code,
        items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        source,
        previewSeatLabel,
      );

      if (result.valid && result.discount != null) {
        appliedCouponFingerprintRef.current = itemsFingerprint;
        setAppliedCoupon({ code, discount: result.discount });
        setCouponInput("");
      } else {
        setAppliedCoupon(null);
        setCouponMessage(result.message || "This coupon is not valid");
      }
    } catch {
      setAppliedCoupon(null);
      setCouponMessage(
        "Could not check this coupon right now. Please try again.",
      );
    } finally {
      setCouponChecking(false);
    }
  };

  const handleRemoveCoupon = () => {
    appliedCouponFingerprintRef.current = null;
    setAppliedCoupon(null);
    setCouponMessage(null);
  };

  const onSubmit = async (data: CheckoutFormData) => {
    const session = sessions.find(
      (candidate) => String(candidate.id) === data.sessionId,
    );

    // The picker is populated from the same list this reads, so this is a
    // guard rather than an expected path - but submitting without it would
    // send an order with no film or time and no error to explain why.
    if (!session || !session.filmTitle || !session.startsAt) {
      setError(
        "sessionId",
        { type: "manual", message: "Please choose your show" },
        { shouldFocus: true },
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const submittedRow = data.rowNumber.toUpperCase();
    const submittedSeat = data.seatNumber;
    // Joined only here, for the order payload's single seat column. Everything
    // upstream - URL, context store, form - keeps the two apart.
    const seatLabel = `${submittedRow}${submittedSeat}`;

    try {
      const order = await placeOrder(
        {
          cinemaId,
          // The auditorium is resolved server-side from these two - never
          // sent as an id (see consumer.service.resolveScreenId). There is
          // deliberately NO fallback to the QR's own screenId: a QR is
          // printed with whatever screens row existed at the time, and for a
          // cinema whose screen data is one row per SEAT ROW that value is a
          // seat-row record, not an auditorium.
          // The screening itself. Everything the backend needs about the show
          // is read from this row server-side; the three fields below are the
          // no-session fallback and are ignored when this is present.
          sessionId: session.id ?? null,
          screenName: session.screenName ?? null,
          seatRow: submittedRow,
          // Film and show time come off the one selected session, so they
          // cannot disagree with each other.
          filmTitle: session.filmTitle,
          showTime: new Date(session.startsAt).toISOString(),
          seatNumber: seatLabel,
          customerMobile: data.customerMobile,
          customerEmail: data.customerEmail || null,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          source,
          couponCode: appliedCoupon?.code ?? null,
        },
        uuidv4,
      );

      // A 2xx with no order body would otherwise leave the sheet locked
      // forever, since `placed` is what releases it.
      if (!order?.orderId) {
        setFormError("We could not confirm your order. Please try again.");
        setSubmitting(false);
        return;
      }

      // Align the stored context with what the order was actually accepted
      // for, so the confirmation screen reads back the right seat and show.
      // Done only after the backend accepted it, so the context can never
      // claim a seat no order exists for.
      const contextChanges: Parameters<typeof setContext>[0] = {};
      if (submittedRow !== contextRow) contextChanges.row = submittedRow;
      if (submittedSeat !== contextSeat) contextChanges.seat = submittedSeat;
      if (session.filmTitle !== filmTitle)
        contextChanges.filmTitle = session.filmTitle;
      contextChanges.showTime = new Date(session.startsAt).toISOString();

      setContext(contextChanges);

      // The handoff to payment, unchanged from the checkout page: the order id
      // goes to sessionStorage and /payment owns everything after this point.
      sessionStorage.setItem("qbusto_order_id", order.orderId.toString());
      setPlaced(true);
      toggleCart();
      navigate("/payment", { replace: true });
    } catch (caught) {
      const mapped = mapCheckoutError(caught);

      if (mapped.field && SESSION_FIELDS.has(mapped.field)) {
        // Screen, film and time no longer have inputs of their own; the show
        // that supplied them does.
        setFormError(null);
        setError(
          "sessionId",
          { type: "server", message: mapped.message },
          { shouldFocus: true },
        );
      } else if (mapped.field) {
        setFormError(null);
        setError(
          mapped.field as keyof CheckoutFormData,
          { type: "server", message: mapped.message },
          { shouldFocus: true },
        );
      } else {
        setFormError(mapped.message);
      }

      setSubmitting(false);
    }
  };

  const busy = submitting || placed;

  return (
    <>
      {cartOpen && (
        <div
          className="cart-overlay"
          onClick={busy ? undefined : toggleCart}
          aria-hidden="true"
        />
      )}

      {/* The panel stays mounted so it can animate, so it must be hidden from
          assistive tech and the tab order while closed. */}
      <aside
        ref={panelRef}
        className={`cart-drawer${cartOpen ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!cartOpen}
        aria-labelledby="checkout-drawer-title"
      >
        <div className="cart-drawer__grabber" aria-hidden="true" />

        <header className="cart-drawer__header">
          <div className="cart-drawer__heading">
            <h2 className="cart-drawer__title" id="checkout-drawer-title">
              Your cart
            </h2>
            {itemCount > 0 && (
              <span className="cart-drawer__count">
                {itemCount === 1 ? "1 item" : `${itemCount} items`}
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            className="cart-drawer__close"
            onClick={toggleCart}
            disabled={busy}
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
            <div className="cart-drawer__scroll">
              <ul className="cart-drawer__items">
                {items.map((item) => (
                  <li key={item.productId} className="cart-drawer__item">
                    <Thumbnail
                      src={item.imageUrl}
                      alt=""
                      imgClassName="cart-drawer__item-image"
                      placeholderClassName="cart-drawer__item-image cart-drawer__item-image--empty"
                      iconSize={20}
                    />

                    <div className="cart-drawer__item-body">
                      <div className="cart-drawer__item-top">
                        <h3 className="cart-drawer__item-name">
                          {item.productName}
                        </h3>
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
                            type="button"
                            className="cart-drawer__step"
                            disabled={busy}
                            onClick={() =>
                              updateQuantity(item.productId, item.quantity - 1)
                            }
                            aria-label={
                              item.quantity === 1
                                ? `Remove ${item.productName} from cart`
                                : `Decrease quantity of ${item.productName}`
                            }
                          >
                            <MinusIcon size={18} />
                          </button>
                          <span className="cart-drawer__qty" aria-live="polite">
                            <span className="sr-only">
                              {item.productName} quantity:{" "}
                            </span>
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="cart-drawer__step"
                            disabled={busy}
                            onClick={() =>
                              updateQuantity(item.productId, item.quantity + 1)
                            }
                            aria-label={`Increase quantity of ${item.productName}`}
                          >
                            <PlusIcon size={18} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="cart-drawer__remove"
                          disabled={busy}
                          onClick={() => removeItem(item.productId)}
                          aria-label={`Remove ${item.productName} from cart`}
                        >
                          <TrashIcon size={18} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <form
                className="cart-drawer__form"
                id="checkout-drawer-form"
                onSubmit={handleSubmit(onSubmit)}
                noValidate
              >
                <fieldset className="cart-drawer__fields" disabled={busy}>
                  <legend className="sr-only">Your show and seat</legend>

                  <div className="field">
                    <label className="field__label" htmlFor="checkout-session">
                      Show{" "}
                      <span className="field__required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <select
                      id="checkout-session"
                      className="field__select"
                      aria-required="true"
                      aria-invalid={errors.sessionId ? "true" : undefined}
                      aria-describedby={
                        errors.sessionId ? "checkout-session-error" : undefined
                      }
                      {...register("sessionId")}
                    >
                      <option value="">
                        {sessionsLoading
                          ? "Loading shows…"
                          : "Select your show"}
                      </option>
                      {sessions.map((session) => (
                        <option key={session.id} value={String(session.id)}>
                          {sessionLabel(session)}
                        </option>
                      ))}
                    </select>
                    {errors.sessionId && (
                      <span
                        className="field__error"
                        id="checkout-session-error"
                      >
                        {errors.sessionId.message}
                      </span>
                    )}
                    {!sessionsLoading &&
                      !sessionsFailed &&
                      sessions.length === 0 && (
                        <span className="field__error">
                          No shows are scheduled at this cinema right now.
                          Please ask a member of staff.
                        </span>
                      )}
                    {sessionsFailed && (
                      <span className="field__error">
                        We could not load the show times. Close this and try
                        again.
                      </span>
                    )}
                  </div>

                  <div className="cart-drawer__fields-row">
                    <div className="field">
                      <label className="field__label" htmlFor="checkout-row">
                        Row{" "}
                        <span className="field__required" aria-hidden="true">
                          *
                        </span>
                      </label>
                      {/* Always a dropdown, driven by the CHOSEN show's own
                          rows (ConsumerSession.seatRows) - the row can then
                          only ever be one that actually resolves to an
                          auditorium. Disabled and empty until a show with
                          known rows is picked (see the effect above). */}
                      <select
                        id="checkout-row"
                        className="field__select"
                        aria-required="true"
                        disabled={
                          !selectedSession ||
                          selectedSession.seatRows?.length === 0
                        }
                        aria-invalid={errors.rowNumber ? "true" : undefined}
                        aria-describedby={
                          errors.rowNumber ? "checkout-row-error" : undefined
                        }
                        {...register("rowNumber")}
                      >
                        <option value="">
                          {!selectedSession
                            ? "Select a show first"
                            : selectedSession.seatRows?.length
                              ? "Select row"
                              : "No rows available"}
                        </option>
                        {(selectedSession?.seatRows ?? []).map((row) => (
                          <option key={row} value={row}>
                            {row}
                          </option>
                        ))}
                      </select>
                      {errors.rowNumber && (
                        <span className="field__error" id="checkout-row-error">
                          {errors.rowNumber.message}
                        </span>
                      )}
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor="checkout-seat">
                        Seat{" "}
                        <span className="field__required" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <input
                        id="checkout-seat"
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        placeholder="5"
                        aria-required="true"
                        aria-invalid={errors.seatNumber ? "true" : undefined}
                        aria-describedby={
                          errors.seatNumber ? "checkout-seat-error" : undefined
                        }
                        {...register("seatNumber")}
                      />
                      {errors.seatNumber && (
                        <span className="field__error" id="checkout-seat-error">
                          {errors.seatNumber.message}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="checkout-mobile">
                      WhatsApp No.{" "}
                      <span className="field__required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <input
                      id="checkout-mobile"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="10-digit number"
                      aria-required="true"
                      aria-invalid={errors.customerMobile ? "true" : undefined}
                      aria-describedby={
                        errors.customerMobile
                          ? "checkout-mobile-error"
                          : undefined
                      }
                      {...register("customerMobile")}
                    />
                    {errors.customerMobile && (
                      <span className="field__error" id="checkout-mobile-error">
                        {errors.customerMobile.message}
                      </span>
                    )}
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="checkout-email">
                      Email <span className="field__optional">Optional</span>
                    </label>
                    <input
                      id="checkout-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      aria-invalid={errors.customerEmail ? "true" : undefined}
                      aria-describedby={
                        errors.customerEmail
                          ? "checkout-email-error"
                          : undefined
                      }
                      {...register("customerEmail")}
                    />
                    {errors.customerEmail && (
                      <span className="field__error" id="checkout-email-error">
                        {errors.customerEmail.message}
                      </span>
                    )}
                  </div>
                </fieldset>

                {formError && (
                  <div className="alert alert--error" role="alert">
                    <AlertIcon size={18} />
                    <p>{formError}</p>
                  </div>
                )}
              </form>

              {/*
                Last in the sheet, after the order details.
                Position only - this is the same block, with the same state and
                the same handlers. It sits OUTSIDE the <form> exactly as it did
                before, so its Enter key is still handled manually and the Apply
                button still cannot submit the checkout.
              */}
              {offersEnabled && (
                <div className="cart-drawer__coupon">
                  {appliedCoupon ? (
                    <div className="cart-drawer__coupon-applied">
                      <span className="cart-drawer__coupon-applied-text">
                        <TagIcon size={16} />
                        <strong>{appliedCoupon.code}</strong> applied · −
                        {formatMoney(couponDiscount)}
                      </span>
                      <button
                        type="button"
                        className="cart-drawer__coupon-remove"
                        onClick={handleRemoveCoupon}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="cart-drawer__coupon-input">
                      <div className="field cart-drawer__coupon-field">
                        <label className="sr-only" htmlFor="checkout-coupon">
                          Coupon code
                        </label>
                        <input
                          id="checkout-coupon"
                          type="text"
                          placeholder="Have a coupon code?"
                          autoCapitalize="characters"
                          value={couponInput}
                          disabled={busy || couponChecking}
                          onChange={(event) => {
                            setCouponInput(event.target.value);
                            if (couponMessage) setCouponMessage(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleApplyCoupon();
                            }
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn--secondary cart-drawer__coupon-apply"
                        disabled={busy || couponChecking || !couponInput.trim()}
                        onClick={() => void handleApplyCoupon()}
                      >
                        {couponChecking ? (
                          <span className="spinner spinner--sm" />
                        ) : (
                          "Apply"
                        )}
                      </button>
                    </div>
                  )}
                  {couponMessage && (
                    <span className="cart-drawer__coupon-message" role="alert">
                      {couponMessage}
                    </span>
                  )}
                </div>
              )}
            </div>

            <footer className="cart-drawer__footer">
              {appliedCoupon && (
                <div className="cart-drawer__summary cart-drawer__summary--muted">
                  <span className="cart-drawer__summary-label">Subtotal</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
              )}
              {appliedCoupon && (
                <div className="cart-drawer__summary cart-drawer__summary--muted">
                  <span className="cart-drawer__summary-label">
                    Coupon ({appliedCoupon.code})
                  </span>
                  <span>−{formatMoney(couponDiscount)}</span>
                </div>
              )}
              <div className="cart-drawer__summary">
                <span className="cart-drawer__summary-label">
                  Total{" "}
                  <span className="cart-drawer__summary-count">
                    · {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                </span>
                <span className="cart-drawer__summary-value">
                  {formatMoney(estimatedTotal)}
                </span>
              </div>
              {/*
                One line, not two: the show and the tax disclaimer used to be
                separate paragraphs, each carrying its own margin, which is
                what was pushing the Pay button out of view on a short phone
                screen. Combined into one line, and led with the session -
                real, already-computed data - rather than opening on the
                generic disclaimer.
              */}
              <p className="cart-drawer__note">
                {selectedSession && `${sessionLabel(selectedSession)} · `}
                Taxes may apply. Final amount shown at payment.
              </p>

              <button
                type="submit"
                form="checkout-drawer-form"
                className="btn btn--primary btn--block"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner spinner--sm spinner--on-primary" />
                    {placed ? "Taking you to payment…" : "Placing your order…"}
                  </>
                ) : (
                  "Proceed to Pay"
                )}
              </button>
              <p className="cart-drawer__secure">
                <LockIcon size={14} />
                Payment is processed securely by Cashfree.
              </p>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
