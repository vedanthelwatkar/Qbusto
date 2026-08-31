'use strict';

/**
 * Consumer API service - public, unauthenticated endpoints.
 *
 * Implements all 10 consumer endpoints:
 * 1. GET /api/consumer/cinemas/{id}
 * 2. GET /api/consumer/cinemas/{cinemaId}/screens/{id}
 * 3. GET /api/consumer/cinemas/{cinemaId}/categories
 * 4. GET /api/consumer/cinemas/{cinemaId}/products
 * 5. GET /api/consumer/cinemas/{cinemaId}/products/{id}
 * 6. GET /api/consumer/cinemas/{cinemaId}/banners
 * 7. GET /api/consumer/cinemas/{cinemaId}/sessions
 * 8. POST /api/consumer/orders (idempotent)
 * 9. POST /api/consumer/orders/{orderId}/payment-init (idempotent)
 * 10. POST /api/consumer/orders/{orderId}/payment-verify (idempotent)
 *
 * Reuses pricing logic from pricing.service for consistency with staff orders.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const {
  NotFoundError,
  ConflictError,
  ValidationError,
  ServiceUnavailableError,
} = require('../utils/errors');
const { PAGINATION, ORDER_STATUSES, PAYMENT_STATUSES, ORDER_SOURCES } = require('../constants');
const { sqlDateTimeLiteral } = require('../utils/sqlDate');

/**
 * How far either side of now a screening may start and still be offered.
 *
 * A flat window around the current moment, deliberately NOT a calendar or
 * programming day: a customer ordering at 01:30 is choosing between the film
 * they are sitting in - which may well have started the previous day - and the
 * one after it. Anchoring to any day boundary makes the list depend on which
 * side of that boundary the clock happens to be, which is exactly the case
 * (a 23:45 show, ordered against at 01:30) that has to work.
 *
 * The LOOKBACK half is the part worth being explicit about: a screening
 * already under way is offered on purpose. Someone twenty minutes into a film
 * is the customer most likely to want food, and refusing them is a worse
 * answer than letting them order against a show that has started.
 */
const SESSION_WINDOW_HOURS = 3;

const SESSION_WINDOW_MS = SESSION_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * How many screenings to offer per screen.
 *
 * A customer ordering food is choosing between the show they are about to sit
 * in and possibly the next one; a full day's listings for every auditorium is
 * a scroll, not a choice. The client's requirement is two per screen.
 */
const SESSIONS_PER_SCREEN = 2;

/**
 * `session.Session_strStatus`, as the client defines it:
 *
 *   O = Open      - selling, and the only status a customer may order against
 *   C = Closed    - no longer selling
 *   I = Inactive  - not in service
 *
 * Only Open is offered to customers. Closed and Inactive are excluded in SQL
 * rather than in the mapping below, so a screening that is not selling never
 * leaves the database - the filter cannot be bypassed by a client, and it
 * cannot be lost by a later refactor of the response shape.
 */
const SESSION_STATUS_OPEN = 'O';

const pricingService = require('./pricing.service');
const cache = require('./cache.service');
const cashfree = require('./cashfree.client');
const couponService = require('./coupon.service');
const { applyPaidTransition } = require('./paymenttransition.service');

/**
 * The payment status Cashfree reports for money that actually moved.
 *
 * Its other values - PENDING, FAILED, USER_DROPPED, VOID, CANCELLED,
 * NOT_ATTEMPTED - all mean the money is not ours, and none of them is treated
 * as success anywhere in this file.
 */
const GATEWAY_PAYMENT_SUCCESS = 'SUCCESS';

/**
 * A payment attempt Cashfree has not finished deciding.
 *
 * This is NOT the same as a failure, and the difference is the whole point of
 * the distinction: a UPI collect sits here while the customer is still in
 * their UPI app, and it can become SUCCESS minutes later. Every OTHER
 * non-success value - FAILED, USER_DROPPED, CANCELLED, VOID, NOT_ATTEMPTED -
 * is terminal, so the money is definitively not ours and the customer may
 * safely pay again.
 *
 * Treating PENDING as terminal is how a customer gets charged twice: they are
 * told nothing was taken, they pay again, and then the first payment settles.
 */
const GATEWAY_PAYMENT_PENDING = 'PENDING';

/** Orders are created in INR only. */
const GATEWAY_CURRENCY = 'INR';

/**
 * Whether a thrown error is `cashfree.client`'s specific "no credentials for
 * this cinema" refusal, as opposed to a genuine network/provider failure.
 * Matched on message rather than a custom error class, to keep
 * cashfree.client free of a dependency on this module's error types - it
 * throws a plain Error deliberately, since which cinema is "not configured"
 * is business-layer framing, not something the provider boundary should own.
 */
function isCashfreeNotConfiguredError(error) {
  return Boolean(error && error.message === 'Cashfree is not configured for this cinema');
}

const {
  toPaise,
  toDecimalString,
  isoDayOfWeek,
  unavailableReason,
  selectPricing,
  unitDiscountPaise,
  deriveSource,
  EVERY_DAY,
} = pricingService;

// ---------------------------------------------------------------------------
// Catalog endpoints
// ---------------------------------------------------------------------------

/** GET /api/consumer/cinemas/{id} */
async function getCinema(cinemaId) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    // screensaverUrl is public by design: the Consumer's screensaver is what a
    // customer sees before they have identified themselves at all.
    attributes: ['id', 'name', 'code', 'location', 'city', 'screensaverUrl'],
    raw: true,
  });

  if (!cinema) throw new NotFoundError('Cinema');

  return cinema;
}

/** GET /api/consumer/cinemas/{cinemaId}/screens/{id} */
async function getScreen(cinemaId, screenId) {
  const screen = await models.Screen.findOne({
    where: {
      id: screenId,
      cinemaId,
      isActive: true,
    },
    include: [
      {
        association: 'cinema',
        attributes: [],
        where: { isActive: true },
        required: true,
      },
    ],
    attributes: ['id', 'name', 'cinemaId'],
    raw: true,
  });

  if (!screen) throw new NotFoundError('Screen');

  return screen;
}

