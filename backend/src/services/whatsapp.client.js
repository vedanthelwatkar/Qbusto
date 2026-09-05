'use strict';

/**
 * WhatsApp transport - Jalpi.
 *
 * WHICH PROVIDER, AND WHY THIS ONE
 *
 * The client's own systems already send WhatsApp through **Jalpi**
 * (`https://app.jalpi.com/api/v1/sendTemplateMessage`), against an approved
 * template named `sos_order`. This module reproduces that call from the
 * backend. It replaced an earlier Meta Cloud API implementation, which existed
 * only because no provider had been confirmed at the time - no Meta account,
 * template or token was ever provisioned, so nothing was migrated, only
 * replaced.
 *
 * The client's legacy implementation is a SQL Server stored procedure that
 * calls the same endpoint via `sp_OACreate`/`MSXML2.XMLHTTP`. **QBusto does
 * not call, create or depend on that procedure, or on any stored procedure,
 * for notifications.** It was read as a specification for the request contract
 * and nothing more. Everything below is Node.
 *
 * AUTHENTICATION - A BODY FIELD, NOT A HEADER
 *
 * Jalpi authenticates with a `key` field inside the JSON body. The client's
 * working call sends no Authorization header, no basic auth and no
 * username/password; the credentials supplied alongside the key are for the
 * Jalpi web console, not for this endpoint. So `JALPI_API_KEY` is the request
 * credential and the only secret here, and there are deliberately no
 * `JALPI_USERNAME`/`JALPI_PASSWORD` settings - adding config this endpoint
 * does not use would only invite someone to send it.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT, NEVER FROM THE DATABASE
 *
 * `JALPI_API_KEY` is read through `src/config/env.js` and nowhere else. There
 * is no `whatsapp_config` table and no column holding a key: the one
 * credential QBusto stores in the database is the per-cinema Cashfree secret,
 * which is there because it is genuinely per-cinema and encrypted at rest
 * (`utils/credentials.js`). A WhatsApp sender is per-deployment, so the
 * environment is the right home, and a second place a credential can live
 * would be a step backwards.
 *
 * The key is never logged, never returned, and never included in an error
 * message - and because it travels in the BODY rather than a header, the body
 * is never logged either, on success or on failure.
 *
 * TEMPLATES
 *
 * WhatsApp does not allow free-form text to a customer who has not messaged
 * the business in the last 24 hours, which is every food order. So this sends
 * a TEMPLATE message. `sos_order` is already approved on the client's Jalpi
 * account; its two positional body parameters are documented in
 * notification.service.js.
 *
 * "SENT" MEANS ACCEPTED, NOT DELIVERED
 *
 * A success from this module means Jalpi answered `ErrorCode: "000"` and took
 * responsibility for the message. It does NOT mean the message reached the
 * customer's handset - WhatsApp delivery is asynchronous, and Jalpi's delivery
 * webhook is not wired up. `whatsapp_status = 'success'` should be read as
 * "accepted by the provider", and a customer insisting they got nothing is not
 * contradicted by it. The `MaskId` kept as `messageId` is the handle to quote
 * at Jalpi support when chasing one.
 *
 * NO IMAGE HEADER
 *
 * Jalpi's request shape allows `headertype`/`link`/`filename`/`headertext`,
 * and the client's own production call for `sos_order` sends none of them -
 * the template has a text-only header. QBusto has no public image URL it could
 * hand a third party anyway, so nothing is invented here. If the template is
 * ever re-approved WITH an image header, that is a configuration change (a
 * publicly reachable URL) plus four fields, not a redesign.
 */

const env = require('../config/env');
const logger = require('../config/logger');

/** Bound how long we wait for the provider. Same shape as cashfree.client. */
function withTimeout(value, ms, label) {
  let timerId;

  const timeout = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  const settled = Promise.resolve(value);
  settled.catch(() => {});

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timerId));
}

/**
 * Whether this deployment can send at all.
 *
 * The API key is the whole credential, so its presence is the whole check. A
 * deployment without one is treated as not configured rather than attempted,
 * so the failure is one clear log line at send time instead of a rejection per
 * order.
 */
function isConfigured() {
  return Boolean(env.whatsapp.apiKey);
}

