import axios from 'axios';
import type { AxiosError } from 'axios';

import { formatApiError } from '@/utils/formatApiError';

/**
 * Turning an order-creation failure into something the customer can act on.
 *
 * The shared `formatApiError` answers "Item not found" for every 404, which is
 * true but useless at checkout: a wrong screen number, a product that stopped
 * being carried and a deactivated cinema all read the same, and none of them
 * tells the customer which box to fix.
 *
 * This maps the failures `POST /api/consumer/orders` can actually produce onto
 * the field responsible, so the message can be shown under that input. Anything
 * that does not belong to a single field - a cart problem, a deactivated
 * cinema, an infrastructure failure - falls through to the banner above the
 * submit button, which is where the customer is already looking.
 *
 * `formatApiError` is deliberately left alone: Catalog and Payment rely on its
 * current wording, and this is a checkout-specific concern.
 */

/** The form fields an error can be attached to. */
export type CheckoutField =
  | 'customerMobile'
  | 'customerEmail'
  | 'rowNumber'
  | 'seatNumber'
  | 'filmTitle'
  | 'showTime';

export interface CheckoutError {
  /** Undefined when the failure does not belong to one input. */
  field?: CheckoutField;
  message: string;
}

/** Backend envelope: `{ success: false, error: { code, message, details } }`. */
interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    // Two shapes are in use: Joi validation sends an array of field errors,
    // and a ConflictError sends an object naming the offending entity.
    details?: Array<{ field?: string; message?: string }> | Record<string, unknown>;
  };
}

function envelope(error: AxiosError): ErrorEnvelope['error'] | undefined {
  return (error.response?.data as ErrorEnvelope | undefined)?.error;
}

/**
 * Joi-style `details` name their own field, so trust them when they match.
 *
 * `seatRow` is the backend's name for the field (it resolves the screen from
 * screenName + seatRow); the form's row input is `rowNumber`, so it is
 * remapped below rather than added here as its own case.
 */
const VALIDATION_FIELDS = new Set<string>([
  'customerMobile',
  'customerEmail',
  'seatNumber',
  'filmTitle',
  'showTime',
]);

export function mapCheckoutError(caught: unknown): CheckoutError {
  if (!axios.isAxiosError(caught)) {
    return { message: formatApiError(caught) };
  }

  const status = caught.response?.status;
  const body = envelope(caught);
  const message = body?.message ?? '';
  const details = body?.details;

  // 1. `seatRow` - the row didn't match any seat carried by this show's
  //    screen. Shown under the row input, which the form calls `rowNumber`.
  if (Array.isArray(details)) {
    const rowError = details.find((entry) => entry.field === 'seatRow' && entry.message);
    if (rowError?.message) {
      return { field: 'rowNumber', message: rowError.message };
    }
  }

  // 2. A validation response that names its own field.
  if (Array.isArray(details)) {
    const named = details.find(
      (entry) => entry.field && VALIDATION_FIELDS.has(entry.field) && entry.message
    );
    if (named?.field && named.message) {
      return { field: named.field as CheckoutField, message: named.message };
    }
  }

  // 3. Everything else belongs to the banner. Prefer the server's wording for
  //    the cases where it is written for a customer - a product that is no
  //    longer carried, or outside its serving hours - rather than replacing it
  //    with something vaguer.
  if (status === 404 && /^product /i.test(message)) {
    return { message: 'One of the items in your order is no longer available.' };
  }

  if (status === 409 && message) {
    return { message };
  }

  return { message: formatApiError(caught) };
}
