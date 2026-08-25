'use strict';

/**
 * Cinema-scoped coupons ("offers"), staff-managed CRUD.
 *
 * WHY THIS EXISTS
 *
 * Coupons are validated and applied ENTIRELY within QBusto -
 * `services/coupon.service.validateCoupon`, called from the Consumer app's
 * "Apply coupon" control and from order creation itself - and the discount
 * is folded into an order's own `discount`/`total` before Cashfree is ever
 * involved. Cashfree has no coupon/offer concept in this flow: it only ever
 * sees the final, already-discounted amount. This is a deliberate design,
 * not an oversight - an earlier version tried routing coupons through
 * Cashfree's own offer system, which meant a third party could ultimately
 * decide what a customer owed; that was abandoned in favour of this simpler
 * model, where QBusto is the only source of truth.
 *
 * This module is the staff-facing CRUD side of that table (list/get/create/
 * update/delete). The customer-facing validation logic lives in
 * coupon.service, not here.
 *
 * An out-of-scope cinema is reported as 404, matching every other
 * cinema-scoped resource in this codebase (banners, screens, products).
 *
 * No transactions: every write here is a single-row operation.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'code',
  'name',
  'discountType',
  'description',
  'tnc',
  'status',
  'discAmount',
  'maxDiscAmount',
  'minTxnAmount',
  'maxTxnAmount',
  'maxTxnLimit',
  'validFrom',
  'validUntil',
  'createdAt',
  'updatedAt',
];

function serializeOffer(offer) {
  if (!offer) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = offer[attribute];
  }

  return result;
}

/** Join to the owning cinema, filtered to the actor's chain. */
function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * @throws {NotFoundError} 404 when the cinema does not exist or is out of
 *   the actor's chain.
 * @throws {ConflictError} 409 when the cinema is deactivated.
 */
async function findCinemaInScope(actor, cinemaId) {
  const where = { id: cinemaId };
  if (actor.role !== ROLES.OWNER) where.chainId = actor.chainId;

  const cinema = await models.Cinema.findOne({ where, attributes: ['id', 'chainId', 'isActive'] });

  if (!cinema) throw new NotFoundError('Cinema');

  if (!cinema.isActive) {
    throw new ConflictError('Cannot add an offer to a deactivated cinema', { cinemaId: cinema.id });
  }

  return cinema;
}

/**
 * `code` is unique within a cinema (see the migration's index) - one code
 * names one offer within one cinema.
 *
 * @throws {ConflictError} 409 when the code is already used in that cinema.
 */
async function assertCodeAvailable(cinemaId, code, excludeId) {
  const where = { cinemaId, code };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Offer.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('An offer with this code already exists in this cinema', {
      cinemaId,
      code,
    });
  }
}

function assertValidityOrder(validFrom, validUntil) {
  if (!validFrom || !validUntil) return;

  if (new Date(validUntil) < new Date(validFrom)) {
    throw new ValidationError("'validUntil' cannot be earlier than 'validFrom'", [
      { field: 'validUntil', message: "'validUntil' cannot be earlier than 'validFrom'" },
    ]);
  }
}

async function findForUpdate(actor, offerId) {
  const offer = await models.Offer.findOne({
    where: { id: offerId },
    include: [cinemaScope(actor)],
  });

  if (!offer) throw new NotFoundError('Offer');

  return offer;
}

/**
 * Paginated, filtered offer list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{offers: object[], total: number}>}
 */
async function listOffers(actor, { page, limit, sort, order, cinemaId, status, code }) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (status) where.status = status;
  if (code) where.code = code;

  const { rows, count } = await models.Offer.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { offers: rows.map(serializeOffer), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is
 *   outside the actor's chain.
 */
async function getOffer(actor, offerId) {
  const offer = await models.Offer.findOne({
    where: { id: offerId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!offer) throw new NotFoundError('Offer');

  return serializeOffer(offer);
}

async function createOffer(actor, payload) {
  const { cinemaId, ...attributes } = payload;

  await findCinemaInScope(actor, cinemaId);
  await assertCodeAvailable(cinemaId, attributes.code);
  assertValidityOrder(attributes.validFrom, attributes.validUntil);

  const offer = await models.Offer.create({
    ...attributes,
    cinemaId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeOffer(offer);
}

async function updateOffer(actor, offerId, payload) {
  const offer = await findForUpdate(actor, offerId);

  if (payload.code !== undefined && payload.code !== offer.code) {
    await assertCodeAvailable(offer.cinemaId, payload.code, offer.id);
  }

  assertValidityOrder(
    payload.validFrom !== undefined ? payload.validFrom : offer.validFrom,
    payload.validUntil !== undefined ? payload.validUntil : offer.validUntil
  );

  await offer.update({ ...payload, updatedBy: actor.id });

  return serializeOffer(offer);
}

/**
 * Deletion is a genuine delete, not soft: an offer's code becoming reusable
 * once retired is expected (the operator may reuse the same code for an
 * unrelated future coupon), unlike a banner's sequence slot, which stays
 * reserved for exactly that reason.
 */
async function deleteOffer(actor, offerId) {
  const offer = await findForUpdate(actor, offerId);

  // orders.offer_id is a NO ACTION foreign key (see the migration that added
  // it): an offer that has ever actually been redeemed must not disappear
  // from an order's own history. Checked here so that case is a clear 409,
  // not a raw database constraint error - the operator should deactivate
  // (status: 'inactive') a used coupon instead of deleting it.
  const redemptions = await models.Order.count({ where: { offerId: offer.id } });
  if (redemptions > 0) {
    throw new ConflictError(
      'This coupon has been used on at least one order and cannot be deleted. Set its status to inactive instead.',
      { offerId: offer.id, redemptions }
    );
  }

  const serialized = serializeOffer(offer);
  await offer.destroy();
  return serialized;
}

module.exports = {
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  serializeOffer,
  PUBLIC_ATTRIBUTES,
};
