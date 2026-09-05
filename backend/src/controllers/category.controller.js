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

/**
 * The cinema's category display order, for the reordering UI.
 *
 * Cinema-scoped rather than category-scoped: the answer is a whole ordered
 * list, and asking each category for its own position would make the UI issue
 * one request per row.
 */
async function getCategoryOrder(req, res) {
  const categories = await categoryService.listCategoryOrder(
    req.user,
    req.validated.params.cinemaId
  );

  return success(res, { message: 'Category order retrieved', data: categories });
}

async function setCategoryOrder(req, res) {
  const categories = await categoryService.setCategoryOrder(
    req.user,
    req.validated.params.cinemaId,
    req.validated.body.categoryIds
  );

  return success(res, { message: 'Category order updated', data: categories });
}

module.exports = { list, getById, create, update, remove, getCategoryOrder, setCategoryOrder };
