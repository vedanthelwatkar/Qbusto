/**
 * The record of one payment attempt, persisted so a reload cannot lose it.
 *
 * WHY THIS EXISTS
 *
 * The gateway takes the customer's money inside its own checkout. Our backend
 * confirms it either when the browser comes back and payment-verify asks the
 * gateway, or when the gateway's webhook arrives. If the browser is closed,
 * reloaded, or loses the network between "money taken" and "confirmed", the
 * order can still be `pending` in our database while the customer has
 * genuinely paid.
 *
 * An attempt that died before returning would otherwise leave no trace at all,
 * and on reload the page would see a plain pending order and offer "Pay" again
 * - inviting a second charge for an order that may already have been paid.
 *
 * The attempt is therefore recorded BEFORE the checkout opens. Its mere
 * presence is the signal "a payment may have been taken for this order"; that
 * is enough to stop the UI offering a second one.
 *
 * WHAT IS STORED, AND WHY IT IS SAFE
 *
 * - orderId / gatewayOrderId: our own order key and the gateway's public
 *   handle for it. Neither is a secret.
 * - attemptId: a client-generated id used to tell one attempt's async results
 *   from another's. Never sent anywhere.
 * - phase: how far this attempt got.
 *
 * NO PAYMENT CREDENTIAL IS STORED, because none exists. Cashfree's hosted
 * checkout returns no signature or payment token to the browser by design, so
 * unlike the previous provider there is nothing to keep and nothing that could
 * be replayed. Recovery does not need one: payment-verify asks Cashfree
 * directly using the order id, which is strictly more reliable than relaying a
 * credential the browser might have lost.
 *
 * No card number, no CVV, no provider API key, no customer secret is stored
 * here, and nothing in this record can be replayed to move money.
 *
 * Storage is sessionStorage, mirroring `checkoutSession.ts`: scoped to the tab,
 * cleared by the browser when it closes, with an in-memory fallback for
 * private-browsing modes where storage throws.
 */

const ATTEMPT_KEY = 'qbusto_payment_attempt';

/**
 * How far an attempt got. The phase decides what recovery is possible, so the
 * values are behavioural, not cosmetic.
 *
 * - `opened`   the checkout was opened. The outcome is genuinely unknown: the
 *              customer may have paid, cancelled, or never got that far.
 * - `returned` the checkout ran to completion and handed control back. The
 *              payment probably happened and only our confirmation is
 *              outstanding, so asking the backend again is the correct
 *              recovery.
 *
 * There is no `rejected` phase any more. It existed to record a signature the
 * backend had permanently refused, and with no browser-held credential there
 * is nothing that can be permanently refused in that way: every unconfirmed
 * attempt is re-checkable against the gateway.
 */
export type AttemptPhase = 'opened' | 'returned';

export interface PaymentAttempt {
  orderId: number;
  attemptId: string;
  gatewayOrderId: string;
  phase: AttemptPhase;
  /**
   * The amount in paise, as payment-init reported it.
   *
   * Recorded so a payment recovered after a reload can still show the customer
   * what they paid. Recovery deliberately never calls payment-init for a fresh
   * quote, so without this the confirmation screen for exactly the customer who
   * most needs reassurance would be the one with no amount on it.
   *
   * Display only. The backend's own total remains authoritative; this is never
   * sent anywhere.
   */
  amountPaise?: number;
  startedAt: number;
}

/**
 * Fallback for when sessionStorage throws (private browsing, storage
 * disabled). Module-scoped, so it survives remounts within the page but not a
 * reload — which is all that is achievable with no storage at all. Without it
 * every read returned null and the recovery logic silently did nothing.
 */
let memoryAttempt: PaymentAttempt | null = null;

function isAttempt(value: unknown): value is PaymentAttempt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PaymentAttempt;
  return (
    typeof candidate.orderId === 'number' &&
    typeof candidate.attemptId === 'string' &&
    typeof candidate.gatewayOrderId === 'string' &&
    (candidate.phase === 'opened' || candidate.phase === 'returned')
  );
}

/**
 * The stored attempt for this order, or null.
 *
 * Scoped by orderId on purpose: an attempt left over from a previous order
 * must never be applied to the current one, which would either block a
 * legitimate payment or claim a stale result belongs to this order.
 */
export function readAttempt(orderId: number): PaymentAttempt | null {
  const fromMemory = memoryAttempt && memoryAttempt.orderId === orderId ? memoryAttempt : null;

  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return fromMemory;

    const parsed: unknown = JSON.parse(raw);
    if (isAttempt(parsed) && parsed.orderId === orderId) return parsed;
    return fromMemory;
  } catch {
    return fromMemory;
  }
}

export function writeAttempt(attempt: PaymentAttempt): void {
  memoryAttempt = attempt;
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Private browsing: the in-memory copy still covers this page load.
  }
}

/**
 * Clear the attempt. Called only once its outcome is genuinely settled —
 * verified paid, or superseded by a deliberately started new attempt.
 *
 * Never call this because a request failed: a failed request is exactly the
 * case where the record is needed.
 */
export function clearAttempt(): void {
  memoryAttempt = null;
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Nothing to clean up.
  }
}
