'use strict';

/**
 * Products.
 *
 * A product carries its own chain_id *and* a category_id, and the database does
 * not check that the two agree. Rather than trust a client to keep them in
 * step, chain_id is never accepted from a request: it is copied from the
 * category the product is being filed under, so the two cannot disagree by
 * construction.
 *
 * Every read and write is filtered by chain_id, and an out-of-scope id is
 * reported as 404 rather than 403 - confirming a row exists is itself a leak.
 *
 * Deletion is soft: is_active is set to 0 and the row stays.
 *
 * No transactions: every operation here is a single-row write.
 */

const { Op } = require('sequelize');

const { models } = require('../config/database');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');
const { ROLES } = require('../constants');

const PUBLIC_ATTRIBUTES = [
  'id',
  'chainId',
  'categoryId',
  'name',
  'description',
  'weight',
  'imageUrl',
  'taxSlabCode',
  'isAddon',
  'addonParentId',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeProduct(product) {
  if (!product) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = product[attribute];
  }

  return result;
}

/** Extra `where` clause confining non-owners to their own chain. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}

/**
 * Resolve the category a product is being filed under, and with it the chain
 * the product belongs to.
 *
 * Scoped, so a category in another chain is a 404 - otherwise this endpoint
 * would confirm which category ids exist elsewhere in the system.
 *
 * @throws {NotFoundError} 404 when the category does not exist or is out of
 *   scope.
 */
async function findCategoryInScope(actor, categoryId) {
  const category = await models.Category.findOne({
    where: { id: categoryId, ...tenantScope(actor) },
    attributes: ['id', 'chainId'],
  });

  if (!category) throw new NotFoundError('Category');

  return category;
}

/**
 * Product names are unique within a category - "Popcorn" may appear once under
 * Snacks and once under Combos, but not twice under Snacks.
 *
 * Enforced here rather than by the database: the frozen schema carries no
 * unique index on (category_id, name). See category.service for the race this
 * leaves and why it is acceptable.
 *
 * Deactivated products are counted: a soft-deleted row still holds its name.
 *
 * @throws {ConflictError} 409 when the name is taken in that category.
 */
async function assertNameAvailable(categoryId, name, excludeId) {
  const where = { categoryId, name };
  if (excludeId !== undefined) where.id = { [Op.ne]: excludeId };

  const existing = await models.Product.findOne({ where, attributes: ['id'] });

  if (existing) {
    throw new ConflictError('A product with this name already exists in this category', {
      categoryId,
      name,
    });
  }
}

/**
 * An add-on's parent must exist, sit in the same chain, and not be an add-on
 * itself - add-on chains more than one level deep have no meaning at checkout.
 *
 * @throws {NotFoundError} 404 when the parent does not exist or is out of scope.
 * @throws {ValidationError} 400 when the parent is itself an add-on, or when a
 *   product is pointed at itself.
 */
async function assertAddonParent(actor, addonParentId, chainId, selfId) {
  if (addonParentId === undefined || addonParentId === null) return;

  if (selfId !== undefined && Number(addonParentId) === Number(selfId)) {
    throw new ValidationError('A product cannot be its own add-on parent', [
      { field: 'addonParentId', message: "'addonParentId' cannot reference the product itself" },
    ]);
  }

  const parent = await models.Product.findOne({
    where: { id: addonParentId, ...tenantScope(actor) },
    attributes: ['id', 'chainId', 'isAddon'],
  });

  if (!parent) throw new NotFoundError('Add-on parent product');

  if (parent.chainId !== chainId) {
    throw new ConflictError('The add-on parent belongs to a different chain', {
      addonParentId: parent.id,
      parentChainId: parent.chainId,
      productChainId: chainId,
    });
  }

  if (parent.isAddon) {
    throw new ValidationError('An add-on cannot be the parent of another add-on', [
      { field: 'addonParentId', message: "'addonParentId' must reference a non-add-on product" },
    ]);
  }
}

/**
 * Load a product for modification. Unlike getProduct this returns the instance
 * with every column loaded - a partially loaded instance would fail model
 * validation on save.
 */
async function findForUpdate(actor, productId) {
  const product = await models.Product.findOne({
    where: { id: productId, ...tenantScope(actor) },
  });

  if (!product) throw new NotFoundError('Product');

  return product;
}

/**
 * Paginated, filtered product list.
 *
 * @param {object} actor The authenticated user making the request.
 * @param {object} query Validated query params.
 * @returns {Promise<{products: object[], total: number}>}
 */
async function listProducts(
  actor,
  { page, limit, sort, order, search, categoryId, chainId, isAddon, addonParentId, isActive }
) {
  const where = { ...tenantScope(actor) };

  // Narrows within the actor's scope; it can never widen it.
  if (chainId && actor.role === ROLES.OWNER) where.chainId = chainId;
  if (categoryId) where.categoryId = categoryId;
  if (isAddon !== undefined) where.isAddon = isAddon;
  if (addonParentId) where.addonParentId = addonParentId;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) where.name = { [Op.like]: `%${search}%` };

  const { rows, count } = await models.Product.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { products: rows.map(serializeProduct), total: count };
}

/**
 * @throws {NotFoundError} When the id does not exist, or is outside the actor's
 *   chain.
 */
async function getProduct(actor, productId) {
  const product = await models.Product.findOne({
    where: { id: productId, ...tenantScope(actor) },
    attributes: PUBLIC_ATTRIBUTES,
  });

  if (!product) throw new NotFoundError('Product');

  return serializeProduct(product);
}

async function createProduct(actor, payload) {
  const { categoryId, ...attributes } = payload;

  // The category decides the chain. Nothing in the request can override it.
  const category = await findCategoryInScope(actor, categoryId);

  await assertNameAvailable(categoryId, attributes.name);
  await assertAddonParent(actor, attributes.addonParentId, category.chainId);

  const product = await models.Product.create({
    ...attributes,
    categoryId,
    chainId: category.chainId,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  return serializeProduct(product);
}

async function updateProduct(actor, productId, payload) {
  const product = await findForUpdate(actor, productId);

  // Re-filing under another category is allowed, but only inside the same
  // chain: findCategoryInScope already refuses categories outside the actor's
  // chain, and the explicit comparison closes the same hole for an owner, who
  // is not scoped at all.
  const targetCategoryId = payload.categoryId ?? product.categoryId;

  if (payload.categoryId !== undefined && payload.categoryId !== product.categoryId) {
    const category = await findCategoryInScope(actor, payload.categoryId);

    if (category.chainId !== product.chainId) {
      throw new ConflictError('The selected category belongs to a different chain', {
        categoryId: category.id,
        categoryChainId: category.chainId,
        productChainId: product.chainId,
      });
    }
  }

  // Re-checked when either half of the (category, name) pair moves.
  const targetName = payload.name ?? product.name;
  if (targetCategoryId !== product.categoryId || targetName !== product.name) {
    await assertNameAvailable(targetCategoryId, targetName, product.id);
  }

  await assertAddonParent(actor, payload.addonParentId, product.chainId, product.id);

  await product.update({ ...payload, updatedBy: actor.id });

  return serializeProduct(product);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - order items,
 * pricing and POS mappings all reference it.
 *
 * Idempotent.
 */
async function deactivateProduct(actor, productId) {
  const product = await findForUpdate(actor, productId);

  if (product.isActive) {
    await product.update({ isActive: false, updatedBy: actor.id });
  }

  return serializeProduct(product);
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  serializeProduct,
  PUBLIC_ATTRIBUTES,
};
