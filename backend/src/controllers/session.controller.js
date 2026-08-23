'use strict';

/**
 * Session endpoints.
 *
 * Read-only: the schedule is synced from the source system. `req.user` is
 * passed into the service, which uses it for tenant scoping.
 */

const sessionService = require('../services/session.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { sessions, total } = await sessionService.listSessions(req.user, req.validated.query);

  return paginated(res, { data: sessions, total, page, limit, message: 'Sessions retrieved' });
}

async function getById(req, res) {
  const session = await sessionService.getSession(req.user, req.validated.params.id);

  return success(res, { message: 'Session retrieved', data: session });
}

module.exports = { list, getById };
