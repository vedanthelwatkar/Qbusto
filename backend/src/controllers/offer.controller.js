'use strict';

/**
 * Offer endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const offerService = require('../services/offer.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { offers, total } = await offerService.listOffers(req.user, req.validated.query);

  return paginated(res, { data: offers, total, page, limit, message: 'Offers retrieved' });
}

async function getById(req, res) {
  const offer = await offerService.getOffer(req.user, req.validated.params.id);

  return success(res, { message: 'Offer retrieved', data: offer });
}

async function create(req, res) {
  const offer = await offerService.createOffer(req.user, req.validated.body);

  return success(res, { message: 'Offer created', data: offer, statusCode: 201 });
}

async function update(req, res) {
  const offer = await offerService.updateOffer(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Offer updated', data: offer });
}

async function remove(req, res) {
  const offer = await offerService.deleteOffer(req.user, req.validated.params.id);

  return success(res, { message: 'Offer deleted', data: offer });
}

module.exports = { list, getById, create, update, remove };
