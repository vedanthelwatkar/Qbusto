'use strict';

/**
 * Cinema endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const cinemaService = require('../services/cinema.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { cinemas, total } = await cinemaService.listCinemas(req.user, req.validated.query);

  return paginated(res, { data: cinemas, total, page, limit, message: 'Cinemas retrieved' });
}

async function getById(req, res) {
  const cinema = await cinemaService.getCinema(req.user, req.validated.params.id);

  return success(res, { message: 'Cinema retrieved', data: cinema });
}

async function create(req, res) {
  const cinema = await cinemaService.createCinema(req.user, req.validated.body);

  return success(res, { message: 'Cinema created', data: cinema, statusCode: 201 });
}

async function update(req, res) {
  const cinema = await cinemaService.updateCinema(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Cinema updated', data: cinema });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const cinema = await cinemaService.deactivateCinema(req.user, req.validated.params.id);

  return success(res, { message: 'Cinema deactivated', data: cinema });
}

module.exports = { list, getById, create, update, remove };
