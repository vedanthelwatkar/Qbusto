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
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { PAGINATION, ORDER_STATUSES, PAYMENT_STATUSES, ORDER_SOURCES } = require('../constants');
const pricingService = require('./pricing.service');

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

  // Categories that have at least one available product at this cinema
  const { rows: categories, count } = await models.Category.findAndCountAll({
    include: [
      {
        association: 'products',
        attributes: [],
        through: { attributes: [] },
        required: true,
        include: [
          {
            association: 'cinemaProducts',
            attributes: [],
            where: { cinemaId, isActive: true },
            required: true,
          },
          {
            association: 'pricings',
            attributes: [],
            where: {
              cinemaId,
              dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(new Date())] },
              isActive: true,
            },
            required: true,
          },
        ],
      },
    ],
    attributes: ['id', 'name', 'imageUrl', 'description'],
    subQuery: false,
    raw: true,
    limit,
    offset: (page - 1) * limit,
    order: [['name', 'ASC']],
    distinct: true,
  });

  return {
    categories,
    total: count,
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

  const { rows: products, count } = await models.Product.findAndCountAll({
    where,
    include: [
      {
        association: 'cinemaProducts',
        attributes: [],
        where: { cinemaId, isActive: true },
        required: true,
        include: [
          {
            association: 'availabilityHours',
            attributes: [],
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
          dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(new Date())] },
          isActive: true,
        },
        required: true,
      },
    ],
    attributes: ['id', 'name', 'description', 'imageUrl'],
    subQuery: false,
    raw: false,
    limit,
    offset: (page - 1) * limit,
    order: [['name', 'ASC']],
    distinct: true,
  });

  // Transform products to include basePrice with source discount
  const transformedProducts = products.map((product) => {
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
    total: count,
  };
}

/** GET /api/consumer/cinemas/{cinemaId}/products/{id} */
async function getProductDetail(cinemaId, productId) {
  const cinema = await models.Cinema.findByPk(cinemaId, {
    where: { isActive: true },
    attributes: ['id'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  const product = await models.Product.findOne({
    where: { id: productId, isActive: true },
    include: [
      {
        association: 'cinemaProducts',
        attributes: [],
        where: { cinemaId, isActive: true },
        required: true,
        include: [
          {
            association: 'availabilityHours',
            attributes: [],
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
          dayOfWeek: { [Op.in]: [EVERY_DAY, isoDayOfWeek(new Date())] },
          isActive: true,
        },
        required: true,
      },
    ],
    attributes: ['id', 'name', 'description', 'imageUrl'],
    raw: false,
  });

  if (!product) throw new NotFoundError('Product');

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

  const where = {
    cinemaId,
    isActive: true,
  };

  // Date filtering: startDate NULL or <= today AND endDate NULL or >= today
  where[Op.and] = [
    sequelize.where(sequelize.col('startDate'), Op.or, [
      { [Op.is]: null },
      { [Op.lte]: new Date() },
    ]),
    sequelize.where(sequelize.col('endDate'), Op.or, [{ [Op.is]: null }, { [Op.gte]: new Date() }]),
  ];

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

  // If razorpayOrderId already set, return it (idempotent)
  if (order.razorpayOrderId) {
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

  // Update order status to paid in a transaction
  return sequelize.transaction(async (transaction) => {
    const [newPaymentStatusId, oldPaymentStatusId] = await Promise.all([
      resolveStatusId('payment', PAYMENT_STATUSES.PAID, transaction),
      resolveStatusId('payment', PAYMENT_STATUSES.PENDING, transaction),
    ]);

    await models.Order.update(
      { paymentStatusId: newPaymentStatusId, razorpayPaymentId },
      { where: { id: orderId }, transaction }
    );

    // Create payment status log
    await models.PaymentStatusLog.create(
      {
        orderId,
        previousStatusId: oldPaymentStatusId,
        newStatusId: newPaymentStatusId,
        razorpayPaymentId,
        reason: 'Payment verified',
      },
      { transaction }
    );

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
