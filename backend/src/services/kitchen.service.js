'use strict';

/**
 * The Kitchen Display System's read model.
 *
 * This service holds NO transition logic. Moving an order through the kitchen
 * is fulfilment.service's job, and the KDS calls it through the same function
 * the Dashboard uses. What lives here is the one thing the KDS genuinely needs
 * that the staff order API cannot express: the eligibility rule.
 *
 * THE ELIGIBILITY RULE
 *
 *   payment_status = 'paid'  AND  order_status IN (confirmed, preparing, ready)
 *
 * Both halves matter, and each is doing separate work.
 *
 * `paid` is the money guard. An order the customer abandoned in the Razorpay
 * modal sits at (pending, initiated) forever, and the kitchen must never make
 * food for it. Note this is read from the orders row, which is the only
 * authoritative payment state in the system - the KDS never calls Razorpay,
 * never verifies a signature, and never decides for itself that something was
 * paid for. It reads what the payment seam already settled.
 *
 * The status set is the work guard. `initiated` is excluded because an order
 * only leaves `initiated` when its payment is confirmed (fulfilment.service
 * confirmOnPayment), so an order still sitting in `initiated` has not been
 * paid for - the two conditions agree, and requiring both means a bug in
 * either one alone cannot leak an unpaid order onto a kitchen screen.
 * `rejected` is excluded because it is cancelled work. `delivered` is excluded
 * from the ACTIVE board but available through the completed view, so a cook can
 * still answer "did that go out?" without the board filling up with finished
 * tickets.
 *
 * A refunded order also drops off the board, which is correct: the money went
 * back, so the food should not go out.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const { NotFoundError, ValidationError, AuthorizationError } = require('../utils/errors');
const { ROLES, PAGINATION } = require('../constants');
const fulfilmentService = require('./fulfilment.service');

/**
 * Columns the kitchen is allowed to see.
 *
 * Deliberately narrower than the staff order API's PUBLIC_ATTRIBUTES. A
 * kitchen screen hangs on a wall where anyone walking past can read it, so the
 * customer's mobile number and email address are not on it, and neither are
 * the razorpay_* identifiers - a cook has no use for a gateway payment id and
 * a wall display is not where one should be readable.
 *
 * Money is included because `total` is on the physical ticket and staff use it
 * when handing an order over.
 */
const KDS_ATTRIBUTES = [
  'id',
  'cinemaId',
  'screenId',
  'seatNumber',
  'statusId',
  'paymentStatusId',
  'source',
  'filmTitle',
  'showTime',
  'total',
  'notes',
  'deliveredAt',
  'createdAt',
  'updatedAt',
];

const ITEM_ATTRIBUTES = ['id', 'productId', 'productName', 'quantity', 'unitPrice', 'total'];

/**
 * Roles that are chain-level by design.
 *
 * Mirrors the reason users.cinema_id is nullable at all - see models/user.js:
 * "Nullable for owner and chain_admin roles, which are not cinema-scoped".
 * Every other role describes a job done at one site, so a null cinema on one
 * of those is a provisioning mistake rather than an intent to span the chain.
 */
const CHAIN_LEVEL_ROLES = Object.freeze([ROLES.OWNER, ROLES.CHAIN_ADMIN]);

/**
 * The tenant boundary for a kitchen request, derived ENTIRELY from the
 * authenticated user.
 *
 * Nothing a client sends reaches this function. A kitchen display is a fixed
 * terminal on one counter, and the account signed into it is what says which
 * counter that is - so the cinema comes from users.cinema_id, never from a
 * query parameter, a header or a request body. A caller can narrow what it
 * asks for; it can never widen what it is allowed to see.
 *
 * Three outcomes:
 *
 *   - cinema-assigned (any role)  -> pinned to that one cinema. This is the
 *     normal kitchen account, and it is the narrowest scope, so it is checked
 *     first: an owner deliberately assigned to a cinema is honoured rather
 *     than quietly promoted to seeing everything.
 *   - chain-level role, no cinema -> the whole chain (owner: every chain).
 *     A supervisor or chain admin watching several kitchens.
 *   - anything else               -> refused. A kitchen_staff account with no
 *     cinema cannot be given "all cinemas in the chain" by default; that is
 *     precisely the widening this function exists to prevent.
 *
 * @throws {AuthorizationError} When a cinema-scoped role has no cinema. This
 *   is a 403 rather than an empty board on purpose: an empty board looks like
 *   a quiet day, and the operator would have no idea the account is
 *   misconfigured.
 */