/** GET /api/consumer/cinemas/{cinemaId}/categories */
async function getCategories(
  cinemaId,
  limit = PAGINATION.DEFAULT_LIMIT,
  page = PAGINATION.DEFAULT_PAGE
) {
  // Verify cinema exists and is active
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  // Get total count first
  const countResult = await sequelize.query(
    `
    SELECT COUNT(DISTINCT c.id) as total
    FROM categories c
    INNER JOIN products p ON p.category_id = c.id AND p.is_active = 1
    INNER JOIN cinema_products cp ON cp.product_id = p.id AND cp.cinema_id = ? AND cp.is_active = 1
    INNER JOIN product_pricing pp ON pp.product_id = p.id AND pp.cinema_id = ?
      AND pp.day_of_week IN (?, ?) AND pp.is_active = 1
    `,
    {
      replacements: [cinemaId, cinemaId, EVERY_DAY, isoDayOfWeek(new Date())],
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const total = countResult[0]?.total || 0;

  // Get distinct category ids with SQL Server pagination (OFFSET...FETCH)
  const categoryIds = await sequelize.query(
    `
    SELECT DISTINCT c.id, c.name
    FROM categories c
    INNER JOIN products p ON p.category_id = c.id AND p.is_active = 1
    INNER JOIN cinema_products cp ON cp.product_id = p.id AND cp.cinema_id = ? AND cp.is_active = 1
    INNER JOIN product_pricing pp ON pp.product_id = p.id AND pp.cinema_id = ?
      AND pp.day_of_week IN (?, ?) AND pp.is_active = 1
    ORDER BY c.name ASC
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `,
    {
      replacements: [
        cinemaId,
        cinemaId,
        EVERY_DAY,
        isoDayOfWeek(new Date()),
        (page - 1) * limit,
        limit,
      ],
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const ids = categoryIds.map((row) => row.id);

  // Fetch full category data
  const categories = await models.Category.findAll({
    where: { id: { [Op.in]: ids.length > 0 ? ids : [0] } },
    attributes: ['id', 'name', 'imageUrl', 'description'],
    order: [['name', 'ASC']],
    raw: true,
  });

  return {
    categories,
    total,
  };
}

/** GET /api/consumer/cinemas/{cinemaId}/products */
async function getProducts(
  cinemaId,
  {
    categoryId = null,
    search = null,
    limit = PAGINATION.DEFAULT_LIMIT,
    page = PAGINATION.DEFAULT_PAGE,
    source = null,
    seat = null,
  } = {}
) {
  // The channel whose discount column this listing prices against. DERIVED
  // rather than trusted: it arrives from the query string, and it must be one
  // of exactly four values before it reaches either the column lookup or the
  // cache key - and the seat rate has to be earned by naming a seat, exactly
  // as it is when the order is priced for real. See pricing.service.
  // deriveSource; the two paths call the same function so the price on the
  // card cannot diverge from the price on the bill.
  const orderSource = deriveSource(source, { hasSeat: Boolean(seat) });
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const where = {
    isActive: true,
  };

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (search) {
    where.name = { [Op.like]: `%${search}%` };
  }

  // One clock for the whole request. Reading it twice could straddle midnight
  // and select a price row for one day while judging availability against
  // another.
  const now = new Date();

  // availableFrom/availableUntil and the availability-hour rows are selected
  // here because unavailableReason() reads them. They were previously joined
  // with attributes: [] - present in the SQL, never loaded - which is why an
  // out-of-hours product reached the catalog and was only rejected later, at
  // order creation.
  const products = await models.Product.findAll({
    where,
    include: [
      {
        association: 'cinemaProducts',
        attributes: ['id', 'productId', 'availableFrom', 'availableUntil', 'isActive'],
        where: { cinemaId, isActive: true },
        required: true,
        include: [
          {
            association: 'availabilityHours',
            attributes: ['id', 'dayOfWeek', 'startTime', 'endTime'],
            required: false,
          },
        ],
      },
      {
        association: 'pricings',
        attributes: [
          'basePrice',
          'discountType',
          'discountValue',
          'discountOnQr',
          'discountOnSeatQr',
          'discountOnKiosk',
          'discountOnCounter',
        ],
        where: {
          cinemaId,
          dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(now)] },
          isActive: true,
        },
        required: true,
      },
    ],
    // categoryId drives the Consumer's category sections; weight is shown on
    // the card and in the product details dialog.
    attributes: ['id', 'categoryId', 'name', 'description', 'imageUrl', 'weight'],
    raw: false,
    order: [['name', 'ASC']],
  });

  // The same predicate order creation uses (pricing.service.unavailableReason),
  // so the catalog and the order check cannot drift apart. Deliberately applied
  // in JS rather than reimplemented as SQL: a second implementation of these
  // rules is exactly the drift this is meant to prevent.
  //
  // (cinema_id, product_id) is unique, and the join is required, so there is
  // exactly one link per row.
  const available = products.filter(
    (product) => !unavailableReason(product.cinemaProducts[0], now)
  );

  // Paginated after filtering. Slicing the database page instead would return
  // short pages and a total that counts products the customer cannot order.
  const offset = (page - 1) * limit;
  const pageProducts = available.slice(offset, offset + limit);

  // Transform products to include basePrice with source discount
  const transformedProducts = pageProducts.map((product) => {
    const pricing = product.pricings && product.pricings[0];
    const unitPaise = toPaise(pricing.basePrice);
    const discountPaise = unitDiscountPaise(pricing, orderSource, unitPaise);
    const discountedPaise = unitPaise - discountPaise;

    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      weight: product.weight,
      basePrice: parseFloat(toDecimalString(discountedPaise)),
    };
  });

  return {
    products: transformedProducts,
    total: available.length,
  };
}

/** GET /api/consumer/cinemas/{cinemaId}/products/{id} */
async function getProductDetail(cinemaId, productId, source = null, seat = null) {
  const orderSource = deriveSource(source, { hasSeat: Boolean(seat) });

  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const now = new Date();

  const product = await models.Product.findOne({
    where: { id: productId, isActive: true },
    include: [
      {
        association: 'cinemaProducts',
        attributes: ['id', 'productId', 'availableFrom', 'availableUntil', 'isActive'],
        where: { cinemaId, isActive: true },
        required: true,
        include: [
          {
            association: 'availabilityHours',
            attributes: ['id', 'dayOfWeek', 'startTime', 'endTime'],
            required: false,
          },
        ],
      },
      {
        association: 'pricings',
        attributes: [
          'basePrice',
          'discountType',
          'discountValue',
          'discountOnQr',
          'discountOnSeatQr',
          'discountOnKiosk',
          'discountOnCounter',
        ],
        where: {
          cinemaId,
          dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(now)] },
          isActive: true,
        },
        required: true,
      },
    ],
    // categoryId drives the Consumer's category sections; weight is shown on
    // the card and in the product details dialog.
    attributes: ['id', 'categoryId', 'name', 'description', 'imageUrl', 'weight'],
    raw: false,
  });

  if (!product) throw new NotFoundError('Product');

  // Same predicate as the listing and as order creation. A product that is not
  // orderable right now is not addressable either - otherwise a stale link or a
  // guessed id would still put it in the cart.
  if (unavailableReason(product.cinemaProducts[0], now)) throw new NotFoundError('Product');

  const pricing = product.pricings && product.pricings[0];
  const unitPaise = toPaise(pricing.basePrice);
  const discountPaise = unitDiscountPaise(pricing, orderSource, unitPaise);
  const discountedPaise = unitPaise - discountPaise;

  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    weight: product.weight,
    basePrice: parseFloat(toDecimalString(discountedPaise)),
    addons: [],
  };
}

/** GET /api/consumer/cinemas/{cinemaId}/banners */
async function getBanners(cinemaId, type = null) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const today = new Date();

  const where = {
    cinemaId,
    isActive: true,
    [Op.and]: [
      {
        [Op.or]: [{ startDate: null }, { startDate: { [Op.lte]: today } }],
      },
      {
        [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: today } }],
      },
    ],
  };

  if (type) {
    where.type = type;
  }

  const banners = await models.Banner.findAll({
    where,
    attributes: ['id', 'imageUrl', 'type', 'sequence'],
    order: [
      ['sequence', 'ASC'],
      ['id', 'ASC'],
    ],
    raw: true,
  });

  return banners;
}

