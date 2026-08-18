'use strict';

/**
 * Kitchen Display System endpoints.
 *
 * Thin, like every other controller here: `req.user` goes into the service as
 * the acting user, which is what applies the tenant scope and what lands in
 * `changed_by_user_id` on the status log.
 */

const kitchenService = require('../services/kitchen.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { orders, total } = await kitchenService.listKitchenOrders(req.user, req.validated.query);

  return paginated(res, { data: orders, total, page, limit, message: 'Kitchen orders retrieved' });
}

async function getById(req, res) {
  const order = await kitchenService.getKitchenOrder(req.user, req.validated.params.id);

  return success(res, { message: 'Kitchen order retrieved', data: order });
}

async function updateStatus(req, res) {
  const order = await kitchenService.updateKitchenOrderStatus(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Order status updated', data: order });
}

module.exports = { list, getById, updateStatus };