function resolveKitchenScope(actor) {
  if (actor.cinemaId) {
    return { chainId: actor.chainId, cinemaId: actor.cinemaId };
  }

  if (actor.role === ROLES.OWNER) {
    return { chainId: null, cinemaId: null };
  }

  if (CHAIN_LEVEL_ROLES.includes(actor.role)) {
    return { chainId: actor.chainId, cinemaId: null };
  }

  throw new AuthorizationError(
    'This account is not assigned to a cinema, so it has no kitchen board. ' +
      'Ask an administrator to assign it to one.',
    undefined,
    { role: actor.role }
  );
}

/**
 * Tenant scope applied through the cinema join - orders has no chain_id of its
 * own, so the chain is only reachable this way.
 *
 * `required: true` matters: it makes this an INNER JOIN, so an order whose
 * cinema falls outside the scope is dropped by the join itself rather than by
 * a filter a later edit might forget to apply.
 */
function cinemaScope(scope) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId', 'code', 'name'],
    required: true,
    where: scope.chainId === null ? undefined : { chainId: scope.chainId },
  };
}

/**
 * Fold the user's scope into the order WHERE clause.
 *
 * The cinema pin is applied here, on the orders table, in addition to the
 * chain filter on the join above. Both are kept: the chain filter still proves
 * the cinema belongs to the actor's chain, so a user whose cinema_id somehow
 * pointed outside their own chain matches nothing rather than escaping.
 */
function applyScope(where, scope) {
  if (scope.cinemaId !== null) where.cinemaId = scope.cinemaId;
  return where;
}

function kdsIncludes(scope) {
  return [
    cinemaScope(scope),
    { association: 'screen', attributes: ['id', 'name'], required: false },
    { association: 'status', attributes: ['id', 'code', 'name'], required: false },
    { association: 'paymentStatus', attributes: ['id', 'code', 'name'], required: false },
    { association: 'items', attributes: ITEM_ATTRIBUTES, required: false },
  ];
}

/**
 * Shape an order for a kitchen screen.
 *
 * Everything here is a real column. Fields a KDS conventionally shows that this
 * schema has no room for - per-item modifiers, combo composition, a separate
 * booking reference, a prep station - are absent rather than faked. `notes` is
 * the order-level special instruction the consumer app collects, and it is the
 * only free text an order carries.
 */
function serializeKdsOrder(order) {
  if (!order) return null;

  return {
    id: order.id,
    status: order.status ? order.status.code : null,
    paymentStatus: order.paymentStatus ? order.paymentStatus.code : null,
    source: order.source,
    seatNumber: order.seatNumber,
    filmTitle: order.filmTitle,
    showTime: order.showTime,
    notes: order.notes,
    total: order.total,
    cinema: order.cinema ? { id: order.cinema.id, name: order.cinema.name } : null,
    screen: order.screen ? { id: order.screen.id, name: order.screen.name } : null,
    items: (order.items || []).map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    // The clocks a kitchen runs on. createdAt is when the order was placed;
    // the elapsed time a screen shows is derived from it client-side so the
    // number keeps ticking between polls.
    placedAt: order.createdAt,
    updatedAt: order.updatedAt,
    deliveredAt: order.deliveredAt,
  };
}

/**
 * The eligibility WHERE clause, built once so the list and the detail read
 * cannot drift apart. A detail endpoint that applied a looser rule than the
 * board would let an unpaid order be opened by guessing its id.
 *
 * @param {'active'|'completed'|'all'} scope
 */
function eligibilityWhere(scope, paidStatusId, statusIdsByCode) {
  const active = fulfilmentService.KDS_ACTIVE_STATUSES.map((code) => statusIdsByCode[code]);
  const completed = fulfilmentService.KDS_COMPLETED_STATUSES.map((code) => statusIdsByCode[code]);

  let statusIds;
  if (scope === 'completed') statusIds = completed;
  else if (scope === 'all') statusIds = [...active, ...completed];
  else statusIds = active;

  return {
    paymentStatusId: paidStatusId,
    statusId: { [Op.in]: statusIds },
  };
}

