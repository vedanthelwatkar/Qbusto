import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { initializePayment, verifyOrderPayment } from '@/services/orders.service';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import {
  clearAttempt,
  readAttempt,
  writeAttempt,
  type PaymentAttempt,
} from '@/utils/paymentAttempt';
import {
  INITIAL_PAYMENT_STATE,
  canCheckStatus,
  canStartNewPayment,
  isTerminal,
  reduce,
  type PaymentScreenState,
} from '@/utils/paymentState';
import {
  formatApiError,
  isSignatureVerificationFailure,
  readConflictPaymentStatus,
} from '@/utils/formatApiError';
import { formatMoney } from '@/utils/formatMoney';
import StatePanel from '@/components/StatePanel';
import { AlertIcon, ChevronLeftIcon, LockIcon } from '@/components/icons';
import type { PostApiConsumerOrdersOrderIdPaymentInit200Data } from '@/api/generated/cinemaOrderingAPI.schemas';
import type {
  RazorpayFailureResponse,
  RazorpayOptions,
  RazorpaySuccessResponse,
} from '@/types/razorpay';
import '../styles/pages/payment.scss';

/** How long to wait for the deferred Razorpay script before reporting failure. */
const SDK_WAIT_MS = 10000;
const SDK_POLL_MS = 150;

/**
 * How long verification may run before the copy escalates from "processing" to
 * "still checking". This changes wording only — it never concludes failure,
 * because a slow network says nothing about whether money moved.
 */
const SLOW_VERIFY_MS = 8000;

const ORDER_ID_KEY = 'qbusto_order_id';

/** Keep the Razorpay modal on the same brand colour as the app. */
function brandColor(): string {
  if (typeof window === 'undefined') return '#dc3c2c';
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-primary')
    .trim();
  return value || '#dc3c2c';
}

