'use strict';

/**
 * Chain endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const chainService = require('../services/chain.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { chains, total } = await chainService.listChains(req.user, req.validated.query);

  return paginated(res, { data: chains, total, page, limit, message: 'Chains retrieved' });
}

async function getById(req, res) {
  const chain = await chainService.getChain(req.user, req.validated.params.id);

  return success(res, { message: 'Chain retrieved', data: chain });
}

async function create(req, res) {
  const chain = await chainService.createChain(req.user, req.validated.body);

  return success(res, { message: 'Chain created', data: chain, statusCode: 201 });
}

async function update(req, res) {
  const chain = await chainService.updateChain(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Chain updated', data: chain });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const chain = await chainService.deactivateChain(req.user, req.validated.params.id);

  return success(res, { message: 'Chain deactivated', data: chain });
}

module.exports = { list, getById, create, update, remove };
