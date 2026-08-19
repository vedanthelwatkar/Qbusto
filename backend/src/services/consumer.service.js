'use strict';

/**
 * Consumer API service - public, unauthenticated endpoints.
 *
 * Implements all 9 consumer endpoints:
 * 1. GET /api/consumer/cinemas/{id}
 * 2. GET /api/consumer/cinemas/{cinemaId}/screens/{id}
 * 3. GET /api/consumer/cinemas/{cinemaId}/categories
 * 4. GET /api/consumer/cinemas/{cinemaId}/products
 * 5. GET /api/consumer/cinemas/{cinemaId}/products/{id}
 * 6. GET /api/consumer/cinemas/{cinemaId}/banners
 * 7. POST /api/consumer/orders (idempotent)
 * 8. POST /api/consumer/orders/{orderId}/payment-init (idempotent)
 * 9. POST /api/consumer/orders/{orderId}/payment-verify (idempotent)
 *
 * Reuses pricing logic from pricing.service for consistency with staff orders.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const logger = require('../config/logger');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { PAGINATION, ORDER_STATUSES, PAYMENT_STATUSES, ORDER_SOURCES } = require('../constants');
const pricingService = require('./pricing.service');
const { applyPaidTransition } = require('./paymenttransition.service');

const {
  toPaise,
  toDecimalString,
  isoDayOfWeek,
  unavailableReason,
  selectPricing,
  unitDiscountPaise,
  EVERY_DAY,
} = pricingService;

// ---------------------------------------------------------------------------
// Catalog endpoints
// ---------------------------------------------------------------------------

/** GET /api/consumer/cinemas/{id} */
async function getCinema(cinemaId) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id', 'name', 'code', 'location', 'city'],
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
  } = {}
) {
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
    attributes: ['id', 'name', 'description', 'imageUrl'],
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
    const discountPaise = unitDiscountPaise(pricing, ORDER_SOURCES.QR, unitPaise);
    const discountedPaise = unitPaise - discountPaise;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      basePrice: parseFloat(toDecimalString(discountedPaise)),
    };
  });

  return {
    products: transformedProducts,
    total: available.length,
  };
}

