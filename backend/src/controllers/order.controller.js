'use strict';

/**
 * Order endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and as the `changed_by_user_id` on every status
 * log entry it writes.
 */

const orderService = require('../services/order.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { orders, total } = await orderService.listOrders(req.user, req.validated.query);

  return paginated(res, { data: orders, total, page, limit, message: 'Orders retrieved' });
}

async function getById(req, res) {
  const order = await orderService.getOrder(req.user, req.validated.params.id);

  return success(res, { message: 'Order retrieved', data: order });
}

async function create(req, res) {
  const order = await orderService.createOrder(req.user, req.validated.body);

  return success(res, { message: 'Order created', data: order, statusCode: 201 });
}

async function updateStatus(req, res) {
  const order = await orderService.updateOrderStatus(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Order status updated', data: order });
}

async function updatePaymentStatus(req, res) {
  const order = await orderService.updatePaymentStatus(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Payment status updated', data: order });
}

/**
 * The status master tables. Small fixed lists, so they are returned whole
 * rather than paginated - there is no page two of six rows.
 */
async function listOrderStatuses(req, res) {
  const statuses = await orderService.listOrderStatuses(req.validated.query);

  return success(res, { message: 'Order statuses retrieved', data: statuses });
}

async function listPaymentStatuses(req, res) {
  const statuses = await orderService.listPaymentStatuses(req.validated.query);

  return success(res, { message: 'Payment statuses retrieved', data: statuses });
}

module.exports = {
  list,
  getById,
  create,
  updateStatus,
  updatePaymentStatus,
  listOrderStatuses,
  listPaymentStatuses,
};