/** Resolve every status code the KDS cares about to its id, in one query each. */
async function resolveStatusIds() {
  const [orderStatuses, paidStatus] = await Promise.all([
    models.OrderStatus.findAll({ attributes: ['id', 'code'] }),
    models.PaymentStatus.findOne({
      where: { code: fulfilmentService.KDS_ELIGIBLE_PAYMENT_STATUS },
      attributes: ['id'],
    }),
  ]);

  if (!paidStatus) {
    throw new Error('Payment status "paid" is missing from the master table. Run the seeders.');
  }

  const statusIdsByCode = {};
  for (const status of orderStatuses) {
    statusIdsByCode[status.code] = status.id;
  }

  for (const code of [
    ...fulfilmentService.KDS_ACTIVE_STATUSES,
    ...fulfilmentService.KDS_COMPLETED_STATUSES,
  ]) {
    if (!statusIdsByCode[code]) {
      throw new Error(`Order status "${code}" is missing from the master table. Run the seeders.`);
    }
  }

  return { statusIdsByCode, paidStatusId: paidStatus.id };
}

/**
 * The kitchen board.
 *
 * Sorted oldest-first by default, which is the opposite of the staff order
 * list and is the whole point: a kitchen works a queue, so the order that has
 * been waiting longest belongs at the top. `showTime` is offered as an
 * alternative because a cinema kitchen often works to the screening rather
 * than to the order clock - food for a 14:00 show is wanted before food
 * ordered earlier for a 15:30 one.
 *
 * @param {object} actor The authenticated kitchen user.
 * @param {object} query Validated query params.
 */
