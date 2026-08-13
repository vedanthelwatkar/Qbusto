import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { initializePayment, verifyOrderPayment } from '@/services/orders.service';
import { clearCheckoutSession } from '@/utils/checkoutSession';
import { formatApiError, isSignatureVerificationFailure } from '@/utils/formatApiError';
import { formatMoney } from '@/utils/formatMoney';
import { AlertIcon, ChevronLeftIcon, LockIcon } from '@/components/icons';
import type { PostApiConsumerOrdersOrderIdPaymentInit200Data } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/payment.scss';

interface PaymentState {
  orderId: number | null;
  isInitializing: boolean;
  isProcessing: boolean;
  razorpayReady: boolean;
  /** Gave up waiting for the CDN script; distinguishes "loading" from "failed". */
  razorpayTimedOut: boolean;
  /**
   * Razorpay credentials from a payment whose verification call failed. The
   * customer may already have been charged, so these are retained to allow
   * re-verifying the same payment (the endpoint is idempotent) rather than
   * discarding them and offering only a fresh payment attempt.
   */
  pendingVerification: { paymentId: string; signature: string } | null;
  /**
   * The backend rejected the signature. Permanent: re-sending the same
   * credentials is deterministic and can never succeed, so no retry is offered
   * and payment is not re-initialised.
   */
  verificationRejected: boolean;
  error: string | null;
}

/** How long to wait for the deferred Razorpay script before reporting failure. */
const SDK_WAIT_MS = 10000;
const SDK_POLL_MS = 150;

/**
 * A payment that Razorpay completed but that the backend has not confirmed yet
 * is persisted, so a refresh cannot strand a customer who has been charged.
 * These values are not secrets — the signature is only meaningful to the
 * backend, which holds the key — and they live in sessionStorage, scoped to
 * the order and cleared as soon as verification succeeds.
 */
const PENDING_VERIFICATION_KEY = 'qbusto_pending_verification';

interface PendingVerification {
  orderId: number;
  paymentId: string;
  signature: string;
  /**
   * The backend rejected this signature. Kept (rather than discarded) so a
   * refresh restores the permanent-failure screen instead of re-initialising
   * payment and inviting a second charge.
   */
  rejected?: boolean;
}

