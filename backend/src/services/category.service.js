'use strict';

/**
 * Categories.
 *
 * Chain-scoped, exactly like cinemas: every read and write is filtered by
 * chain_id, and an out-of-scope id is reported as 404 rather than 403 -
 * confirming a row exists is itself a leak. Per-cinema visibility lives in
 * cinema_categories and is not part of this module.
 *
 * `chain_id` is fixed at creation and cannot be updated: moving a category
 * between chains would drag its products across a tenant boundary.
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
  'name',
  'description',
  'imageUrl',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeCategory(category) {
  if (!category) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = category[attribute];
  }

  return result;
}

/** Extra `where` clause confining non-owners to their own chain. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}

/**
 * A category may only be created in a chain that exists.
 *
 * Only reachable for owners - every other role has chain_id forced to their own.
 *
 * @throws {NotFoundError} 404 when the chain does not exist.
 */
async function assertChainExists(chainId) {
  const chain = await models.Chain.findByPk(chainId, { attributes: ['id'] });

  if (!chain) throw new NotFoundError('Chain');
}

/**
 * Category names are unique within a chain - two chains may each have a
 * "Beverages", one chain may not have two.
 *
 * Enforced here rather than by the database: the frozen schema carries no
 * unique index on (chain_id, name). That leaves a race between this check and
 * the insert, which is acceptable for an operation performed by hand - closing
 * it properly needs an index, and the schema is frozen.
 *
 * Deactivated categories are counted: a soft-deleted row still holds its name.
 *
 * @throws {ConflictError} 409 when the name is taken in that chain.
 */
async function assertNameAvailable(chainId, name, excludeId) {
  const where = { chainId, name };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Category.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('A category with this name already exists in this chain', {
      chainId,
      name,
    });
  }
}

/**
 * Load a category for modification. Unlike getCategory this returns the
 * instance with every column loaded - a partially loaded instance would fail
 * model validation on save.
 */
async function findForUpdate(actor, categoryId) {
  const category = await models.Category.findOne({
    where: { id: categoryId, ...tenantScope(actor) },
  });

  if (!category) throw new NotFoundError('Category');

  return category;
}

/**
 * Paginated, filtered category list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{categories: object[], total: number}>}
 */
async function listCategories(actor, { page, limit, sort, order, search, chainId, isActive }) {
  const where = { ...tenantScope(actor) };

  // Narrows within the actor's scope; it can never widen it, because
  // tenantScope is spread first and an owner is the only role it leaves unset.
  if (chainId && actor.role === ROLES.OWNER) where.chainId = chainId;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.name = { [Op.like]: `%${search}%` };

  const { rows, count } = await models.Category.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { categories: rows.map(serializeCategory), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or is outside the actor's
 *   chain.
 */
async function getCategory(actor, categoryId) {
  const category = await models.Category.findOne({
    where: { id: categoryId, ...tenantScope(actor) },
    attributes: PUBLIC_ATTRIBUTES,
  });

  if (!category) throw new NotFoundError('Category');

  return serializeCategory(category);
}

async function createCategory(actor, payload) {
  const { chainId, ...attributes } = payload;

  // Only an owner may place a category in another chain; anyone else creates
  // within their own, whatever the request body said.
  const targetChainId = actor.role === ROLES.OWNER ? (chainId ?? actor.chainId) : actor.chainId;

  await assertChainExists(targetChainId);
  await assertNameAvailable(targetChainId, attributes.name);

  const category = await models.Category.create({
    ...attributes,
    chainId: targetChainId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeCategory(category);
}

async function updateCategory(actor, categoryId, payload) {
  const category = await findForUpdate(actor, categoryId);

  // Skipped when the name is unchanged, so re-saving a category without
  // touching its name never trips the uniqueness check against itself.
  if (payload.name !== undefined && payload.name !== category.name) {
    await assertNameAvailable(category.chainId, payload.name, category.id);
  }

  await category.update({ ...payload, updatedBy: actor.id });

  return serializeCategory(category);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - products and
 * cinema_categories reference it.
 *
 * Idempotent. Products under the category are deliberately left alone; this is
 * not a cascade.
 */
async function deactivateCategory(actor, categoryId) {
  const category = await findForUpdate(actor, categoryId);

  if (category.isActive) {
    await category.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeCategory(category);
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deactivateCategory,
  serializeCategory,
  PUBLIC_ATTRIBUTES,
};
