'use strict';

/**
 * Product endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const productService = require('../services/product.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { products, total } = await productService.listProducts(req.user, req.validated.query);

  return paginated(res, { data: products, total, page, limit, message: 'Products retrieved' });
}

async function getById(req, res) {
  const product = await productService.getProduct(req.user, req.validated.params.id);

  return success(res, { message: 'Product retrieved', data: product });
}

async function create(req, res) {
  const product = await productService.createProduct(req.user, req.validated.body);

  return success(res, { message: 'Product created', data: product, statusCode: 201 });
}

async function update(req, res) {
  const product = await productService.updateProduct(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Product updated', data: product });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const product = await productService.deactivateProduct(req.user, req.validated.params.id);

  return success(res, { message: 'Product deactivated', data: product });
}

module.exports = { list, getById, create, update, remove };
