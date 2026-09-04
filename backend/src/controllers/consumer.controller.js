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
    // Which channel's price to show. Both are passed through raw; the service
    // derives the source it will actually price against from the two together
    // (pricing.service.deriveSource) before either reaches a discount column
    // or a cache key. Anything unrecognised - and any `seat_qr` claim with no
    // seat behind it - prices as `qr`, the lobby rate.
    const source = req.query.source ? String(req.query.source) : null;
    // Evidence for a `seat_qr` claim, not a stored value: only its presence is
    // read, and it is capped so an oversized string cannot travel any further.
    const seat = req.query.seat ? String(req.query.seat).substring(0, 20) : null;

    const { products, total } = await consumerService.getProducts(parseInt(cinemaId), {
      categoryId,
      search,
      limit,
      page,
      source,
      seat,
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
    const source = req.query.source ? String(req.query.source) : null;
    const seat = req.query.seat ? String(req.query.seat).substring(0, 20) : null;
    const product = await consumerService.getProductDetail(
      parseInt(cinemaId),
      parseInt(id),
      source,
      seat
    );
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

async function getSessions(req, res, next) {
  try {
    const { cinemaId } = req.params;

    const sessions = await consumerService.getSessions(parseInt(cinemaId));

    return success(res, { data: sessions, message: 'Sessions found' });
  } catch (error) {
    next(error);
  }
}

async function getShows(req, res, next) {
  try {
    const { cinemaId } = req.params;

    const shows = await consumerService.getShows(parseInt(cinemaId));

    return success(res, { data: shows, message: 'Shows found' });
  } catch (error) {
    next(error);
  }
}

// Order endpoints

async function createOrder(req, res, next) {
  try {
    const idempotencyKey = req.get('Idempotency-Key');

    const order = await consumerService.createOrder(req.validated.body, idempotencyKey);

    return success(res, {
      data: order,
      statusCode: 201,
      message: 'Order created',
    });
  } catch (error) {
    next(error);
  }
}

async function validateCoupon(req, res, next) {
  try {
    const { cinemaId } = req.params;
    const { code, items, source, seatNumber } = req.validated.body;

    const result = await consumerService.validateCouponPreview(parseInt(cinemaId), {
      code,
      items,
      source,
      seatNumber,
    });

    return success(res, {
      data: result,
      message: result.valid ? 'Coupon applied' : 'Coupon not applied',
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
    if (error.message && error.message.includes('Cashfree API unavailable')) {
      return next(
        new ServiceUnavailableError('Payment provider temporarily unavailable, please retry')
      );
    }
    next(error);
  }
}

async function paymentVerify(req, res, next) {
  try {
    const { orderId } = req.params;

    // Deliberately takes nothing from the request body. Cashfree's hosted
    // checkout gives the browser no cryptographic credential, so any payment
    // identity a caller supplied would be an unverifiable assertion. The
    // service asks Cashfree directly instead.
    const result = await consumerService.paymentVerify(parseInt(orderId));

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
  getSessions,
  getShows,
  createOrder,
  validateCoupon,
  paymentInit,
  paymentVerify,
};