// ---------------------------------------------------------------------------
// Order endpoints
// ---------------------------------------------------------------------------

/** POST /api/consumer/orders - Create order (IDEMPOTENT by Idempotency-Key) */
async function createOrder(payload, idempotencyKey) {
  if (!idempotencyKey) {
    throw new ValidationError('Idempotency-Key header required');
  }

  return sequelize.transaction(async (transaction) => {
    // Check if idempotency key already exists
    const existing = await models.IdempotencyKey.findOne({
      where: { key: idempotencyKey },
      include: [{ association: 'order', attributes: ['id'] }],
      transaction,
    });

    if (existing) {
      const order = await models.Order.findByPk(existing.orderId, {
        include: [
          {
            association: 'items',
            attributes: ['productId', 'productName', 'quantity', 'unitPrice', 'discount', 'total'],
          },
        ],
        attributes: [
          'id',
          'subtotal',
          'discount',
          'total',
          'createdAt',
          'customerMobile',
          'customerEmail',
        ],
        transaction,
      });

      if (order) {
        return {
          orderId: order.id,
          status: ORDER_STATUSES.INITIATED,
          paymentStatus: PAYMENT_STATUSES.PENDING,
          subtotal: parseFloat(order.subtotal),
          discount: parseFloat(order.discount),
          total: parseFloat(order.total),
          currency: 'INR',
          items: order.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice),
            lineTotal: parseFloat(item.total),
          })),
          customerMobile: order.customerMobile,
          customerEmail: order.customerEmail,
          createdAt: order.createdAt,
        };
      }
    }

    // Validate cinema
    const cinema = await models.Cinema.findByPk(payload.cinemaId, {
      attributes: ['id', 'chainId', 'isActive'],
      transaction,
    });

    if (!cinema) throw new NotFoundError('Cinema');
    if (!cinema.isActive) throw new ConflictError('Cinema is not active', { cinemaId: cinema.id });

    // The auditorium is never trusted from the client - only resolved here,
    // from the screen name of the show the customer picked plus the seat row
    // they entered, against `screens` (see resolveScreenId and
    // client-tables.md "screens grain conflict"). A QR's own screenId is not
    // used: it is fixed at print time and does not track which show the
    // customer actually selected.
    let screenId = null;

    if (payload.screenName) {
      screenId = await resolveScreenId(cinema.id, payload.screenName, payload.seatRow);

      if (!screenId) {
        throw new ValidationError('Could not match your seat to this show', [
          { field: 'seatRow', message: 'Please check the row and try again' },
        ]);
      }
    }

    // Validate source
    if (!Object.values(ORDER_SOURCES).includes(payload.source)) {
      throw new ValidationError('Invalid order source', [
        { field: 'source', message: `Must be one of: ${Object.values(ORDER_SOURCES).join(', ')}` },
      ]);
    }

    /*
     * The source this order is ENTITLED to, which is not necessarily the one
     * it asked for.
     *
     * `source` selects a discount column, and it reaches us as an editable
     * query-string value with nothing authenticating it. `seat_qr` is the one
     * claim the request can substantiate on its own - a seat QR carries a
     * seat - so claiming the seat rate while naming no seat is downgraded to
     * the lobby rate here rather than being taken at face value. See
     * pricing.service.deriveSource for the full reasoning, including why
     * `kiosk` and `counter` cannot be checked the same way.
     *
     * This value, not the claim, is what prices the lines AND what is written
     * to orders.source, so the row records the channel the customer was
     * actually charged as - staff reading an order later see the truth rather
     * than the assertion.
     */
    const orderSource = deriveSource(payload.source, {
      hasSeat: Boolean(payload.seatNumber),
    });

    // Build order lines with pricing validation
    const now = new Date();
    const lines = await buildOrderLines(
      cinema,
      { ...payload, source: orderSource },
      now,
      transaction
    );

    // Calculate totals
    const subtotalPaise = lines.reduce((sum, line) => sum + line.grossPaise, 0);
    const productDiscountPaise = lines.reduce((sum, line) => sum + line.discountPaise, 0);

    // Coupon, if one was applied. Validated and computed ENTIRELY here, from
    // QBusto's own just-computed subtotal - never a client-supplied amount -
    // so the discounted total handed to payment-init is already final by the
    // time Cashfree is ever involved. See services/coupon.service for why
    // this replaced routing coupons through Cashfree's own offer system.
    let couponDiscountPaise = 0;
    let offerId = null;

    if (payload.couponCode) {
      const result = await couponService.validateCoupon({
        cinemaId: cinema.id,
        code: payload.couponCode,
        subtotalPaise,
      });

      if (!result.valid) {
        throw new ValidationError(result.message, [
          { field: 'couponCode', message: result.message },
        ]);
      }

      couponDiscountPaise = result.discountPaise;
      offerId = result.offer.id;
    }

    // Product/source pricing discounts and a coupon discount are each capped
    // independently against the GROSS subtotal (see pricing.service
    // .unitDiscountPaise and coupon.service.computeDiscountPaise), so their
    // SUM is not - a 100%-off promotional price plus a generous coupon can
    // otherwise add up to more than the cart is worth. Capped here, at the
    // one place they are combined, rather than negative-total math being
    // caught downstream by orders.total's `min: 0` model validation: that
    // validation exists to protect data integrity, not to be the mechanism
    // that turns a normal discount combination into a customer-facing error.
    const discountPaise = Math.min(productDiscountPaise + couponDiscountPaise, subtotalPaise);
    const totalPaise = subtotalPaise - discountPaise;

    // Belt-and-suspenders: the cap above makes this unreachable today, but a
    // future change to either discount source should fail as a clean,
    // named validation error - never as Sequelize's generic "Validation min
    // on total failed", which names a column the customer never touched and
    // gives staff nothing to act on.
    if (totalPaise < 0) {
      throw new ValidationError('This order could not be priced correctly', [
        { field: 'items', message: 'The applied discounts exceed the order subtotal' },
      ]);
    }

    // Resolve status IDs
    const [statusId, paymentStatusId] = await Promise.all([
      resolveStatusId('order', ORDER_STATUSES.INITIATED, transaction),
      resolveStatusId('payment', PAYMENT_STATUSES.PENDING, transaction),
    ]);

    // Create order
    const order = await models.Order.create(
      {
        cinemaId: cinema.id,
        screenId,
        seatNumber: payload.seatNumber || null,
        statusId,
        paymentStatusId,
        source: orderSource,
        customerMobile: payload.customerMobile || null,
        customerEmail: payload.customerEmail || null,
        filmTitle: payload.filmTitle || null,
        showTime: payload.showTime || null,
        notes: payload.notes || null,
        subtotal: toDecimalString(subtotalPaise),
        discount: toDecimalString(discountPaise),
        total: toDecimalString(totalPaise),
        offerId,
      },
      { transaction }
    );

    // Create order items
    await models.OrderItem.bulkCreate(
      lines.map((line) => ({
        ...line.item,
        orderId: order.id,
      })),
      { transaction }
    );

    // Create idempotency key association
    try {
      await models.IdempotencyKey.create(
        {
          key: idempotencyKey,
          orderId: order.id,
        },
        { transaction }
      );
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const existingKey = await models.IdempotencyKey.findOne({
          where: { key: idempotencyKey },
          attributes: ['orderId'],
          transaction,
        });
        if (existingKey) {
          const existingOrder = await models.Order.findByPk(existingKey.orderId, {
            include: [
              {
                association: 'items',
                attributes: [
                  'productId',
                  'productName',
                  'quantity',
                  'unitPrice',
                  'discount',
                  'total',
                ],
              },
            ],
            attributes: [
              'id',
              'subtotal',
              'discount',
              'total',
              'createdAt',
              'customerMobile',
              'customerEmail',
            ],
            transaction,
          });
          return {
            orderId: existingOrder.id,
            status: ORDER_STATUSES.INITIATED,
            paymentStatus: PAYMENT_STATUSES.PENDING,
            subtotal: parseFloat(existingOrder.subtotal),
            discount: parseFloat(existingOrder.discount),
            total: parseFloat(existingOrder.total),
            currency: 'INR',
            items: existingOrder.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: parseFloat(item.unitPrice),
              lineTotal: parseFloat(item.total),
            })),
            customerMobile: existingOrder.customerMobile,
            customerEmail: existingOrder.customerEmail,
            createdAt: existingOrder.createdAt,
          };
        }
      }
      throw error;
    }

    // Create status logs
    await Promise.all([
      models.OrderStatusLog.create(
        {
          orderId: order.id,
          previousStatusId: null,
          newStatusId: statusId,
          reason: 'Order created',
        },
        { transaction }
      ),
      models.PaymentStatusLog.create(
        {
          orderId: order.id,
          previousStatusId: null,
          newStatusId: paymentStatusId,
          reason: 'Order created',
        },
        { transaction }
      ),
    ]);

    return {
      orderId: order.id,
      status: ORDER_STATUSES.INITIATED,
      paymentStatus: PAYMENT_STATUSES.PENDING,
      subtotal: parseFloat(toDecimalString(subtotalPaise)),
      discount: parseFloat(toDecimalString(discountPaise)),
      couponDiscount: parseFloat(toDecimalString(couponDiscountPaise)),
      total: parseFloat(toDecimalString(totalPaise)),
      currency: 'INR',
      items: lines.map((line) => ({
        productId: line.item.productId,
        productName: line.item.productName,
        quantity: line.item.quantity,
        unitPrice: parseFloat(line.item.unitPrice),
        lineTotal: parseFloat(line.item.total),
      })),
      customerMobile: payload.customerMobile || null,
      customerEmail: payload.customerEmail || null,
      createdAt: new Date().toISOString(),
    };
  });
}