/** GET /api/consumer/cinemas/{cinemaId}/products/{id} */
async function getProductDetail(cinemaId, productId) {
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
    attributes: ['id', 'name', 'description', 'imageUrl'],
    raw: false,
  });

  if (!product) throw new NotFoundError('Product');

  // Same predicate as the listing and as order creation. A product that is not
  // orderable right now is not addressable either - otherwise a stale link or a
  // guessed id would still put it in the cart.
  if (unavailableReason(product.cinemaProducts[0], now)) throw new NotFoundError('Product');

  const pricing = product.pricings && product.pricings[0];
  const unitPaise = toPaise(pricing.basePrice);
  const discountPaise = unitDiscountPaise(pricing, ORDER_SOURCES.QR, unitPaise);
  const discountedPaise = unitPaise - discountPaise;

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
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

    // Validate screen if provided
    if (payload.screenId) {
      const screen = await models.Screen.findOne({
        where: { id: payload.screenId, cinemaId: cinema.id },
        attributes: ['id', 'isActive'],
        transaction,
      });

      if (!screen) throw new NotFoundError('Screen');
      if (!screen.isActive)
        throw new ConflictError('Screen is not active', { screenId: payload.screenId });
    }

    // Validate source
    if (!Object.values(ORDER_SOURCES).includes(payload.source)) {
      throw new ValidationError('Invalid order source', [
        { field: 'source', message: `Must be one of: ${Object.values(ORDER_SOURCES).join(', ')}` },
      ]);
    }

    // Build order lines with pricing validation
    const now = new Date();
    const lines = await buildOrderLines(cinema, payload, now, transaction);

    // Calculate totals
    const subtotalPaise = lines.reduce((sum, line) => sum + line.grossPaise, 0);
    const discountPaise = lines.reduce((sum, line) => sum + line.discountPaise, 0);
    const totalPaise = subtotalPaise - discountPaise;

    // Resolve status IDs
    const [statusId, paymentStatusId] = await Promise.all([
      resolveStatusId('order', ORDER_STATUSES.INITIATED, transaction),
      resolveStatusId('payment', PAYMENT_STATUSES.PENDING, transaction),
    ]);

    // Create order
    const order = await models.Order.create(
      {
        cinemaId: cinema.id,
        screenId: payload.screenId || null,
        seatNumber: payload.seatNumber || null,
        statusId,
        paymentStatusId,
        source: payload.source,
        customerMobile: payload.customerMobile || null,
        customerEmail: payload.customerEmail || null,
        filmTitle: payload.filmTitle || null,
        showTime: payload.showTime || null,
        notes: payload.notes || null,
        subtotal: toDecimalString(subtotalPaise),
        discount: toDecimalString(discountPaise),
        total: toDecimalString(totalPaise),
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
 * How long reconciliation may wait on Razorpay.
 *
 * This call sits inside payment-init, which a customer is standing at a kiosk
 * waiting on, so the budget is the customer's patience rather than Razorpay's
 * worst case. Measured against the live test account on this machine, the
 * round trip is ~1s (payment-init 1.69s with reconciliation vs 0.73s without).
 * 4s leaves roughly 4x headroom for a slow-but-healthy Razorpay while capping
 * what a hung endpoint can cost the customer.
 *
 * Erring long would be the wrong trade: a timeout costs only a missed chance to
 * reconcile, which the next attempt retries, whereas a stalled payment-init
 * strands someone mid-purchase.
 */
const RECONCILIATION_TIMEOUT_MS = 4000;

/**
 * Bound how long we WAIT for a promise. This is not cancellation.
 *
 * If the timeout wins, the underlying HTTP request is still in flight - the
 * axios default set alongside this may abort the socket, but that is
 * best-effort. What is guaranteed is that our caller stops waiting.
 *
 * The loser's rejection is swallowed explicitly: once we have returned, a late
 * rejection would otherwise surface as an unhandled rejection and, under Node's
 * default, take the process down. The timer is always cleared so a fast success
 * cannot leak one.
 */
function withTimeout(value, ms, label) {
  let timerId;

  const timeout = new Promise((_resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  // Promise.resolve() rather than using `value` directly: if the SDK ever
  // returns a non-thenable or throws synchronously, calling .catch() on it
  // would throw AFTER the timer above exists, leaking a timer that fires much
  // later as an unhandled rejection. Normalising first makes that impossible.
  const settled = Promise.resolve(value);

  // Attach a handler now, so a rejection arriving after we have already
  // returned is never unhandled - Node terminates the process on those.
  settled.catch(() => {});

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timerId));
}

/**
 * Ask Razorpay whether an already-initialised order was in fact paid.
 *
 * THE GAP THIS CLOSES
 *
 * Our backend normally learns of a payment two ways: the browser posts the
 * signature, or a webhook arrives. If BOTH fail - the customer's phone dies on
 * cinema wifi and the webhook delivery is exhausted or misconfigured - the
 * money is gone and our order sits `pending` forever, with nothing in the
 * system able to discover otherwise.
 *
 * `orders.fetchPayments` (GET /orders/{id}/payments) is Razorpay's own record
 * of what happened, authenticated with our key secret. It is server-to-server,
 * so unlike the browser callback it cannot be lost, forged or replayed by a
 * customer.
 *
 * WHAT MAKES IT SAFE
 *
 * - It only ever CONFIRMS. A payment is accepted only when Razorpay itself
 *   reports `status: 'captured'` for the exact amount we expect. Anything else
 *   - authorized-not-captured, failed, refunded, a mismatched amount, an API
 *   error - leaves the order exactly as it was. It never guesses.
 * - `authorized` is deliberately not accepted: this codebase never calls
 *   payments.capture(), so authorised money has not been taken.
 * - The transition goes through applyPaidTransition like every other source,
 *   so it cannot double the state change or the post-payment side effects,
 *   whichever source wins the race.
 * - A failure to reach Razorpay is swallowed: the caller then behaves exactly
 *   as it did before this existed. Reconciliation is an extra chance to learn
 *   the truth, never a new way to fail a legitimate retry.
 *
 * @returns {Promise<boolean>} true when the order is now paid.
 */
async function reconcilePaymentFromRazorpay(order) {
  let payments;

  try {
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // Razorpay 2.9.8 exposes no timeout option (its own config sets only
    // baseURL, headers and auth), so one is applied two ways. The axios
    // default below is best-effort and does genuinely abort the socket, but it
    // reaches into SDK internals and would silently stop applying if those
    // change - so it is never relied on alone.
    try {
      if (razorpay.api && razorpay.api.rq && razorpay.api.rq.defaults) {
        razorpay.api.rq.defaults.timeout = RECONCILIATION_TIMEOUT_MS;
      }
    } catch {
      // Internals not as expected; the bounded wait below still applies.
    }

    const response = await withTimeout(
      razorpay.orders.fetchPayments(order.razorpayOrderId),
      RECONCILIATION_TIMEOUT_MS,
      'Razorpay reconciliation'
    );
    payments = response && Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    // Razorpay unreachable, credentials wrong, order unknown to them. Not
    // knowing is the status quo, so carry on rather than blocking a customer
    // who may simply be retrying a genuinely failed payment.
    logger.warn('Razorpay reconciliation could not be completed', {
      orderId: order.id,
      // Message only - never the payload, and never credentials.
      reason: error && error.message ? error.message : 'unknown',
    });
    return false;
  }

  const expectedPaise = toPaise(order.total);

  // Integer paise on both sides; no floating-point money comparison.
  const captured = payments.find(
    (payment) =>
      payment &&
      payment.status === 'captured' &&
      Number.isInteger(payment.amount) &&
      payment.amount === expectedPaise
  );

  if (!captured) return false;

  logger.info('Razorpay reconciliation found a captured payment', {
    orderId: order.id,
    razorpayOrderId: order.razorpayOrderId,
  });

  await sequelize.transaction(async (transaction) => {
    await applyPaidTransition(
      {
        orderId: order.id,
        razorpayPaymentId: captured.id || null,
        reason: 'Payment confirmed by reconciliation with Razorpay',
      },
      transaction
    );
  });

  return true;
}

/** POST /api/consumer/orders/{orderId}/payment-init - Initialize Razorpay payment (IDEMPOTENT) */
async function paymentInit(orderId) {
  const order = await models.Order.findByPk(orderId, {
    attributes: ['id', 'paymentStatusId', 'total', 'razorpayOrderId'],
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

  // If razorpayOrderId already set, return it (idempotent).
  if (order.razorpayOrderId) {
    // Before handing back a payable order, ask Razorpay whether this order was
    // ALREADY paid. Reaching here means a previous attempt existed, and the
    // dangerous case is the one where that attempt succeeded but neither the
    // browser callback nor the webhook ever told us — the customer would
    // otherwise be shown a Pay button for money they have already handed over.
    //
    // This is the only trigger: a customer-initiated request on an order that
    // has already been initialised. It is not a poller.
    const reconciled = await reconcilePaymentFromRazorpay(order);

    if (reconciled) {
      // Same 409 shape payment-init already returns for a settled order, so
      // the Consumer's existing recovery reads it and moves to confirmation.
      throw new ConflictError('Order is not in pending payment state', {
        orderId,
        paymentStatus: PAYMENT_STATUSES.PAID,
      });
    }

    return {
      orderId,
      razorpayOrderId: order.razorpayOrderId,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      amount: toPaise(order.total),
      currency: 'INR',
    };
  }

  // Call Razorpay API (OUTSIDE transaction)
  let razorpayOrderId;
  try {
    // Razorpay is optional - if not available, log and skip
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const response = await razorpay.orders.create({
      amount: toPaise(order.total),
      currency: 'INR',
      receipt: `order_${order.id}`,
    });
    razorpayOrderId = response.id;
  } catch (error) {
    // If Razorpay is not available or returns 5xx, return service unavailable
    if (
      error.statusCode === 503 ||
      error.statusCode === 500 ||
      error.code === 'ERR_MODULE_NOT_FOUND'
    ) {
      throw new Error('Razorpay API unavailable', { cause: error });
    }
    throw error;
  }

  // Compare-and-set: UPDATE only if razorpayOrderId is still NULL
  const [rowsUpdated] = await models.Order.update(
    { razorpayOrderId },
    { where: { id: orderId, razorpayOrderId: null } }
  );

  if (rowsUpdated === 1) {
    // We won the race
    return {
      orderId,
      razorpayOrderId,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      amount: toPaise(order.total),
      currency: 'INR',
    };
  } else {
    // Another request won, reload and return their ID
    const reloadedOrder = await models.Order.findByPk(orderId, {
      attributes: ['razorpayOrderId', 'total'],
    });

    return {
      orderId,
      razorpayOrderId: reloadedOrder.razorpayOrderId,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      amount: toPaise(reloadedOrder.total),
      currency: 'INR',
    };
  }
}

/** POST /api/consumer/orders/{orderId}/payment-verify - Verify payment signature (IDEMPOTENT) */
async function paymentVerify(orderId, razorpayPaymentId, razorpaySignature) {
  const order = await models.Order.findByPk(orderId, {
    attributes: ['id', 'razorpayOrderId', 'paymentStatusId', 'total'],
    include: [
      {
        association: 'paymentStatus',
        attributes: ['code'],
      },
    ],
  });

  if (!order) throw new NotFoundError('Order');

  // Idempotency: if already paid, return success
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

  if (!order.razorpayOrderId) {
    throw new ValidationError('Order has no Razorpay order ID', { orderId });
  }

  // Verify signature
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '');
  hmac.update(`${order.razorpayOrderId}|${razorpayPaymentId}`);
  const hash = hmac.digest('hex');

  if (hash !== razorpaySignature) {
    throw new ValidationError('Invalid payment signature', [
      { field: 'razorpaySignature', message: 'Signature verification failed' },
    ]);
  }

  // Update order status to paid in a transaction.
  //
  // The status was read above, OUTSIDE this transaction, so it is a snapshot:
  // the Razorpay webhook can commit `paid` for the same payment in between.
  // This used to be an unconditional UPDATE plus an unconditional log insert,
  // which meant the loser of that race still wrote a second
  // payment_status_logs row for a transition that had already happened - and,
  // more dangerously, still ran this block, which is where post-payment side
  // effects (kitchen ticket, receipt, notification) would naturally be added.
  //
  // The write is therefore the same compare-and-set the webhook path uses:
  // only a still-pending row transitions, so exactly one of the two callers
  // ever performs the transition and everything hanging off it runs once.
  return sequelize.transaction(async (transaction) => {
    // The transition and everything that must happen exactly once with it live
    // in paymenttransition.service, shared with the webhook and reconciliation
    // paths. A `false` here means one of those got there first, which is a
    // normal race outcome, not a failure.
    await applyPaidTransition(
      { orderId, razorpayPaymentId, reason: 'Payment verified' },
      transaction
    );

    // `paid` either way, and that is the truth: this request verified a
    // genuine signature, and the order is paid whether this call or another
    // source was the one to record it. Reporting anything else here would
    // strand a customer whose payment had in fact succeeded.
    return {
      orderId,
      paymentStatus: PAYMENT_STATUSES.PAID,
    };
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

module.exports = {
  getCinema,
  getScreen,
  getCategories,
  getProducts,
  getProductDetail,
  getBanners,
  createOrder,
  paymentInit,
  paymentVerify,
};
