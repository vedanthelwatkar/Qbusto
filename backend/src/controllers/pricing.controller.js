'use strict';

/**
 * Product pricing endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const pricingService = require('../services/pricing.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { pricings, total } = await pricingService.listPricings(req.user, req.validated.query);

  return paginated(res, {
    data: pricings,
    total,
    page,
    limit,
    message: 'Product pricing retrieved',
  });
}

async function getById(req, res) {
  const pricing = await pricingService.getPricing(req.user, req.validated.params.id);

  return success(res, { message: 'Product pricing retrieved', data: pricing });
}

async function create(req, res) {
  const pricing = await pricingService.createPricing(req.user, req.validated.body);

  return success(res, { message: 'Product pricing created', data: pricing, statusCode: 201 });
}

async function update(req, res) {
  const pricing = await pricingService.updatePricing(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Product pricing updated', data: pricing });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const pricing = await pricingService.deactivatePricing(req.user, req.validated.params.id);

  return success(res, { message: 'Product pricing deactivated', data: pricing });
}

module.exports = { list, getById, create, update, remove };