/**
 * POST /api/consumer/cinemas/{cinemaId}/coupons/validate
 *
 * Lets the Consumer app's "Apply coupon" control show a customer the
 * discount BEFORE they submit the order, without creating anything. The
 * subtotal it checks the coupon against is computed the exact same way order
 * creation computes it - from `items`/`source` against live
 * product_pricing, never trusted from the client - so the discount previewed
 * here is guaranteed to match what `createOrder` would actually apply for
 * the identical cart a moment later.
 *
 * No transaction: this is read-only, and `buildOrderLines` accepts an
 * undefined transaction just as happily as a real one.
 *
 * @returns {Promise<{valid: boolean, message: string|null, discount: number|null, subtotal: number}>}
 */
async function validateCouponPreview(cinemaId, { code, items, source, seatNumber = null }) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    attributes: ['id', 'isActive'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const now = new Date();
  // Derived exactly as createOrder derives it, from the same evidence: the
  // preview's whole job is to state the subtotal the order will have, and a
  // preview that priced a seat rate the order will refuse would understate it.
  const previewSource = deriveSource(source, { hasSeat: Boolean(seatNumber) });
  const lines = await buildOrderLines(cinema, { items, source: previewSource }, now, undefined);
  const subtotalPaise = lines.reduce((sum, line) => sum + line.grossPaise, 0);

  const result = await couponService.validateCoupon({ cinemaId: cinema.id, code, subtotalPaise });

  if (!result.valid) {
    return {
      valid: false,
      message: result.message,
      discount: null,
      subtotal: parseFloat(toDecimalString(subtotalPaise)),
    };
  }

  return {
    valid: true,
    message: null,
    discount: parseFloat(toDecimalString(result.discountPaise)),
    subtotal: parseFloat(toDecimalString(subtotalPaise)),
  };
}

/**
 * Ask Cashfree whether an already-initialised order was in fact paid.
 *
 * THE GAP THIS CLOSES
 *
 * Our backend normally learns of a payment two ways: the browser comes back
 * and payment-verify confirms it, or a webhook arrives. If BOTH fail - the
 * customer's phone dies on cinema wifi and the webhook delivery is exhausted
 * or misconfigured - the money is gone and our order sits `pending` forever,
 * with nothing in the system able to discover otherwise.
 *
 * `PGOrderFetchPayments` is Cashfree's own record of what happened,
 * authenticated with our client secret. It is server-to-server, so unlike a
 * browser callback it cannot be lost, forged or replayed by a customer.
 *
 * WHAT MAKES IT SAFE
 *
 * - It only ever CONFIRMS. A payment is accepted only when Cashfree itself
 *   reports `SUCCESS` for the exact amount we expect. Anything else - PENDING,
 *   FAILED, USER_DROPPED, VOID, CANCELLED, a mismatched amount, an API error -
 *   leaves the order exactly as it was. It never guesses.
 * - A payment still IN FLIGHT is reported separately, as `gatewayPending`.
 *   Not settling it and calling it a failure are different things: a UPI
 *   collect the customer has not yet approved is neither paid nor refusable,
 *   and telling the customer "nothing was taken, try again" while it is
 *   outstanding is what produces a double charge.
 * - The transition goes through applyPaidTransition like every other source,
 *   so it cannot double the state change or the post-payment side effects,
 *   whichever source wins the race.
 * - A failure to reach Cashfree never becomes a claim about the payment. It is
 *   reported separately, as `reachable: false`, so callers can tell "the
 *   gateway says this was not paid" apart from "we could not ask". Those two
 *   must never be conflated: the first means nothing was charged, the second
 *   means we do not know, and treating the second as the first is how a
 *   customer gets charged twice.
 *
 * @returns {Promise<{settled: boolean, reachable: boolean, gatewayPending: boolean}>}
 *   `settled` is true when the order is now paid. `reachable` is false only
 *   when the provider could not be consulted at all. `gatewayPending` is true
 *   when the provider holds at least one attempt it has not finished deciding,
 *   which means paying again is NOT safe.
 */
