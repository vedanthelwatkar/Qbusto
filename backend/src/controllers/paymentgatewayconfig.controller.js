'use strict';

const configService = require('../services/paymentgatewayconfig.service');
const { success } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');

async function getActive(req, res) {
  const config = await configService.getActiveConfig(req.user, req.validated.query.cinemaId);

  if (!config) throw new NotFoundError('Active payment gateway config');

  return success(res, { message: 'Payment gateway config retrieved', data: config });
}

async function setCredentials(req, res) {
  const { cinemaId, ...rest } = req.validated.body;

  const config = await configService.setCredentials(req.user, cinemaId, rest);

  return success(res, { message: 'Payment gateway credentials saved', data: config });
}

async function deactivate(req, res) {
  const config = await configService.deactivateConfig(req.user, req.validated.query.cinemaId);

  return success(res, { message: 'Payment gateway config deactivated', data: config });
}

module.exports = { getActive, setCredentials, deactivate };