export default function PaymentPage() {
  const navigate = useNavigate();

  const [state, setState] = useState<PaymentScreenState>(INITIAL_PAYMENT_STATE);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [orderIdError, setOrderIdError] = useState<string | null>(null);
  const [paymentData, setPaymentData] =
    useState<PostApiConsumerOrdersOrderIdPaymentInit200Data | null>(null);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [razorpayTimedOut, setRazorpayTimedOut] = useState(false);
  const [slowVerify, setSlowVerify] = useState(false);
  /**
   * A status check is running. Purely for feedback, and separate from `phase`
   * on purpose: checking does not change what is known about the payment, so
   * it must not move the state machine. Without it the "Check payment status"
   * button sat inert for the whole request whenever there were no credentials
   * to verify, which reads as a dead button on a screen about money.
   */
  const [checking, setChecking] = useState(false);

  /**
   * The live state, for callbacks that outlive the render that created them.
   * The Razorpay handlers are registered once per attempt but fire much later,
   * and must decide what to do against the state as it is when they fire.
   */
  const stateRef = useRef(state);

  /** Serialises status checks so a retry cannot race an in-flight check. */
  const checkInFlight = useRef(false);
  /** True once this attempt got a result, so dismissal is not "cancelled". */
  const resultReceivedRef = useRef(false);
  /**
   * Read by `confirmPaid` instead of closing over `paymentData`. Keeping that
   * value out of the dependency chain matters: `confirmPaid` feeds
   * `resolveAttempt`, which feeds the recovery effect, and a dependency that
   * changes when payment-init resolves would re-run recovery for an attempt
   * that is already being resolved.
   */
  const paymentDataRef = useRef(paymentData);
  /** Recovery runs once per order, not once per render of its dependencies. */
  const recoveredOrderRef = useRef<number | null>(null);
  /**
   * Blocks payment-init when an attempt already exists for this order.
   *
   * A ref, not state, because both effects run in the same commit and would
   * otherwise read the same stale `state.phase`. The recovery effect sets this
   * synchronously before its `setState`, so the init effect below sees it on
   * the very first pass. Without it, arriving on this page with an unresolved
   * attempt would still initialise a payment and render a Pay button — the
   * exact double-charge this whole mechanism exists to prevent.
   */
  const attemptBlocksInitRef = useRef(false);
  /** Ensures payment-init runs once per order, without depending on `state`. */
  const initStartedRef = useRef(false);
  /**
   * Bumped by "Try again" to re-run the init effect.
   *
   * Necessary because that effect's other dependencies are all stable, so
   * clearing `initStartedRef` alone changed nothing and the effect never fired
   * again — the button looked live and did nothing, leaving the customer on an
   * error screen with no way to pay.
   */
  const [initAttempt, setInitAttempt] = useState(0);

  /**
   * Keep the mirrors current, in an effect rather than during render.
   *
   * Writing `ref.current` in the render body is a React rule violation: render
   * must be pure, and under StrictMode or a re-render that is later discarded
   * the write happens for a render that never commits. Syncing after commit is
   * both legal and sufficient here, because every reader is an asynchronous
   * callback — a Razorpay handler or a resolved request — which by definition
   * runs after the commit that produced the value it needs.
   */
  useEffect(() => {
    stateRef.current = state;
    paymentDataRef.current = paymentData;
  }, [state, paymentData]);

  const apply = useCallback((next: Parameters<typeof reduce>[1], expectedAttemptId?: string) => {
    setState((current) => reduce(current, next, expectedAttemptId));
  }, []);

  // Wait for the Razorpay SDK. The script is deferred so it may not be present
  // when this mounts; poll briefly rather than deciding once and giving up.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.Razorpay) {
      setRazorpayReady(true);
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (window.Razorpay) {
        window.clearInterval(intervalId);
        setRazorpayReady(true);
      } else if (Date.now() - startedAt >= SDK_WAIT_MS) {
        window.clearInterval(intervalId);
        setRazorpayTimedOut(true);
      }
    }, SDK_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  // Resolve the order id. Kept separate from any payment logic so a missing or
  // malformed id is reported as itself rather than as a payment failure.
  useEffect(() => {
    const stored = sessionStorage.getItem(ORDER_ID_KEY);
    if (!stored) {
      setOrderIdError('We could not find your order. Please start checkout again.');
      return;
    }

    const parsed = parseInt(stored, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setOrderIdError('We could not read your order. Please start checkout again.');
      return;
    }

    setOrderId(parsed);
  }, []);

  /**
   * Enter the terminal confirmed state and hand over to the confirmation page.
   *
   * Storage is cleared here, before navigating, but only on the backend's
   * word — this is the one place `confirmed` is reachable.
   */
  const confirmPaid = useCallback(
    (attempt: PaymentAttempt) => {
      clearAttempt();
      sessionStorage.removeItem(ORDER_ID_KEY);
      // This checkout attempt is finished. Leaving its key in storage would
      // make a later checkout of the same cart resolve to this already-paid
      // order, which then fails payment-init with 409 and strands the customer.
      clearCheckoutSession();

      setState({ phase: 'confirmed', message: null, attemptId: attempt.attemptId });

      navigate(`/confirmation/${attempt.orderId}`, {
        replace: true,
        // The attempt's own amount first: after a reload, recovery never ran
        // payment-init, so `paymentDataRef` is empty and only the persisted
        // value can tell the customer what they paid.
        state: { amount: attempt.amountPaise ?? paymentDataRef.current?.amount ?? null },
      });
    },
    [navigate]
  );

  /**
   * Ask the backend what actually happened to an interrupted attempt.
   *
   * This is the recovery path, and it is built only from what the existing API
   * can truthfully answer:
   *
   *  - With credentials, payment-verify is authoritative and idempotent. It
   *    either confirms the payment or rejects the signature. Re-sending them
   *    cannot take money a second time.
   *
   *  - Without credentials the only signal available is payment-init's 409,
   *    which carries the order's real payment status. A 200 means our backend
   *    still has the order pending — which is NOT proof the customer did not
   *    pay, only that we never received a confirmation. That case stays
   *    `unresolved` on purpose.
   *
   * payment-init is safe to call here: the order already has a razorpayOrderId
   * by the time any attempt exists, so it returns that same id rather than
   * creating anything. Verified against the running backend.
   */
  const resolveAttempt = useCallback(
    async (attempt: PaymentAttempt) => {
      if (checkInFlight.current) return;
      if (isTerminal(stateRef.current.phase)) return;
      checkInFlight.current = true;
      setChecking(true);

      try {
        if (attempt.credentials) {
          apply(
            {
              phase: 'verifying',
              message: 'Checking your payment. Please do not pay again.',
              attemptId: attempt.attemptId,
            },
            attempt.attemptId
          );

          await verifyOrderPayment(attempt.orderId, {
            razorpayPaymentId: attempt.credentials.paymentId,
            razorpaySignature: attempt.credentials.signature,
          });

          confirmPaid(attempt);
          return;
        }

        // No credentials: probe the order's authoritative status.
        await initializePayment(attempt.orderId);

        // 200 means still pending at our end. The customer may nonetheless
        // have paid at the provider, so this stays unknown rather than
        // becoming a failure or re-offering payment.
        apply(
          {
            phase: 'unresolved',
            message:
              'We have not been able to confirm this payment yet. Please do not pay again — show your order reference at the counter and they can check it for you.',
            attemptId: attempt.attemptId,
          },
          attempt.attemptId
        );
      } catch (error) {
        if (isSignatureVerificationFailure(error)) {
          writeAttempt({ ...attempt, phase: 'rejected' });
          apply(
            { phase: 'rejected', message: null, attemptId: attempt.attemptId },
            attempt.attemptId
          );
          return;
        }

        const status = readConflictPaymentStatus(error);
        if (status === 'paid') {
          confirmPaid(attempt);
          return;
        }

        if (status !== null) {
          // Resolved, and not paid (failed/refunded). Naming the status is not
          // useful to a customer, so the copy stays about what to do next.
          apply(
            {
              phase: 'unresolved',
              message:
                'This order could not be completed. Please show your order reference at the counter before paying again.',
              attemptId: attempt.attemptId,
            },
            attempt.attemptId
          );
          return;
        }

        // Could not reach the backend, or an unexpected error. The attempt is
        // still unknown; it must not be downgraded to a failure.
        apply(
          {
            phase: 'unresolved',
            // `navigator.onLine` decides the wording only. It is never treated
            // as evidence about the payment itself — both branches say the
            // same thing about the money, which is that we do not know yet.
            message: navigator.onLine
              ? 'We could not check your payment just now. Please do not pay again — try again in a moment.'
              : 'You appear to be offline, so we cannot check your payment yet. Please do not pay again — this will resume automatically when you reconnect.',
            attemptId: attempt.attemptId,
          },
          attempt.attemptId
        );
      } finally {
        checkInFlight.current = false;
        setChecking(false);
      }
    },
    [apply, confirmPaid]
  );

  /**
   * On arrival, an existing attempt takes priority over starting a new one.
   * This is what stops a reload mid-payment offering a second charge.
   */
  useEffect(() => {
    if (orderId === null) return;
    // Once per order. Without this the effect would re-enter recovery whenever
    // one of its dependencies was rebuilt, restarting a check already running.
    if (recoveredOrderRef.current === orderId) return;
    recoveredOrderRef.current = orderId;

    const attempt = readAttempt(orderId);
    if (!attempt) return;

    // Synchronous, before any setState: the init effect runs in this same
    // commit and would otherwise still see phase 'idle'.
    attemptBlocksInitRef.current = true;

    if (attempt.phase === 'rejected') {
      // Restored rather than re-checked: the signature is deterministic, so
      // re-sending it would fail identically and re-initialising would invite
      // a second charge for a payment that was never accepted.
      setState({ phase: 'rejected', message: null, attemptId: attempt.attemptId });
      return;
    }

    setState({
      phase: 'unresolved',
      message: 'Checking your payment. Please do not pay again.',
      attemptId: attempt.attemptId,
    });
    resolveAttempt(attempt);
  }, [orderId, resolveAttempt]);

  /**
   * Initialise payment — but only when there is no unresolved attempt.
   *
   * The phase guard is the safety property: `idle` is the only phase this may
   * fire from, so an order whose payment may already have been taken never
   * gets a fresh razorpay order and a fresh Pay button.
   *
   * The phase is read through `stateRef`, NOT from the reactive `state`, and is
   * deliberately absent from the dependency array. It used to be in there, and
   * that made the effect cancel its own request: calling `apply` moved the
   * phase to `initializing`, which changed the deps, which ran this effect's
   * cleanup and set `active = false` — so when payment-init finally answered,
   * the response was discarded and the screen sat on "Preparing your payment"
   * forever. `initStartedRef` provides the run-once guarantee instead, so the
   * effect no longer re-runs on the very state change it causes.
   */
  useEffect(() => {
    if (orderId === null) return;
    if (initStartedRef.current) return;
    // An attempt exists for this order, so a payment may already have been
    // taken. Recovery owns this page; do not arm a second one.
    if (attemptBlocksInitRef.current) return;
    if (stateRef.current.phase !== 'idle') return;

    initStartedRef.current = true;
    let active = true;
    apply({ phase: 'initializing', message: null });

    initializePayment(orderId)
      .then((response) => {
        if (!active) return;
        if (response.data) {
          setPaymentData(response.data);
          apply({ phase: 'ready', message: null });
        } else {
          apply({
            phase: 'error',
            message: 'We could not start the payment. Please try again.',
          });
        }
      })
      .catch((error) => {
        if (!active) return;

        // The order may already be settled — for instance the customer paid in
        // another tab. That is authoritative and must not be shown as an error.
        const status = readConflictPaymentStatus(error);
        if (status === 'paid') {
          apply({ phase: 'confirmed', message: null });
          clearAttempt();
          sessionStorage.removeItem(ORDER_ID_KEY);
          clearCheckoutSession();
          navigate(`/confirmation/${orderId}`, { replace: true, state: { amount: null } });
          return;
        }

        apply({ phase: 'error', message: formatApiError(error) });
      });

    return () => {
      // Only fires on unmount or a change of order now, never on this effect's
      // own state transition.
      active = false;
    };
  }, [orderId, apply, navigate, initAttempt]);

  /**
   * Escalate the wording of a long verification. Deliberately does not change
   * the phase: a slow check is still a check, and time alone proves nothing
   * about whether the payment succeeded.
   */
  useEffect(() => {
    if (state.phase !== 'verifying') {
      setSlowVerify(false);
      return;
    }
    const timeoutId = setTimeout(() => setSlowVerify(true), SLOW_VERIFY_MS);
    return () => clearTimeout(timeoutId);
  }, [state.phase]);

  /**
   * Resume an unresolved attempt when connectivity comes back.
   *
   * Event-driven rather than polled: one check per reconnection, guarded by
   * the same in-flight lock as every other check, so it can neither loop nor
   * race. `navigator.onLine` is used only as a trigger — the backend's answer
   * remains the source of truth.
   */
  useEffect(() => {
    if (orderId === null || state.phase !== 'unresolved') return;

    const onReconnect = () => {
      const attempt = readAttempt(orderId);
      if (attempt) resolveAttempt(attempt);
    };

    window.addEventListener('online', onReconnect);
    return () => window.removeEventListener('online', onReconnect);
  }, [orderId, state.phase, resolveAttempt]);

  /** Verify credentials the provider just returned. */
  const verifyPayment = useCallback(
    async (attempt: PaymentAttempt) => {
      apply(
        {
          phase: 'verifying',
          message: 'Confirming your payment. Please do not close this page.',
          attemptId: attempt.attemptId,
        },
        attempt.attemptId
      );

      try {
        await verifyOrderPayment(attempt.orderId, {
          razorpayPaymentId: attempt.credentials!.paymentId,
          razorpaySignature: attempt.credentials!.signature,
        });
        confirmPaid(attempt);
      } catch (error) {
        if (isSignatureVerificationFailure(error)) {
          writeAttempt({ ...attempt, phase: 'rejected' });
          apply(
            { phase: 'rejected', message: null, attemptId: attempt.attemptId },
            attempt.attemptId
          );
          return;
        }

        // Money has already moved. Anything other than an outright rejection
        // leaves the outcome unknown, never failed.
        apply(
          {
            phase: 'unresolved',
            message:
              'Your payment went through, but we could not confirm it. Please do not pay again — check the status below.',
            attemptId: attempt.attemptId,
          },
          attempt.attemptId
        );
      }
    },
    [apply, confirmPaid]
  );

  const handlePayNow = () => {
    if (!paymentData || !razorpayReady || orderId === null) return;
    if (!canStartNewPayment(state.phase)) return;

    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      apply({ phase: 'error', message: 'The payment window is not ready. Please reload.' });
      return;
    }

    const attempt: PaymentAttempt = {
      orderId,
      attemptId: uuidv4(),
      razorpayOrderId: paymentData.razorpayOrderId || '',
      phase: 'opened',
      amountPaise: paymentData.amount ?? undefined,
      startedAt: Date.now(),
    };

    // Recorded BEFORE the widget opens. From here on, a reload finds evidence
    // that a payment may have been taken and will not offer to take another.
    writeAttempt(attempt);
    resultReceivedRef.current = false;
    apply({ phase: 'opening', message: null, attemptId: attempt.attemptId });

    const options: RazorpayOptions = {
      key: paymentData.razorpayKeyId || '',
      amount: paymentData.amount ?? 0,
      currency: paymentData.currency || 'INR',
      order_id: paymentData.razorpayOrderId || '',
      name: 'Cinema Ordering',
      description: `Order #${orderId}`,

      handler: (response: RazorpaySuccessResponse) => {
        resultReceivedRef.current = true;
        const withCredentials: PaymentAttempt = {
          ...attempt,
          phase: 'returned',
          credentials: {
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          },
        };
        // Persisted before the request goes out: the money is already gone by
        // this point, and a reload mid-request must not lose the only thing
        // that can prove it.
        writeAttempt(withCredentials);
        verifyPayment(withCredentials);
      },

      prefill: { contact: '', email: '' },
      theme: { color: brandColor() },

      modal: {
        ondismiss: () => {
          // A dismissal only means "cancelled" when nothing else has happened.
          // It fires after a successful payment too, and previously overwrote
          // an in-flight verification with a cancellation notice.
          if (resultReceivedRef.current) return;
          if (stateRef.current.phase !== 'opening') return;

          // No result, so the widget was closed before paying. Money cannot
          // have moved via this path, which is why a new payment is offered.
          clearAttempt();
          apply(
            {
              phase: 'cancelled',
              message: 'Payment cancelled. Nothing has been charged.',
              attemptId: attempt.attemptId,
            },
            attempt.attemptId
          );
        },
      },
    };

    try {
      const rzp = new Razorpay(options);

      rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
        resultReceivedRef.current = true;

        // Razorpay's `description` is customer-facing copy. Use it when it is
        // a plausible string; never surface codes, sources or metadata.
        const description = response?.error?.description;
        const reason =
          typeof description === 'string' && description.trim() && description.length <= 160
            ? description.trim()
            : null;

        // An explicit provider failure is the one case where we know no charge
        // was captured, so the attempt record is cleared and paying again is
        // offered.
        clearAttempt();
        apply(
          {
            phase: 'failed',
            message: reason
              ? `Payment failed: ${reason} You can try again or use a different method.`
              : 'Payment failed. You can try again or use a different payment method.',
            attemptId: attempt.attemptId,
          },
          attempt.attemptId
        );
      });

      rzp.open();
    } catch {
      clearAttempt();
      apply({
        phase: 'error',
        message: 'We could not open the payment window. Please try again.',
        attemptId: attempt.attemptId,
      });
    }
  };

  /** Re-ask the backend about the current attempt. Never starts a payment. */
  const handleCheckStatus = () => {
    if (orderId === null) return;
    const attempt = readAttempt(orderId);
    if (attempt) {
      resolveAttempt(attempt);
      return;
    }
    // No record to check against — storage was cleared under us. Say so
    // rather than leaving a button that silently does nothing.
    apply({
      phase: 'unresolved',
      message: `We no longer have the details needed to check this payment. Please show order #${orderId} at the counter before paying again.`,
    });
  };

  /**
   * Leave an unresolved attempt without resolving it. The attempt record and
   * the order id stay in storage on purpose: this is "come back to it later",
   * not "give up", and returning to payment resumes the check.
   */
  const handleLeaveUnresolved = () => navigate('/catalog');

  /**
   * Start over after a failure where no money moved. Returning to `idle` is
   * what re-arms the payment-init effect; the machine only permits it from
   * phases that mean nothing was charged.
   */
  const handleTryAgain = () => {
    setPaymentData(null);
    initStartedRef.current = false;
    apply({ phase: 'idle', message: null });
    setInitAttempt((n) => n + 1);
  };

  const handleGoBack = () => navigate('/checkout');

  // --- Rendering ---------------------------------------------------------

  if (orderIdError) {
    return (
      <div className="payment">
        <StatePanel
          icon={<AlertIcon size={28} />}
          tone="error"
          title="We couldn't find your order"
          body={orderIdError}
          actions={
            <button
              className="btn btn--primary"
              onClick={() => navigate('/catalog', { replace: true })}
            >
              Back to the menu
            </button>
          }
        />
      </div>
    );
  }

  if (state.phase === 'rejected') {
    return (
      <div className="payment">
        <StatePanel
          icon={<AlertIcon size={28} />}
          tone="error"
          title="We couldn't verify this payment"
          body={
            <>
              Your payment could not be confirmed as genuine, so this order has not been
              completed. <strong>Please do not pay again.</strong> Show the reference below
              to the counter and they will check it for you.
            </>
          }
          actions={
            <button
              className="btn btn--primary"
              onClick={() => navigate('/', { replace: true })}
            >
              Back to home
            </button>
          }
        >
          <div className="payment__reference">
            <span className="payment__reference-label">Order reference</span>
            <span className="payment__reference-value">#{orderId}</span>
          </div>
        </StatePanel>
      </div>
    );
  }

  if (state.phase === 'initializing' && !paymentData) {
    return (
      <div className="payment">
        <StatePanel spinner role="status" title="Preparing your payment" body="This only takes a moment." />
      </div>
    );
  }

  const amountInRupees = paymentData?.amount ? paymentData.amount / 100 : 0;
  const busy = state.phase === 'verifying' || state.phase === 'opening';
  const unresolved = state.phase === 'unresolved';
  const showPayButton = canStartNewPayment(state.phase) && Boolean(paymentData);

  return (
    <div className="payment">
      <header className="payment__topbar">
        <button
          type="button"
          className="payment__back"
          onClick={handleGoBack}
          // Leaving mid-payment would strand an attempt that may have taken
          // money, so the way out is closed until the outcome is known.
          disabled={busy || unresolved}
        >
          <ChevronLeftIcon size={18} />
          Details
        </button>
        <span className="steps">
          <span className="steps__track" aria-hidden="true">
            <span className="steps__dot steps__dot--done" />
            <span className="steps__dot steps__dot--done" />
          </span>
          <span className="steps__label">Step 2 of 2</span>
        </span>
      </header>

      <div className="payment__body">
        <div className="payment__intro">
          <h1 className="payment__title">{unresolved ? 'Checking your payment' : 'Confirm and pay'}</h1>
          <p className="payment__order-ref">Order #{orderId}</p>
        </div>

        {/* Tone follows what is actually known. An unknown outcome and a slow
            check are not failures and must not be painted as one. */}
        {state.message && (
          <div
            className={`alert ${
              state.phase === 'failed' || state.phase === 'error'
                ? 'alert--error'
                : 'alert--warning'
            }`}
            role={unresolved || state.phase === 'verifying' ? 'status' : 'alert'}
          >
            <AlertIcon size={18} />
            <p>{state.message}</p>
          </div>
        )}

        {paymentData && !unresolved && (
          <section className="payment__amount-card">
            <span className="payment__amount-label">Amount payable</span>
            <span className="payment__amount">{formatMoney(amountInRupees)}</span>
            <span className="payment__amount-note">
              Confirmed by the cinema · {paymentData.currency || 'INR'}
            </span>
          </section>
        )}

        {unresolved && (
          <section className="payment__reference">
            <span className="payment__reference-label">Order reference</span>
            <span className="payment__reference-value">#{orderId}</span>
          </section>
        )}

        <section className="payment__actions">
          {state.phase === 'verifying' && (
            <div className="payment__processing" role="status">
              <span className="spinner" />
              <p className="payment__processing-label">
                {slowVerify ? 'Still checking your payment…' : 'Confirming your payment…'}
              </p>
              <p className="payment__processing-note">
                {slowVerify
                  ? 'This is taking longer than usual. Please keep this page open and do not pay again.'
                  : "Please don't close or refresh this page."}
              </p>
            </div>
          )}

          {state.phase === 'opening' && (
            <div className="payment__processing" role="status">
              <span className="spinner" />
              <p className="payment__processing-label">Payment window open…</p>
              <p className="payment__processing-note">
                Complete the payment in the window that just opened.
              </p>
            </div>
          )}

          {showPayButton && (
            <>
              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={handlePayNow}
                disabled={!razorpayReady}
              >
                <LockIcon size={18} />
                Pay {formatMoney(amountInRupees)}
              </button>

              {!razorpayReady && !razorpayTimedOut && (
                <p className="payment__unavailable" role="status">
                  Loading the secure payment window…
                </p>
              )}

              {razorpayTimedOut && (
                <div className="payment__unavailable" role="status">
                  <p>
                    The secure payment window couldn&apos;t load. Check your connection, then
                    reload to try again. Your order is saved.
                  </p>
                  <button
                    className="btn btn--secondary btn--block"
                    onClick={() => window.location.reload()}
                  >
                    Reload page
                  </button>
                </div>
              )}
            </>
          )}

          {/* Status check, never a payment. The label says so explicitly: the
              customer must never fear that checking will charge them again. */}
          {canCheckStatus(state.phase) && state.phase !== 'verifying' && (
            <>
              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={handleCheckStatus}
                disabled={checking}
              >
                {checking ? (
                  <>
                    <span className="spinner spinner--sm spinner--on-primary" />
                    Checking…
                  </>
                ) : (
                  'Check payment status'
                )}
              </button>
              <p className="payment__unverified">
                This only checks what happened — it will not charge you again. If it stays
                unresolved, show order <strong>#{orderId}</strong> at the counter.
              </p>

              {/* A way off this screen. The check can keep failing on bad wifi,
                  and with the back button disabled and no Pay button offered,
                  the customer would otherwise be stuck here. Leaving keeps the
                  attempt in storage, so returning resumes the same check
                  rather than starting a payment. */}
              <button className="btn btn--secondary btn--block" onClick={handleLeaveUnresolved}>
                Back to the menu
              </button>
            </>
          )}

          {/* Only when there is nothing to pay with. With payment data already
              loaded the Pay button above is the retry, and offering both left
              two buttons that did almost the same thing on an error screen. */}
          {state.phase === 'error' && !paymentData && (
            <button className="btn btn--primary btn--lg btn--block" onClick={handleTryAgain}>
              Try again
            </button>
          )}
        </section>

        {showPayButton && !busy && (
          <p className="payment__secure">
            <LockIcon size={14} />
            You&apos;ll be redirected to Razorpay to complete payment securely. Your card
            details never reach us.
          </p>
        )}
      </div>
    </div>
  );
}
