'use strict';

/**
 * Film endpoints.
 *
 * Read-only: the film catalogue is synced from the source system, so writes
 * made here would not survive the next sync. See film.service.
 */

const filmService = require('../services/film.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { films, total } = await filmService.listFilms(req.user, req.validated.query);

  return paginated(res, { data: films, total, page, limit, message: 'Films retrieved' });
}

async function getByCode(req, res) {
  const film = await filmService.getFilm(req.user, req.validated.params.code);

  return success(res, { message: 'Film retrieved', data: film });
}

module.exports = { list, getByCode };
