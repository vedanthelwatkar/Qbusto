import axios from 'axios';
import type { AxiosError } from 'axios';

/**
 * Format API error responses to user-friendly messages.
 * Never expose stack traces or internal error details.
 */
/**
 * Backend error envelope: `{ success: false, error: { code, message, details? } }`.
 * The message lives under `error.message`, not at the top level — reading the
 * wrong path silently discarded every backend message in favour of a generic
 * fallback. The top-level path is kept as a defensive fallback.
 */
function envelopeMessage(error: AxiosError): string | undefined {
  const data = error.response?.data as
    | { error?: { message?: string }; message?: string }
    | undefined;
  return data?.error?.message ?? data?.message;
}

export function formatApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = envelopeMessage(error);

    switch (status) {
      case 400:
        return message || 'Please check your input and try again';
      case 403:
        return 'Access denied or payment verification failed';
      case 404:
        return 'Item not found';
      case 409:
        return message || 'This action cannot be completed right now';
      case 503:
        return 'Service temporarily unavailable. Please try again later';
      case 500:
        return 'Server error. Please try again later';
      default:
        return 'Something went wrong. Please try again';
    }
  }

  if (error instanceof Error) {
    return 'Network error. Please check your internet connection';
  }

  return 'An unexpected error occurred';
}

/**
 * True when payment-verify rejected the signature itself — a permanent failure
 * that re-sending the same credentials can never resolve, as opposed to a
 * network or server error where retrying is the correct recovery.
 *
 * Shape verified against the running backend rather than assumed: the service
 * raises `ValidationError('Invalid payment signature', [{ field:
 * 'razorpaySignature', ... }])`, which `errorHandler` serialises as HTTP **400**
 * with `error.details`. This is the authoritative contract (README §10.8).
 *
 * Status alone is not sufficient: payment-verify also returns 400 when the
 * order has no `razorpayOrderId`, which is a different, non-permanent case.
 * 403 is accepted as a defensive compatibility case only — the current backend
 * does not produce it.
 */
export function isSignatureVerificationFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  const status = error.response?.status;
  if (status === 403) return true;
  if (status !== 400) return false;

  const details = (error.response?.data as { error?: { details?: unknown } } | undefined)
    ?.error?.details;

  return (
    Array.isArray(details) &&
    details.some(
      (detail) =>
        detail && typeof detail === 'object' && (detail as { field?: string }).field === 'razorpaySignature'
    )
  );
}