function readPendingVerification(orderId: number): Omit<PendingVerification, 'orderId'> | null {
  try {
    const raw = sessionStorage.getItem(PENDING_VERIFICATION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingVerification>;
    if (
      parsed &&
      parsed.orderId === orderId &&
      typeof parsed.paymentId === 'string' &&
      typeof parsed.signature === 'string'
    ) {
      return {
        paymentId: parsed.paymentId,
        signature: parsed.signature,
        rejected: parsed.rejected === true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingVerification(value: PendingVerification): void {
  try {
    sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable: recovery is then limited to this page instance.
  }
}

function clearPendingVerification(): void {
  try {
    sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch {
    // Nothing to clean up.
  }
}

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
  const [paymentState, setPaymentState] = useState<PaymentState>({
    orderId: null,
    isInitializing: false,
    isProcessing: false,
    razorpayReady: false,
    razorpayTimedOut: false,
    pendingVerification: null,
    verificationRejected: false,
    error: null,
  });
  const [paymentData, setPaymentData] =
    useState<PostApiConsumerOrdersOrderIdPaymentInit200Data | null>(null);

  // Wait for the Razorpay SDK. The script is deferred so it may not be present
  // when this mounts; poll briefly rather than deciding once and giving up.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ((window as any).Razorpay) {
      setPaymentState((prev) => ({ ...prev, razorpayReady: true }));
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if ((window as any).Razorpay) {
        window.clearInterval(intervalId);
        setPaymentState((prev) => ({ ...prev, razorpayReady: true }));
      } else if (Date.now() - startedAt >= SDK_WAIT_MS) {
        window.clearInterval(intervalId);
        setPaymentState((prev) => ({ ...prev, razorpayTimedOut: true }));
      }
    }, SDK_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  // Retrieve and validate orderId from sessionStorage on mount
  useEffect(() => {
    const storedOrderId = sessionStorage.getItem('qbusto_order_id');
    if (!storedOrderId) {
      setPaymentState((prev) => ({
        ...prev,
        error: 'Order ID not found. Please start checkout again.',
      }));
      return;
    }

    const orderId = parseInt(storedOrderId, 10);
    if (isNaN(orderId) || orderId <= 0) {
      setPaymentState((prev) => ({
        ...prev,
        error: 'Invalid order ID. Please start checkout again.',
      }));
      return;
    }

    // Restore a payment that was made but never confirmed, so a refresh in the
    // recovery state does not lose the credentials needed to complete it.
    const pending = readPendingVerification(orderId);

    if (pending?.rejected) {
      // Permanent failure restored: no credentials in state, so no retry action
      // is rendered and payment-init stays blocked.
      setPaymentState((prev) => ({
        ...prev,
        orderId,
        pendingVerification: null,
        verificationRejected: true,
        error: 'We could not verify this payment.',
      }));
      return;
    }

    setPaymentState((prev) => ({
      ...prev,
      orderId,
      pendingVerification: pending
        ? { paymentId: pending.paymentId, signature: pending.signature }
        : null,
      error: pending
        ? 'We could not confirm your last payment. Please confirm it below.'
        : prev.error,
    }));
  }, []);

  // Initialize payment (Step 2: Call payment-init)
  // The `error` guard matters: without it a failed init leaves paymentData null
  // and isInitializing false, which re-satisfies this effect and re-fires
  // payment-init in an endless loop. Recovery is via handleRetry, which clears
  // both error and paymentData.
  // `pendingVerification` also blocks init: a payment already went through, so
  // re-initialising would offer a second payment for the same order.
  useEffect(() => {
    if (
      !paymentState.orderId ||
      paymentData ||
      paymentState.isInitializing ||
      paymentState.pendingVerification ||
      paymentState.verificationRejected ||
      paymentState.error
    ) {
      return;
    }

    const initPayment = async () => {
      setPaymentState((prev) => ({ ...prev, isInitializing: true, error: null }));
      try {
        const response = await initializePayment(paymentState.orderId!);
        // Extract data from response envelope
        if (response.data) {
          setPaymentData(response.data);
        } else {
          setPaymentState((prev) => ({
            ...prev,
            error: 'Payment initialization returned no data. Please try again.',
          }));
        }
      } catch (err) {
        const message = formatApiError(err);
        setPaymentState((prev) => ({ ...prev, error: message }));
      } finally {
        setPaymentState((prev) => ({ ...prev, isInitializing: false }));
      }
    };

    initPayment();
  }, [
    paymentState.orderId,
    paymentData,
    paymentState.isInitializing,
    paymentState.pendingVerification,
    paymentState.verificationRejected,
    paymentState.error,
  ]);

  // Handle payment click (Step 3: Open Razorpay checkout)
  const handlePayNow = async () => {
    if (!paymentData || !paymentState.razorpayReady || !paymentState.orderId) {
      setPaymentState((prev) => ({
        ...prev,
        error: 'Payment not ready. Please refresh and try again.',
      }));
      return;
    }

    if (paymentState.isProcessing) {
      return; // Prevent concurrent requests
    }

    const Razorpay = (window as any).Razorpay;
    if (!Razorpay) {
      setPaymentState((prev) => ({
        ...prev,
        error: 'Payment system not loaded. Please refresh and try again.',
      }));
      return;
    }

    // Starting a genuinely new payment supersedes any earlier unconfirmed one.
    clearPendingVerification();
    setPaymentState((prev) => ({
      ...prev,
      isProcessing: true,
      pendingVerification: null,
      error: null,
    }));

    const options = {
      key: paymentData.razorpayKeyId || '',
      amount: paymentData.amount ?? 0, // Already in paise from backend, default to 0 if undefined
      currency: paymentData.currency || 'INR',
      order_id: paymentData.razorpayOrderId || '',
      name: 'Cinema Ordering', // Generic name, cinema name not available
      description: `Order #${paymentState.orderId}`,

      handler: async (response: any) => {
        // Step 4: Verify payment signature
        await verifyPaymentSignature(
          paymentState.orderId!,
          response.razorpay_payment_id,
          response.razorpay_signature
        );
      },

      prefill: {
        contact: '',
        email: '',
      },

      theme: {
        color: brandColor(),
      },

      modal: {
        ondismiss: () => {
          // A declined payment fires payment.failed and then dismisses the
          // modal, so this must not overwrite the more accurate message.
          setPaymentState((prev) =>
            prev.error
              ? { ...prev, isProcessing: false }
              : {
                  ...prev,
                  isProcessing: false,
                  error: 'Payment cancelled. Please try again or contact support.',
                }
          );
        },
      },
    };

    try {
      const rzp = new Razorpay(options);

      // Without this, a declined payment only surfaces when the customer closes
      // the modal, and is then reported as "cancelled" — which is inaccurate.
      // No charge is captured on this event, so re-attempting is the right
      // recovery and the order stays pending.
      rzp.on('payment.failed', (response: any) => {
        // Razorpay's `description` is customer-facing copy (e.g. "Your payment
        // was declined by the bank"). Use it when it is a plausible string;
        // never surface codes, sources or metadata.
        const description = response?.error?.description;
        const reason =
          typeof description === 'string' && description.trim() && description.length <= 160
            ? description.trim()
            : null;

        setPaymentState((prev) => ({
          ...prev,
          isProcessing: false,
          error: reason
            ? `Payment failed: ${reason} Please try again or use a different payment method.`
            : 'Payment failed. Please try again or use a different payment method.',
        }));
      });

      rzp.open();
    } catch (err) {
      const message = formatApiError(err);
      setPaymentState((prev) => ({
        ...prev,
        isProcessing: false,
        error: `Failed to open payment: ${message}`,
      }));
    }
  };

  // Verify payment signature with backend (Step 4)
  const verifyPaymentSignature = async (
    orderId: number,
    paymentId: string,
    signature: string
  ) => {
    // Persist BEFORE the request, not only on failure: Razorpay has already
    // taken the money by this point, and a refresh while the call is in flight
    // would otherwise lose the credentials and let the page offer a second
    // payment. Cleared immediately on success.
    writePendingVerification({ orderId, paymentId, signature });

    try {
      await verifyOrderPayment(orderId, {
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      });

      // Payment verified successfully - navigate to confirmation with orderId
      // Pass orderId via URL param so confirmation page can display it
      sessionStorage.removeItem('qbusto_order_id');
      // Verified: the payment no longer needs recovering.
      clearPendingVerification();
      // This checkout attempt is finished. Leaving its key in storage would
      // make a later checkout of the same cart resolve to this already-paid
      // order, which then fails payment-init with 409 and strands the customer.
      clearCheckoutSession();
      navigate(`/confirmation/${orderId}`, {
        replace: true,
        // Backend-verified amount, shown as a receipt line. Optional by design:
        // the confirmation page renders fine without it.
        state: { amount: paymentData?.amount ?? null },
      });
    } catch (err) {
      // A rejected signature is deterministic: re-sending the same credentials
      // can never succeed, so this must not become a retry loop. Anything else
      // (network, timeout, 5xx) is transient and stays recoverable.
      if (isSignatureVerificationFailure(err)) {
        writePendingVerification({ orderId, paymentId, signature, rejected: true });
        setPaymentState((prev) => ({
          ...prev,
          isProcessing: false,
          pendingVerification: null,
          verificationRejected: true,
          error: 'We could not verify this payment.',
        }));
        return;
      }

      const message = formatApiError(err);
      // Credentials are already persisted above; mirror them into state so the
      // recovery action renders.
      setPaymentState((prev) => ({
        ...prev,
        isProcessing: false,
        pendingVerification: { paymentId, signature },
        error: message,
      }));
    }
  };

  // Re-verify the payment that already went through, using the retained
  // credentials. payment-verify is idempotent, so this is safe to repeat.
  const handleRetryVerification = () => {
    const pending = paymentState.pendingVerification;
    if (!pending || !paymentState.orderId || paymentState.isProcessing) return;

    setPaymentState((prev) => ({ ...prev, isProcessing: true, error: null }));
    verifyPaymentSignature(paymentState.orderId, pending.paymentId, pending.signature);
  };

  // Retry: Clear error and reinitialize
  const handleRetry = () => {
    setPaymentData(null);
    setPaymentState((prev) => ({ ...prev, error: null }));
  };

  // Go back to checkout
  const handleGoBack = () => {
    navigate('/checkout', { replace: false });
  };

  // Error state: Invalid order ID
  if (paymentState.error && !paymentState.orderId) {
    return (
      <div className="payment">
        <div className="state-panel">
          <span className="state-panel__icon">
            <AlertIcon size={28} />
          </span>
          <h1 className="state-panel__title">We couldn&apos;t find your order</h1>
          <p className="state-panel__body">{paymentState.error}</p>
          <button
            className="btn btn--primary"
            onClick={() => navigate('/catalog', { replace: true })}
          >
            Back to the menu
          </button>
        </div>
      </div>
    );
  }

  // Loading state: Initializing payment
  if (paymentState.isInitializing && !paymentData) {
    return (
      <div className="payment">
        <div className="state-panel">
          <span className="spinner" />
          <p className="state-panel__body">Preparing your payment…</p>
        </div>
      </div>
    );
  }

  // Permanent verification failure. Rendered as a full replacement so no
  // payment control exists on the page: no Pay now, no retry, no back-to-details.
  // The cart is untouched and no new order is created.
  if (paymentState.verificationRejected) {
    return (
      <div className="payment">
        <div className="state-panel">
          <span className="state-panel__icon">
            <AlertIcon size={28} />
          </span>
          <h1 className="state-panel__title">We couldn&apos;t verify this payment</h1>
          <p className="state-panel__body">
            Your payment could not be confirmed as genuine, so this order has not
            been completed. <strong>Please do not pay again.</strong> Show the
            reference below to the counter and they will check it for you.
          </p>

          <div className="payment__reference">
            <span className="payment__reference-label">Order reference</span>
            <span className="payment__reference-value">#{paymentState.orderId}</span>
          </div>

          <button
            className="btn btn--primary"
            onClick={() => navigate('/', { replace: true })}
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const amountInRupees = paymentData?.amount ? paymentData.amount / 100 : 0;

  return (
    <div className="payment">
      <header className="payment__topbar">
        <button
          type="button"
          className="payment__back"
          onClick={handleGoBack}
          disabled={paymentState.isProcessing}
        >
          <ChevronLeftIcon size={18} />
          Details
        </button>
        <span className="payment__step">Step 2 of 2</span>
      </header>

      <div className="payment__body">
        <div className="payment__intro">
          <h1 className="payment__title">Confirm and pay</h1>
          <p className="payment__order-ref">Order #{paymentState.orderId}</p>
        </div>

        {paymentState.error && (
          <div className="alert alert--error" role="alert">
            <AlertIcon size={18} />
            <p>{paymentState.error}</p>
          </div>
        )}

        {paymentData && (
          <section className="payment__amount-card">
            <span className="payment__amount-label">Amount payable</span>
            <span className="payment__amount">{formatMoney(amountInRupees)}</span>
            <span className="payment__amount-note">
              Confirmed by the cinema · {paymentData.currency || 'INR'}
            </span>
          </section>
        )}

        <section className="payment__actions">
          {paymentData && !paymentState.isProcessing && !paymentState.error && (
            <>
              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={handlePayNow}
                disabled={!paymentState.razorpayReady}
              >
                <LockIcon size={18} />
                Pay {formatMoney(amountInRupees)}
              </button>

              {/* A disabled primary action needs a reason the customer can act on. */}
              {!paymentState.razorpayReady && !paymentState.razorpayTimedOut && (
                <p className="payment__unavailable" role="status">
                  Loading the secure payment window…
                </p>
              )}

              {paymentState.razorpayTimedOut && (
                <div className="payment__unavailable" role="status">
                  <p>
                    The secure payment window couldn&apos;t load. Check your
                    connection, then reload to try again. Your order is saved.
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

          {/* A payment went through but could not be confirmed. Offer to confirm
              that same payment — never a fresh one, which risks charging twice. */}
          {paymentState.error && paymentState.pendingVerification && !paymentState.isProcessing && (
            <>
              <p className="payment__unverified">
                Your payment may already have been taken. Don&apos;t pay again —
                confirm this payment instead, or contact the counter with order
                #{paymentState.orderId}.
              </p>
              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={handleRetryVerification}
              >
                Confirm my payment
              </button>
            </>
          )}

          {paymentState.error && !paymentState.pendingVerification && (
            <>
              <button className="btn btn--primary btn--lg btn--block" onClick={handleRetry}>
                Try again
              </button>
              <button className="btn btn--secondary btn--block" onClick={handleGoBack}>
                Back to details
              </button>
            </>
          )}

          {paymentState.isProcessing && (
            <div className="payment__processing" role="status">
              <span className="spinner" />
              <p className="payment__processing-label">Processing your payment…</p>
              <p className="payment__processing-note">
                Please don&apos;t close or refresh this page.
              </p>
            </div>
          )}
        </section>

        {!paymentState.isProcessing && paymentData && !paymentState.error && (
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
