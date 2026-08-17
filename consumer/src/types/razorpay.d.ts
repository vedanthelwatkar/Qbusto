/**
 * Minimal typings for the Razorpay Checkout script.
 *
 * The script is loaded from Razorpay's CDN in index.html, not installed as a
 * package, so it arrives untyped and every use of it was `(window as any)` or
 * `response: any`. That is exactly the wrong place to lose type safety: these
 * are the values we hand to signature verification, and a typo in
 * `razorpay_payment_id` would surface as a failed verification for a real
 * payment rather than as a compile error.
 *
 * Deliberately describes ONLY what this app actually uses. It is not an attempt
 * to model Razorpay's full options object — inventing fields we never pass
 * would be a guess at a contract we cannot verify.
 */

/** What the success handler receives. Verified server-side, never trusted here. */
export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

/** What the `payment.failed` event carries. Only `description` is surfaced. */
export interface RazorpayFailureResponse {
  error?: {
    description?: string;
    [key: string]: unknown;
  };
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: RazorpaySuccessResponse) => void;
  prefill?: { contact?: string; email?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

export interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void): void;
}

export type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    /** Present only once the deferred CDN script has executed. */
    Razorpay?: RazorpayConstructor;
  }
}
