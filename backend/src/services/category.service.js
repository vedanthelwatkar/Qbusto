'use strict';

/**
 * Categories.
 *
 * Chain-scoped, exactly like cinemas: every read and write is filtered by
 * chain_id, and an out-of-scope id is reported as 404 rather than 403 -
 * confirming a row exists is itself a leak. Per-cinema visibility lives in
 * cinema_categories. The per-cinema DISPLAY ORDER of those categories lives
 * on that same link row and IS part of this module - see the
 * "Per-cinema category display order" section at the bottom.
 *
 * `chain_id` is fixed at creation and cannot be updated: moving a category
 * between chains would drag its products across a tenant boundary.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models, sequelize } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { ROLES } = require('../constants');
const cache = require('./cache.service');

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

  // Which cinemas this category is assigned to. Categories are chain-scoped and
  // carry no cinema of their own, so cinema_categories is the only answer to
  // "where does this appear" - the details drawer shows it beside the chain.
  const links = await models.CinemaCategory.findAll({
    where: { categoryId, isActive: true },
    attributes: ['cinemaId'],
    order: [['cinemaId', 'ASC']],
  });

  return { ...serializeCategory(category), cinemaIds: links.map((link) => link.cinemaId) };
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

// Catalogue writes drop the read-through cache - see services/cache.service.js.
// Wrapped at the export boundary rather than inside each function, so every
// invalidation point in this file is visible in one place.

// ---------------------------------------------------------------------------
// Per-cinema category display order
//
// WHY THE ORDER IS PER CINEMA AND NOT PER CHAIN
//
// Two cinemas in one chain can want different sections first - a multiplex
// leading with Main Course and a dessert-heavy site leading with Desserts is
// the client's own example. `categories` is chain-scoped, so it cannot hold
// that; the cinema-specific answer belongs on the link row between them.
//
// NO NEW TABLE, AND NO SCHEMA CHANGE AT ALL
//
// `cinema_categories` already carries `sequence` (int NOT NULL DEFAULT 0), and
// it is exactly the (cinema_id, category_id) grain the ordering needs. Adding
// a second table for the same relationship would leave two places to look for
// one fact.
//
// SEQUENCE 0 MEANS "UNSET", AND SORTS LAST
//
// The column's default is 0 and every existing row would carry it, so treating
// 0 as "first" would make a cinema that orders three of its twenty categories
// look completely shuffled. Unset therefore sorts AFTER everything explicitly
// ordered, alphabetically among itself - which is precisely today's behaviour
// for a cinema nobody has ordered yet. Setting an order is opt-in and cannot
// regress a cinema that has not opted in.
// ---------------------------------------------------------------------------

/**
 * A cinema the actor may see, or a 404.
 *
 * Out of scope is reported as "not found", never 403 - existence is not
 * disclosed across a tenant boundary. See .claude/rules/tenancy-auth.md.
 */
async function cinemaInScope(actor, cinemaId) {
  const cinema = await models.Cinema.findOne({
    where: { id: cinemaId, ...tenantScope(actor) },
    attributes: ['id', 'chainId'],
  });

  if (!cinema) throw new NotFoundError('Cinema');

  return cinema;
}

/**
 * The cinema's categories in the order a customer sees them.
 *
 * Every category in the cinema's chain is returned, not only the ones that
 * already have a link row: an admin ordering a list needs to see the whole
 * list, including the ones sitting at the bottom because nobody has placed
 * them yet.
 *
 * @returns {Promise<Array<{id: number, name: string, sequence: number}>>}
 *   `sequence` is 0 for a category that has not been placed.
 */
async function listCategoryOrder(actor, cinemaId) {
  const cinema = await cinemaInScope(actor, cinemaId);

  const [categories, links] = await Promise.all([
    models.Category.findAll({
      where: { chainId: cinema.chainId, isActive: true },
      attributes: ['id', 'name'],
      order: [['name', 'ASC']],
    }),
    models.CinemaCategory.findAll({
      where: { cinemaId: cinema.id, isActive: true },
      attributes: ['categoryId', 'sequence'],
    }),
  ]);

  const sequenceByCategory = new Map(links.map((link) => [link.categoryId, link.sequence]));

  return categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      sequence: sequenceByCategory.get(category.id) ?? 0,
    }))
    .sort(orderComparator);
}

