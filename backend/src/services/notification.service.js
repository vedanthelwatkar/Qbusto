'use strict';

/**
 * Customer notifications - a POST-ORDER SIDE EFFECT, and nothing more.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * A WhatsApp outage must never invalidate a food order the customer has
 * already paid for. So nothing here throws into a caller, nothing here runs
 * inside the caller's transaction, and nothing here can roll anything back:
 *
 *   - `notifyOrderConfirmed` is registered with `transaction.afterCommit`, so
 *     it does not even begin until the order's own commit has succeeded. A
 *     provider call inside the transaction would hold a database transaction
 *     open across a network round trip to the provider, and a failure would take
 *     the payment transition down with it.
 *   - Every path is wrapped. A malformed number, an unconfigured deployment,
 *     a 500 from the provider and an unexpected programming error all end the
 *     same way: a log line and `orders.whatsapp_status = 'failed'`.
 *   - The status write is itself wrapped, because a notification's bookkeeping
 *     failing is even less of a reason to disturb an order.
 *
 * `orders.whatsapp_status` is the record of what happened - 'success' or
 * 'failed', NULL meaning the channel was never attempted for this order (the
 * cinema has it switched off, or the order carries no mobile number). That
 * column and `cinemas.whatsapp_enabled` both predate this service; this is
 * the code that finally sets them.
 *
 * WHAT IS AND IS NOT CONFIGURATION
 *
 * `cinemas.whatsapp_enabled` stays in the database: it is a per-cinema
 * operational switch a staff user flips, not a secret. The credential is in
 * the environment - see whatsapp.client.js.
 */

const { models } = require('../config/database');
const logger = require('../config/logger');
const whatsapp = require('./whatsapp.client');

const STATUS_SUCCESS = 'success';
const STATUS_FAILED = 'failed';

/**
 * Record the outcome without ever letting the recording fail anything.
 *
 * A direct UPDATE rather than a model instance save: this runs after the
 * order's transaction has committed, so there is no transaction to join, and
 * re-reading the row first would only widen the window for no benefit.
 */
async function recordStatus(orderId, status) {
  try {
    await models.Order.update({ whatsappStatus: status }, { where: { id: orderId } });
  } catch (err) {
    logger.error('Could not record WhatsApp status for order', {
      orderId,
      status,
      error: err.message,
    });
  }
}

/**
 * Strip the redundant "Screen " prefix off an auditorium name.
 *
 * The parameter reads "Screen #: X", so a screen literally named "Screen 1"
 * would render as "Screen #: Screen 1". The prefix is dropped only when the
 * whole name is that word plus one token ("Screen 1" -> "1"); a name that
 * carries meaning of its own ("IMAX", "Gold Class", "Screen Room 4") is left
 * exactly as staff typed it. This is presentation of a string QBusto composes
 * in full, not a provider contract field.
 */
function screenLabel(name) {
  if (!name) return null;

  const match = /^screen\s+(\S+)$/i.exec(name.trim());
  return match ? match[1] : name;
}

/**
 * Positional parameters for the client's approved Jalpi template `sos_order`.
 *
 * TWO PARAMETERS. NOT FIVE.
 *
 * The client's own working call - the legacy POPExpress stored procedure,
 * read here as a specification and nothing more - documents the mapping
 * exactly:
 *
 *     {{1}} = #: OrderID | Screen #: X | Seat #: X
 *     {{2}} = Cinema Name
 *
 * and builds {{1}} as `'#: ' + OrderID + ' | Screen #: ' + Screen +
 * ' | Seat #: ' + Seat`, which is reproduced verbatim below. Everything else
 * in the message the customer receives - the greeting, "Thank you for visiting
 * 1 Cinemas!!", "Your order id", the 25-30 minute promise - is FIXED TEXT
 * inside the approved template. It is not sent from here.
 *
 * An earlier five-parameter mapping (chain, city, order id, screen, seat) was
 * inferred from a filled-in sample before the template contract was known. It
 * was wrong and is gone: a template's parameter COUNT is fixed at approval
 * time and a mismatch is rejected outright, so this list is two entries and
 * stays two entries unless the client re-approves `sos_order`.
 *
 * {{2}} IS THE LOCATION, TAKEN FROM QBUSTO DATA
 *
 * The stored procedure hard-codes `CL01 -> 'Noida'`, `CL02 -> 'Akola'`. Those
 * values are `cinemas.city` in QBusto (cinema 8 is city "Noida", name
 * "1Cinemas Noida"; cinema 9 is "Akola" / "1Cinema Akola"), and the sample
 * message shows the location on its own line under the chain's fixed text. So
 * this reads the city off the order's own cinema. Nothing is hard-coded, and a
 * cinema with no city falls back to its name rather than sending an empty
 * value.
 *
 * A provider rejects an empty string as a parameter, so every slot falls back
 * to something printable. `screen` and `seat` are both genuinely nullable on
 * `orders` (a counter order has neither), which is why they fall back rather
 * than being asserted.
 */
