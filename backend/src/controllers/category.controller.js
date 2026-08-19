'use strict';

/**
 * Category endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const categoryService = require('../services/category.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { categories, total } = await categoryService.listCategories(req.user, req.validated.query);

  return paginated(res, { data: categories, total, page, limit, message: 'Categories retrieved' });
}

async function getById(req, res) {
  const category = await categoryService.getCategory(req.user, req.validated.params.id);

  return success(res, { message: 'Category retrieved', data: category });
}

async function create(req, res) {
  const category = await categoryService.createCategory(req.user, req.validated.body);

  return success(res, { message: 'Category created', data: category, statusCode: 201 });
}

async function update(req, res) {
  const category = await categoryService.updateCategory(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Category updated', data: category });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const category = await categoryService.deactivateCategory(req.user, req.validated.params.id);

  return success(res, { message: 'Category deactivated', data: category });
}

module.exports = { list, getById, create, update, remove };
