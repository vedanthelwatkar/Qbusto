'use strict';

/**
 * A cinema's About/Terms footer content. `req.user` carries tenant scope and
 * the audit columns, same as cinema.controller.
 */

const cinemaContentService = require('../services/cinemaContent.service');
const { success } = require('../utils/response');

async function getById(req, res) {
  const content = await cinemaContentService.getContent(req.user, req.validated.params.id);

  return success(res, { message: 'Cinema content retrieved', data: content });
}

async function upsert(req, res) {
  const content = await cinemaContentService.upsertContent(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Cinema content saved', data: content });
}

module.exports = { getById, upsert };
