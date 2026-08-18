'use strict';

/**
 * The single owner of the pending -> paid transition.
 *
 * Three different things can now discover that a payment succeeded:
 *
 *   1. the browser posting a signature to payment-verify
 *   2. a Razorpay webhook
 *   3. reconciliation against Razorpay's own records, when neither of the
 *      above ever arrived
 *
 * Each is a legitimate discovery path, and any of them may be first. What none
 * of them may do is apply the transition twice, so the transition itself lives
 * here rather than being written out three times. Three copies of a
 * compare-and-set is how a future developer ends up attaching a kitchen ticket
 * to one of them and not the others.
 *
 * THE RULE
 *
 * The transition is a conditional UPDATE that only matches a row still in
 * `pending`. Whichever caller gets there first matches one row; every later
 * caller matches zero and is told it did not transition. That holds across
 * concurrent requests, across separate Node instances and across a webhook
 * racing the browser, because the arbiter is the database row, not anything in
 * application memory.
 */

const { models } = require('../config/database');
const { PAYMENT_STATUSES } = require('../constants');
const fulfilmentService = require('./fulfilment.service');

/** Resolve a payment status code to its id. */
async function resolvePaymentStatusId(code, transaction) {
  const status = await models.PaymentStatus.findOne({
    where: { code },
    attributes: ['id'],
    transaction,
  });

  if (!status) {
    throw new Error(`Payment status "${code}" not found in payment_statuses master table`);
  }

  return status.id;
}

/**
 * Move an order from pending to paid, exactly once.
 *
 * Must be called inside a transaction owned by the caller, so the transition
 * commits together with whatever else that caller is recording (a webhook
 * event row, for instance).
 *
 * @param {object} params
 * @param {number} params.orderId
 * @param {string|null} params.razorpayPaymentId Written only when supplied, so
 *   a source that does not carry one cannot erase a value another source
 *   already recorded.
 * @param {string} params.reason Audit text for the status log.
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<{transitioned: boolean}>} `false` means someone else had
 *   already done it — never an error.
 */
async function applyPaidTransition({ orderId, razorpayPaymentId = null, reason }, transaction) {
  const [paidStatusId, pendingStatusId] = await Promise.all([
    resolvePaymentStatusId(PAYMENT_STATUSES.PAID, transaction),
    resolvePaymentStatusId(PAYMENT_STATUSES.PENDING, transaction),
  ]);

  const changes = { paymentStatusId: paidStatusId };
  if (razorpayPaymentId) {
    changes.razorpayPaymentId = razorpayPaymentId;
  }

  const [rowsUpdated] = await models.Order.update(changes, {
    where: { id: orderId, paymentStatusId: pendingStatusId },
    transaction,
  });

  if (rowsUpdated !== 1) {
    return { transitioned: false };
  }

  await models.PaymentStatusLog.create(
    {
      orderId,
      previousStatusId: pendingStatusId,
      newStatusId: paidStatusId,
      razorpayPaymentId,
      reason,
    },
    { transaction }
  );

  // ===================== POST-PAYMENT SEAM =====================
  // Reached exactly once per order, by whichever source discovered the
  // payment first. Duplicate webhooks, a browser verify that lost the race,
  // and repeated reconciliation all return above with transitioned: false and
  // never arrive here.
  //
  // Anything that must happen exactly once per paid order - kitchen ticket,
  // receipt, customer notification - belongs HERE, and nowhere else. Attaching
  // it to "a webhook arrived" or "verify was called" instead of "the row
  // moved" is what produces two kitchen tickets for one payment.
  // =============================================================

  // The order becomes work for the kitchen. This is the KDS "ticket": there is
  // no separate kitchen queue table, so the ticket is the order itself moving
  // initiated -> confirmed, which is what makes it visible to the KDS.
  //
  // Deliberately attached here and not in razorpaywebhook.service, not in
  // paymentVerify and not in reconciliation. Those are three ways of finding
  // out about ONE payment; this line runs once regardless of which of them got
  // there first, so a webhook retry racing the browser cannot produce two
  // tickets. confirmOnPayment is itself a compare-and-set on `initiated`, so
  // an order a human already confirmed or rejected is left alone.
  await fulfilmentService.confirmOnPayment(orderId, transaction);

  return { transitioned: true };
}

module.exports = { applyPaidTransition, resolvePaymentStatusId };