function buildBodyParameters(order) {
  const screen = screenLabel(order.screen ? order.screen.name : null) || '-';
  const seat = order.seatNumber || '-';

  return [
    `#: ${order.id} | Screen #: ${screen} | Seat #: ${seat}`,
    order.cinema.city || order.cinema.name || '-',
  ].map(oneLine);
}

/**
 * Flatten a parameter to a single line.
 *
 * WhatsApp rejects a template parameter containing a newline or a tab, and
 * `seatNumber` is only trimmed at the edges by `optionalText` - "A
5" is 20
 * characters or fewer and passes validation, so the backend accepts an input
 * the Consumer's own field would never produce. Without this, that order would
 * be taken and paid for and its confirmation would be refused by the provider.
 *
 * Applied to the composed value rather than to `orders.seat_number` itself:
 * this is a constraint of the message, not of what a seat may be called, and
 * the stored order must keep exactly what the customer entered.
 */
function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Send the order-confirmation message for one order.
 *
 * Never throws. Never returns a value a caller is expected to act on - the
 * outcome is in the log and in `orders.whatsapp_status`.
 *
 * @param {number} orderId
 */
async function notifyOrderConfirmed(orderId) {
  try {
    const order = await models.Order.findByPk(orderId, {
      attributes: ['id', 'cinemaId', 'customerMobile', 'seatNumber'],
      include: [
        // `city` is the template's {{2}}; `name` is only its fallback. The
        // chain is no longer read - `sos_order` carries the chain as fixed
        // text - so the join is gone rather than left loading unused rows.
        { association: 'cinema', attributes: ['name', 'city', 'whatsappEnabled'] },
        // The auditorium the order was placed against. LEFT JOIN by default:
        // `orders.screen_id` is nullable and a missing screen must not stop
        // the message.
        { association: 'screen', attributes: ['name'], required: false },
      ],
    });

    if (!order) {
      logger.warn('WhatsApp confirmation skipped: order not found', { orderId });
      return;
    }

    // Per-cinema switch. Not an error and not a failure - the channel was
    // never attempted, so whatsapp_status stays NULL.
    if (!order.cinema || !order.cinema.whatsappEnabled) return;

    if (!whatsapp.isConfigured()) {
      // A cinema has the channel switched on but the deployment has no
      // sender. Worth one warning per order, because it is a configuration
      // mistake somebody needs to fix, not a transient failure.
      logger.warn('WhatsApp confirmation skipped: no sender configured for this deployment', {
        orderId,
      });
      await recordStatus(orderId, STATUS_FAILED);
      return;
    }

    const to = whatsapp.toWhatsAppNumber(order.customerMobile);

    if (!to) {
      // Nothing to send to. `customer_mobile` is nullable by design - a
      // counter order need not collect one - so this is not a failure either.
      return;
    }

    const bodyParameters = buildBodyParameters(order);

    const { messageId } = await whatsapp.sendOrderConfirmation({ to, bodyParameters });

    // No phone number in the log line: it is customer data and the order id
    // already identifies the row it belongs to.
    logger.info('WhatsApp order confirmation sent', { orderId, messageId });
    await recordStatus(orderId, STATUS_SUCCESS);
  } catch (err) {
    // The whole point of this file. The order is already committed and paid;
    // this is a message that did not arrive, not a failed order.
    logger.error('WhatsApp order confirmation failed, order is unaffected', {
      orderId,
      error: err.message,
    });
    await recordStatus(orderId, STATUS_FAILED);
  }
}

/**
 * Queue the confirmation to be sent once `transaction` commits.
 *
 * This is how a caller inside a transaction asks for a notification without
 * taking on any of its risk. If the transaction rolls back, the callback
 * never runs and no message is sent for an order that does not exist.
 *
 * @param {import('sequelize').Transaction} transaction
 * @param {number} orderId
 */
function queueOrderConfirmed(transaction, orderId) {
  if (!transaction || typeof transaction.afterCommit !== 'function') {
    // No transaction to hang it off (a caller outside one, or a test double).
    // Still fire-and-forget, still never rejecting.
    void notifyOrderConfirmed(orderId);
    return;
  }

  transaction.afterCommit(() => {
    // Not awaited: afterCommit's own promise chain must not be able to turn a
    // provider failure into a caller-visible error.
    void notifyOrderConfirmed(orderId);
  });
}

module.exports = { notifyOrderConfirmed, queueOrderConfirmed };
