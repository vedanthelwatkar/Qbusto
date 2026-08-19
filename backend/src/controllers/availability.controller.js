'use strict';

/**
 * Product availability hour endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const availabilityService = require('../services/availability.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { availabilityHours, total } = await availabilityService.listAvailabilityHours(
    req.user,
    req.validated.query
  );

  return paginated(res, {
    data: availabilityHours,
    total,
    page,
    limit,
    message: 'Availability hours retrieved',
  });
}

async function getById(req, res) {
  const hour = await availabilityService.getAvailabilityHour(req.user, req.validated.params.id);

  return success(res, { message: 'Availability hour retrieved', data: hour });
}

async function create(req, res) {
  const hour = await availabilityService.createAvailabilityHour(req.user, req.validated.body);

  return success(res, { message: 'Availability hour created', data: hour, statusCode: 201 });
}

async function update(req, res) {
  const hour = await availabilityService.updateAvailabilityHour(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Availability hour updated', data: hour });
}

/**
 * Hard delete - product_availability_hours has no is_active column, so there is
 * nothing to soft delete.
 */
async function remove(req, res) {
  const hour = await availabilityService.deleteAvailabilityHour(req.user, req.validated.params.id);

  return success(res, { message: 'Availability hour deleted', data: hour });
}

module.exports = { list, getById, create, update, remove };
