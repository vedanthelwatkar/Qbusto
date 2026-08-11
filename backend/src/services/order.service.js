'use strict';

/**
 * Orders.
 *
 * An order is a business record rather than master data, which changes most of
 * the rules the other services follow:
 *
 *   - It is never deleted and never soft-deleted. `rejected` is how an order
 *     stops, and the row stays exactly as it was.
 *   - Its items are immutable snapshots. product_name, unit_price and discount
 *     are frozen at order time, so renaming or repricing a product later cannot
 *     rewrite what a customer was charged.
 *   - The client names products and quantities. Every rupee is calculated here
 *     from product_pricing; a price or total in the request body is stripped by
 *     validate() and never reaches this file.
 *
 * Statuses live in the order_statuses and payment_statuses master tables and
 * are addressed by `code` throughout. A numeric status id appears in this file
 * only as the value being written to a column, resolved from a code moments
 * earlier - see resolveStatusId.
 *
 * Both status columns are audited. Every change writes an order_status_logs or
 * payment_status_logs row in the same transaction as the update, so the log can
 * never disagree with the order it describes.
 *
 * Tenant scope is applied through the cinema, exactly as it is for screens,
 * banners, pricing and availability: orders has no chain_id of its own.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const {
  ROLES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ORDER_SOURCES,
  PAGINATION,
} = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'screenId',
  'seatNumber',
  'statusId',
  'source',
  'customerMobile',
  'customerEmail',
  'filmTitle',
  'showTime',
  'subtotal',
  'discount',
  'total',
  'paymentStatusId',
  'smsStatus',
  'whatsappStatus',
  'razorpayOrderId',
  'razorpayPaymentId',
  'notes',
  'deliveredAt',
  'createdAt',
  'updatedAt',
];

const ITEM_ATTRIBUTES = [
  'id',
  'orderId',
  'productId',
  'productName',
  'posItemId',
  'quantity',
  'unitPrice',
  'discount',
  'total',
];

const STATUS_ATTRIBUTES = ['id', 'code', 'name', 'description', 'isActive'];

/**
 * Legal order status moves, keyed by the code the order is currently in.
 *
 * The forward path is the one documented in docs/schema-explained.md:
 * initiated -> confirmed -> preparing -> ready -> delivered. It is a straight
 * line with no skipping, so an order cannot be marked delivered while the
 * kitchen has not been told to make it.
 *
 * `rejected` is reachable from every non-terminal state. The schema seeds
 * exactly one failure status and defines no point past which an order stops
 * being cancellable, and refusing to reject an order that is merely `ready`
 * would leave staff with no way to record a customer who never collected it.
 *
 * `delivered` and `rejected` are terminal: both map to an empty set. Reopening
 * a finished order would need an "un-deliver" concept the schema does not have.
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
 * Legal payment status moves.
 *
 * `failed` is not terminal: a declined card is retried, which puts the payment
 * back to `pending`, and a retry that succeeds lands on `paid` directly.
 * `refunded` is only reachable from `paid`, since there is nothing to refund
 * otherwise.
 */
const PAYMENT_TRANSITIONS = Object.freeze({
  [PAYMENT_STATUSES.PENDING]: [PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.FAILED],
  [PAYMENT_STATUSES.FAILED]: [PAYMENT_STATUSES.PENDING, PAYMENT_STATUSES.PAID],
  [PAYMENT_STATUSES.PAID]: [PAYMENT_STATUSES.REFUNDED],
  [PAYMENT_STATUSES.REFUNDED]: [],
});

/** orders.source -> the product_pricing column holding that channel's discount. */
const SOURCE_DISCOUNT_COLUMN = Object.freeze({
  [ORDER_SOURCES.QR]: 'discountOnQr',
  [ORDER_SOURCES.SEAT_QR]: 'discountOnSeatQr',
  [ORDER_SOURCES.KIOSK]: 'discountOnKiosk',
  [ORDER_SOURCES.COUNTER]: 'discountOnCounter',
});

/** product_pricing.day_of_week / product_availability_hours.day_of_week */
const EVERY_DAY = 0;

