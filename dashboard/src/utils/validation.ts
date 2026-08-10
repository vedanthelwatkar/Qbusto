/**
 * Turning a 400 from the API into per-field form errors.
 *
 * backend/src/middleware/validate.js collects every Joi failure into
 * `error.details` as `{ source, field, message }`, so a rejected request already
 * says which field it was unhappy with. This puts those messages on the fields
 * themselves rather than only in the alert at the top of the form.
 *
 * Lives here because all three entity forms need it; it is a translation of one
 * documented error shape, not a form framework.
 */

import { ERROR_CODES, type ApiError } from '@/types/api';

interface ValidationDetail {
  /**
   * Absent on validation errors raised by a service rather than by the request
   * validator - those are always about the body, so they carry only the field.
   */
  source?: string;
  field: string;
  message: string;
}

function isValidationDetails(details: unknown): details is ValidationDetail[] {
  return (
    Array.isArray(details) &&
    details.every((entry) => typeof entry === 'object' && entry !== null && 'field' in entry)
  );
}

interface FieldError<Values> {
  name: keyof Values & string;
  errors: string[];
}

/**
 * Field errors from an ApiError, ready for antd's `form.setFields`. Empty for
 * anything that is not a validation failure about the request body.
 *
 * Pass the form's value type so the result lines up with a typed FormInstance:
 * `fieldErrorsFrom<FormValues>(apiError)`.
 */
export function fieldErrorsFrom<Values>(error: ApiError): FieldError<Values>[] {
  if (error.code !== ERROR_CODES.VALIDATION_ERROR || !isValidationDetails(error.details)) {
    return [];
  }

  return (
    error.details
      // Only query and params are excluded, and a missing source is kept rather
      // than dropped: validate.js stamps a source on every Joi failure, but the
      // services raise their own ValidationErrors with just a field - "An add-on
      // cannot be the parent of another add-on" is one - and requiring the key
      // would silently throw those away.
      .filter((detail) => detail.source === undefined || detail.source === 'body')
      .map((detail) => ({
        // The server names the field as a plain string. Which of the form's
        // fields that is cannot be known at compile time, so this is asserted
        // here; a name that matches nothing is simply ignored by antd.
        name: detail.field as keyof Values & string,
        errors: [detail.message],
      }))
  );
}