async function reconcilePaymentFromGateway(order) {
  let payments;

  try {
    payments = await cashfree.fetchOrderPayments(order.gatewayOrderId, order.cinemaId);
  } catch (error) {
    // Cashfree unreachable, credentials wrong, order unknown to them. Not
    // knowing is the status quo for payment-init, which carries on rather than
    // blocking a customer who may simply be retrying a genuinely failed
    // payment. payment-verify treats it differently - see `reachable`.
    logger.warn('Cashfree reconciliation could not be completed', {
      orderId: order.id,
      // Message only - never the payload, and never credentials.
      reason: error && error.message ? error.message : 'unknown',
    });
    // Unknown, so no claim is made about a pending attempt either.
    return { settled: false, reachable: false, gatewayPending: false };
  }

  const expectedPaise = toPaise(order.total);

  // Integer paise on both sides; no floating-point money comparison. The
  // client converted Cashfree's rupee decimal on the way in.
  //
  // Strict exact-match ONLY. QBusto is the sole source of truth for what an
  // order costs - `order.total` already reflects any coupon a customer
  // applied (see applyCoupon), computed and validated entirely within
  // QBusto before payment-init ever ran. Cashfree has no discount/offer
  // concept in this flow at all, so a payment short of `expectedPaise` for
  // ANY reason is refused as a mismatch, never explained away.
  const settled = payments.find(
    (payment) =>
      payment &&
      payment.status === GATEWAY_PAYMENT_SUCCESS &&
      Number.isInteger(payment.amountPaise) &&
      payment.amountPaise === expectedPaise &&
      (!payment.currency || payment.currency === GATEWAY_CURRENCY)
  );

  if (!settled) {
    // No success, so the question becomes whether anything is still in flight.
    // Deliberately NOT amount-filtered: an attempt Cashfree has not finished
    // deciding may not carry a final amount yet, and the safe reading of any
    // outstanding attempt on this order is "do not invite a second payment".
    const gatewayPending = payments.some(
      (payment) => payment && payment.status === GATEWAY_PAYMENT_PENDING
    );

    if (gatewayPending) {
      logger.info('Cashfree reconciliation found a payment still in flight', {
        orderId: order.id,
        gatewayOrderId: order.gatewayOrderId,
      });
    }

    return { settled: false, reachable: true, gatewayPending };
  }

  logger.info('Cashfree reconciliation found a successful payment', {
    orderId: order.id,
    gatewayOrderId: order.gatewayOrderId,
  });

  await sequelize.transaction(async (transaction) => {
    await applyPaidTransition(
      {
        orderId: order.id,
        gatewayPaymentId: settled.paymentId || null,
        reason: 'Payment confirmed by reconciliation with Cashfree',
      },
      transaction
    );
  });

  return { settled: true, reachable: true, gatewayPending: false };
}

/**
 * POST /api/consumer/orders/{orderId}/payment-init (IDEMPOTENT)
 *
 * Returns a short-lived `paymentSessionId` for the hosted checkout.
 *
 * WHY THE SESSION IS NOT STORED
 *
 * Unlike the previous provider's order id, a Cashfree payment session is a
 * short-lived token, not a durable handle. Persisting one would mean handing
 * a customer an expired session after any meaningful delay. The durable handle
 * is `gateway_order_id`, which is stored; the session is fetched fresh from
 * Cashfree whenever an existing order needs to be paid again.
 */
async function paymentInit(orderId) {
  const order = await models.Order.findByPk(orderId, {
    attributes: [
      'id',
      'paymentStatusId',
      'total',
      'gatewayOrderId',
      'customerMobile',
      'customerEmail',
      // Which cinema's Cashfree credentials apply - resolved per cinema via
      // payment_gateway_config, not from one global configuration.
      'cinemaId',
    ],
    include: [
      {
        association: 'paymentStatus',
        attributes: ['code'],
      },
    ],
  });

  if (!order) throw new NotFoundError('Order');

  if (order.paymentStatus.code !== PAYMENT_STATUSES.PENDING) {
    throw new ConflictError('Order is not in pending payment state', {
      orderId,
      paymentStatus: order.paymentStatus.code,
    });
  }

  // A coupon can discount an order down to nothing - computeDiscountPaise
  // caps a coupon's discount at the cart subtotal, so this is "fully
  // covered", never negative. There is nothing left to ask Cashfree to
  // collect (its own create-order API refuses order_amount 0 outright,
  // verified live), and there should not be: a customer whose coupon paid
  // for the whole order should never be shown a payment screen at all.
  // Settled the same way every other source settles a payment - through the
  // one compare-and-set every discovery path shares - so this cannot race a
  // webhook or a browser verify into a double confirmation, and it drives
  // the same kitchen-ticket side effect a real payment would.
  if (toPaise(order.total) === 0) {
    await sequelize.transaction(async (transaction) => {
      await applyPaidTransition(
        {
          orderId: order.id,
          reason: 'Order fully covered by coupon - no payment required',
        },
        transaction
      );
    });

    return {
      orderId,
      gatewayOrderId: null,
      paymentSessionId: null,
      amount: 0,
      currency: GATEWAY_CURRENCY,
      paymentStatus: PAYMENT_STATUSES.PAID,
    };
  }

  // Deliberately no upfront "is Cashfree configured" gate here any more:
  // credentials are resolved per cinema, inside cashfree.client, and a cinema
  // with no active payment_gateway_config (and no global env fallback) is
  // reported as unavailable at the point a call is actually attempted below -
  // see the catch around cashfree.createOrder.

  // An attempt already exists for this order.
  if (order.gatewayOrderId) {
    // Before handing back a payable order, ask Cashfree whether this order was
    // ALREADY paid. Reaching here means a previous attempt existed, and the
    // dangerous case is the one where that attempt succeeded but neither the
    // browser nor the webhook ever told us - the customer would otherwise be
    // shown a Pay button for money they have already handed over.
    //
    // This is the only trigger: a customer-initiated request on an order that
    // has already been initialised. It is not a poller.
    // Only `settled` matters here. An unreachable gateway leaves the customer
    // able to pay, which is the correct status quo for payment-init.
    const { settled: reconciled } = await reconcilePaymentFromGateway(order);

    if (reconciled) {
      // Same 409 shape payment-init already returns for a settled order, so
      // the Consumer's existing recovery reads it and moves to confirmation.
      throw new ConflictError('Order is not in pending payment state', {
        orderId,
        paymentStatus: PAYMENT_STATUSES.PAID,
      });
    }

    // Still unpaid, so re-issue a session against the SAME gateway order
    // rather than creating a second one.
    return {
      orderId,
      gatewayOrderId: order.gatewayOrderId,
      paymentSessionId: await resumePaymentSession(order),
      amount: toPaise(order.total),
      currency: GATEWAY_CURRENCY,
    };
  }

  // Create the gateway order (OUTSIDE any transaction - it is a network call).
  let created;
  try {
    created = await cashfree.createOrder({
      orderId: order.id,
      cinemaId: order.cinemaId,
      amountPaise: toPaise(order.total),
      customerMobile: order.customerMobile,
      customerEmail: order.customerEmail,
    });
  } catch (error) {
    // The gateway order id is deterministic, so a 409 means a previous attempt
    // created it and we simply lost the record - or two requests raced. Adopt
    // the existing order instead of failing the customer.
    if (cashfree.isDuplicateOrderError(error)) {
      created = {
        gatewayOrderId: cashfree.buildGatewayOrderId(order.id),
        paymentSessionId: null,
      };
    } else if (
      cashfree.isTransientError(error) ||
      cashfree.isAuthError(error) ||
      isCashfreeNotConfiguredError(error)
    ) {
      // Not configured, wrong/revoked credentials, and a transient outage are
      // all folded into the same 503: to the customer standing at a kiosk,
      // "this cinema has no working Cashfree credentials right now" and
      // "Cashfree is briefly unreachable" both mean the same thing - try
      // again shortly, or ask staff. A bad credential is an operator error in
      // that cinema's payment_gateway_config row, not a bug, and it must not
      // leak a raw provider auth failure to a customer-facing endpoint - see
      // isAuthError's own note for how this was found.
      throw new Error('Cashfree API unavailable', { cause: error });
    } else {
      throw error;
    }
  }

  // Compare-and-set: UPDATE only if gatewayOrderId is still NULL. Backed by
  // the filtered unique index, so one QBusto order maps to one gateway order
  // for its lifetime even across instances.
  const [rowsUpdated] = await models.Order.update(
    { gatewayOrderId: created.gatewayOrderId },
    { where: { id: orderId, gatewayOrderId: null } }
  );

  if (rowsUpdated === 1) {
    return {
      orderId,
      gatewayOrderId: created.gatewayOrderId,
      paymentSessionId:
        created.paymentSessionId ||
        (await resumePaymentSession({
          id: orderId,
          cinemaId: order.cinemaId,
          gatewayOrderId: created.gatewayOrderId,
        })),
      amount: toPaise(order.total),
      currency: GATEWAY_CURRENCY,
    };
  }

  // Another request won the race; reload and return theirs.
  const reloadedOrder = await models.Order.findByPk(orderId, {
    attributes: ['id', 'gatewayOrderId', 'total', 'cinemaId'],
  });

  return {
    orderId,
    gatewayOrderId: reloadedOrder.gatewayOrderId,
    paymentSessionId: await resumePaymentSession(reloadedOrder),
    amount: toPaise(reloadedOrder.total),
    currency: GATEWAY_CURRENCY,
  };
}