async function listKitchenOrders(actor, query) {
  const {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    scope = 'active',
    sort = 'placedAt',
    order = 'asc',
    search,
    cinemaId,
    screenId,
    status,
  } = query;

  // Established before anything the caller sent is looked at.
  const tenant = resolveKitchenScope(actor);

  const { statusIdsByCode, paidStatusId } = await resolveStatusIds();

  const where = applyScope(eligibilityWhere(scope, paidStatusId, statusIdsByCode), tenant);

  /*
   * `cinemaId` is a convenience filter for an account that legitimately spans
   * several cinemas - a chain admin narrowing to one kitchen. It is applied
   * ONLY when the user is not already pinned to a cinema.
   *
   * For a pinned kitchen account the parameter is ignored outright rather than
   * intersected. Intersecting would make `?cinemaId=<other>` return an empty
   * board, which reads as "no orders" and invites someone to conclude the
   * other cinema is quiet. Ignoring it means the display always shows its own
   * counter, whatever the URL says.
   */
  if (cinemaId && tenant.cinemaId === null) where.cinemaId = cinemaId;

  if (screenId) where.screenId = screenId;

  // Narrowing to one status intersects with the eligibility set rather than
  // replacing it: asking for `initiated` cannot widen what the kitchen sees,
  // because the validator only accepts codes already inside that set.
  if (status) where.statusId = statusIdsByCode[status];

  // What a cook has to hand when someone walks up to the counter: the order
  // number called out, or the seat it is going to. There is no separate order
  // number in the schema, so the id is the token.
  if (search) {
    const like = { [Op.like]: `%${search}%` };
    const asId = Number(search);

    where[Op.or] = [
      { seatNumber: like },
      { filmTitle: like },
      ...(Number.isInteger(asId) && asId > 0 ? [{ id: asId }] : []),
    ];
  }

  // `placedAt` is the API's name for created_at; the column has to be named
  // for the ORDER BY. The validator whitelists these, so no caller-supplied
  // string reaches the query.
  const sortColumn = { placedAt: 'createdAt', showTime: 'showTime', id: 'id' }[sort] || 'createdAt';

  const { rows, count } = await models.Order.findAndCountAll({
    where,
    attributes: KDS_ATTRIBUTES,
    include: kdsIncludes(tenant),
    order: [[sortColumn, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
    // Without this the items hasMany join multiplies each order by its item
    // count and `count` reports rows rather than orders.
    distinct: true,
  });

  return { orders: rows.map(serializeKdsOrder), total: count };
}

/**
 * One eligible order in full.
 *
 * An order that exists but is not KDS-eligible - unpaid, rejected, or in
 * another chain - is a 404 here, not a 403. The kitchen has no business
 * learning that an unpaid order exists, and this matches the tenant rule the
 * rest of the API follows.
 */
async function getKitchenOrder(actor, orderId) {
  // Same scope as the board. An id typed into the URL is not a way round it:
  // the cinema pin is part of the WHERE clause, so an order belonging to
  // another cinema simply does not match.
  const tenant = resolveKitchenScope(actor);

  const { statusIdsByCode, paidStatusId } = await resolveStatusIds();

  const order = await models.Order.findOne({
    where: applyScope(
      {
        id: orderId,
        ...eligibilityWhere('all', paidStatusId, statusIdsByCode),
      },
      tenant
    ),
    attributes: KDS_ATTRIBUTES,
    include: kdsIncludes(tenant),
  });

  if (!order) throw new NotFoundError('Order');

  return serializeKdsOrder(order);
}

/**
 * Move an eligible order along the kitchen workflow.
 *
 * This function contains no transition rules. It establishes that the caller
 * is allowed to touch this order at all - right chain, paid, not cancelled,
 * and asking for a move a kitchen user is permitted to make - and then hands
 * the actual transition to fulfilment.service, which is the same code path the
 * Dashboard uses. A status change made here and one made from the Dashboard
 * are the same write, validated the same way and audited the same way, so the
 * two surfaces cannot disagree about what happened.
 *
 * The KDS deliberately cannot reach `rejected` or `confirmed`. Rejecting an
 * order is a commercial decision with a refund attached and belongs to staff
 * with the Dashboard in front of them, not to a wall-mounted screen where it
 * is one mis-tap away. `confirmed` is set by payment, never by a person.
 *
 * @throws {NotFoundError}  Order is outside the actor's chain, unpaid, or not
 *   an order the kitchen is responsible for.
 * @throws {ConflictError}  Illegal move, or another device got there first.
 */
async function updateKitchenOrderStatus(actor, orderId, { status, reason }) {
  if (!fulfilmentService.KDS_ALLOWED_TARGETS.includes(status)) {
    throw new ValidationError('That is not a status the kitchen can set', [
      {
        field: 'status',
        message: `Must be one of: ${fulfilmentService.KDS_ALLOWED_TARGETS.join(', ')}`,
      },
    ]);
  }

  // Resolved before the transaction opens: it depends only on the actor, so
  // there is no reason to hold a transaction open to reject a misconfigured
  // account.
  const tenant = resolveKitchenScope(actor);

  await sequelize.transaction(async (transaction) => {
    const { statusIdsByCode, paidStatusId } = await resolveStatusIds();

    const order = await models.Order.findOne({
      where: applyScope(
        {
          id: orderId,
          // The eligibility rule is re-applied on the write path, not just on
          // the read path. A board that was loaded while the order was still
          // eligible must not be able to drive a transition on an order that
          // has since been refunded or rejected.
          ...eligibilityWhere('all', paidStatusId, statusIdsByCode),
        },
        tenant
      ),
      include: [
        // The cinema pin is on the WHERE clause above and the chain filter is
        // on this join, so a cross-cinema id fails to load and is reported as
        // 404 below - the write path is scoped exactly like the read path.
        cinemaScope(tenant),
        { association: 'status', attributes: ['id', 'code'], required: false },
      ],
      transaction,
    });

    if (!order) throw new NotFoundError('Order');

    await fulfilmentService.applyStatusTransition(
      { order, targetStatus: status, actorId: actor.id, reason: reason ?? null },
      transaction
    );
  });

  // Re-read so the caller gets the order as it now is, including anything a
  // concurrent writer changed. The KDS replaces its local copy with this.
  return getKitchenOrder(actor, orderId);
}

module.exports = {
  listKitchenOrders,
  getKitchenOrder,
  updateKitchenOrderStatus,
  serializeKdsOrder,
  KDS_ATTRIBUTES,
};