// ---------------------------------------------------------------------------
// Money
//
// Every amount is computed in integer paise and only rendered back to a decimal
// string at the end. Doing it in rupees would mean floating point: 0.1 + 0.2 is
// not 0.3, and a percentage discount on an odd price compounds the error across
// a multi-line order until subtotal - discount no longer equals total, which
// the CHECK constraints would then reject with nothing useful to say.
// ---------------------------------------------------------------------------

/** '250.00' | 250 -> 25000. */
function toPaise(value) {
  return Math.round(Number(value) * 100);
}

/** 25000 -> '250.00', the exact string a DECIMAL(10,2) column wants. */
function toDecimalString(paise) {
  return (paise / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function pick(instance, attributes) {
  if (!instance) return null;

  const result = {};
  for (const attribute of attributes) {
    result[attribute] = instance[attribute];
  }

  return result;
}

function serializeStatus(status) {
  return pick(status, STATUS_ATTRIBUTES);
}

/**
 * A log entry, with both ends of the move given as codes.
 *
 * The numeric ids are included as well because they are what the row actually
 * stores, but a client should read the codes: an id means nothing without the
 * master table beside it.
 */
function serializeLog(log, extra = {}) {
  if (!log) return null;

  return {
    id: log.id,
    orderId: log.orderId,
    previousStatusId: log.previousStatusId,
    previousStatus: log.previousStatus ? log.previousStatus.code : null,
    newStatusId: log.newStatusId,
    newStatus: log.newStatus ? log.newStatus.code : null,
    changedByUserId: log.changedByUserId,
    reason: log.reason,
    createdAt: log.createdAt,
    ...extra,
  };
}

/**
 * An order, with whatever associations were loaded folded in.
 *
 * `status` and `paymentStatus` are flattened to their codes so a caller can act
 * on them without carrying the master rows around; the full rows stay available
 * under `statusDetail` / `paymentStatusDetail` on the single-order read, where
 * the display name is wanted too.
 */
function serializeOrder(order) {
  if (!order) return null;

  const result = pick(order, PUBLIC_ATTRIBUTES);

  result.status = order.status ? order.status.code : null;
  result.paymentStatus = order.paymentStatus ? order.paymentStatus.code : null;

  if (order.status) result.statusDetail = serializeStatus(order.status);
  if (order.paymentStatus) result.paymentStatusDetail = serializeStatus(order.paymentStatus);

  if (order.cinema) {
    result.cinema = { id: order.cinema.id, code: order.cinema.code, name: order.cinema.name };
  }

  if (order.screen) {
    result.screen = { id: order.screen.id, name: order.screen.name };
  }

  if (order.items) {
    result.items = order.items.map((item) => pick(item, ITEM_ATTRIBUTES));
  }

  if (order.statusLogs) {
    result.statusLogs = order.statusLogs.map((log) => serializeLog(log));
  }

  if (order.paymentStatusLogs) {
    result.paymentStatusLogs = order.paymentStatusLogs.map((log) =>
      serializeLog(log, { razorpayPaymentId: log.razorpayPaymentId })
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * Join to the owning cinema, filtered to the actor's chain.
 *
 * orders has no chain_id, so scope is applied through the cinema exactly as it
 * is for screens, banners, pricing and availability hours. `required: true`
 * makes it an inner join, so an order in another chain drops out of the result
 * set entirely and reads as 404 rather than 403.
 *
 * This is chain-level, not cinema-level. No service in the codebase narrows to
 * `actor.cinemaId`, and doing it here alone would be a second authorization
 * model that only orders obey.
 */
function cinemaScope(actor, attributes = ['id', 'chainId']) {
  return {
    association: 'cinema',
    attributes,
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * Resolve a status code to the id its column stores.
 *
 * Every write goes through here, which is what keeps numeric ids out of the
 * application logic. A code that is not in the master table is a 500 rather
 * than a client error: the codes come from a Joi `valid()` list built from
 * constants, so reaching this branch means the seeders did not run, not that
 * the request was wrong.
 *
 * @param {'order'|'payment'} kind Which master table to read.
 */
async function resolveStatusId(kind, code, transaction) {
  const model = kind === 'order' ? models.OrderStatus : models.PaymentStatus;

  const status = await model.findOne({ where: { code }, attributes: ['id'], transaction });

  if (!status) {
    throw new Error(
      `Status code "${code}" is missing from the ${kind === 'order' ? 'order' : 'payment'} ` +
        'status master table. Run the seeders.'
    );
  }

  return status.id;
}

// ---------------------------------------------------------------------------
// Availability and pricing
// ---------------------------------------------------------------------------

/**
 * The ISO day number for a date: 1 = Monday ... 7 = Sunday.
 *
 * `Date.getDay()` returns 0 for Sunday, which collides with the schema's
 * "0 = every day", so it is remapped rather than used directly.
 */
function isoDayOfWeek(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** A Date as the 'HH:MM:SS' string a TIME column is compared against. */
function timeOfDay(date) {
  const pad = (part) => String(part).padStart(2, '0');

  return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
}

/**
 * Render whatever the driver hands back for a TIME column as 'HH:MM:SS'.
 *
 * Mirrors availability.service.formatTime: a TIME arrives as a Date pinned to
 * 1970-01-01 with the time in UTC, so the UTC accessors are the correct ones.
 */
function formatStoredTime(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;

  const pad = (part) => String(part).padStart(2, '0');

  return [pad(value.getUTCHours()), pad(value.getUTCMinutes()), pad(value.getUTCSeconds())].join(
    ':'
  );
}

/**
 * Whether a cinema product is orderable at `now`, per docs/schema.md.
 *
 * The rule has five parts and the last two are the subtle ones: hours *restrict*
 * availability, so a product with no windows at all is available all day, while
 * a product with windows is available only inside one of them. Reading "no rows"
 * as "never available" would silently close every product that has not had a
 * schedule entered.
 *
 * @returns {string|null} A reason it is unavailable, or null when it is.
 */
function unavailableReason(cinemaProduct, now) {
  if (!cinemaProduct.isActive) {
    return 'is not currently carried at this cinema';
  }

  if (cinemaProduct.availableFrom && now < new Date(cinemaProduct.availableFrom)) {
    return 'is not available at this cinema yet';
  }

  if (cinemaProduct.availableUntil && now > new Date(cinemaProduct.availableUntil)) {
    return 'is no longer available at this cinema';
  }

  const hours = cinemaProduct.availabilityHours || [];

  // Rule 5: no windows means no time-of-day restriction.
  if (hours.length === 0) return null;

  const day = isoDayOfWeek(now);
  const time = timeOfDay(now);

  const open = hours.some((hour) => {
    if (hour.dayOfWeek !== EVERY_DAY && hour.dayOfWeek !== day) return false;

    const start = formatStoredTime(hour.startTime);
    const end = formatStoredTime(hour.endTime);

    // Half-open: a window ending at 17:00:00 is closed at 17:00:00, so two
    // touching windows never both claim the same instant.
    return start <= time && time < end;
  });

  return open ? null : 'is not available at this time of day';
}

/**
 * The price row that applies to a product at a cinema on a given day.
 *
 * A day-specific row wins over the every-day row, which is the whole point of
 * having both: day 0 is the standing price and day N overrides it. Inactive
 * rows are excluded by the caller's query.
 */
function selectPricing(pricings, day) {
  return (
    pricings.find((pricing) => pricing.dayOfWeek === day) ||
    pricings.find((pricing) => pricing.dayOfWeek === EVERY_DAY) ||
    null
  );
}

/**
 * The per-unit discount in paise for one price row on one channel.
 *
 * `discount_type` governs every amount on the row: 'P' makes them percentages
 * of the base price, 'F' makes them flat rupee amounts. Without a type the
 * amounts are meaningless - the ProductPricing hook refuses to store them at
 * all - so no type means no discount.
 *
 * The channel column matching the order's source is preferred, falling back to
 * `discount_value` as the row's general discount. A null channel column means
 * "nothing specific to this channel", not "no discount", so the fallback is on
 * null rather than on the source being absent.
 *
 * Clamped to the unit price: a flat discount larger than the item, or a
 * percentage above 100, would otherwise produce a negative line total and
 * violate CK_order_items_total.
 */
function unitDiscountPaise(pricing, source, unitPricePaise) {
  if (!pricing.discountType) return 0;

  const column = source ? SOURCE_DISCOUNT_COLUMN[source] : undefined;
  const channelValue = column ? pricing[column] : null;
  const raw =
    channelValue !== null && channelValue !== undefined ? channelValue : pricing.discountValue;

  if (raw === null || raw === undefined) return 0;

  const discount =
    pricing.discountType === 'P' ? Math.round((unitPricePaise * Number(raw)) / 100) : toPaise(raw);

  return Math.min(Math.max(discount, 0), unitPricePaise);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Associations for a list row.
 *
 * Items come along because the dashboard shows them in the list, and Sequelize
 * loads them in one extra query for the whole page rather than one per order -
 * fetching them per row afterwards is exactly the N+1 this avoids.
 */
function listIncludes(actor) {
  return [
    cinemaScope(actor, ['id', 'chainId', 'code', 'name']),
    { association: 'screen', attributes: ['id', 'name'], required: false },
    { association: 'status', attributes: STATUS_ATTRIBUTES, required: false },
    { association: 'paymentStatus', attributes: STATUS_ATTRIBUTES, required: false },
    { association: 'items', attributes: ITEM_ATTRIBUTES, required: false },
  ];
}

/**
 * Paginated, filtered order list.
 *
 * Status filters are given as codes and resolved to ids here, so a caller never
 * has to know what `status_id = 3` means.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{orders: object[], total: number}>}
 */
async function listOrders(actor, query) {
  const {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    sort = 'createdAt',
    order = 'desc',
    search,
    cinemaId,
    screenId,
    status,
    paymentStatus,
    source,
    createdFrom,
    createdTo,
  } = query;

  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (screenId) where.screenId = screenId;
  if (source) where.source = source;

  if (status) where.statusId = await resolveStatusId('order', status);
  if (paymentStatus) where.paymentStatusId = await resolveStatusId('payment', paymentStatus);

  if (createdFrom || createdTo) {
    where.createdAt = {};
    if (createdFrom) where.createdAt[Op.gte] = createdFrom;
    if (createdTo) where.createdAt[Op.lte] = createdTo;
  }

  // The fields a counter or kitchen user has to hand when someone asks about
  // an order. There is no order number in the schema, so the id is included.
  if (search) {
    const like = { [Op.like]: `%${search}%` };
    const asId = Number(search);

    where[Op.or] = [
      { customerMobile: like },
      { customerEmail: like },
      { seatNumber: like },
      { filmTitle: like },
      ...(Number.isInteger(asId) && asId > 0 ? [{ id: asId }] : []),
    ];
  }

  const { rows, count } = await models.Order.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    // Carries the tenant filter; a cinemaId from another chain narrows an
    // already-scoped set rather than escaping it.
    include: listIncludes(actor),
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
    // Without this the hasMany join multiplies each order by its item count and
    // `count` reports rows, not orders.
    distinct: true,
  });

  return { orders: rows.map(serializeOrder), total: count };
}

/**
 * One order in full: items, both status master rows, and both audit trails.
 *
 * The logs are included rather than given endpoints of their own. An order has
 * a handful of transitions at most, they are only ever read beside the order
 * itself, and loading them here costs two queries instead of two round trips.
 *
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getOrder(actor, orderId) {
  const order = await models.Order.findOne({
    where: { id: orderId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [
      ...listIncludes(actor),
      {
        association: 'statusLogs',
        required: false,
        include: [
          { association: 'previousStatus', attributes: ['id', 'code'], required: false },
          { association: 'newStatus', attributes: ['id', 'code'], required: false },
        ],
      },
      {
        association: 'paymentStatusLogs',
        required: false,
        include: [
          { association: 'previousStatus', attributes: ['id', 'code'], required: false },
          { association: 'newStatus', attributes: ['id', 'code'], required: false },
        ],
      },
    ],
    order: [
      [{ model: models.OrderStatusLog, as: 'statusLogs' }, 'createdAt', 'ASC'],
      [{ model: models.PaymentStatusLog, as: 'paymentStatusLogs' }, 'createdAt', 'ASC'],
    ],
  });

  if (!order) throw new NotFoundError('Order');

  return serializeOrder(order);
}

/** The order and payment status master tables. Not tenant-scoped - they are global. */
async function listOrderStatuses({ isActive } = {}) {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive;

  const statuses = await models.OrderStatus.findAll({
    where,
    attributes: STATUS_ATTRIBUTES,
    order: [['id', 'ASC']],
  });

  return statuses.map(serializeStatus);
}

async function listPaymentStatuses({ isActive } = {}) {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive;

  const statuses = await models.PaymentStatus.findAll({
    where,
    attributes: STATUS_ATTRIBUTES,
    order: [['id', 'ASC']],
  });

  return statuses.map(serializeStatus);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Resolve the cinema an order is being placed at.
 *
 * @throws {NotFoundError} 404 when it does not exist or is out of scope.
 * @throws {ConflictError} 409 when it is deactivated.
 */
async function findOrderCinema(actor, cinemaId, transaction) {
  const scope = actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };

  const cinema = await models.Cinema.findOne({
    where: { id: cinemaId, ...scope },
    attributes: ['id', 'chainId', 'isActive'],
    transaction,
  });

  if (!cinema) throw new NotFoundError('Cinema');

  if (!cinema.isActive) {
    throw new ConflictError('Cannot place an order at a deactivated cinema', {
      cinemaId: cinema.id,
    });
  }

  return cinema;
}

/**
 * Confirm a screen belongs to the cinema the order is for.
 *
 * Looked up by (id, cinemaId) together, so a screen from another cinema is a
 * 404 rather than a silently accepted mismatch - the pair does not exist.
 */
async function assertScreenBelongsToCinema(screenId, cinemaId, transaction) {
  if (screenId === null || screenId === undefined) return;

  const screen = await models.Screen.findOne({
    where: { id: screenId, cinemaId },
    attributes: ['id', 'isActive'],
    transaction,
  });

  if (!screen) throw new NotFoundError('Screen');

  if (!screen.isActive) {
    throw new ConflictError('Cannot place an order against a deactivated screen', { screenId });
  }
}

/**
 * Turn requested (productId, quantity) pairs into priced, snapshotted lines.
 *
 * Everything is loaded in three queries regardless of how many lines there are:
 * the products, their links to this cinema with their availability windows, and
 * their prices. Doing it per line would be an N+1 against the hottest path in
 * the system.
 *
 * @throws {ValidationError} 400 when the same product appears twice.
 * @throws {NotFoundError}   404 when a product does not exist in this chain.
 * @throws {ConflictError}   409 when a product is deactivated, not carried at
 *   the cinema, outside its availability, or has no active price there.
 */
async function buildOrderLines(cinema, { items, source }, now, transaction) {
  const productIds = items.map((item) => item.productId);

  // A merged quantity and a rejected request are both defensible, but only one
  // of them is unambiguous about what the customer asked for.
  const duplicates = productIds.filter(
    (productId, index) => productIds.indexOf(productId) !== index
  );

  if (duplicates.length > 0) {
    throw new ValidationError('Validation failed', [
      {
        field: 'items',
        message: `Each product may appear only once. Repeated: ${[...new Set(duplicates)].join(', ')}`,
      },
    ]);
  }

  const [products, links, pricings] = await Promise.all([
    models.Product.findAll({
      where: { id: { [Op.in]: productIds }, chainId: cinema.chainId },
      attributes: ['id', 'name', 'isActive'],
      transaction,
    }),
    models.CinemaProduct.findAll({
      where: { cinemaId: cinema.id, productId: { [Op.in]: productIds } },
      attributes: ['id', 'productId', 'availableFrom', 'availableUntil', 'isActive'],
      include: [
        {
          association: 'availabilityHours',
          attributes: ['id', 'dayOfWeek', 'startTime', 'endTime'],
          required: false,
        },
      ],
      transaction,
    }),
    models.ProductPricing.findAll({
      where: {
        cinemaId: cinema.id,
        productId: { [Op.in]: productIds },
        dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(now)] },
        isActive: true,
      },
      transaction,
    }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const linkByProductId = new Map(links.map((link) => [link.productId, link]));

  const pricingsByProductId = new Map();
  for (const pricing of pricings) {
    const existing = pricingsByProductId.get(pricing.productId) || [];
    existing.push(pricing);
    pricingsByProductId.set(pricing.productId, existing);
  }

  const day = isoDayOfWeek(now);
  const lines = [];

  for (const { productId, quantity } of items) {
    const product = productById.get(productId);

    // Scoped to the cinema's chain by the query above, so a product from
    // another chain is indistinguishable from one that does not exist.
    if (!product) throw new NotFoundError(`Product ${productId}`);

    if (!product.isActive) {
      throw new ConflictError(`${product.name} is no longer available`, { productId });
    }

    const link = linkByProductId.get(productId);

    if (!link) {
      throw new ConflictError(`${product.name} is not carried at this cinema`, { productId });
    }

    const reason = unavailableReason(link, now);

    if (reason) {
      throw new ConflictError(`${product.name} ${reason}`, { productId, cinemaProductId: link.id });
    }

    const pricing = selectPricing(pricingsByProductId.get(productId) || [], day);

    if (!pricing) {
      throw new ConflictError(`${product.name} has no price set at this cinema`, {
        productId,
        dayOfWeek: day,
      });
    }

    const unitPaise = toPaise(pricing.basePrice);
    const lineDiscountPaise = unitDiscountPaise(pricing, source, unitPaise) * quantity;
    const lineGrossPaise = unitPaise * quantity;

    lines.push({
      // What actually gets written to order_items, kept separate from the
      // paise the order totals are summed from so neither leaks into the other.
      item: {
        productId,
        // The snapshot. Renaming or repricing the product later leaves this
        // untouched, which is the entire reason the columns exist.
        productName: product.name,
        quantity,
        unitPrice: toDecimalString(unitPaise),
        discount: toDecimalString(lineDiscountPaise),
        total: toDecimalString(lineGrossPaise - lineDiscountPaise),
      },
      grossPaise: lineGrossPaise,
      discountPaise: lineDiscountPaise,
    });
  }

  return lines;
}

/**
 * Create an order and everything that hangs off it, atomically.
 *
 * The order, its items and the first entry in each audit trail are one unit: an
 * order with no items, or an order whose status has no opening log entry, is a
 * broken record. Anything that throws mid-way rolls the whole thing back and
 * leaves no partial order behind.
 *
 * A new order always starts at `initiated` / `pending`. Payment is not asserted
 * here - creating an order is not evidence that anyone paid for it.
 */
async function createOrder(actor, payload) {
  const { items, ...attributes } = payload;
  const now = new Date();

  const createdId = await sequelize.transaction(async (transaction) => {
    const cinema = await findOrderCinema(actor, attributes.cinemaId, transaction);

    await assertScreenBelongsToCinema(attributes.screenId, cinema.id, transaction);

    const lines = await buildOrderLines(
      cinema,
      { items, source: attributes.source },
      now,
      transaction
    );

    const subtotalPaise = lines.reduce((sum, line) => sum + line.grossPaise, 0);
    const discountPaise = lines.reduce((sum, line) => sum + line.discountPaise, 0);

    const [statusId, paymentStatusId] = await Promise.all([
      resolveStatusId('order', ORDER_STATUSES.INITIATED, transaction),
      resolveStatusId('payment', PAYMENT_STATUSES.PENDING, transaction),
    ]);

    const order = await models.Order.create(
      {
        ...attributes,
        statusId,
        paymentStatusId,
        subtotal: toDecimalString(subtotalPaise),
        discount: toDecimalString(discountPaise),
        total: toDecimalString(subtotalPaise - discountPaise),
      },
      { transaction }
    );

    await models.OrderItem.bulkCreate(
      lines.map((line) => ({ ...line.item, orderId: order.id })),
      { transaction }
    );

    // previousStatusId is null: there is no status the order moved from.
    await Promise.all([
      models.OrderStatusLog.create(
        {
          orderId: order.id,
          previousStatusId: null,
          newStatusId: statusId,
          changedByUserId: actor.id,
          reason: 'Order created',
        },
        { transaction }
      ),
      models.PaymentStatusLog.create(
        {
          orderId: order.id,
          previousStatusId: null,
          newStatusId: paymentStatusId,
          changedByUserId: actor.id,
          reason: 'Order created',
        },
        { transaction }
      ),
    ]);

    return order.id;
  });

  return getOrder(actor, createdId);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Load an order for modification, with the tenant join applied.
 *
 * The current status master row comes along because a transition cannot be
 * judged without knowing the code the order is in.
 */
async function findForUpdate(actor, orderId, association, transaction) {
  const order = await models.Order.findOne({
    where: { id: orderId },
    include: [cinemaScope(actor), { association, attributes: ['id', 'code'], required: false }],
    transaction,
  });

  if (!order) throw new NotFoundError('Order');

  return order;
}

/**
 * @throws {ConflictError} 409 listing what the order could legally move to.
 */
function assertTransitionAllowed(transitions, from, to, label) {
  const allowed = transitions[from] || [];

  if (!allowed.includes(to)) {
    throw new ConflictError(
      allowed.length === 0
        ? `This order is ${from} and its ${label} can no longer change`
        : `An order cannot go from ${from} to ${to}`,
      { from, to, allowed }
    );
  }
}

/**
 * Move an order to a new status, recording the move.
 *
 * The update and the log insert share one transaction, as docs/schema.md
 * requires: an order whose status changed without a log entry has lost the only
 * record of who changed it and when.
 *
 * Asking for the status the order is already in is a no-op that returns 200 and
 * writes no log row, matching how deactivation is idempotent elsewhere. Two
 * kitchen screens both marking an order ready is a race, not an error, and the
 * audit trail should not gain an entry describing a change that did not happen.
 */
async function updateOrderStatus(actor, orderId, { status, reason }) {
  await sequelize.transaction(async (transaction) => {
    const order = await findForUpdate(actor, orderId, 'status', transaction);

    const current = order.status ? order.status.code : null;

    if (current === status) return;

    assertTransitionAllowed(ORDER_TRANSITIONS, current, status, 'status');

    const newStatusId = await resolveStatusId('order', status, transaction);
    const previousStatusId = order.statusId;

    await order.update(
      {
        statusId: newStatusId,
        // The moment the customer got the food. Only meaningful on this one
        // transition, and never cleared: the transitions out of `delivered` are
        // empty, so it cannot be reached twice.
        ...(status === ORDER_STATUSES.DELIVERED ? { deliveredAt: new Date() } : {}),
      },
      { transaction }
    );

    await models.OrderStatusLog.create(
      {
        orderId: order.id,
        previousStatusId,
        newStatusId,
        changedByUserId: actor.id,
        reason: reason ?? null,
      },
      { transaction }
    );
  });

  return getOrder(actor, orderId);
}

/**
 * Move an order's payment to a new status, recording the move.
 *
 * This is the staff-operated path: cash taken at the counter, a refund granted,
 * a failed attempt written off. It does not touch the razorpay_* columns and
 * takes no gateway identifiers - a payment is only marked paid here because a
 * human with the Orders permission says it was, and dressing that up as a
 * gateway result would be a lie the Razorpay phase then has to unpick.
 */
async function updatePaymentStatus(actor, orderId, { paymentStatus, reason }) {
  await sequelize.transaction(async (transaction) => {
    const order = await findForUpdate(actor, orderId, 'paymentStatus', transaction);

    const current = order.paymentStatus ? order.paymentStatus.code : null;

    if (current === paymentStatus) return;

    assertTransitionAllowed(PAYMENT_TRANSITIONS, current, paymentStatus, 'payment status');

    const newStatusId = await resolveStatusId('payment', paymentStatus, transaction);
    const previousStatusId = order.paymentStatusId;

    await order.update({ paymentStatusId: newStatusId }, { transaction });

    await models.PaymentStatusLog.create(
      {
        orderId: order.id,
        previousStatusId,
        newStatusId,
        changedByUserId: actor.id,
        // Left null on purpose: this path has no gateway payment to reference.
        razorpayPaymentId: null,
        reason: reason ?? null,
      },
      { transaction }
    );
  });

  return getOrder(actor, orderId);
}

module.exports = {
  listOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  updatePaymentStatus,
  listOrderStatuses,
  listPaymentStatuses,
  serializeOrder,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PUBLIC_ATTRIBUTES,
};