/**
 * Fetch a fresh payment session for an order that already exists at Cashfree.
 *
 * Returns null rather than throwing when the session cannot be produced. The
 * caller still has something useful to say - the order exists and its status
 * is known - and the Consumer treats a missing session as "cannot pay right
 * now", which is accurate and retryable. Throwing here would turn a
 * recoverable hiccup into a hard failure on a screen about money.
 */
async function resumePaymentSession(order) {
  try {
    const fetched = await cashfree.fetchOrder(order.gatewayOrderId, order.cinemaId);
    return fetched && fetched.paymentSessionId ? fetched.paymentSessionId : null;
  } catch (error) {
    logger.warn('Could not obtain a Cashfree payment session', {
      orderId: order.id,
      reason: error && error.message ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * POST /api/consumer/orders/{orderId}/payment-verify (IDEMPOTENT)
 *
 * THIS IS A SERVER-SIDE CONFIRMATION, NOT A CLIENT ASSERTION
 *
 * The previous provider handed the browser a signed payload which the browser
 * relayed to us and we verified with an HMAC. Cashfree's hosted checkout hands
 * the browser NO cryptographic credential - by design - so there is nothing a
 * client could present that would prove anything.
 *
 * The endpoint therefore takes no payment identity from the caller at all.
 * The browser's request means only "my checkout finished, please look"; the
 * answer comes from asking Cashfree directly, authenticated with our own
 * credentials. A caller cannot influence the outcome by what it sends, which
 * is a stronger position than verifying a relayed signature: there is no
 * client-supplied value in the trust path to get wrong.
 *
 * Everything else about the endpoint is unchanged - same path, same idempotent
 * behaviour, same 409 shape the Consumer's recovery reads.
 */
async function paymentVerify(orderId) {
  const order = await models.Order.findByPk(orderId, {
    attributes: ['id', 'gatewayOrderId', 'paymentStatusId', 'total', 'cinemaId'],
    include: [
      {
        association: 'paymentStatus',
        attributes: ['code'],
      },
    ],
  });

  if (!order) throw new NotFoundError('Order');

  // Idempotency: if already paid, return success. Covers the browser callback
  // arriving after the webhook has already settled the order, and a customer
  // reloading the confirmation screen.
  if (order.paymentStatus.code === PAYMENT_STATUSES.PAID) {
    return {
      orderId,
      paymentStatus: PAYMENT_STATUSES.PAID,
    };
  }

  if (order.paymentStatus.code !== PAYMENT_STATUSES.PENDING) {
    throw new ConflictError('Order not in pending payment state', {
      orderId,
      paymentStatus: order.paymentStatus.code,
    });
  }

  if (!order.gatewayOrderId) {
    throw new ValidationError('Order has no gateway order', { orderId });
  }

  // The authoritative question, asked of the gateway rather than the caller.
  // reconcilePaymentFromGateway validates the amount and currency and routes
  // the transition through the same compare-and-set every other source uses.
  const { settled, reachable, gatewayPending } = await reconcilePaymentFromGateway(order);

  if (settled) {
    return {
      orderId,
      paymentStatus: PAYMENT_STATUSES.PAID,
    };
  }

  // We could not ask. This is NOT evidence that nothing was charged, and it
  // must not be reported as though it were: the Consumer reads a `pending`
  // conflict as "the gateway holds no payment, so paying again is safe" and
  // discards the record that stops a second charge. A customer whose payment
  // succeeded while our connection to Cashfree was briefly down would then be
  // invited to pay twice.
  //
  // 503 says "ask again", which is the only honest answer, and the Consumer
  // keeps the attempt and stays on "we could not check yet".
  if (!reachable) {
    throw new ServiceUnavailableError(
      'Could not confirm this payment with the provider, please retry'
    );
  }

  // The gateway was reached and reports no successful payment for this order.
  // The order stays pending either way - the webhook and the next
  // reconciliation remain able to record it - but WHY there is no success
  // decides whether the customer may safely pay again, so it is reported.
  //
  //   gatewayPending true  - an attempt is still in flight (a UPI collect the
  //                          customer has not approved yet). Paying again is
  //                          NOT safe: the outstanding attempt can still
  //                          succeed, and a second payment would double-charge.
  //   gatewayPending false - every attempt reached a terminal non-success
  //                          (FAILED / USER_DROPPED / CANCELLED / VOID /
  //                          NOT_ATTEMPTED), or there was no attempt at all.
  //                          Nothing was taken, so retrying is safe.
  throw new ConflictError('Payment has not been confirmed by the gateway yet', {
    orderId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
    gatewayPending,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a status code to ID */
async function resolveStatusId(kind, code, transaction) {
  const model = kind === 'order' ? models.OrderStatus : models.PaymentStatus;
  const status = await model.findOne({ where: { code }, attributes: ['id'], transaction });

  if (!status) {
    throw new Error(`Status code "${code}" not found in ${kind} statuses master table`);
  }

  return status.id;
}

/** Build order lines with full validation */
async function buildOrderLines(cinema, payload, now, transaction) {
  const { items, source } = payload;
  const productIds = items.map((item) => item.productId);

  // Check for duplicates
  const duplicates = productIds.filter((id, index) => productIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new ValidationError('Duplicate products in order', [
      {
        field: 'items',
        message: `Each product may appear only once. Repeated: ${[...new Set(duplicates)].join(', ')}`,
      },
    ]);
  }

  // Load products, cinema products, pricings in parallel
  const [products, links, pricings] = await Promise.all([
    models.Product.findAll({
      where: { id: { [Op.in]: productIds }, isActive: true },
      attributes: ['id', 'name'],
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

  const productById = new Map(products.map((p) => [p.id, p]));
  const linkByProductId = new Map(links.map((l) => [l.productId, l]));

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
    if (!product) throw new NotFoundError(`Product ${productId}`);

    const link = linkByProductId.get(productId);
    if (!link)
      throw new ConflictError(`${product.name} is not carried at this cinema`, { productId });

    const reason = unavailableReason(link, now);
    if (reason) {
      throw new ConflictError(`${product.name} ${reason}`, { productId });
    }

    const pricing = selectPricing(pricingsByProductId.get(productId) || [], day);
    if (!pricing) {
      throw new ConflictError(`${product.name} has no price set at this cinema`, { productId });
    }

    const unitPaise = toPaise(pricing.basePrice);
    const lineDiscountPaise = unitDiscountPaise(pricing, source, unitPaise) * quantity;
    const lineGrossPaise = unitPaise * quantity;

    lines.push({
      item: {
        productId,
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
 * Sessions a customer can still order for, at one cinema.
 *
 * Reads the client's `session` table, which their source system syncs.
 *
 * WHAT IS OFFERED
 *
 * Screenings starting within SESSION_WINDOW_HOURS either side of now, and at
 * most two per auditorium. The window is flat rather than tied to a calendar
 * or programming day, so a 23:45 screening is still offered at 01:30 the next
 * morning - the customer sitting in it has not changed just because the date
 * has. A screening that has already started is offered deliberately; see
 * SESSION_WINDOW_HOURS.
 *
 * Capping per auditorium rather than overall keeps every screen represented: a
 * flat limit would fill the picker with one busy screen's listings and hide the
 * others entirely.
 *
 * SCREEN
 *
 * The source system names the auditorium rather than referencing `screens.id`,
 * so the name is resolved to one here (resolveScreenIdsByName) and returned
 * alongside it as `screenId`, so the order records the screen of the show the
 * customer actually picked rather than whichever screen their QR was printed
 * for.
 *
 * STATUS
 *
 * Only Open (`Session_strStatus = 'O'`) sessions are offered. Closed ('C') and
 * Inactive ('I') are excluded - both mean the screening is not selling, so
 * there is nothing for a customer to order food against. The vocabulary is the
 * client's, confirmed by them; see SESSION_STATUS_OPEN above.
 *
 * The exclusion is a SQL predicate, not a step in the mapping below, so a
 * non-Open session never leaves the database at all.
 */
function normaliseScreenName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * WHAT THE `screens` TABLE ACTUALLY HOLDS (measured, not assumed)
 *
 * Two different shapes live in this one table:
 *
 *   - Rows created through screen.service, where `assertNameAvailable`
 *     enforces one row per (cinema, name). `category` and `seat_row` are NULL.
 *     One row = one auditorium. This is QBusto's own convention.
 *   - Rows bulk-loaded from the client, which are ONE ROW PER SEAT ROW:
 *     `category` is a seat class ("Platinum") and `seat_row` a row label
 *     ("A".."N"). These never went through the service, so they never met the
 *     uniqueness rule.
 *
 * On the live database the split is total: cinemas 1-7 hold only the first
 * shape (2-4 rows each, every name unique), and cinema 8 holds only the second
 * (61 rows, ~6 names, EVERY row under a duplicated name - "Screen 1" is 10
 * rows, "Screen 2" is 14).
 *
 * THE RESOLUTION
 *
 * A name alone identifies the auditorium only in the first shape. In the
 * second, the seat row the customer is sitting in is the other half of the
 * key: `(cinemaId, name, seatRow)` is unique across the whole table (verified
 * live - e.g. cinema 8 + "Screen 2" + row A is exactly one row, id 32). So the
 * picker offers only the rows that actually exist for the chosen show
 * (`seatRows`, from `summariseScreensByName`), and the final id is resolved at
 * order-creation time (`resolveScreenId`), once both the name and the row the
 * customer entered are known - never guessed from the name alone.
 */
async function loadActiveScreens(cinemaId) {
  return models.Screen.findAll({
    where: { cinemaId, isActive: true },
    attributes: ['id', 'name', 'seatRow'],
    order: [['id', 'ASC']],
  });
}

/**
 * Screen name -> { screenId, seatRows }, for one cinema.
 *
 * `screenId` is populated only for the auditorium-grain shape (name unique,
 * no seat rows) - the case the picker needs no further input for.
 * `seatRows` lists the distinct rows available under that name, sorted, for
 * the seat-row-grain shape; empty when the shape doesn't apply, in which case
 * the row field stays free text (see CheckoutDrawer).
 */
async function summariseScreensByName(cinemaId) {
  const screens = await loadActiveScreens(cinemaId);
  const byName = new Map();

  for (const screen of screens) {
    const key = normaliseScreenName(screen.name);
    if (!byName.has(key)) byName.set(key, { ids: [], seatRows: new Set() });
    const entry = byName.get(key);
    entry.ids.push(screen.id);
    if (screen.seatRow) entry.seatRows.add(String(screen.seatRow).trim().toUpperCase());
  }

  const summary = new Map();
  for (const [key, entry] of byName) {
    const seatRows = [...entry.seatRows].sort();
    summary.set(key, {
      screenId: seatRows.length === 0 && entry.ids.length === 1 ? entry.ids[0] : null,
      seatRows,
    });
  }

  return summary;
}

/**
 * Resolves one order's `screens.id` from the show's screen name plus the
 * seat row the customer entered - the first point both parts exist. The only
 * place `orders.screen_id` is ever set; a client-supplied id is never
 * trusted directly (see createOrder).
 *
 * Auditorium-grain cinemas (no row carries `seatRow`) resolve by name alone,
 * same as before, and `seatRow` is ignored. Seat-row-grain cinemas require an
 * exact, case-insensitive row match; a missing or unmatched row returns null
 * rather than a guess.
 */
async function resolveScreenId(cinemaId, screenName, seatRow) {
  if (!screenName) return null;

  const screens = await loadActiveScreens(cinemaId);
  const key = normaliseScreenName(screenName);
  const matches = screens.filter((screen) => normaliseScreenName(screen.name) === key);
  if (matches.length === 0) return null;

  const withRow = matches.filter((screen) => screen.seatRow);
  if (withRow.length > 0) {
    if (!seatRow) return null;
    const row = String(seatRow).trim().toUpperCase();
    const hit = withRow.find((screen) => String(screen.seatRow).trim().toUpperCase() === row);
    return hit ? hit.id : null;
  }

  return matches.length === 1 ? matches[0].id : null;
}

async function getSessions(cinemaId) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id', 'code'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const now = new Date();

  // A flat window either side of now, so a show that started shortly before
  // the customer opened checkout - the one they are most likely sitting in -
  // is offered alongside the ones still to come. Crossing midnight is not a
  // special case here: these are instants, so a 23:45 screening is simply
  // within three hours of 01:30 the next morning.
  const windowStarts = new Date(now.getTime() - SESSION_WINDOW_MS);
  const windowEnds = new Date(now.getTime() + SESSION_WINDOW_MS);

  const sessions = await models.Session.findAll({
    where: {
      cinemaCode: cinema.code,
      // Open only. A Closed or Inactive screening is not selling, so food
      // cannot be ordered against it.
      status: SESSION_STATUS_OPEN,
      // Session_dtmRealShow - the scheduled start. Formatted as a literal
      // because the source system's column is `datetime`, which carries no
      // offset (see utils/sqlDate).
      startsAt: {
        [Op.gte]: sqlDateTimeLiteral(windowStarts),
        [Op.lt]: sqlDateTimeLiteral(windowEnds),
      },
    },
    attributes: ['sessionId', 'filmCode', 'screenName', 'startsAt', 'endsAt', 'seatsAvailable'],
    include: [
      {
        association: 'film',
        attributes: ['code', 'title', 'certification', 'durationMinutes'],
        required: true,
      },
    ],
    order: [
      ['startsAt', 'ASC'],
      ['sessionId', 'ASC'],
    ],
  });

  // Capped here rather than in SQL: the window already bounds this to a
  // six-hour span for one cinema, so the set is small, and a per-group limit
  // costs a window function that Sequelize would not express any more clearly.
  //
  // Ranked by DISTANCE FROM NOW, not by start time. Taking the first two of a
  // start-ascending list keeps the two EARLIEST, and since the window now
  // reaches three hours backwards those can both be screenings that have
  // already begun - at 20:00 with shows at 17:30, 19:15 and 20:45, the 20:45
  // the customer is about to sit in was the one dropped. Nearest-first keeps
  // the screening they are in and the one after it, which is the whole point
  // of the lookback.
  const nowMs = now.getTime();
  const byDistance = [...sessions].sort(
    (a, b) => Math.abs(a.startsAt - nowMs) - Math.abs(b.startsAt - nowMs)
  );

  const perScreen = new Map();
  const kept = new Set();

  for (const session of byDistance) {
    const key = session.screenName || '';
    const taken = perScreen.get(key) || 0;
    if (taken >= SESSIONS_PER_SCREEN) continue;
    perScreen.set(key, taken + 1);
    kept.add(session);
  }

  // Back into start order for display: the picker reads as a schedule, so the
  // selection is by proximity but the presentation stays chronological.
  const offered = sessions.filter((session) => kept.has(session));

  const screensByName = await summariseScreensByName(cinemaId);

  return offered.map((session) => {
    const summary = screensByName.get(normaliseScreenName(session.screenName)) ?? {
      screenId: null,
      seatRows: [],
    };

    return {
      id: session.sessionId,
      screenName: session.screenName,
      // The screen the CHOSEN show plays in, resolved here rather than taken
      // from the QR link - a QR's screenId is fixed at print time and does not
      // change when the customer picks a different show.
      //
      // NULL when the cinema's screen data is one row per seat row (see
      // summariseScreensByName) - `seatRows` is populated instead, and the
      // actual id is resolved at order-creation time once the customer has
      // picked one.
      screenId: summary.screenId,
      // The rows the customer can choose from for this screen, or empty when
      // the cinema's screen data doesn't carry rows - the picker falls back
      // to free text in that case.
      seatRows: summary.seatRows,
      filmCode: session.filmCode,
      filmTitle: session.film ? session.film.title : null,
      certification: session.film ? session.film.certification : null,
      durationMinutes: session.film ? session.film.durationMinutes : null,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      seatsAvailable: session.seatsAvailable,
    };
  });
}

// ---------------------------------------------------------------------------
// Read-through cache
//
// The query functions above are left exactly as they were and are wrapped here
// instead, so the caching layer is one reviewable block rather than a call
// threaded through every function body. Each wrapper names the parameters that
// vary the answer; anything omitted from that object would collapse two
// different responses onto one key.
//
// Only the catalogue is wrapped. getSessions, the order path and the payment
// path are deliberately absent - see the header of services/cache.service.js
// for why each one is excluded.
// ---------------------------------------------------------------------------

function getCinemaCached(cinemaId) {
  return cache.wrap('cinema', cinemaId, {}, () => getCinema(cinemaId));
}

function getScreenCached(cinemaId, screenId) {
  return cache.wrap('screen', cinemaId, { screenId }, () => getScreen(cinemaId, screenId));
}

function getCategoriesCached(cinemaId, limit, page) {
  return cache.wrap('categories', cinemaId, { limit, page }, () =>
    getCategories(cinemaId, limit, page)
  );
}

/*
 * SOURCE IS PART OF THE KEY, AND MUST STAY THAT WAY.
 *
 * getProducts and getProductDetail price against the caller's order source -
 * the same source createOrder charges against - so their response DOES vary
 * by it. Dropping `source` from the key would serve one channel's prices to
 * every other channel: a seat-QR customer would be shown the lobby price and
 * charged the seat price, or vice versa, entirely at the mercy of whoever
 * warmed the cache first.
 *
 * The key must carry the DERIVED source, not the claimed one, and that
 * distinction is load-bearing: `seat_qr` with no seat is served the lobby
 * rate (pricing.service.deriveSource). Keying on the claim would file that
 * lobby-priced payload under `seat_qr`, and the next request that DID name a
 * seat would be served it - the seatless caller would have poisoned the seat
 * channel. Deriving here, with the same evidence getProducts derives from,
 * keeps key and payload describing the same thing.
 *
 * Cardinality stays bounded at 4x per cinema: the seat is evidence, never a
 * key component, so no caller can mint arbitrary entries from the query
 * string by varying it.
 */
function getProductsCached(cinemaId, options = {}) {
  // A search term is caller-supplied free text: unbounded cardinality and a
  // hit rate near zero, so caching it would fill Redis with entries nothing
  // reads twice. Straight to the database instead.
  if (options.search) return getProducts(cinemaId, options);

  const { categoryId = null, limit, page } = options;
  const source = deriveSource(options.source, { hasSeat: Boolean(options.seat) });

  return cache.wrap('products', cinemaId, { categoryId, limit, page, source }, () =>
    getProducts(cinemaId, options)
  );
}

function getProductDetailCached(cinemaId, productId, source = null, seat = null) {
  const derived = deriveSource(source, { hasSeat: Boolean(seat) });

  return cache.wrap('product', cinemaId, { productId, source: derived }, () =>
    getProductDetail(cinemaId, productId, source, seat)
  );
}

function getBannersCached(cinemaId, type = null) {
  return cache.wrap('banners', cinemaId, { type }, () => getBanners(cinemaId, type));
}

module.exports = {
  getCinema: getCinemaCached,
  getScreen: getScreenCached,
  getCategories: getCategoriesCached,
  getProducts: getProductsCached,
  getProductDetail: getProductDetailCached,
  getBanners: getBannersCached,

  // Uncached on purpose - see cache.service.js.
  getSessions,
  createOrder,
  validateCouponPreview,
  paymentInit,
  paymentVerify,

  // The unwrapped queries, for tests and for callers that must bypass the
  // cache (nothing does today).
  uncached: {
    getCinema,
    getScreen,
    getCategories,
    getProducts,
    getProductDetail,
    getBanners,
  },
};
