/**
 * Minimal typings for the Cashfree JS checkout SDK.
 *
 * `@cashfreepayments/cashfree-js` ships no TypeScript declarations of its own,
 * so without this every use of it would be `any` - and that is exactly the
 * wrong place to lose type safety, since this is the boundary the payment
 * screen drives.
 *
 * Deliberately describes ONLY what this app actually uses. It is not an attempt
 * to model the SDK's full surface: inventing fields we never pass would be a
 * guess at a contract we cannot verify.
 *
 * NOTE ON TRUST. Nothing in the result of `checkout()` is evidence that money
 * moved. Cashfree's hosted checkout returns no signature or credential to the
 * browser by design, so the only meaning of any value here is "the checkout UI
 * finished". Settlement is decided by the backend asking Cashfree directly.
 */
declare module '@cashfreepayments/cashfree-js' {
  export interface CashfreeLoadOptions {
    /** Which Cashfree environment the session belongs to. */
    mode: 'sandbox' | 'production';
  }

  export interface CashfreeCheckoutOptions {
    /** The short-lived session token issued by our payment-init endpoint. */
    paymentSessionId: string;
    /**
     * `_modal` keeps the customer on our page, which preserves the existing
     * PaymentPage UX. `_self` navigates away and is the fallback used when a
     * redirect is unavoidable.
     */
    redirectTarget?: '_self' | '_blank' | '_top' | '_modal';
  }

  export interface CashfreeCheckoutResult {
    /** Present when the checkout itself errored or the customer dismissed it. */
    error?: { message?: string; code?: string; type?: string };
    /** True when the SDK had to hand off to a full redirect instead. */
    redirect?: boolean;
    /** Present when the checkout ran to completion. Not proof of payment. */
    paymentDetails?: { paymentMessage?: string };
  }

  export interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult>;
  }

  export function load(options: CashfreeLoadOptions): Promise<CashfreeInstance>;
}
