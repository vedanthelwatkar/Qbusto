'use strict';

/**
 * The single owner of an order's FULFILMENT lifecycle.
 *
 * Fulfilment is what the kitchen does: confirm, prepare, hand over. It is a
 * separate axis from payment, which lives in paymenttransition.service. An
 * order is (paid, preparing) or (pending, confirmed) - the two columns move
 * independently and neither is derived from the other. The only place they
 * touch is confirmOnPayment below, and that coupling runs in exactly one
 * direction: payment can start fulfilment, fulfilment can never mark anything
 * paid.
 *
 * WHY THIS FILE EXISTS
 *
 * Before the KDS there was one caller moving order status - the Dashboard,
 * through order.service.updateOrderStatus. The kitchen is a second caller, and
 * a second caller is exactly the point at which "just write the same check
 * again over here" produces two graphs that drift. So the graph, the
 * compare-and-set and the audit log live here, and both callers go through
 * applyStatusTransition.
 *
 * THE CONCURRENCY RULE
 *
 * The transition is a conditional UPDATE matching only a row still in the
 * status we read. Two kitchen screens, or a kitchen screen and the Dashboard,
 * both pressing READY on the same order will both pass the in-memory legality
 * check - they read the same row a millisecond apart. Only one of them matches
 * a row. The loser is told the order moved underneath it and re-reads, rather
 * than writing a second audit entry describing a change that did not happen.
 *
 * The arbiter is the database row, not anything in application memory, so this
 * holds across separate Node processes as well as across requests.
 */

const { models } = require('../config/database');
const { ORDER_STATUSES, PAYMENT_STATUSES } = require('../constants');
const { ConflictError } = require('../utils/errors');

/**
 * Legal fulfilment moves, keyed by the code the order is currently in.
 *
 * The forward path is documented in docs/schema-explained.md:
 * initiated -> confirmed -> preparing -> ready -> delivered. A straight line
 * with no skipping, so an order cannot be marked delivered while the kitchen
 * was never told to make it.
 *
 * `rejected` is reachable from every non-terminal state. `delivered` and
 * `rejected` are terminal - reopening a finished order would need an
 * "un-deliver" concept the schema does not have.
 *
 * This object is the authoritative graph for the whole application. The
 * Dashboard and the KDS both validate against it; neither keeps its own copy.
 */
const ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.INITIATED]: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.REJECTED],
  [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.PREPARING, ORDER_STATUSES.REJECTED],
  [ORDER_STATUSES.PREPARING]: [ORDER_STATUSES.READY, ORDER_STATUSES.REJECTED],
  [ORDER_STATUSES.READY]: [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.REJECTED],
  [ORDER_STATUSES.DELIVERED]: [],
  [ORDER_STATUSES.REJECTED]: [],
});

/**
 * The fulfilment states the kitchen is responsible for.
 *
 * `initiated` is deliberately absent. An order sits in `initiated` until its
 * payment is discovered, at which point confirmOnPayment moves it to
 * `confirmed` - so "still initiated" means "not yet paid for", and the kitchen
 * must not see it. See kitchen.service for the full eligibility rule.
 */
const KDS_ACTIVE_STATUSES = Object.freeze([
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.PREPARING,
  ORDER_STATUSES.READY,
]);

/** Finished work, kept out of the active queues but still visible for a while. */
const KDS_COMPLETED_STATUSES = Object.freeze([ORDER_STATUSES.DELIVERED]);

/** The moves a kitchen user may make. A narrower set than the full graph. */
const KDS_ALLOWED_TARGETS = Object.freeze([
  ORDER_STATUSES.PREPARING,
  ORDER_STATUSES.READY,
  ORDER_STATUSES.DELIVERED,
]);

/**
 * Resolve an order status code to the id its column stores.
 *
 * A code missing from the master table is a 500, not a client error: the codes
 * come from Joi `valid()` lists built from constants, so reaching this branch
 * means the seeders did not run.
 */
async function resolveOrderStatusId(code, transaction) {
  const status = await models.OrderStatus.findOne({
    where: { code },
    attributes: ['id'],
    transaction,
  });

  if (!status) {
    throw new Error(
      `Status code "${code}" is missing from the order status master table. Run the seeders.`
    );
  }

  return status.id;
}

/**
 * @throws {ConflictError} 409 listing what the order could legally move to.
 */
function assertTransitionAllowed(from, to) {
  const allowed = ORDER_TRANSITIONS[from] || [];

  if (!allowed.includes(to)) {
    throw new ConflictError(
      allowed.length === 0
        ? `This order is ${from} and its status can no longer change`
        : `An order cannot go from ${from} to ${to}`,
      { from, to, allowed }
    );
  }
}

