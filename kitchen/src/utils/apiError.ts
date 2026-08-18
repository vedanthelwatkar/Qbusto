import axios from 'axios';
import type { AxiosError } from 'axios';

/**
 * Error handling for a screen nobody is sitting in front of.
 *
 * The Consumer app's equivalent talks to a customer and softens everything. A
 * kitchen display talks to staff who need to know whether to act, so the
 * messages here are operational: they say what the screen is doing about it.
 */

/** Backend envelope: `{ success: false, error: { code, message, details? } }`. */
function envelope(error: AxiosError) {
  return error.response?.data as
    | { error?: { message?: string; code?: string; details?: unknown }; message?: string }
    | undefined;
}

export function formatApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = envelope(error);
    const message = data?.error?.message ?? data?.message;

    if (!error.response) {
      return 'Cannot reach the server. Showing the last known board.';
    }

    switch (status) {
      case 400:
        return message || 'The server rejected that request.';
      case 401:
        return 'Session expired. Sign in again.';
      case 403:
        // Prefer the server's wording. The backend refuses a kitchen account
        // with no cinema assigned and says exactly how to fix it; replacing
        // that with a generic line would throw away the only clue an operator
        // has about why the board is refusing to load.
        return message || 'This account is not allowed to do that.';
      case 404:
        return 'That order is no longer on the kitchen board.';
      case 409:
        // The most operationally important case: someone else moved it.
        return message || 'This order was changed on another screen.';
      case 503:
        return 'Server unavailable. Retrying.';
      default:
        return status && status >= 500 ? 'Server error. Retrying.' : 'Something went wrong.';
    }
  }

  return 'Something went wrong.';
}

/** A conflict means our copy is stale and must be replaced by the server's. */
export function isConflict(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
}

/** The order left the board - refunded, rejected, or never ours. */
export function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/** The token is no longer good. The only case that signs the screen out. */
export function isUnauthenticated(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}
