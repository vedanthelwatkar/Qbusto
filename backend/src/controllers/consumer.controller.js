'use strict';

/**
 * Consumer API controller - request handling for public endpoints.
 *
 * Validates requests, calls consumer.service, and formats responses.
 */

const { success, paginated } = require('../utils/response');
const consumerService = require('../services/consumer.service');
const { ServiceUnavailableError } = require('../utils/errors');
const { PAGINATION } = require('../constants');

// Catalog endpoints

async function getCinema(req, res, next) {
  try {
    const { id } = req.params;
    const cinema = await consumerService.getCinema(parseInt(id));
    return success(res, { data: cinema, message: 'Cinema found' });
  } catch (error) {
    next(error);
  }
}

async function getScreen(req, res, next) {
  try {
    const { cinemaId, id } = req.params;
    const screen = await consumerService.getScreen(parseInt(cinemaId), parseInt(id));
    return success(res, { data: screen, message: 'Screen found' });
  } catch (error) {
    next(error);
  }
}

async function getCategories(req, res, next) {
  try {
    const { cinemaId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, 100);
    const page = Math.max(parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE, 1);

    const { categories, total } = await consumerService.getCategories(
      parseInt(cinemaId),
      limit,
      page
    );

    return paginated(res, {
      data: categories,
      total,
      limit,
      page,
      message: 'Categories found',
    });
  } catch (error) {
    next(error);
  }
}

async function getProducts(req, res, next) {
  try {
    const { cinemaId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, 100);
    const page = Math.max(parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE, 1);
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;
    const search = req.query.search ? String(req.query.search).substring(0, 100) : null;

    const { products, total } = await consumerService.getProducts(parseInt(cinemaId), {
      categoryId,
      search,
      limit,
      page,
    });

    return paginated(res, {
      data: products,
      total,
      limit,
      page,
      message: 'Products found',
    });
  } catch (error) {
    next(error);
  }
}

async function getProductDetail(req, res, next) {
  try {
    const { cinemaId, id } = req.params;
    const product = await consumerService.getProductDetail(parseInt(cinemaId), parseInt(id));
    return success(res, { data: product, message: 'Product found' });
  } catch (error) {
    next(error);
  }
}

async function getBanners(req, res, next) {
  try {
    const { cinemaId } = req.params;
    const type = req.query.type ? String(req.query.type).substring(0, 1) : null;

    const banners = await consumerService.getBanners(parseInt(cinemaId), type);

    return success(res, { data: banners, message: 'Banners found' });
  } catch (error) {
    next(error);
  }
}

// Order endpoints

async function createOrder(req, res, next) {
  try {
    const idempotencyKey = req.get('Idempotency-Key');

    const order = await consumerService.createOrder(req.body, idempotencyKey);

    return success(res, {
      data: order,
      statusCode: 201,
      message: 'Order created',
    });
  } catch (error) {
    next(error);
  }
}

async function paymentInit(req, res, next) {
  try {
    const { orderId } = req.params;

    const payment = await consumerService.paymentInit(parseInt(orderId));

    return success(res, {
      data: payment,
      message: 'Payment initialized',
    });
  } catch (error) {
    if (error.message && error.message.includes('Razorpay API unavailable')) {
      return next(
        new ServiceUnavailableError('Razorpay API temporarily unavailable, please retry')
      );
    }
    next(error);
  }
}

async function paymentVerify(req, res, next) {
  try {
    const { orderId } = req.params;
    const { razorpayPaymentId, razorpaySignature } = req.body;

    const result = await consumerService.paymentVerify(
      parseInt(orderId),
      razorpayPaymentId,
      razorpaySignature
    );

    return success(res, {
      data: result,
      message: 'Payment verified',
    });
  } catch (error) {
    next(error);
  }
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
