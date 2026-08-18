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
  | 'screenId'
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

/** Joi-style `details` name their own field, so trust them when they match. */
const VALIDATION_FIELDS = new Set<string>([
  'customerMobile',
  'customerEmail',
  'seatNumber',
  'screenId',
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

  // 1. A validation response that names its own field.
  if (Array.isArray(details)) {
    const named = details.find(
      (entry) => entry.field && VALIDATION_FIELDS.has(entry.field) && entry.message
    );
    if (named?.field && named.message) {
      return { field: named.field as CheckoutField, message: named.message };
    }
  }

  // 2. A conflict that names the entity it is about. `Screen is not active`
  //    arrives as 409 with `{ screenId }`.
  if (details && !Array.isArray(details) && 'screenId' in details) {
    return {
      field: 'screenId',
      message: message || 'That screen is not available. Check the screen number.',
    };
  }

  // 3. `NotFoundError('Screen')` is a 404 whose only distinguishing mark is its
  //    message, which the backend builds as `${resource} not found`.
  if (status === 404 && /^screen not found$/i.test(message)) {
    return {
      field: 'screenId',
      message: 'We could not find that screen at this cinema. Check the screen number.',
    };
  }

  // 4. Everything else belongs to the banner. Prefer the server's wording for
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
