/**
 * Idempotency key lifetime for a single checkout attempt.
 *
 * README §10.7 requires one UUID per checkout attempt, reused across every
 * retry of that attempt. Holding it in component state broke that promise:
 * navigating back from the payment page remounted checkout, minted a fresh key
 * and let the same cart create a second order.
 *
 * The key is therefore stored for the session — but bound to the cart it was
 * created for. The backend ignores the payload on a repeat key and returns the
 * original order, so a key that outlived its cart would silently charge the
 * customer for the basket they had *before* they edited it. Rebinding on a
 * changed cart keeps "one key per attempt" honest: same basket means the same
 * attempt, a different basket is a new one.
 */

const CHECKOUT_KEY = 'qbusto_checkout_key';

interface StoredSession {
  key: string;
  fingerprint: string;
}

interface FingerprintSource {
  cinemaId: number;
  screenId?: number | null;
  seatNumber?: string | null;
  source: string;
  customerMobile?: string | null;
  customerEmail?: string | null;
  filmTitle?: string | null;
  showTime?: string | null;
  items: { productId: number; quantity: number }[];
}

/**
 * Stable identity for "what this checkout attempt is submitting".
 *
 * It covers the whole payload, not just the cart: the backend ignores the body
 * on a repeat key and replays the original order, so correcting a seat, mobile
 * number or show time and resubmitting under the same key would silently keep
 * the old details. Items are sorted so cart ordering cannot cause a spurious
 * mismatch.
 */
export function orderFingerprint(body: FingerprintSource): string {
  const items = body.items
    .map((item) => `${item.productId}:${item.quantity}`)
    .sort()
    .join(',');

  return [
    body.cinemaId,
    body.screenId ?? '',
    body.seatNumber ?? '',
    body.source,
    body.customerMobile ?? '',
    body.customerEmail ?? '',
    body.filmTitle ?? '',
    body.showTime ?? '',
    items,
  ].join('|');
}

/**
 * Fallback when sessionStorage is unavailable (private browsing, storage
 * disabled). Without it every call minted a fresh key, so retrying a failed
 * submit would have created a duplicate order. Module-scoped, so it survives
 * remounts within the page but not a reload — which is all that is possible
 * with no storage.
 */
let memorySession: StoredSession | null = null;

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_KEY);
    if (!raw) return memorySession;

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as StoredSession).key === 'string' &&
      typeof (parsed as StoredSession).fingerprint === 'string'
    ) {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    // Storage unavailable: fall back to the in-memory session.
    return memorySession;
  }
}

function writeSession(session: StoredSession): void {
  memorySession = session;
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(session));
  } catch {
    // Private browsing: the in-memory copy above still allows a retry to reuse
    // the key within this page load.
  }
}

/**
 * Returns the key for the active checkout attempt. Reuses the stored key only
 * when it belongs to the same cart; otherwise starts a new attempt.
 */
export function getOrCreateIdempotencyKey(
  fingerprint: string,
  uuid: () => string
): string {
  const existing = readSession();
  if (existing && existing.fingerprint === fingerprint) {
    return existing.key;
  }

  const created = uuid();
  writeSession({ key: created, fingerprint });
  return created;
}

/**
 * Ends the checkout attempt. Called once payment is verified — and again when
 * the customer acknowledges the confirmation — so a completed order's key can
 * never be reused by a later one.
 */
export function clearCheckoutSession(): void {
  memorySession = null;
  try {
    sessionStorage.removeItem(CHECKOUT_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
