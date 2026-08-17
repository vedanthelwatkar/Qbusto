/**
 * The record of one payment attempt, persisted so a reload cannot lose it.
 *
 * WHY THIS EXISTS
 *
 * Razorpay takes the customer's money inside its own widget. Our backend only
 * learns about it when the widget's success callback hands us a payment id and
 * signature and we post them to payment-verify. If the browser is closed,
 * reloaded, or loses the network between "money taken" and "verify posted",
 * the order stays `pending` in our database while the customer has genuinely
 * paid.
 *
 * The previous implementation only wrote to storage inside that callback, so
 * an attempt that died before the callback left no trace at all. On reload the
 * page saw a plain pending order and offered "Pay" again — inviting a second
 * charge for an order that may already have been paid.
 *
 * The attempt is therefore recorded BEFORE the widget opens. Its mere presence
 * is the signal "a payment may have been taken for this order"; that is enough
 * to stop the UI offering a second one.
 *
 * WHAT IS STORED, AND WHY IT IS SAFE
 *
 * - orderId / razorpayOrderId: our own order key and the public handle already
 *   passed to the checkout widget in the page. Neither is a secret.
 * - attemptId: a client-generated id used to tell one attempt's async results
 *   from another's. Never sent anywhere.
 * - phase: how far this attempt got.
 * - credentials (only once the provider has returned them): the razorpay
 *   payment id and signature. The signature is an HMAC the *backend* checks
 *   with a key only it holds — it proves a payment happened, it cannot create
 *   one, and it is useless for any order other than this one. It is kept
 *   because it is the only input payment-verify accepts, so discarding it
 *   would make an interrupted payment permanently unverifiable.
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
 * - `opened`   the widget was opened. The outcome is genuinely unknown: the
 *              customer may have paid, cancelled, or never got that far.
 * - `returned` the provider handed back credentials. The payment happened and
 *              only our confirmation is outstanding, so re-verifying is both
 *              safe and the correct recovery.
 * - `rejected` the backend rejected the signature. Deterministic and final —
 *              re-sending identical credentials can never succeed, so this
 *              must survive a reload or the page would re-offer payment.
 */
export type AttemptPhase = 'opened' | 'returned' | 'rejected';

export interface PaymentAttempt {
  orderId: number;
  attemptId: string;
  razorpayOrderId: string;
  phase: AttemptPhase;
  /** Present from `returned` onwards. See the note above on why this is safe. */
  credentials?: { paymentId: string; signature: string };
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
    typeof candidate.razorpayOrderId === 'string' &&
    (candidate.phase === 'opened' ||
      candidate.phase === 'returned' ||
      candidate.phase === 'rejected')
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
