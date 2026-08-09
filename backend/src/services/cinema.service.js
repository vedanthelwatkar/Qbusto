'use strict';

/**
 * Cinemas.
 *
 * Every read and write is filtered by chain_id, so a chain_admin cannot see or
 * modify a cinema belonging to another chain. Out-of-scope ids are reported as
 * 404 rather than 403 - confirming a row exists is itself a leak.
 *
 * `chain_id` is fixed at creation and cannot be updated: moving a cinema between
 * chains would carry its screens, orders and pricing across a tenant boundary.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'chainId',
  'code',
  'name',
  'location',
  'city',
  'gstNumber',
  'fssaiNumber',
  'activeSince',
  'smsEnabled',
  'whatsappEnabled',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeCinema(cinema) {
  if (!cinema) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = cinema[attribute];
  }

  return result;
}

/** Extra `where` clause confining non-owners to their own chain. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}

/**
 * A cinema may only be created in a chain that exists and is still active.
 *
 * The foreign key would reject a missing chain anyway, but as an opaque 409;
 * checking first turns it into a 404 that names what was missing. A missing
 * chain is a 404 because the id addresses nothing; a deactivated one is a 409
 * because it exists and the request conflicts with its current state.
 *
 * Create only. Deactivating a chain deliberately leaves its existing cinemas
 * alone - the rule stops new rows being added underneath a closed parent, it is
 * not a cascade.
 *
 * @throws {NotFoundError} 404 when the chain does not exist.
 * @throws {ConflictError} 409 when the chain is deactivated.
 */
async function assertChainAcceptsCinemas(chainId) {
  const chain = await models.Chain.findByPk(chainId, { attributes: ['id', 'isActive'] });

  if (!chain) throw new NotFoundError('Chain');

  if (!chain.isActive) {
    throw new ConflictError('Cannot add a cinema to a deactivated chain', { chainId: chain.id });
  }
}

/**
 * Load a cinema for modification. Unlike getCinema this returns the instance
 * with every column loaded - a partially loaded instance would fail model
 * validation on save.
 */
async function findForUpdate(actor, cinemaId) {
  const cinema = await models.Cinema.findOne({ where: { id: cinemaId, ...tenantScope(actor) } });

  if (!cinema) throw new NotFoundError('Cinema');

  return cinema;
}

/**
 * Paginated, filtered cinema list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{cinemas: object[], total: number}>}
 */
async function listCinemas(actor, { page, limit, sort, order, search, chainId, city, isActive }) {
  const where = { ...tenantScope(actor) };

  // Narrows within the actor's scope; it can never widen it, because tenantScope
  // is spread first and an owner is the only role it leaves unset.
  if (chainId && actor.role === ROLES.OWNER) where.chainId = chainId;
  if (city) where.city = city;
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { code: { [Op.like]: `%${search}%` } },
      { city: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await models.Cinema.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { cinemas: rows.map(serializeCinema), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or is outside the actor's
 *   chain.
 */
async function getCinema(actor, cinemaId) {
  const cinema = await models.Cinema.findOne({
    where: { id: cinemaId, ...tenantScope(actor) },
    attributes: PUBLIC_ATTRIBUTES,
  });

  if (!cinema) throw new NotFoundError('Cinema');

  return serializeCinema(cinema);
}

/**
 * A duplicate `code` is left to the UQ_cinemas_code constraint, which the error
 * handler turns into a 409 - checking first would only add a query and still
 * lose a race.
 */
async function createCinema(actor, payload) {
  const { chainId, ...attributes } = payload;

  // Only an owner may place a cinema in another chain; anyone else creates
  // within their own, whatever the request body said.
  const targetChainId = actor.role === ROLES.OWNER ? (chainId ?? actor.chainId) : actor.chainId;

  await assertChainAcceptsCinemas(targetChainId);

  const cinema = await models.Cinema.create({
    ...attributes,
    chainId: targetChainId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeCinema(cinema);
}

async function updateCinema(actor, cinemaId, payload) {
  const cinema = await findForUpdate(actor, cinemaId);

  await cinema.update({ ...payload, updatedBy: actor.id });

  return serializeCinema(cinema);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - screens, orders
 * and pricing all reference it.
 *
 * Idempotent.
 */
async function deactivateCinema(actor, cinemaId) {
  const cinema = await findForUpdate(actor, cinemaId);

  if (cinema.isActive) {
    await cinema.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeCinema(cinema);
}

module.exports = {
  listCinemas,
  getCinema,
  createCinema,
  updateCinema,
  deactivateCinema,
  serializeCinema,
  PUBLIC_ATTRIBUTES,
};
