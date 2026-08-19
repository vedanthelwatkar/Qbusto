'use strict';

/**
 * Screen endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const screenService = require('../services/screen.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { screens, total } = await screenService.listScreens(req.user, req.validated.query);

  return paginated(res, { data: screens, total, page, limit, message: 'Screens retrieved' });
}

async function getById(req, res) {
  const screen = await screenService.getScreen(req.user, req.validated.params.id);

  return success(res, { message: 'Screen retrieved', data: screen });
}

async function create(req, res) {
  const screen = await screenService.createScreen(req.user, req.validated.body);

  return success(res, { message: 'Screen created', data: screen, statusCode: 201 });
}

async function update(req, res) {
  const screen = await screenService.updateScreen(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Screen updated', data: screen });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const screen = await screenService.deactivateScreen(req.user, req.validated.params.id);

  return success(res, { message: 'Screen deactivated', data: screen });
}

module.exports = { list, getById, create, update, remove };
