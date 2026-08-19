'use strict';

/**
 * Screens.
 *
 * A screen carries no chain_id of its own, so tenant scope is applied through
 * its cinema: every query joins `cinemas` with `required: true` and filters on
 * chain_id, which means a screen in another chain simply does not exist as far
 * as this module is concerned. Out-of-scope ids are reported as 404 rather than
 * 403 - confirming a row exists is itself a leak.
 *
 * `cinema_id` is fixed at creation and cannot be updated: orders reference a
 * screen, so moving one between cinemas would rewrite the history of those
 * orders.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = ['id', 'cinemaId', 'name', 'isActive', 'createdAt', 'updatedAt'];

function serializeScreen(screen) {
  if (!screen) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = screen[attribute];
  }

  return result;
}

/**
 * Join to the parent cinema, filtered to the actor's chain.
 *
 * `required: true` makes this an inner join, so a screen whose cinema is outside
 * the actor's chain drops out of the result set rather than coming back with a
 * null cinema. Owners get the same join with no filter, which keeps one query
 * shape for both cases.
 */
function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

/**
 * Resolve the parent cinema of a screen being created.
 *
 * Scoped, so a cinema in another chain is a 404 and not a 403 - otherwise this
 * endpoint would confirm which cinema ids exist elsewhere in the system. A
 * deactivated cinema is a 409 instead: it exists and is visible to the actor,
 * and the request conflicts with its current state.
 *
 * Create only. Deactivating a cinema deliberately leaves its existing screens
 * alone - the rule stops new rows being added underneath a closed parent, it is
 * not a cascade.
 *
 * @throws {NotFoundError} 404 when the cinema does not exist or is out of scope.
 * @throws {ConflictError} 409 when the cinema is deactivated.
 */
async function findCinemaInScope(actor, cinemaId) {
  const where = { id: cinemaId };
  if (actor.role !== ROLES.OWNER) where.chainId = actor.chainId;

  const cinema = await models.Cinema.findOne({
    where,
    attributes: ['id', 'chainId', 'isActive'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  if (!cinema.isActive) {
    throw new ConflictError('Cannot add a screen to a deactivated cinema', {
      cinemaId: cinema.id,
    });
  }

  return cinema;
}

/**
 * Screen names are unique within a cinema - "Screen 1" may exist once per
 * cinema, not once per database.
 *
 * Enforced here rather than by the database: the frozen schema carries no unique
 * index on (cinema_id, name). That leaves a race between this check and the
 * insert, which is acceptable for an operation performed by hand a handful of
 * times - closing it properly needs an index, and the schema is frozen.
 *
 * Deactivated screens are counted: a soft-deleted row still holds its name, so
 * reusing it would produce two "Screen 1" rows the moment the old one is
 * reactivated.
 *
 * @throws {ConflictError} 409 when the name is taken in that cinema.
 */
async function assertNameAvailable(cinemaId, name, excludeId) {
  const where = { cinemaId, name };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Screen.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('A screen with this name already exists in this cinema', {
      cinemaId,
      name,
    });
  }
}

/**
 * Load a screen for modification. Unlike getScreen this returns the instance
 * with every column loaded - a partially loaded instance would fail model
 * validation on save.
 */
async function findForUpdate(actor, screenId) {
  const screen = await models.Screen.findOne({
    where: { id: screenId },
    include: [cinemaScope(actor)],
  });

  if (!screen) throw new NotFoundError('Screen');

  return screen;
}

/**
 * Paginated, filtered screen list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{screens: object[], total: number}>}
 */
async function listScreens(actor, { page, limit, sort, order, search, cinemaId, isActive }) {
  const where = {};

  if (cinemaId) where.cinemaId = cinemaId;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.name = { [Op.like]: `%${search}%` };

  const { rows, count } = await models.Screen.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    // Carries the tenant filter. A cinemaId from another chain narrows an
    // already-scoped set to nothing rather than escaping it.
    include: [cinemaScope(actor)],
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { screens: rows.map(serializeScreen), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or its cinema is outside
 *   the actor's chain.
 */
async function getScreen(actor, screenId) {
  const screen = await models.Screen.findOne({
    where: { id: screenId },
    attributes: PUBLIC_ATTRIBUTES,
    include: [cinemaScope(actor)],
  });

  if (!screen) throw new NotFoundError('Screen');

  return serializeScreen(screen);
}

async function createScreen(actor, payload) {
  const { cinemaId, ...attributes } = payload;

  await findCinemaInScope(actor, cinemaId);
  await assertNameAvailable(cinemaId, attributes.name);

  const screen = await models.Screen.create({
    ...attributes,
    cinemaId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeScreen(screen);
}

async function updateScreen(actor, screenId, payload) {
  const screen = await findForUpdate(actor, screenId);

  // Skipped when the name is unchanged, so re-saving a screen without touching
  // its name never trips the uniqueness check against itself.
  if (payload.name !== undefined && payload.name !== screen.name) {
    await assertNameAvailable(screen.cinemaId, payload.name, screen.id);
  }

  await screen.update({ ...payload, updatedBy: actor.id });

  return serializeScreen(screen);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - orders and POS
 * mappings reference it.
 *
 * Idempotent.
 */
async function deactivateScreen(actor, screenId) {
  const screen = await findForUpdate(actor, screenId);

  if (screen.isActive) {
    await screen.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeScreen(screen);
}

module.exports = {
  listScreens,
  getScreen,
  createScreen,
  updateScreen,
  deactivateScreen,
  serializeScreen,
  PUBLIC_ATTRIBUTES,
};
