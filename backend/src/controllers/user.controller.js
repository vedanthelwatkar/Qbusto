'use strict';

/**
 * User management endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns
 * on user_permissions.
 */

const userService = require('../services/user.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { users, total } = await userService.listUsers(req.user, req.validated.query);

  return paginated(res, { data: users, total, page, limit, message: 'Users retrieved' });
}

async function getById(req, res) {
  const user = await userService.getUser(req.user, req.validated.params.id);

  return success(res, { message: 'User retrieved', data: user });
}

async function create(req, res) {
  const user = await userService.createUser(req.user, req.validated.body);

  return success(res, { message: 'User created', data: user, statusCode: 201 });
}

async function update(req, res) {
  const user = await userService.updateUser(req.user, req.validated.params.id, req.validated.body);

  return success(res, { message: 'User updated', data: user });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const user = await userService.deactivateUser(req.user, req.validated.params.id);

  return success(res, { message: 'User deactivated', data: user });
}

module.exports = { list, getById, create, update, remove };