/**
 * Move an order to a new fulfilment status, exactly once, recording the move.
 *
 * Must be called inside a transaction owned by the caller so the update and its
 * audit row commit together. An order whose status changed without a log entry
 * has lost the only record of who changed it and when.
 *
 * Three outcomes:
 *
 *   - `{ transitioned: true }`  - this caller made the change.
 *   - `{ transitioned: false, reason: 'noop' }` - the order was already in the
 *     requested status. Not an error: two screens both pressing READY is a
 *     race, and the second one got the outcome it wanted.
 *   - throws ConflictError - either the move is illegal from the current
 *     status, or another writer moved the row between our read and our write.
 *
 * @param {object} params
 * @param {object} params.order        A loaded Order instance with `status`.
 * @param {string} params.targetStatus An ORDER_STATUSES code.
 * @param {number|null} params.actorId  User making the change, for the audit row.
 * @param {string|null} params.reason   Free-text audit note.
 * @param {import('sequelize').Transaction} transaction
 */
async function applyStatusTransition(
  { order, targetStatus, actorId = null, reason = null },
  transaction
) {
  const current = order.status ? order.status.code : null;

  // Idempotent by design: asking for the status the order is already in writes
  // nothing and reports success, matching how deactivation behaves elsewhere.
  if (current === targetStatus) {
    return { transitioned: false, reason: 'noop', status: current };
  }

  assertTransitionAllowed(current, targetStatus);

  const newStatusId = await resolveOrderStatusId(targetStatus, transaction);
  const previousStatusId = order.statusId;

  const [rowsUpdated] = await models.Order.update(
    {
      statusId: newStatusId,
      // The moment the customer got the food. Only meaningful on this one
      // transition, and never cleared: the transitions out of `delivered` are
      // empty, so it cannot be reached twice.
      ...(targetStatus === ORDER_STATUSES.DELIVERED ? { deliveredAt: new Date() } : {}),
    },
    {
      // The compare-and-set. `statusId` in the WHERE clause is what makes this
      // safe against a concurrent writer: if anyone moved the order after we
      // read it, this matches zero rows.
      where: { id: order.id, statusId: previousStatusId },
      transaction,
    }
  );

  if (rowsUpdated !== 1) {
    throw new ConflictError('This order was updated by someone else. Refresh and try again.', {
      from: current,
      to: targetStatus,
      concurrent: true,
    });
  }

  await models.OrderStatusLog.create(
    {
      orderId: order.id,
      previousStatusId,
      newStatusId,
      changedByUserId: actorId,
      reason,
    },
    { transaction }
  );

  return { transitioned: true, status: targetStatus };
}

/**
 * Start fulfilment for an order whose payment has just been confirmed.
 *
 * CALLED FROM THE POST-PAYMENT SEAM, AND FROM NOWHERE THAT WATCHES A GATEWAY.
 *
 * An order is created `initiated` / `pending` and stays `initiated` while the
 * customer is paying. Payment is what turns it into work for the kitchen, so
 * `initiated -> confirmed` happens here, at the one point that already knows a
 * payment moved from pending to paid exactly once.
 *
 * This is deliberately NOT attached to "a webhook arrived" or "verify was
 * called" or "reconciliation found a capture". Those are three ways of
 * discovering the same payment, and attaching a kitchen side effect to each of
 * them is precisely how one payment becomes three kitchen tickets.
 *
 * Idempotent twice over: the compare-and-set below matches only an order still
 * in `initiated`, and the seam that calls it is itself reached only once per
 * order. An order a human already confirmed, or already rejected, is left
 * exactly as it is.
 *
 * @returns {Promise<{confirmed: boolean}>} `false` means it was not in
 *   `initiated` - never an error.
 */
async function confirmOnPayment(orderId, transaction) {
  const [confirmedId, initiatedId] = await Promise.all([
    resolveOrderStatusId(ORDER_STATUSES.CONFIRMED, transaction),
    resolveOrderStatusId(ORDER_STATUSES.INITIATED, transaction),
  ]);

  const [rowsUpdated] = await models.Order.update(
    { statusId: confirmedId },
    { where: { id: orderId, statusId: initiatedId }, transaction }
  );

  if (rowsUpdated !== 1) {
    return { confirmed: false };
  }

  await models.OrderStatusLog.create(
    {
      orderId,
      previousStatusId: initiatedId,
      newStatusId: confirmedId,
      // No human made this change, so the audit row honestly records none.
      changedByUserId: null,
      reason: 'Payment confirmed',
    },
    { transaction }
  );

  return { confirmed: true };
}

module.exports = {
  ORDER_TRANSITIONS,
  KDS_ACTIVE_STATUSES,
  KDS_COMPLETED_STATUSES,
  KDS_ALLOWED_TARGETS,
  KDS_ELIGIBLE_PAYMENT_STATUS: PAYMENT_STATUSES.PAID,
  applyStatusTransition,
  assertTransitionAllowed,
  confirmOnPayment,
  resolveOrderStatusId,
};
