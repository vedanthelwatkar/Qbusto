'use strict';

/**
 * Chains - the top of the tenant tree.
 *
 * Tenant scope is narrower here than anywhere else: a chain *is* the tenant, so
 * a non-owner sees exactly one row, their own. Every read and write is filtered
 * by `id = actor.chainId`, which makes another chain's id a 404 rather than a
 * 403 - confirming a row exists is itself a leak.
 *
 * Deletion is soft: is_active is set to 0 and the row stays, because cinemas,
 * users, categories and products all reference it.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError, AuthorizationError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = ['id', 'name', 'logoImageUrl', 'isActive', 'createdAt', 'updatedAt'];

function serializeChain(chain) {
  if (!chain) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = chain[attribute];
  }

  return result;
}

/** Extra `where` clause confining a non-owner's list to their own chain. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { id: actor.chainId };
}

/**
 * Tenant scope for a single addressed chain.
 *
 * Deliberately a check and not a `where` clause. Elsewhere the scope is a
 * different column from the one being addressed, so `{ id, ...scope }` composes;
 * here both are `id`, and spreading would overwrite the requested id with the
 * actor's own - handing a non-owner their own chain for every id they asked for.
 *
 * Reported as 404 rather than 403 for the same reason as everywhere else:
 * confirming a row exists is itself a leak.
 *
 * @throws {NotFoundError} 404 when a non-owner addresses another chain.
 */
function assertInScope(actor, chainId) {
  if (actor.role === ROLES.OWNER) return;

  if (Number(chainId) !== actor.chainId) throw new NotFoundError('Chain');
}

/**
 * Only an owner may create a chain.
 *
 * Not a role hierarchy - a single comparison against one role, for the same
 * reason the owner role itself is owner-assignable only. Tenant scope pins every
 * other role to their own chain_id, so a chain created by anyone else would be
 * a row its creator could never read back, and could never put a cinema in.
 *
 * @throws {AuthorizationError} 403 when a non-owner tries to create a chain.
 */
function assertMayCreateChain(actor) {
  if (actor.role === ROLES.OWNER) return;

  throw new AuthorizationError('Only an owner may create a chain');
}

/**
 * Chain names are unique.
 *
 * Enforced here rather than by the database: the frozen schema carries no unique
 * index on chains.name. That leaves a race between this check and the insert,
 * which is acceptable for an operation performed by hand a handful of times -
 * closing it properly needs an index, and the schema is frozen.
 *
 * @throws {ConflictError} 409 when the name is taken.
 */
async function assertNameAvailable(name, excludeId) {
  const where = { name };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Chain.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('A chain with this name already exists', { name });
  }
}

/**
 * Load a chain for modification. Unlike getChain this returns the instance with
 * every column loaded - a partially loaded instance would fail model validation
 * on save.
 */
async function findForUpdate(actor, chainId) {
  assertInScope(actor, chainId);

  const chain = await models.Chain.findByPk(chainId);

  if (!chain) throw new NotFoundError('Chain');

  return chain;
}

/**
 * Paginated, filtered chain list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{chains: object[], total: number}>}
 */
async function listChains(actor, { page, limit, sort, order, search, isActive }) {
  const where = { ...tenantScope(actor) };

  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.name = { [Op.like]: `%${search}%` };

  const { rows, count } = await models.Chain.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { chains: rows.map(serializeChain), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or is not the actor's own
 *   chain.
 */
async function getChain(actor, chainId) {
  assertInScope(actor, chainId);

  const chain = await models.Chain.findByPk(chainId, { attributes: PUBLIC_ATTRIBUTES });

  if (!chain) throw new NotFoundError('Chain');

  return serializeChain(chain);
}

async function createChain(actor, payload) {
  assertMayCreateChain(actor);

  await assertNameAvailable(payload.name);

  const chain = await models.Chain.create({
    ...payload,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeChain(chain);
}

async function updateChain(actor, chainId, payload) {
  const chain = await findForUpdate(actor, chainId);

  // Skipped when the name is unchanged, so re-saving a chain without touching
  // its name never trips the uniqueness check against itself.
  if (payload.name !== undefined && payload.name !== chain.name) {
    await assertNameAvailable(payload.name, chain.id);
  }

  await chain.update({ ...payload, updatedBy: actor.id });

  return serializeChain(chain);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - cinemas, users,
 * categories and products all reference it.
 *
 * Idempotent.
 */
async function deactivateChain(actor, chainId) {
  const chain = await findForUpdate(actor, chainId);

  if (chain.isActive) {
    await chain.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeChain(chain);
}

module.exports = {
  listChains,
  getChain,
  createChain,
  updateChain,
  deactivateChain,
  serializeChain,
  PUBLIC_ATTRIBUTES,
};