/**
 * The single definition of "category display order", used by the staff list
 * above and mirrored by the Consumer's SQL - see consumer.service.getCategories.
 *
 * Placed categories first, by sequence; unplaced ones after, alphabetically.
 * Name is the tie-break at both levels, so the order is total and stable
 * rather than dependent on whatever the database returned first.
 */
function orderComparator(a, b) {
  const placedA = a.sequence > 0 ? 0 : 1;
  const placedB = b.sequence > 0 ? 0 : 1;

  if (placedA !== placedB) return placedA - placedB;
  if (placedA === 0 && a.sequence !== b.sequence) return a.sequence - b.sequence;

  return a.name.localeCompare(b.name);
}

/**
 * Set the cinema's category order.
 *
 * `categoryIds` is the display order itself: position 1 in the array becomes
 * sequence 1, and so on. Sending a positional list rather than a map of
 * explicit numbers is what makes a drag-and-drop list a single request, and it
 * makes duplicate or colliding sequence values impossible to express.
 *
 * A category absent from the list is RESET to 0 (unplaced), not left at a
 * stale sequence - a half-applied order is worse than none.
 *
 * WHAT A LINK ROW MEANS, AND WHAT IT DOES NOT
 *
 * This creates a `cinema_categories` row for any ordered category that has
 * none, because that row is where the sequence lives. Today nothing reads a
 * link row as an ASSIGNMENT: the Consumer decides which categories a cinema
 * shows from `cinema_products` and `product_pricing`, and joins
 * `cinema_categories` only LEFT, only for the sequence. If a future change
 * gives the link row visibility meaning, this function becomes a way to
 * assign a category to a cinema by ordering it - decide that deliberately
 * rather than inheriting it.
 *
 * Every category named must belong to the cinema's chain; one that does not is
 * a 404, because a cross-tenant category is not a category this caller can see.
 * The CinemaCategory beforeSave hook enforces the same rule at the model, and
 * is deliberately not relied on alone: it would surface as a 409 mid-loop with
 * some rows already written.
 */
async function setCategoryOrder(actor, cinemaId, categoryIds) {
  const cinema = await cinemaInScope(actor, cinemaId);

  const unique = [...new Set(categoryIds)];

  if (unique.length !== categoryIds.length) {
    throw new ValidationError('A category may appear only once in the order', [
      { field: 'categoryIds', message: 'Remove the duplicate entries' },
    ]);
  }

  if (unique.length > 0) {
    const owned = await models.Category.count({
      where: { id: { [Op.in]: unique }, chainId: cinema.chainId },
    });

    if (owned !== unique.length) throw new NotFoundError('Category');
  }

  await sequelize.transaction(async (transaction) => {
    // Everything back to unplaced first, so a category dropped from the list
    // does not keep the position it used to hold.
    await models.CinemaCategory.update(
      { sequence: 0, updatedBy: actor.id },
      { where: { cinemaId: cinema.id }, transaction }
    );

    for (const [index, categoryId] of unique.entries()) {
      const sequence = index + 1;

      const [link, created] = await models.CinemaCategory.findOrCreate({
        where: { cinemaId: cinema.id, categoryId },
        defaults: {
          cinemaId: cinema.id,
          categoryId,
          sequence,
          isActive: true,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        transaction,
      });

      /*
       * findOrCreate does not update an existing row, and most rows here will
       * already exist on the second call onwards.
       *
       * `isActive: true` is written back deliberately. The link is matched on
       * (cinemaId, categoryId) ALONE - it has to be, that pair is the unique
       * key - so a deactivated link would otherwise be found, given a
       * sequence, and then ignored by both readers, which filter
       * `is_active = 1`. The admin would get a 200 for an order that never
       * takes effect. Placing a category in the order is an explicit act, so
       * it reactivates the link rather than silently doing nothing.
       */
      if (!created) {
        await link.update({ sequence, isActive: true, updatedBy: actor.id }, { transaction });
      }
    }
  });

  return listCategoryOrder(actor, cinemaId);
}

// Catalogue writes drop the read-through cache - the Consumer's category list
// is cached per cinema, and a reorder changes it.
module.exports = {
  listCategories,
  getCategory,
  listCategoryOrder,
  setCategoryOrder: cache.invalidatingAfter(setCategoryOrder),
  createCategory: cache.invalidatingAfter(createCategory),
  updateCategory: cache.invalidatingAfter(updateCategory),
  deactivateCategory: cache.invalidatingAfter(deactivateCategory),
  serializeCategory,
  PUBLIC_ATTRIBUTES,
};