/**
 * Reduce a stored mobile number to the digits Jalpi addresses.
 *
 * Jalpi's `to` is bare digits INCLUDING the country code and excluding `+`
 * (the client's own example is `919812345678`), which is what this returns.
 *
 * `orders.customer_mobile` is free-form varchar(15) - the Consumer collects it
 * as ten bare digits, and staff-entered numbers have been seen with spaces and
 * a leading `+`. A bare ten-digit Indian number gets the default country code
 * prefixed; anything already carrying one is left alone, so a number that
 * arrives as `919876543210` does not become `9191...`.
 *
 * Returns null for anything that cannot be a phone number, so the caller logs
 * "no usable number" rather than sending to a malformed address.
 */
function toWhatsAppNumber(mobile) {
  if (typeof mobile !== 'string') return null;

  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 10) return null;

  if (digits.length === 10) return `${env.whatsapp.defaultCountryCode}${digits}`;

  // 11+ digits: assume the country code is already there. Longer than a
  // plausible E.164 number is rejected rather than truncated.
  return digits.length <= 15 ? digits : null;
}

/**
 * Send one order-confirmation template message.
 *
 * @param {object} params
 * @param {string} params.to Recipient, already normalized by toWhatsAppNumber.
 * @param {string[]} params.bodyParameters Positional {{1}}, {{2}}, ... values
 *   for the approved template, in order.
 * @returns {Promise<{messageId: string|null}>}
 * @throws {Error} On any non-2xx response or transport failure. The caller
 *   decides what a failure means; this module never swallows one.
 */
async function sendOrderConfirmation({ to, bodyParameters }) {
  if (!isConfigured()) {
    throw new Error('WhatsApp is not configured');
  }

  const url = `${env.whatsapp.baseUrl}/api/v1/sendTemplateMessage`;

  const payload = {
    // The credential. In the body, by Jalpi's design - so this object is
    // never logged, and never included in an error message.
    key: env.whatsapp.apiKey,
    to,
    languageCode: env.whatsapp.languageCode,
    TemplateName: env.whatsapp.templateName,
    BodyParameter: bodyParameters.map((text) => ({ type: 'text', text })),
  };

  let response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env.whatsapp.timeoutMs,
      'WhatsApp sendOrderConfirmation'
    );
  } catch (err) {
    // `cause` keeps the transport failure (DNS, TLS, the timeout) attached, so
    // the log line above this one is not the only trace of what went wrong.
    throw new Error(`WhatsApp request failed: ${err.message}`, { cause: err });
  }

  const body = await response.text();

  if (!response.ok) {
    /*
     * The status, and nothing from the body.
     *
     * A provider error body can echo request context back, and this request
     * carries both a customer's phone number and the API key. Logging the body
     * wholesale would write both into the application log on every failure.
     */
    logger.warn('WhatsApp rejected a message', { status: response.status });

    throw new Error(`WhatsApp returned HTTP ${response.status}`);
  }

  const outcome = interpretResponse(body);

  if (!outcome.accepted) {
    // Sanitized: a code and a short reason, never the body. See
    // interpretResponse for why the body never reaches a log line.
    logger.warn('WhatsApp accepted the request but rejected the message', {
      providerCode: outcome.errorCode,
    });

    throw new Error(
      `WhatsApp rejected the message${outcome.errorCode ? ` (code ${outcome.errorCode})` : ''}`
    );
  }

  return { messageId: outcome.messageId };
}

