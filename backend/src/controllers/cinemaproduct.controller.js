'use strict';

/**
 * Cinema product endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const cinemaProductService = require('../services/cinemaproduct.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { cinemaProducts, total } = await cinemaProductService.listCinemaProducts(
    req.user,
    req.validated.query
  );

  return paginated(res, {
    data: cinemaProducts,
    total,
    page,
    limit,
    message: 'Cinema products retrieved',
  });
}

async function getById(req, res) {
  const cinemaProduct = await cinemaProductService.getCinemaProduct(
    req.user,
    req.validated.params.id
  );

  return success(res, { message: 'Cinema product retrieved', data: cinemaProduct });
}

async function create(req, res) {
  const cinemaProduct = await cinemaProductService.createCinemaProduct(
    req.user,
    req.validated.body
  );

  return success(res, {
    message: 'Cinema product created',
    data: cinemaProduct,
    statusCode: 201,
  });
}

async function update(req, res) {
  const cinemaProduct = await cinemaProductService.updateCinemaProduct(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Cinema product updated', data: cinemaProduct });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const cinemaProduct = await cinemaProductService.deactivateCinemaProduct(
    req.user,
    req.validated.params.id
  );

  return success(res, { message: 'Cinema product deactivated', data: cinemaProduct });
}

module.exports = { list, getById, create, update, remove };
