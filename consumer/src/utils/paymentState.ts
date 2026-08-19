/**
 * The payment screen's state machine.
 *
 * It was previously implicit: six independent booleans on one state object
 * (`isInitializing`, `isProcessing`, `razorpayReady`, `razorpayTimedOut`,
 * `verificationRejected`, plus a nullable `error`), read in combination at
 * every render. Nothing prevented contradictory combinations, and nothing
 * stopped a late response writing over a newer outcome — a stale failure
 * could land after a success and replace it.
 *
 * Making the states named and the transitions explicit buys three things that
 * matter more here than anywhere else in the app:
 *
 *   1. `confirmed` and `rejected` are terminal. `reduce` refuses to leave
 *      them, so no delayed response can un-confirm a paid order.
 *   2. Every state answers "may the customer pay again?" in one place, so the
 *      question cannot be answered inconsistently by two different buttons.
 *   3. An unknown outcome has a name of its own — `unresolved` — instead of
 *      being flattened into the error state and shown as a failure.
 *
 * This machine describes the SCREEN. It is not a second source of truth for
 * the payment: `confirmed` is only ever entered on the backend's word, and
 * `unresolved` exists precisely because the frontend is not entitled to guess.
 */

export type PaymentPhase =
  /** No order resolved yet, or payment-init has not run. */
  | 'idle'
  /** payment-init in flight. */
  | 'initializing'
  /** Have a razorpay order and amount; the customer may pay. */
  | 'ready'
  /** Provider widget open. Money may or may not have moved. */
  | 'opening'
  /** Provider returned credentials; payment-verify in flight. */
  | 'verifying'
  /**
   * An attempt was opened and its outcome is not known — no credentials came
   * back, and the backend still reports the order pending. NOT a failure: the
   * customer may well have paid. Never offers a new payment.
   */
  | 'unresolved'
  /** Backend confirmed the payment. TERMINAL. */
  | 'confirmed'
  /** Backend rejected the signature. TERMINAL. Must never re-offer payment. */
  | 'rejected'
  /** Provider explicitly reported the payment failed. No money taken. */
  | 'failed'
  /** Customer dismissed the widget with no result. No money taken. */
  | 'cancelled'
  /** Our own request failed before any payment could have been taken. */
  | 'error';

export interface PaymentScreenState {
  phase: PaymentPhase;
  /** Customer-facing copy for the current phase. Never a raw server string. */
  message: string | null;
  /**
   * Identifies the attempt this state belongs to. A response carrying a
   * different id is stale and is dropped — a loading flag alone cannot say
   * which request produced a given response.
   */
  attemptId: string | null;
}

/** Phases from which no transition is permitted. */
const TERMINAL: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>(['confirmed', 'rejected']);

/**
 * Phases where no payment can have been taken, so starting a fresh payment is
 * safe. `unresolved` is deliberately absent: that is the whole point of it.
 */
const MAY_START_NEW_PAYMENT: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>([
  'ready',
  'failed',
  'cancelled',
  'error',
]);

/**
 * Phases where the right action is to ask the backend what happened, rather
 * than to pay again. Both describe a payment that may already have succeeded.
 */
const MAY_CHECK_STATUS: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>([
  'unresolved',
  'verifying',
]);

export function isTerminal(phase: PaymentPhase): boolean {
  return TERMINAL.has(phase);
}

/**
 * True when a button that starts a NEW payment may be shown.
 *
 * The distinction this encodes is the one that prevents double charges: it is
 * false for every phase in which the customer's money may already have moved.
 */
export function canStartNewPayment(phase: PaymentPhase): boolean {
  return MAY_START_NEW_PAYMENT.has(phase);
}

/** True when a button that re-checks an existing payment may be shown. */
export function canCheckStatus(phase: PaymentPhase): boolean {
  return MAY_CHECK_STATUS.has(phase);
}

/**
 * Allowed transitions. Anything not listed is refused by `reduce`.
 *
 * Read the rows for the safety properties:
 *   - nothing leaves `confirmed` or `rejected`
 *   - `unresolved` can only become `confirmed`/`rejected`/itself — it never
 *     decays into `failed`, because "we don't know" must not become "it
 *     failed" merely with the passage of time
 *   - `opening` can reach `unresolved` (widget closed with no answer) but the
 *     page can also reload straight into `unresolved` from storage
 */
const TRANSITIONS: Record<PaymentPhase, readonly PaymentPhase[]> = {
  idle: ['initializing', 'unresolved', 'confirmed', 'rejected', 'error'],
  initializing: ['ready', 'error', 'unresolved', 'confirmed', 'rejected'],
  ready: ['opening', 'error', 'initializing'],
  // `error` included because `new Razorpay()` / `rzp.open()` can throw. The
  // widget never opened in that case, so no money moved and the customer must
  // be able to act; without it the page hung on "Payment window open…" with the
  // back button disabled and no way forward.
  opening: ['verifying', 'failed', 'cancelled', 'unresolved', 'error'],
  verifying: ['confirmed', 'rejected', 'unresolved'],
  unresolved: ['verifying', 'confirmed', 'rejected', 'unresolved'],
  confirmed: [],
  rejected: [],
  // `idle` is reachable from each of these so a retry can re-run payment-init
  // from a clean slate. It is safe only because all three mean no money moved.
  //
  // `verifying`/`unresolved` are reachable from `failed` because Razorpay's
  // widget stays OPEN after a payment.failed event: the customer can retry
  // inside it and succeed. Without these the success callback was refused, the
  // screen kept saying "Payment failed" beside a live Pay button, and tapping
  // it would have started a second payment for money that had just gone
  // through.
  failed: ['idle', 'initializing', 'opening', 'error', 'verifying', 'unresolved'],
  cancelled: ['idle', 'initializing', 'opening', 'error'],
  error: ['idle', 'initializing', 'ready', 'opening', 'unresolved', 'confirmed', 'rejected'],
};

export function canTransition(from: PaymentPhase, to: PaymentPhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionInput {
  phase: PaymentPhase;
  message?: string | null;
  attemptId?: string | null;
}

/**
 * Apply a transition, or return the current state unchanged if it is not
 * allowed.
 *
 * Refusing rather than throwing is deliberate: these transitions are driven by
 * network responses arriving in whatever order the network chooses, and a late
 * arrival is an expected event on cinema wifi, not a programming error. The
 * caller does not have to guard every `setState` — the machine is the guard.
 *
 * `expectedAttemptId` is the stale-response check. A response that names an
 * attempt other than the one now in progress is dropped, so attempt A's
 * outcome can never be applied to attempt B.
 */
export function reduce(
  current: PaymentScreenState,
  next: TransitionInput,
  expectedAttemptId?: string | null
): PaymentScreenState {
  // Terminal states are final, whatever arrives later.
  if (isTerminal(current.phase)) return current;

  // A result belonging to a superseded attempt is not ours to apply.
  if (
    expectedAttemptId !== undefined &&
    expectedAttemptId !== null &&
    current.attemptId !== null &&
    current.attemptId !== expectedAttemptId
  ) {
    return current;
  }

  if (!canTransition(current.phase, next.phase)) return current;

  return {
    phase: next.phase,
    message: next.message !== undefined ? next.message : null,
    attemptId: next.attemptId !== undefined ? next.attemptId : current.attemptId,
  };
}

export const INITIAL_PAYMENT_STATE: PaymentScreenState = {
  phase: 'idle',
  message: null,
  attemptId: null,
};