/**
 * Decide what a 2xx body from Jalpi means.
 *
 * ============================================================================
 * PARTLY OBSERVED, PARTLY STILL AN ASSUMPTION.
 * ============================================================================
 *
 * **Jalpi answers 200 OK even when it refuses the message.** Observed live,
 * against the client's own key:
 *
 *     HTTP 200  {"ErrorCode":"506","ErrorMessage":"your waba configuration not found"}
 *
 * and, for a message it accepted:
 *
 *     HTTP 200  {"ErrorCode":"000","ErrorMessage":"success","Data":[{...}]}
 *
 * So HTTP status alone is worthless here and `ErrorCode` is the signal: `000`
 * (numerically zero) is success, any other populated value is a refusal. Both
 * halves are now observed rather than assumed.
 *
 * The rule stays deliberately asymmetric all the same - an unrecognised body
 * is treated as accepted, because marking a genuinely sent message `failed`
 * over a field we happened not to find is the worse error. This function is
 * the ONLY place in the codebase that interprets a Jalpi response.
 *
 * The policy, chosen to be conservative in both directions:
 *
 *   1. transport failure / timeout  -> failed   (handled by the caller above)
 *   2. non-2xx HTTP                 -> failed   (handled by the caller above)
 *   3. 2xx with an EXPLICIT failure signal -> failed
 *   4. 2xx with no explicit failure signal -> provisionally ACCEPTED
 *
 * Case 4 is the important one. An unrecognised body is treated as accepted
 * because the alternative - marking every genuinely sent message `failed`
 * because it did not carry a field we happened to look for - is the worse
 * error, and it would make `whatsapp_status` useless as a signal. An arbitrary
 * body is NOT taken as proof of delivery; see the "sent means accepted" note
 * in the module header.
 *
 * The signals below are the ordinary spellings an HTTP JSON API uses. Any one
 * of them appearing means the provider is telling us something went wrong;
 * none of them appearing means we do not know, and we assume acceptance.
 *
 * NOTHING FROM THE BODY IS RETURNED FOR LOGGING except a short code. A
 * provider body can echo request context back, and this request carries the
 * customer's phone number and the API key.
 */
function interpretResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON: no explicit failure signal, so case 4 applies.
    return { accepted: true, messageId: null, errorCode: null };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { accepted: true, messageId: null, errorCode: null };
  }

  // An explicit boolean/string "this did not work".
  const flag = parsed.status ?? parsed.Status ?? parsed.success ?? parsed.Success;
  const flaggedFailure =
    flag === false ||
    flag === 'false' ||
    (typeof flag === 'string' && ['error', 'failed', 'failure'].includes(flag.toLowerCase()));

  /*
   * Jalpi's own signal, and the one actually observed: a populated `ErrorCode`
   * alongside an `ErrorMessage`, inside a 200.
   *
   * Zero is excluded because "0"/"000" is the conventional "no error" value in
   * this style of API, and treating it as a failure would mark every genuinely
   * sent message failed. A non-numeric code is treated as a failure - if it is
   * not a number it is not a zero.
   */
  const jalpiCode = parsed.ErrorCode ?? parsed.errorCode;
  const hasJalpiError =
    jalpiCode !== undefined &&
    jalpiCode !== null &&
    String(jalpiCode).trim() !== '' &&
    Number(jalpiCode) !== 0;

  // Or a generic error object/message that is actually populated. An empty
  // string or an empty object is not a failure signal.
  const errorField = parsed.error ?? parsed.Error ?? parsed.errorMessage;
  const hasError =
    typeof errorField === 'string'
      ? errorField.trim() !== ''
      : Boolean(errorField) && Object.keys(errorField).length > 0;

  if (flaggedFailure || hasJalpiError || hasError) {
    /*
     * A CODE ONLY - and only when it is short and scalar. `ErrorMessage` is
     * free text that can quote the recipient's number back, so it is never
     * logged and never put in the thrown error.
     */
    const rawCode = jalpiCode ?? parsed.code ?? errorField?.code ?? null;
    const errorCode =
      typeof rawCode === 'number' || (typeof rawCode === 'string' && rawCode.length <= 40)
        ? String(rawCode)
        : null;

    return { accepted: false, messageId: null, errorCode };
  }

  /*
   * The provider's trace id, for tracing only.
   *
   * !! THE SUCCESS BODY ECHOES THE API KEY AND THE CUSTOMER'S NUMBER BACK. !!
   *
   * Observed live:
   *
   *     {"ErrorCode":"000","ErrorMessage":"success",
   *      "Data":[{"Key":"<THE API KEY>","InstanceNumber":"91...",
   *               "mobileNumber":"91...","MaskId":"4527a520..."}]}
   *
   * So ONE field is picked out by name and everything else is discarded here,
   * at the boundary. Nothing downstream ever receives the parsed body, which
   * is what makes "never log the response" hold even if a future caller logs
   * whatever this function returns.
   */
  const rawId = parsed.Data?.[0]?.MaskId ?? parsed.messageId ?? parsed.MessageId ?? null;

  return {
    accepted: true,
    messageId: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null,
    errorCode: null,
  };
}

module.exports = { isConfigured, toWhatsAppNumber, sendOrderConfirmation };
